"""Geographic helpers: straight-line distance, coordinate checks, map boxes.

IMPORTANT: haversine_m() is a STRAIGHT-LINE ("as the crow flies") distance.
It is used only as a guess inside A* and for snapping. It must NEVER be
reported as a road distance.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from numbers import Real

# Earth radius in metres. This is the value OSMnx uses, so our straight-line
# distances match the ones measured in Phase 0.
EARTH_RADIUS_M = 6_371_009.0


class CoordinateError(ValueError):
    """A latitude or longitude is missing, not a number, or out of range."""


def _check_number(value: object, name: str) -> float:
    """Return value as a float, or raise CoordinateError.

    bool is rejected on purpose: True/False are technically numbers in
    Python, but they are never a valid coordinate.
    """
    if value is None:
        raise CoordinateError(f"{name} is missing (None).")
    if isinstance(value, bool) or not isinstance(value, Real):
        raise CoordinateError(
            f"{name} must be a number, but got {type(value).__name__}: {value!r}."
        )
    number = float(value)
    if not math.isfinite(number):
        raise CoordinateError(f"{name} must be a finite number, but got {value!r}.")
    return number


def validate_lat_lng(lat: object, lng: object) -> tuple[float, float]:
    """Check a coordinate pair and return it as (lat, lng) floats.

    lat must be in [-90, 90] and lng in [-180, 180]. Both ends are allowed.
    """
    lat_value = _check_number(lat, "lat")
    lng_value = _check_number(lng, "lng")
    if not -90.0 <= lat_value <= 90.0:
        raise CoordinateError(f"lat must be between -90 and 90, but got {lat_value}.")
    if not -180.0 <= lng_value <= 180.0:
        raise CoordinateError(f"lng must be between -180 and 180, but got {lng_value}.")
    return lat_value, lng_value


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance in metres between two points on the Earth.

    Inputs are NOT validated here (this function runs very often inside
    A*). Validate user input with validate_lat_lng() first.
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = phi2 - phi1
    delta_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    # min(1.0, ...) protects asin() from tiny floating-point overshoot.
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


@dataclass(frozen=True)
class GeoBox:
    """A rectangle on the map. The border counts as inside.

    Latitudes must be within [-90, 90] and longitudes within [-180, 180].
    Does not support boxes that cross the 180-degree meridian.
    """

    south: float
    north: float
    west: float
    east: float

    def __post_init__(self) -> None:
        # Range checks first. They are written as "not (low <= x <= high)"
        # so that NaN (which fails every comparison) is rejected too.
        for name, value in (("south", self.south), ("north", self.north)):
            if not -90.0 <= value <= 90.0:
                raise ValueError(
                    f"{name} must be a latitude between -90 and 90, but got {value}."
                )
        for name, value in (("west", self.west), ("east", self.east)):
            if not -180.0 <= value <= 180.0:
                raise ValueError(
                    f"{name} must be a longitude between -180 and 180, but got {value}."
                )
        # Order checks.
        if self.south > self.north:
            raise ValueError("south must not be greater than north.")
        if self.west > self.east:
            raise ValueError("west must not be greater than east.")

    def contains(self, lat: float, lng: float) -> bool:
        """True if the point is inside the box or exactly on its border."""
        return self.south <= lat <= self.north and self.west <= lng <= self.east

    @classmethod
    def from_points(cls, points: Iterable[tuple[float, float]]) -> "GeoBox":
        """The smallest box containing all (lat, lng) points."""
        lats: list[float] = []
        lngs: list[float] = []
        for lat, lng in points:
            lats.append(lat)
            lngs.append(lng)
        if not lats:
            raise ValueError("Cannot build a box from zero points.")
        return cls(min(lats), max(lats), min(lngs), max(lngs))