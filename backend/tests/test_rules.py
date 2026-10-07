from app.sim.physics import ShotEvents
from app.sim.rules import apply_shot, group_of, new_game, place_cue


def _ev(**kw) -> ShotEvents:
    base = {"first_contact": None, "potted": [], "rail_after_contact": False, "cue_potted": False}
    base.update(kw)
    return ShotEvents(**base)


def test_rack_valid():
    gs = new_game(1)
    assert len(gs.balls) == 16
    order = [b.n for b in gs.balls[1:]]
    assert len(set(order)) == 15
    assert 15 in order
    assert order[4] == 8
    assert sorted(group_of(n) for n in (order[10], order[14])) == ["solid", "stripe"]


def test_foul_flows():
    gs = new_game()
    apply_shot(gs, _ev())
    assert (gs.current, gs.ball_in_hand) == (1, True)
    gs = new_game()
    apply_shot(gs, _ev(first_contact=2, potted=[2], rail_after_contact=True))
    assert not gs.open and gs.groups[0] == "solid"
    apply_shot(gs, _ev(first_contact=9, rail_after_contact=True))
    assert (gs.current, gs.ball_in_hand) == (1, True)


def test_win_loss():
    gs = new_game()
    apply_shot(gs, _ev(first_contact=1, potted=[1], rail_after_contact=True))
    apply_shot(gs, _ev(first_contact=2, potted=[2, 8], rail_after_contact=True))
    assert gs.winner == 1
    # legal run-out wins
    gs = new_game()
    gs.groups, gs.open = ["solid", "stripe"], False
    for b in gs.balls:
        if b.n is not None and b.n != 8 and group_of(b.n) == "solid":
            b.potted = True
    gs.current = 0
    apply_shot(gs, _ev(first_contact=8, potted=[8], rail_after_contact=True))
    assert gs.winner == 0


def test_place_cue():
    gs = new_game()
    assert not place_cue(gs, -1, -1)
    o = gs.balls[1]
    assert not place_cue(gs, o.x, o.y)
    assert place_cue(gs, 1.0, 0.635)
