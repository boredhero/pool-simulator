"""Placeholder authoritative sim mirror (P2 fills in).
Contract: 2D circles + spin (wx,wy,wz), SI units, dt=1/240, swept TOI.
Keep numeric behavior aligned with frontend/src/sim via contracts/golden/*.json.
"""

from dataclasses import dataclass

DT = 1.0 / 240.0
BALL_R = 0.028575  # 57.15mm dia
BALL_M = 0.170  # kg
MU_S = 0.20
MU_R = 0.01
E_BALL = 0.95


@dataclass
class Ball:
    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    wx: float = 0.0
    wy: float = 0.0
    wz: float = 0.0


def step(balls: list[Ball], dt: float = DT) -> None:
    """TODO P2: sliding/rolling friction + swept collisions + cushions + pockets + sleep."""
    for b in balls:
        b.x += b.vx * dt
        b.y += b.vy * dt
