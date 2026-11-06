"""AidFlow core services: road graph, geographic calculations, snapping, and routing."""

from app.services.astar import astar
from app.services.clock import get_reference_time
from app.services.dijkstra import dijkstra
from app.services.geo import CoordinateError, GeoBox, haversine_m, validate_lat_lng
from app.services.graph_loader import (
    DEFAULT_GRAPH_PATH,
    GraphError,
    clear_graph_cache,
    get_road_graph,
    load_road_graph,
)
from app.services.hospital_filter import (
    EligibleHospital,
    FilterResult,
    RejectedHospital,
    filter_hospitals,
    is_bed_data_stale,
)
from app.services.road_graph import Edge, LatLng, RoadGraph, RoadGraphError, UnknownNodeError
from app.services.routing import (
    NodeNotFoundError,
    PathNotFoundError,
    RouteResult,
    RoutingError,
    build_polyline,
    find_route,
    find_route_between_locations,
)
from app.services.snapping import (
    OutOfCoverageError,
    SnapResult,
    SnappingError,
    snap_hospital,
    snap_location,
    snap_point,
    snap_to_road,
)

__all__ = [
    # Road graph
    "RoadGraph",
    "Edge",
    "RoadGraphError",
    "UnknownNodeError",
    # Graph loader
    "load_road_graph",
    "get_road_graph",
    "clear_graph_cache",
    "GraphError",
    "DEFAULT_GRAPH_PATH",
    # Geo
    "haversine_m",
    "validate_lat_lng",
    "CoordinateError",
    "GeoBox",
    "LatLng",
    # Snapping
    "snap_to_road",
    "snap_point",
    "snap_location",
    "snap_hospital",
    "SnapResult",
    "SnappingError",
    "OutOfCoverageError",
    # Routing algorithms
    "dijkstra",
    "astar",
    # Routing facade and shapes
    "RouteResult",
    "find_route",
    "find_route_between_locations",
    "build_polyline",
    "RoutingError",
    "PathNotFoundError",
    "NodeNotFoundError",
    # Clock & Filter
    "get_reference_time",
    "filter_hospitals",
    "is_bed_data_stale",
    "EligibleHospital",
    "RejectedHospital",
    "FilterResult",
]
