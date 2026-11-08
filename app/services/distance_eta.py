"""Distance and ETA calculation (CONTRACT.md sections 2 and 9).

What this file does, in simple words:
  * takes a road distance in METRES (RouteResult.total_distance_m) and an
    average speed in km/h;
  * returns the distance in km (2 decimals) and the ETA in minutes (1 decimal).

Formula (CONTRACT.md section 9):
    eta_min = (road_distance_km / average_speed_kmh) * 60

Rules applied here (Phase 4 decisions D1 and D2):
  * D1: the ETA is calculated from the UNROUNDED distance, then rounded once.
        The distance is NOT rounded first, so rounding errors never add up.
  * D2: rounding is "half up" (0.125 becomes 0.13). Python's built-in round()
        is "half to even" (0.125 becomes 0.12), which would surprise people.
  * The calculation uses Decimal numbers, so 25 m at 30 km/h is exactly
    0.05 min (and rounds to 0.1) instead of 0.04999999999999999.

This file does NOT read settings, the road graph, hospitals or the clock.
The caller passes the speed in (normally Settings.average_speed_kmh).
"""

import math
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from numbers import Real

__all__ = [
    "DISTANCE_DECIMALS",
    "ETA_DECIMALS",
    "DistanceEta",
    "calculate_distance_eta",
    "round_half_up",
]

DISTANCE_DECIMALS = 2  # CONTRACT.md section 2: distance_km, 2 decimals
ETA_DECIMALS = 1  # CONTRACT.md section 2: eta_min, 1 decimal

_METRES_PER_KM = Decimal(1000)
_MINUTES_PER_HOUR = Decimal(60)


@dataclass(frozen=True)
class DistanceEta:
    """Distance and ETA for one route.

    Attributes:
        distance_km: Road distance in km, rounded to 2 decimals (contract value).
        eta_min: ETA in minutes, rounded to 1 decimal (contract value).
        raw_eta_min: ETA in minutes before rounding. Not part of the API
            response; kept so ranking could use it if the team approves
            proposal P2 (rank on unrounded ETA).
    """

    distance_km: float
    eta_min: float
    raw_eta_min: float


def _to_decimal(value: object, name: str) -> Decimal:
    """Check that value is a real, finite number and return it as a Decimal.

    TypeError: not a number (text, None, True/False, ...).
    ValueError: a number that cannot be used (NaN or infinity).
    """
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError(f"{name} must be a number, but got {type(value).__name__}.")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number, but got {value!r}.")
    # repr() gives the shortest text that reads back as the same float,
    # so 0.1 becomes Decimal('0.1') and not 0.1000000000000000055...
    return Decimal(repr(number))


def round_half_up(value: Decimal, decimals: int) -> float:
    """Round a Decimal 'half up' to the given number of decimals."""
    quantum = Decimal(1).scaleb(-decimals)  # 2 -> Decimal('0.01')
    return float(value.quantize(quantum, rounding=ROUND_HALF_UP))


def calculate_distance_eta(
    distance_m: float, average_speed_kmh: float
) -> DistanceEta:
    """Convert a road distance (metres) and a speed (km/h) to distance_km and eta_min.

    Raises:
        TypeError: distance_m or average_speed_kmh is not a number.
        ValueError: distance_m is negative or not finite, or
            average_speed_kmh is not greater than 0 or not finite.
    """
    distance = _to_decimal(distance_m, "distance_m")
    speed = _to_decimal(average_speed_kmh, "average_speed_kmh")

    if distance < 0:
        raise ValueError(f"distance_m must not be negative, but got {distance_m!r}.")
    if speed <= 0:
        raise ValueError(
            f"average_speed_kmh must be greater than 0, but got {average_speed_kmh!r}."
        )

    # (km / speed) * 60 rewritten as (metres * 60) / (speed * 1000):
    # the same maths, but only ONE division, so exact values stay exact.
    raw_eta = (distance * _MINUTES_PER_HOUR) / (speed * _METRES_PER_KM)
    distance_km = distance / _METRES_PER_KM

    return DistanceEta(
        distance_km=round_half_up(distance_km, DISTANCE_DECIMALS),
        eta_min=round_half_up(raw_eta, ETA_DECIMALS),
        raw_eta_min=float(raw_eta),
    )