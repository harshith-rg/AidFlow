"""Location snapping: maps patient/ambulance and hospital coordinates to the road network.

This module validates coordinates, verifies coverage boundaries, finds the
nearest road intersection node deterministically, and checks distance limits.
"""

import math
from collections.abc import Mapping
from numbers import Real
from typing import Any, NamedTuple

from app.services.geo import EARTH_RADIUS_M, CoordinateError, haversine_m, validate_lat_lng
from app.services.road_graph import LatLng, RoadGraph

__all__ = [
    "OutOfCoverageError",
    "SnapResult",
    "SnappingError",
    "snap_hospital",
    "snap_location",
    "snap_point",
    "snap_to_road",
]

# Metres per degree of latitude anywhere on Earth
METRES_PER_LAT_DEGREE = EARTH_RADIUS_M * math.pi / 180.0


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class SnappingError(ValueError):
    """Base error for snapping failures."""


class OutOfCoverageError(SnappingError):
    """The requested location is outside the map coverage area or exceeds the snap limit."""


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
class SnapResult(NamedTuple):
    """Result of snapping geographic coordinates to a road graph node.

    Attributes:
        node_id: Integer ID of the nearest intersection node.
        distance_m: Straight-line distance in metres from the query coordinate
            to the snapped node.
        coords: (lat, lng) tuple of the snapped road node.
    """

    node_id: int
    distance_m: float
    coords: LatLng


# ---------------------------------------------------------------------------
# Snapping Function
# ---------------------------------------------------------------------------
def snap_to_road(
    graph: RoadGraph,
    lat: object,
    lng: object,
    max_distance_m: float | None = None,
) -> SnapResult:
    """Find the nearest road-network node to the given coordinates.

    Args:
        graph: The loaded RoadGraph.
        lat: Latitude in degrees [-90, 90].
        lng: Longitude in degrees [-180, 180].
        max_distance_m: Optional maximum allowed snapping distance in metres.
            If the nearest road node is further than this limit, an
            OutOfCoverageError is raised.

    Returns:
        SnapResult(node_id, distance_m, coords).

    Raises:
        TypeError: If graph is not a RoadGraph instance.
        SnappingError: If graph contains no nodes.
        CoordinateError: If lat/lng are missing, non-numeric, or out of range.
        OutOfCoverageError: If (lat, lng) is outside graph.coverage_box, or if
            the distance to the nearest node exceeds max_distance_m.
        ValueError: If max_distance_m is negative or not finite.
    """
    if not isinstance(graph, RoadGraph):
        raise TypeError(
            f"graph must be a RoadGraph instance, but got {type(graph).__name__}."
        )

    if graph.node_count == 0:
        raise SnappingError("RoadGraph contains no nodes to snap to.")

    # 1. Validate coordinates (raises CoordinateError if invalid)
    query_lat, query_lng = validate_lat_lng(lat, lng)

    # 2. Check coverage box: the query coordinate must be inside the map box
    if not graph.coverage_box.contains(query_lat, query_lng):
        box = graph.coverage_box
        raise OutOfCoverageError(
            f"Coordinates ({query_lat}, {query_lng}) lie outside the road network "
            f"coverage area (south={box.south}, north={box.north}, "
            f"west={box.west}, east={box.east})."
        )

    # 3. Validate max_distance_m if provided
    limit_m: float | None = None
    if max_distance_m is not None:
        if isinstance(max_distance_m, bool) or not isinstance(max_distance_m, Real):
            raise ValueError(
                f"max_distance_m must be a number, but got {type(max_distance_m).__name__}."
            )
        limit_m = float(max_distance_m)
        if not math.isfinite(limit_m) or limit_m < 0:
            raise ValueError(
                f"max_distance_m must be a non-negative finite number, got {max_distance_m!r}."
            )

    # 4. Search for the nearest node with deterministic tie-breaking
    # Pruned linear scan: latitude distance is a rigorous lower bound on
    # total great-circle distance.
    best_dist = float("inf")
    best_node: int | None = None

    for node_id in graph.node_ids:
        node_lat, node_lng = graph.coords(node_id)

        # Quick latitude-difference lower bound check
        lat_diff_m = abs(node_lat - query_lat) * METRES_PER_LAT_DEGREE
        if lat_diff_m >= best_dist:
            continue

        dist_m = haversine_m(query_lat, query_lng, node_lat, node_lng)

        # Strictly closer, or deterministic tie-breaker (lowest node ID wins)
        if dist_m < best_dist or (
            dist_m == best_dist and (best_node is None or node_id < best_node)
        ):
            best_dist = dist_m
            best_node = node_id

    if best_node is None:
        raise SnappingError("Unable to find any road node for snapping.")

    # 5. Check against maximum snapping distance limit if specified
    if limit_m is not None and best_dist > limit_m:
        raise OutOfCoverageError(
            f"Nearest road node {best_node} is {best_dist:.1f} m away, exceeding "
            f"the maximum allowed snapping distance of {limit_m:.1f} m."
        )

    return SnapResult(
        node_id=best_node,
        distance_m=best_dist,
        coords=graph.coords(best_node),
    )


# ---------------------------------------------------------------------------
# Aliases and Hospital Helper
# ---------------------------------------------------------------------------
snap_point = snap_to_road
snap_location = snap_to_road


def snap_hospital(
    graph: RoadGraph,
    hospital: Mapping[str, Any] | Any,
    max_distance_m: float | None = None,
) -> SnapResult:
    """Convenience helper to snap a hospital record or model to the road network.

    Accepts dicts with 'location' key or objects with a .location attribute.
    """
    if isinstance(hospital, Mapping):
        loc = hospital.get("location")
        if isinstance(loc, Mapping):
            lat, lng = loc.get("lat"), loc.get("lng")
        elif hasattr(loc, "lat") and hasattr(loc, "lng"):
            lat, lng = loc.lat, loc.lng
        else:
            raise SnappingError(f"Hospital mapping has no valid location: {hospital!r}.")
    elif hasattr(hospital, "location"):
        loc = hospital.location
        if isinstance(loc, Mapping):
            lat, lng = loc.get("lat"), loc.get("lng")
        elif hasattr(loc, "lat") and hasattr(loc, "lng"):
            lat, lng = loc.lat, loc.lng
        else:
            raise SnappingError(f"Hospital object has no valid location: {hospital!r}.")
    else:
        raise SnappingError(f"Expected a hospital dict or object, got {type(hospital).__name__}.")

    return snap_to_road(graph, lat, lng, max_distance_m=max_distance_m)
