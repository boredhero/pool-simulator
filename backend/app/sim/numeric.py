"""Explicit arithmetic order shared with the browser simulation.

Pool coordinates and velocities are bounded; scaled hypot is unnecessary here.
Using the same expression avoids platform hypot/pow rounding differences being
amplified by dense ball collisions. This does not promise bitwise libm parity.
"""

import math


def norm(x: float, y: float, z: float = 0.0) -> float:
    return math.sqrt(x * x + y * y + z * z)
