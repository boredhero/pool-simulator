"""Expose only completed continuation evidence to the model."""

import math

from app.api.jev import describe_plan


def test_plan_description_retains_measured_lookahead():
    description = describe_plan(
        {
            "family": "direct",
            "calledBall": 1,
            "calledPocket": 0,
            "elevation": math.pi / 18,
            "evidence": {"verified": True, "lookaheadDepth": 2, "followUpVerified": True},
        }
    )
    assert description["elevation_degrees"] == 10
    assert description["lookahead"]["verified_depth"] == 2
    assert description["lookahead"]["follow_up_verified"]
    assert not description["lookahead"]["verified_runout"]


def test_unverified_plan_does_not_claim_lookahead():
    description = describe_plan({"family": "direct", "calledBall": 1, "calledPocket": 0})
    assert description["lookahead"] == {
        "verified_depth": 0,
        "verified_runout": False,
        "follow_up_verified": False,
    }
