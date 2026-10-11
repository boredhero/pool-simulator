"""Shared shot entry point using the existing impulse approximation.

Finite tip compliance and close-stroke fouls are deliberately deferred until
we implement a published, validated contact model. See docs/stroke.md.
"""

from app.sim.physics import VMAX_NORMAL, ShotEvents, simulate_shot, strike


def strike_balls(
    balls,
    cue_id,
    dx,
    dy,
    power,
    tip_x,
    tip_y,
    vmax=VMAX_NORMAL,
    elevation=0.0,
    chalk_level=1.0,
):
    """Apply the established cue impulse; return events for later simulation."""
    cue = next(b for b in balls if b.id == cue_id)
    # Sequential impulse approximation: Dr. Dave TP B.10, pp. 2–3.
    # https://drdavepoolinfo.com/technical_proofs/new/TP_B-10.pdf
    # The existing calibration is retained; no finite contact law is inferred.
    strike(cue, dx, dy, power, tip_x, tip_y, vmax, elevation, chalk_level)
    return ShotEvents()


def simulate_stroke(
    balls,
    cue_id,
    dx,
    dy,
    power,
    tip_x,
    tip_y,
    vmax=VMAX_NORMAL,
    elevation=0.0,
    chalk_level=1.0,
):
    """Resolve the complete shot through the shared cue/physics entry point."""
    events = strike_balls(balls, cue_id, dx, dy, power, tip_x, tip_y, vmax, elevation, chalk_level)
    return simulate_shot(balls, cue_id, events=events)
