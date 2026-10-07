"""Table geometry — WPA 9ft reference, SI units."""

from dataclasses import dataclass

TABLE_W = 2.54  # playfield x
TABLE_H = 1.27  # playfield y
BALL_R = 0.028575
BALL_DIA = BALL_R * 2
POCKET_CORNER_W = 0.114  # ~4.5in mouth
POCKET_SIDE_W = 0.127  # ~5in mouth
CAPTURE_R = 0.075  # capture circle radius around pocket center
JAW_R = 0.006  # jaw bumper radius

# pocket centers: 4 corners slightly outside rails + 2 sides
POCKETS: list[tuple[float, float, bool]] = [
    (0.0, 0.0, True),
    (TABLE_W / 2, -0.02, False),
    (TABLE_W, 0.0, True),
    (0.0, TABLE_H, True),
    (TABLE_W / 2, TABLE_H + 0.02, False),
    (TABLE_W, TABLE_H, True),
]

HEAD_STRING_X = TABLE_W * 0.25
FOOT_SPOT = (TABLE_W * 0.75, TABLE_H / 2)
HEAD_SPOT = (TABLE_W * 0.25, TABLE_H / 2)


@dataclass
class Cushion:
    x1: float
    y1: float
    x2: float
    y2: float


def cushions(gap: float = 0.09) -> list[Cushion]:
    """4 rails split at pockets; gap = half mouth inset from pocket center."""
    W, H = TABLE_W, TABLE_H
    g_c = POCKET_CORNER_W / 2 + 0.01
    g_s = POCKET_SIDE_W / 2 + 0.01
    return [
        Cushion(g_c, 0, W / 2 - g_s, 0),
        Cushion(W / 2 + g_s, 0, W - g_c, 0),
        Cushion(g_c, H, W / 2 - g_s, H),
        Cushion(W / 2 + g_s, H, W - g_c, H),
        Cushion(0, g_c, 0, H - g_c),
        Cushion(W, g_c, W, H - g_c),
    ]
