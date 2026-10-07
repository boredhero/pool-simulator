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


def cushions() -> list[Cushion]:
    """6 rail segments split at pocket mouths."""
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


def jaws() -> list[tuple[float, float]]:
    """Static jaw-bumper circles at cushion ends for rattle physics."""
    out: list[tuple[float, float]] = []
    for c in cushions():
        out.append((c.x1, c.y1))
        out.append((c.x2, c.y2))
    return out


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
