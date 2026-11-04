"""The road graph: a read-only map of intersections and one-way-aware roads.

A node is an intersection. An Edge is one DIRECTED road piece from one node
to another, with a length in metres. A two-way road is stored as two edges
(one per direction); a one-way road is stored as one edge.

This file only HOLDS a map. It does not load files (graph_loader.py), snap
points to nodes (snapping.py) or search for routes (dijkstra.py, astar.py).

Rules the graph enforces, so the search code can rely on them:
  * node IDs are plain integers, and every node has a valid (lat, lng);
  * every edge joins two existing, different nodes;
  * at most ONE edge per (source, target) pair;
  * edge lengths are finite and not negative;
  * the heuristic factor is a number from 0 to 1.

Read-only: the internal lookup tables are wrapped in MappingProxyType, so
trying to add, change or delete an entry raises TypeError. Their values are
tuples, frozen Edge objects and tuples of floats, which cannot be changed
either.
"""

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from numbers import Real
from types import MappingProxyType
from typing import Any

from app.services.geo import CoordinateError, GeoBox, validate_lat_lng

LatLng = tuple[float, float]


class RoadGraphError(ValueError):
    """The map data is invalid."""


class UnknownNodeError(RoadGraphError):
    """A node ID is not part of this graph."""


def _is_node_id(value: object) -> bool:
    """Node IDs are plain integers. bool is rejected (True would equal 1)."""
    return isinstance(value, int) and not isinstance(value, bool)


