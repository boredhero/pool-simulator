"""Table geometry — WPA 9ft reference, SI units."""

from dataclasses import dataclass

TABLE_W = 2.54  # playfield x
TABLE_H = 1.27  # playfield y
BALL_R = 0.028575
BALL_DIA = BALL_R * 2
# WPA mouths: corner 4.5in, side 5.0in. Cushion noses end at the mouth edges.
CORNER_HALF = 0.0572
SIDE_HALF = 0.0635
_CB = 0.0287  # 1.6in along the corner bisector per axis

# Capture circles sit behind the nose line (pooltool layout, SI).
# (x, y, radius, is_corner)
POCKETS: list[tuple[float, float, float, bool]] = [
    (-_CB, -_CB, 0.061, True),
    (TABLE_W / 2, -0.066, 0.0635, False),
    (TABLE_W + _CB, -_CB, 0.061, True),
    (-_CB, TABLE_H + _CB, 0.061, True),
    (TABLE_W / 2, TABLE_H + 0.066, 0.0635, False),
    (TABLE_W + _CB, TABLE_H + _CB, 0.061, True),
]


def capture_radius(r: float, v: float) -> float:
    """Effective capture radius shrinks for fast balls (rattle-out)."""
    if v <= 1.0:
        return r
    return max(0.6 * r, r - 0.01016 * (v - 1.0))


HEAD_STRING_X = TABLE_W * 0.25
FOOT_SPOT = (TABLE_W * 0.75, TABLE_H / 2)
HEAD_SPOT = (TABLE_W * 0.25, TABLE_H / 2)


@dataclass
class Cushion:
    x1: float
    y1: float
    x2: float
    y2: float


def cushions() -> list[Cushion]:
    """6 rail segments split at pocket mouths."""
    W, H = TABLE_W, TABLE_H
    return [
        Cushion(CORNER_HALF, 0, W / 2 - SIDE_HALF, 0),
        Cushion(W / 2 + SIDE_HALF, 0, W - CORNER_HALF, 0),
        Cushion(CORNER_HALF, H, W / 2 - SIDE_HALF, H),
        Cushion(W / 2 + SIDE_HALF, H, W - CORNER_HALF, H),
        Cushion(0, CORNER_HALF, 0, H - CORNER_HALF),
        Cushion(W, CORNER_HALF, W, H - CORNER_HALF),
    ]


def jaws() -> list[tuple[float, float, float]]:
    """Jaw bumpers: corner r=0.83in, side r=0.31in, tucked behind the nose line."""
    W, H = TABLE_W, TABLE_H
    cj, sj, co, so = 0.021, 0.0079, 0.0076, 0.0071
    return [
        (CORNER_HALF + co, -cj, cj),
        (-cj, CORNER_HALF + co, cj),
        (W - CORNER_HALF - co, -cj, cj),
        (W + cj, CORNER_HALF + co, cj),
        (CORNER_HALF + co, H + cj, cj),
        (-cj, H - CORNER_HALF - co, cj),
        (W - CORNER_HALF - co, H + cj, cj),
        (W + cj, H - CORNER_HALF - co, cj),
        (W / 2 - SIDE_HALF - so, -sj, sj),
        (W / 2 + SIDE_HALF + so, -sj, sj),
        (W / 2 - SIDE_HALF - so, H + sj, sj),
        (W / 2 + SIDE_HALF + so, H + sj, sj),
    ]


def rack_order(seed: int = 1) -> list[int]:
    """Deterministic rack: 1 apex, 8 center, corners one solid + one stripe."""
    s = seed & 0xFFFFFFFF or 1

    def rnd() -> float:
        nonlocal s
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
        return s / 4294967296

    def shuffled(arr: list[int]) -> list[int]:
        a = list(arr)
        for i in range(len(a) - 1, 0, -1):
            j = int(rnd() * (i + 1))
            a[i], a[j] = a[j], a[i]
        return a

    solids = shuffled([2, 3, 4, 5, 6, 7])
    stripes = shuffled([9, 10, 11, 12, 13, 14, 15])
    slots = [1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    if rnd() < 0.5:
        slots[10], slots[14] = solids.pop(), stripes.pop()
    else:
        slots[10], slots[14] = stripes.pop(), solids.pop()
    rest = shuffled([*solids, *stripes])
    for i in range(len(slots)):
        if slots[i] == 0:
            slots[i] = rest.pop()
    return slots


def rack_positions() -> list[tuple[float, float]]:
    apex_x, apex_y = TABLE_W * 3 / 4, TABLE_H / 2
    dx = BALL_R * 2 * 0.8660254 + 0.0004
    dy = BALL_R * 2 + 0.0004
    return [
        (apex_x + row * dx, apex_y + (i - row / 2) * dy) for row in range(5) for i in range(row + 1)
    ]
