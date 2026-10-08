"""Server-written match ledger. Legacy client-posted scores never feed account stats."""

import json
import secrets
import time

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session as DatabaseSession

from app.models.db import Account, GameMatch, JevGame, MatchPlayer, MatchShot, Session, init_db
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
            account = db.get(Account, accounts[seat]) if accounts[seat] else None
            db.add(
                MatchPlayer(
                    match_id=match_id,
                    seat=seat,
                    account_id=account.id if account else None,
                    display_name="Deleted player"
                    if accounts[seat] and account is None
                    else names[seat],
                )
            )
    return match_id


def record_shot(
    match_id: str, sequence: int, seat: int, shot: dict, facts: dict, winner: int | None, foul: bool
) -> None:
    with Session.begin() as db:
        record_shot_in_session(db, match_id, sequence, seat, shot, facts, winner, foul)


def record_shot_in_session(db, match_id, sequence, seat, shot, facts, winner, foul):
    """Commit facts with the caller's authoritative game update, or neither."""
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


def abandon_match(
    match_id: str, seat: int, started: bool = False, interrupted: bool = False
) -> None:
    with Session.begin() as db:
        db.execute(
            update(GameMatch)
            .where(GameMatch.id == match_id, GameMatch.status == "active")
            .values(
                status="interrupted" if interrupted else "forfeit" if started else "abandoned",
                ended_at=int(time.time()),
                ended_by=None if interrupted else seat,
                winner_seat=1 - seat if started and not interrupted else None,
            )
        )


def interrupt_matches() -> None:
    """Live rooms are in memory; a restart must not leave durable matches marked active."""
    init_db()
    with Session.begin() as db:
        db.execute(
            update(GameMatch)
            .where(GameMatch.status == "active", GameMatch.mode == "online")
            .values(status="interrupted", ended_at=int(time.time()))
        )


def account_stats(account_id: str) -> dict:
    with Session() as db:
        completed = GameMatch.status.in_(("completed", "forfeit"))
        won = GameMatch.winner_seat == MatchPlayer.seat
        totals = db.execute(
            select(
                func.coalesce(func.sum(case((completed, 1), else_=0)), 0),
                func.coalesce(func.sum(case((completed & won, 1), else_=0)), 0),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (GameMatch.status.in_(("abandoned", "forfeit")))
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
                    "mode": match.mode,
                    "shotStatsComplete": match.shot_stats_complete,
                    "opponent": opponent.display_name,
                    "startedAt": match.started_at,
                    "result": ("win" if match.winner_seat == seat else "loss")
                    if match.status in ("completed", "forfeit")
                    else None,
                }
            )
        by_mode = {mode: {"matches": 0, "wins": 0, "losses": 0} for mode in ("online", "jev")}
        for mode, count, victories in db.execute(
            select(GameMatch.mode, func.count(), func.sum(case((won, 1), else_=0)))
            .join(MatchPlayer, GameMatch.id == MatchPlayer.match_id)
            .where(MatchPlayer.account_id == account_id, completed)
            .group_by(GameMatch.mode)
        ):
            by_mode[mode] = {"matches": count, "wins": victories, "losses": count - victories}
        incomplete = db.scalar(
            select(GameMatch.id)
            .join(MatchPlayer, GameMatch.id == MatchPlayer.match_id)
            .where(MatchPlayer.account_id == account_id, GameMatch.shot_stats_complete.is_(False))
            .limit(1)
        )
        return {
            "byMode": by_mode,
            "shotStatsComplete": incomplete is None,
            "category": "casual",
            "ranked": False,
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


def ensure_jev_match(db, game, *, historical=True):
    """Jev's globally random game ID also identifies its durable match ledger."""
    match = db.get(GameMatch, game.id)
    if match is not None:
        if match.mode != "jev":
            raise ValueError("Match identifier collision")
        return match
    state = json.loads(game.state)
    winner = state.get("winner")
    complete = game.status == "completed" and type(winner) is int and winner in (0, 1)
    account = db.get(Account, game.account_id)
    match = GameMatch(
        id=game.id,
        mode="jev",
        shot_stats_complete=not historical,
        rules=json.dumps(state["rules"]),
        ruleset="eight-ball:unknown" if historical else "eight-ball:2",
        game_version="historical-unknown" if historical else get_info()["version"],
        started_at=game.started_at,
        status="completed" if complete else game.status,
        winner_seat=winner if complete else None,
        ended_at=game.updated_at if complete or game.status != "active" else None,
    )
    db.add(match)
    db.flush()
    db.add_all(
        [
            MatchPlayer(
                match_id=game.id, seat=0, account_id=game.account_id, display_name=account.username
            ),
            MatchPlayer(match_id=game.id, seat=1, account_id=None, display_name="Jev AI"),
        ]
    )
    db.flush()
    return match


def backfill_jev_matches(connection):
    """Import retained authoritative final outcomes once; never invent shot facts."""
    with DatabaseSession(bind=connection) as db:
        candidates = db.scalars(
            select(JevGame)
            .outerjoin(GameMatch, GameMatch.id == JevGame.id)
            .where(JevGame.status == "completed", GameMatch.id.is_(None))
        ).all()
        for game in candidates:
            try:
                state = json.loads(game.state)
            except (ValueError, TypeError):
                continue
            if (
                not isinstance(state, dict)
                or type(state.get("winner")) is not int
                or state["winner"] not in (0, 1)
                or not isinstance(state.get("rules"), dict)
            ):
                continue
            ensure_jev_match(db, game)
        db.flush()