def _check_length(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise RoadGraphError(f"Edge length must be a number, but got {value!r}.")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise RoadGraphError(
            f"Edge length must be finite and not negative, but got {value!r}."
        )
    return number


def _check_shape(shape: object) -> tuple[LatLng, ...]:
    """A road's curve: at least 2 (lat, lng) points, from source to target."""
    try:
        points = list(shape)  # type: ignore[call-overload]
    except TypeError:
        raise RoadGraphError("Edge shape must be a sequence of (lat, lng) points.") from None
    if len(points) < 2:
        raise RoadGraphError("Edge shape needs at least 2 points.")
    checked: list[LatLng] = []
    for index, point in enumerate(points):
        try:
            lat, lng = point
        except (TypeError, ValueError):
            raise RoadGraphError(
                f"Edge shape point {index} must be a (lat, lng) pair."
            ) from None
        try:
            checked.append(validate_lat_lng(lat, lng))
        except CoordinateError as error:
            raise RoadGraphError(f"Edge shape point {index}: {error}") from None
    return tuple(checked)


@dataclass(frozen=True)
class Edge:
    """One directed road piece.

    shape: the road's curve as (lat, lng) points ordered from the source
    node to the target node, or None when we only know the two end nodes.
    """

    source: int
    target: int
    length_m: float
    shape: tuple[LatLng, ...] | None = None

    def __post_init__(self) -> None:
        if not _is_node_id(self.source):
            raise RoadGraphError(f"Edge source must be an integer, got {self.source!r}.")
        if not _is_node_id(self.target):
            raise RoadGraphError(f"Edge target must be an integer, got {self.target!r}.")
        # The class is frozen, so we use object.__setattr__ to store the
        # cleaned-up values (float length, tuple-of-tuples shape).
        object.__setattr__(self, "length_m", _check_length(self.length_m))
        if self.shape is not None:
            object.__setattr__(self, "shape", _check_shape(self.shape))


def _check_factor(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise RoadGraphError(f"heuristic_factor must be a number, got {value!r}.")
    number = float(value)
    if not math.isfinite(number) or not 0.0 <= number <= 1.0:
        raise RoadGraphError(
            f"heuristic_factor must be between 0 and 1, but got {value!r}."
        )
    return number


class RoadGraph:
    """A read-only directed road map.

    heuristic_factor: how much of the straight-line distance A* may use as
    its guess (0 to 1). It is computed by the graph loader. 0.0 means "no
    guessing" (Dijkstra behaviour), which is always correct, so it is the
    safe default.

    load_stats: optional numbers describing how the graph was loaded
    (for reports). Stored read-only.
    """

    def __init__(
        self,
        nodes: Mapping[int, LatLng],
        edges: Iterable[Edge],
        heuristic_factor: float = 0.0,
        load_stats: Mapping[str, Any] | None = None,
    ) -> None:
        if not isinstance(nodes, Mapping):
            raise RoadGraphError("nodes must be a mapping of node ID -> (lat, lng).")

        # ---- nodes (copied, checked, sorted by ID) ----
        coords: dict[int, LatLng] = {}
        for node_id, point in nodes.items():
            if not _is_node_id(node_id):
                raise RoadGraphError(f"Node ID must be an integer, got {node_id!r}.")
            try:
                lat, lng = point
            except (TypeError, ValueError):
                raise RoadGraphError(
                    f"Node {node_id}: coordinates must be a (lat, lng) pair."
                ) from None
            try:
                coords[node_id] = validate_lat_lng(lat, lng)
            except CoordinateError as error:
                raise RoadGraphError(f"Node {node_id}: {error}") from None
        if not coords:
            raise RoadGraphError("A road graph needs at least one node.")
        sorted_coords = dict(sorted(coords.items()))
        self._node_ids: tuple[int, ...] = tuple(sorted_coords)

        # ---- edges (checked, grouped by source, sorted by target) ----
        grouped: dict[int, list[Edge]] = {node_id: [] for node_id in sorted_coords}
        seen: set[tuple[int, int]] = set()
        for edge in edges:
            if not isinstance(edge, Edge):
                raise RoadGraphError(f"Expected an Edge object, got {edge!r}.")
            if edge.source not in sorted_coords:
                raise RoadGraphError(f"Edge source {edge.source} is not a node.")
            if edge.target not in sorted_coords:
                raise RoadGraphError(f"Edge target {edge.target} is not a node.")
            if edge.source == edge.target:
                raise RoadGraphError(f"Self-loop on node {edge.source} is not allowed.")
            pair = (edge.source, edge.target)
            if pair in seen:
                raise RoadGraphError(
                    f"Duplicate edge {edge.source} -> {edge.target} "
                    "(collapse parallel roads before building the graph)."
                )
            seen.add(pair)
            grouped[edge.source].append(edge)

        out_by_source: dict[int, tuple[Edge, ...]] = {
            node_id: tuple(sorted(items, key=lambda e: e.target))
            for node_id, items in grouped.items()
        }
        lookup: dict[tuple[int, int], Edge] = {
            (edge.source, edge.target): edge
            for items in out_by_source.values()
            for edge in items
        }
        self._all_edges: tuple[Edge, ...] = tuple(
            edge for node_id in self._node_ids for edge in out_by_source[node_id]
        )

        # ---- make the lookup tables read-only ----
        # MappingProxyType gives a view that refuses item assignment and
        # deletion (TypeError). We keep no reference to the raw dicts.
        self._coords: Mapping[int, LatLng] = MappingProxyType(sorted_coords)
        self._out: Mapping[int, tuple[Edge, ...]] = MappingProxyType(out_by_source)
        self._lookup: Mapping[tuple[int, int], Edge] = MappingProxyType(lookup)

        # ---- the rest ----
        self._heuristic_factor = _check_factor(heuristic_factor)
        self._load_stats: Mapping[str, Any] = MappingProxyType(dict(load_stats or {}))
        self._coverage_box = GeoBox.from_points(self._coords.values())

    # ---------------- read-only properties ----------------
    @property
    def heuristic_factor(self) -> float:
        return self._heuristic_factor

    @property
    def load_stats(self) -> Mapping[str, Any]:
        return self._load_stats

    @property
    def node_count(self) -> int:
        return len(self._node_ids)

    @property
    def edge_count(self) -> int:
        return len(self._all_edges)

    @property
    def node_ids(self) -> tuple[int, ...]:
        """All node IDs, in ascending order."""
        return self._node_ids

    @property
    def coverage_box(self) -> GeoBox:
        """Smallest rectangle containing every node (decision D4)."""
        return self._coverage_box

    # ---------------- lookups ----------------
    def has_node(self, node_id: object) -> bool:
        return _is_node_id(node_id) and node_id in self._coords

    def __contains__(self, node_id: object) -> bool:
        return self.has_node(node_id)

    def _require_node(self, node_id: object) -> None:
        if not self.has_node(node_id):
            raise UnknownNodeError(f"Node {node_id!r} is not in the road graph.")

    def coords(self, node_id: int) -> LatLng:
        """The (lat, lng) of a node."""
        self._require_node(node_id)
        return self._coords[node_id]

    def out_edges(self, node_id: int) -> tuple[Edge, ...]:
        """Edges leaving the node, sorted by target ID (empty if none)."""
        self._require_node(node_id)
        return self._out[node_id]

    def edge(self, source: int, target: int) -> Edge | None:
        """The directed edge source -> target, or None if it does not exist."""
        self._require_node(source)
        self._require_node(target)
        return self._lookup.get((source, target))

    def all_edges(self) -> tuple[Edge, ...]:
        """Every edge, ordered by source ID then target ID."""
        return self._all_edges

    # ---------------- copy with a different factor ----------------
    def with_heuristic_factor(self, heuristic_factor: float) -> "RoadGraph":
        """A new graph with the same map and a different factor.
        The original graph is not changed. (The read-only mappings are
        accepted by the constructor because MappingProxyType is a Mapping,
        and the new graph builds its own fresh read-only copies.)"""
        return RoadGraph(
            self._coords, self._all_edges, heuristic_factor, self._load_stats
        )

    def __repr__(self) -> str:
        return (
            f"RoadGraph(nodes={self.node_count}, edges={self.edge_count}, "
            f"heuristic_factor={self._heuristic_factor})"
        )