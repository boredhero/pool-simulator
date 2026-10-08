"""Server-written match ledger. Legacy client-posted scores never feed account stats."""

import json
import secrets
import time

from sqlalchemy import case, func, select, update

from app.models.db import GameMatch, MatchPlayer, MatchShot, Session, init_db
from app.version import get_info


def start_match(names: list[str], accounts: list[str | None], rules: dict) -> str:
    init_db()
    match_id = secrets.token_hex(16)
    with Session.begin() as db:
        db.add(
            GameMatch(
                id=match_id,
                rules=json.dumps(rules),
                game_version=get_info()["version"],
                started_at=int(time.time()),
                status="active",
            )
        )
        db.flush()
        for seat in (0, 1):
            db.add(
                MatchPlayer(
                    match_id=match_id,
                    seat=seat,
                    account_id=accounts[seat],
                    display_name=names[seat],
                )
            )
    return match_id


def record_shot(
    match_id: str, sequence: int, seat: int, shot: dict, facts: dict, winner: int | None, foul: bool
) -> None:
    with Session.begin() as db:
        match = db.get(GameMatch, match_id)
        if match is None or match.status != "active" or db.get(MatchShot, (match_id, sequence)):
            return
        db.add(
            MatchShot(
                match_id=match_id,
                sequence=sequence,
                seat=seat,
                shot=json.dumps(shot),
                facts=json.dumps(facts),
            )
        )
        player = db.get(MatchPlayer, (match_id, seat))
        player.shots += 1
        player.potted += len(facts["potted"])
        player.scratches += int(facts["cue_potted"] or None in facts["off_table"])
        player.fouls += int(foul)
        if winner is not None:
            match.status = "completed"
            match.winner_seat = winner
            match.ended_at = int(time.time())


def abandon_match(match_id: str, seat: int) -> None:
    with Session.begin() as db:
        db.execute(
            update(GameMatch)
            .where(GameMatch.id == match_id, GameMatch.status == "active")
            .values(status="abandoned", ended_at=int(time.time()), ended_by=seat)
        )


def interrupt_matches() -> None:
    """Live rooms are in memory; a restart must not leave durable matches marked active."""
    init_db()
    with Session.begin() as db:
        db.execute(
            update(GameMatch)
            .where(GameMatch.status == "active")
            .values(status="interrupted", ended_at=int(time.time()))
        )


def account_stats(account_id: str) -> dict:
    with Session() as db:
        completed = GameMatch.status == "completed"
        won = GameMatch.winner_seat == MatchPlayer.seat
        totals = db.execute(
            select(
                func.coalesce(func.sum(case((completed, 1), else_=0)), 0),
                func.coalesce(func.sum(case((completed & won, 1), else_=0)), 0),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (GameMatch.status == "abandoned")
                                & (GameMatch.ended_by == MatchPlayer.seat),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
                func.coalesce(func.sum(MatchPlayer.shots), 0),
                func.coalesce(func.sum(MatchPlayer.potted), 0),
                func.coalesce(func.sum(MatchPlayer.scratches), 0),
                func.coalesce(func.sum(MatchPlayer.fouls), 0),
            )
            .join(GameMatch, GameMatch.id == MatchPlayer.match_id)
            .where(MatchPlayer.account_id == account_id)
        ).one()
        matches, wins, abandoned, shots, potted, scratches, fouls = totals
        recent = db.execute(
            select(GameMatch, MatchPlayer.seat)
            .join(MatchPlayer, GameMatch.id == MatchPlayer.match_id)
            .where(MatchPlayer.account_id == account_id)
            .order_by(GameMatch.started_at.desc())
            .limit(10)
        ).all()
        history = []
        for match, seat in recent:
            opponent = db.get(MatchPlayer, (match.id, 1 - seat))
            history.append(
                {
                    "id": match.id,
                    "status": match.status,
                    "opponent": opponent.display_name,
                    "startedAt": match.started_at,
                    "result": ("win" if match.winner_seat == seat else "loss")
                    if match.status == "completed"
                    else None,
                }
            )
        return {
            "matches": matches,
            "wins": wins,
            "losses": matches - wins,
            "abandoned": abandoned,
            "shots": shots,
            "ballsPocketed": potted,
            "scratches": scratches,
            "fouls": fouls,
            "recent": history,
        }
