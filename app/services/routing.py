"""Routing foundation: result shapes, polyline builder, error types and route facade.

This module provides the shared RouteResult data shape, path-to-polyline
construction, and a common find_route facade that dispatches to Dijkstra or A*.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.services.road_graph import Edge, LatLng, RoadGraph, UnknownNodeError

__all__ = [
    "NodeNotFoundError",
    "PathNotFoundError",
    "RouteResult",
    "RoutingError",
    "build_polyline",
    "find_route",
    "find_route_between_locations",
]


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class RoutingError(Exception):
    """Base exception for all routing problems."""


class PathNotFoundError(RoutingError):
    """Raised when no directed path connects the source and target nodes."""


class NodeNotFoundError(RoutingError, UnknownNodeError):
    """Raised when a requested node ID is not present in the road graph."""


# ---------------------------------------------------------------------------
# RouteResult: immutable result container with sequence unpacking
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RouteResult:
    """The result of a shortest-path search on a RoadGraph.

    Attributes:
        nodes: Sequence of node IDs along the route from source to destination.
        total_distance_m: Total road distance in metres along directed edges.
        edges: Directed Edge objects traversed along the route.
        polyline: Full sequence of (lat, lng) points describing the road curve.
    """

    nodes: tuple[int, ...]
    total_distance_m: float
    edges: tuple[Edge, ...] = ()
    polyline: tuple[LatLng, ...] = ()

    def __post_init__(self) -> None:
        # Enforce float for total distance
        if not isinstance(self.total_distance_m, (int, float)) or isinstance(
            self.total_distance_m, bool
        ):
            raise TypeError("total_distance_m must be a number.")
        dist_float = float(self.total_distance_m)
        if not math.isfinite(dist_float) or dist_float < 0:
            raise ValueError("total_distance_m must be a non-negative finite number.")
        object.__setattr__(self, "total_distance_m", dist_float)

    @property
    def distance_m(self) -> float:
        """Alias for total_distance_m."""
        return self.total_distance_m

    @property
    def distance_km(self) -> float:
        """Distance in kilometres, unrounded."""
        return self.total_distance_m / 1000.0

    @property
    def node_count(self) -> int:
        """Number of nodes along the path."""
        return len(self.nodes)

    @property
    def edge_count(self) -> int:
        """Number of edges traversed."""
        return len(self.edges)

    def __iter__(self):
        """Allows unpacking as (nodes, total_distance_m)."""
        yield self.nodes
        yield self.total_distance_m

    def __len__(self) -> int:
        """Length is 2 so it can be unpacked as a 2-tuple."""
        return 2

    def __getitem__(self, index: int) -> Any:
        if index == 0:
            return self.nodes
        if index == 1:
            return self.total_distance_m
        if index == 2:
            return self.edges
        if index == 3:
            return self.polyline
        raise IndexError(f"RouteResult index {index} out of range (0-3).")


# ---------------------------------------------------------------------------
# Polyline Construction
# ---------------------------------------------------------------------------
def build_polyline(
    graph: RoadGraph,
    nodes: Sequence[int],
    edges: Sequence[Edge] | None = None,
) -> tuple[LatLng, ...]:
    """Construct a full contiguous polyline of (lat, lng) coordinates for a path.

    When edges have detailed curvature shapes (Edge.shape), the curve points
    are concatenated seamlessly, omitting duplicate juncture points between
    consecutive edges. When shape is absent, node coordinates are used.
    """
    if not nodes:
        return ()

    if len(nodes) == 1:
        return (graph.coords(nodes[0]),)

    # Reconstruct edges from graph if not provided
    if edges is None:
        reconstructed_edges: list[Edge] = []
        for u, v in zip(nodes[:-1], nodes[1:]):
            edge = graph.edge(u, v)
            if edge is None:
                raise PathNotFoundError(
                    f"No directed edge exists between node {u} and node {v}."
                )
            reconstructed_edges.append(edge)
        edges = reconstructed_edges

    points: list[LatLng] = []
    for index, edge in enumerate(edges):
        if edge.shape and len(edge.shape) >= 2:
            # First edge appends all shape points; subsequent edges skip the first
            # point which duplicates the previous edge's ending node.
            if index == 0:
                points.extend(edge.shape)
            else:
                points.extend(edge.shape[1:])
        else:
            if index == 0:
                points.append(graph.coords(edge.source))
            points.append(graph.coords(edge.target))

    return tuple(points)


# ---------------------------------------------------------------------------
# Facade
# ---------------------------------------------------------------------------
def find_route(
    graph: RoadGraph,
    source: int,
    target: int,
    algorithm: str = "astar",
) -> RouteResult:
    """Find the shortest directed road path using either 'astar' or 'dijkstra'.

    Raises:
        UnknownNodeError: If source or target node ID is not in graph.
        PathNotFoundError: If target is not reachable from source.
        ValueError: If an unknown algorithm name is specified.
    """
    normalized = algorithm.strip().lower()
    if normalized in ("astar", "a*", "a_star"):
        from app.services.astar import astar

        return astar(graph, source, target)
    if normalized == "dijkstra":
        from app.services.dijkstra import dijkstra

        return dijkstra(graph, source, target)

    raise ValueError(
        f"Unknown routing algorithm {algorithm!r}. Supported: 'astar', 'dijkstra'."
    )


def find_route_between_locations(
    graph: RoadGraph,
    origin_lat: object,
    origin_lng: object,
    dest_lat: object,
    dest_lng: object,
    algorithm: str = "astar",
    max_snap_distance_m: float | None = None,
) -> RouteResult:
    """Snap origin and destination coordinates to the road network and compute route.

    Raises:
        CoordinateError: If any coordinates are invalid.
        OutOfCoverageError: If origin or destination is outside graph coverage
            or exceeds max_snap_distance_m.
        PathNotFoundError: If no road path connects the snapped nodes.
    """
    from app.services.snapping import snap_to_road

    origin_snap = snap_to_road(
        graph, origin_lat, origin_lng, max_distance_m=max_snap_distance_m
    )
    dest_snap = snap_to_road(
        graph, dest_lat, dest_lng, max_distance_m=max_snap_distance_m
    )

    return find_route(
        graph,
        origin_snap.node_id,
        dest_snap.node_id,
        algorithm=algorithm,
    )
