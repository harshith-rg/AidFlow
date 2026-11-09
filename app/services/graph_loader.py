"""Loads the saved GraphML road network into our read-only RoadGraph.

What this file does, in simple words:
  1. finds the .graphml file and checks it exists;
  2. reads it with OSMnx (imported only when needed, so importing this
     module stays fast);
  3. checks the map is sensible (a directed multigraph, nodes with
     coordinates, edges with valid lengths);
  4. converts it into our own RoadGraph structure.

Rules applied while converting:
  * Direction is preserved: a one-way street stays one directed edge.
  * Edge lengths come from the file. A missing or invalid length is an
    error. We never estimate a length.
  * Self-loops (an edge from a node to itself) are ignored and counted.
  * Parallel edges (several edges between the same two nodes) collapse to
    the SHORTEST one, keeping that edge's own geometry. An exact tie goes
    to the lowest key, so the result never depends on file order.
  * Geometry is converted to (lat, lng) points and turned around if it
    runs from target to source. Missing or unusable geometry never
    discards an edge; the edge just has no shape.
  * The heuristic factor for A* is computed on the FINAL edges:
        alpha = min(1, smallest length/straight-line ratio) x (1 - 1e-6)

Coordinate swap warning: OSMnx stores longitude as "x" and latitude as
"y"; Shapely coordinates are also (x = lng, y = lat). Our code uses
(lat, lng). The two conversions below are the ONLY places where this swap
happens.

The file is only READ. Nothing is ever written.
"""

import math
import os
import re
import threading
import time
from numbers import Integral, Real
from pathlib import Path
from typing import Any

from app.services.geo import CoordinateError, haversine_m, validate_lat_lng
from app.services.road_graph import Edge, LatLng, RoadGraph, RoadGraphError

__all__ = [
    "DEFAULT_GRAPH_PATH",
    "GraphError",
    "clear_graph_cache",
    "get_road_graph",
    "load_road_graph",
]

# app/services/graph_loader.py -> parent = services, parent.parent = app
# The active graph is the larger coverage-box graph (west 77.52, south 12.90, east 77.68,
# north 13.04; 23 of the 37 demo hospitals). Install it with: python scripts/setup_graph.py
DEFAULT_GRAPH_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "graph" / "bengaluru_coverage_box.graphml"
)

# Safety margin from the approved heuristic rule (absorbs rounding errors).
HEURISTIC_MARGIN = 1e-6

_INTEGER_TEXT = re.compile(r"[+-]?[0-9]+")


class GraphError(Exception):
    """The road graph file is missing, unreadable or contains invalid data.

    Deliberately NOT a subclass of RoadGraphError or ValueError: a bad file
    and a bad in-memory graph are different failures.
    """


# ---------------------------------------------------------------------------
# Step 1: path and file checks
# ---------------------------------------------------------------------------
def _resolve_path(path: object) -> Path:
    """Absolute path of the graph file (default: DEFAULT_GRAPH_PATH)."""
    candidate = DEFAULT_GRAPH_PATH if path is None else path
    if not isinstance(candidate, (str, os.PathLike)):
        raise GraphError(
            "The graph path must be a string or a Path, "
            f"but got {type(candidate).__name__}."
        )
    try:
        return Path(candidate).expanduser().resolve()
    except (OSError, RuntimeError, ValueError, TypeError) as error:
        raise GraphError(f"Cannot resolve the graph path {candidate!r}: {error}") from error


def _check_file(file_path: Path) -> int:
    """Make sure the file exists and is not empty. Returns its size in bytes."""
    try:
        if not file_path.exists():
            raise GraphError(
                f"Road graph file not found: {file_path}. "
                "Run 'python scripts/setup_graph.py' to download and set up the road network."
            )
        if not file_path.is_file():
            raise GraphError(f"Road graph path is not a file: {file_path}")
        size = file_path.stat().st_size
    except OSError as error:
        raise GraphError(f"Cannot access the road graph file {file_path}: {error}") from error
    if size == 0:
        raise GraphError(
            f"Road graph file is empty: {file_path}. "
            "Run 'python scripts/setup_graph.py' to download and set up the road network."
        )
    return size


# ---------------------------------------------------------------------------
# Step 2: reading with OSMnx (lazy import)
# ---------------------------------------------------------------------------
def _import_osmnx() -> Any:
    try:
        import osmnx as ox
    except ImportError as error:
        raise GraphError(
            "The 'osmnx' package is needed to read the road graph. "
            'Install it with: pip install "osmnx>=2.0"'
        ) from error
    return ox


def _read_graph(ox: Any, file_path: Path) -> Any:
    try:
        return ox.load_graphml(file_path)
    except Exception as error:  # any read problem becomes one clear error
        raise GraphError(
            f"Cannot read {file_path} as a GraphML road graph: "
            f"{type(error).__name__}: {error}"
        ) from error


def _check_graph_type(graph: Any, file_path: Path) -> None:
    """Accept only a directed multigraph (OSMnx's MultiDiGraph)."""
    if not (
        hasattr(graph, "is_directed")
        and hasattr(graph, "is_multigraph")
        and hasattr(graph, "nodes")
    ):
        raise GraphError(f"{file_path}: reading the file did not give a graph object.")
    if not graph.is_directed():
        raise GraphError(
            f"{file_path}: the graph is not directed. One-way streets would be "
            "lost, so it is rejected."
        )
    if not graph.is_multigraph():
        raise GraphError(
            f"{file_path}: the graph is not a multigraph. A road graph must be a "
            "directed multigraph (MultiDiGraph), so it is rejected."
        )
    if graph.number_of_nodes() == 0:
        raise GraphError(f"{file_path}: the graph contains no nodes.")


# ---------------------------------------------------------------------------
# Step 3: nodes
# ---------------------------------------------------------------------------
def _convert_node_id(value: object) -> int | None:
    """A plain int, or None if the value cannot be a node ID.
    Accepts integers and text made only of digits ("7")."""
    if isinstance(value, bool):
        return None
    if isinstance(value, Integral):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if _INTEGER_TEXT.fullmatch(text):
            return int(text)
    return None


def _convert_nodes(graph: Any, file_path: Path) -> tuple[dict[Any, int], dict[int, LatLng]]:
    """Returns (original node -> int ID, int ID -> (lat, lng))."""
    id_map: dict[Any, int] = {}
    coords: dict[int, LatLng] = {}
    for original, data in graph.nodes(data=True):
        node_id = _convert_node_id(original)
        if node_id is None:
            raise GraphError(
                f"{file_path}: node {original!r}: the node ID must be an integer."
            )
        if node_id in coords:
            raise GraphError(f"{file_path}: duplicate node ID {node_id}.")
        lat_raw, lng_raw = data.get("y"), data.get("x")
        if lat_raw is None or lng_raw is None:
            raise GraphError(
                f"{file_path}: node {node_id}: missing x or y coordinate."
            )
        try:
            # OSMnx: y = latitude, x = longitude. (First of two swap places.)
            coords[node_id] = validate_lat_lng(lat_raw, lng_raw)
        except CoordinateError as error:
            raise GraphError(f"{file_path}: node {node_id}: {error}") from error
        id_map[original] = node_id
    return id_map, coords


# ---------------------------------------------------------------------------
# Step 4: edges
# ---------------------------------------------------------------------------
def _key_order(key: object) -> tuple[int, int, str]:
    """A sortable tie-break value that works even for mixed key types.

    Integer keys come first (smallest first). Any other key type comes
    after, ordered by type name and text. All tuples have the same shape
    (int, int, str), so Python can always compare them.
    """
    if isinstance(key, Integral) and not isinstance(key, bool):
        return (0, int(key), "")
    return (1, 0, f"{type(key).__name__}:{key!r}")


def _check_length(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise GraphError(f"{label}: length must be a number, but got {value!r}.")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise GraphError(
            f"{label}: length must be finite and not negative, but got {value!r}."
        )
    return number


def _extract_points(geometry: object) -> list[LatLng] | None:
    """(lat, lng) points of a Shapely-like line, or None if unusable.

    Unusable means: no coordinates, fewer than 2 points, or invalid values.
    """
    try:
        raw = list(geometry.coords)  # type: ignore[attr-defined]
    except Exception:  # e.g. text, or a geometry type without simple coords
        return None
    if len(raw) < 2:
        return None
    points: list[LatLng] = []
    for item in raw:
        try:
            # Shapely order is (x = lng, y = lat). (Second swap place.)
            points.append(validate_lat_lng(item[1], item[0]))
        except (CoordinateError, TypeError, IndexError):
            return None
    return points


def _orient_shape(
    points: list[LatLng], source: LatLng, target: LatLng
) -> tuple[tuple[LatLng, ...], bool]:
    """Return the points ordered from source to target, and whether we had
    to reverse them.

    Both orientations are scored by the sum of the two end-point distances
    (first point to the node it should be near, last point likewise). The
    smaller sum wins. On an exact tie the original order is kept.
    """
    first, last = points[0], points[-1]
    as_given = haversine_m(*first, *source) + haversine_m(*last, *target)
    flipped = haversine_m(*first, *target) + haversine_m(*last, *source)
    if flipped < as_given:
        return tuple(reversed(points)), True
    return tuple(points), False


def _convert_edges(
    graph: Any,
    id_map: dict[Any, int],
    coords: dict[int, LatLng],
    file_path: Path,
) -> tuple[list[Edge], dict[str, int]]:
    """Validate, drop self-loops, collapse parallel edges, build Edge objects."""
    if graph.is_multigraph():
        edge_iter = graph.edges(keys=True, data=True)
    else:  # a plain directed graph: at most one edge per pair, no keys
        edge_iter = ((u, v, None, data) for u, v, data in graph.edges(data=True))

    best: dict[tuple[int, int], tuple[float, tuple[int, int, str], Any]] = {}
    edges_in_file = 0
    self_loops = 0
    parallel_dropped = 0

    for u, v, key, data in edge_iter:
        edges_in_file += 1
        label = f"{file_path}: edge {u!r} -> {v!r} (key {key!r})"
        if u not in id_map or v not in id_map:  # defensive; networkx prevents it
            raise GraphError(f"{label}: an end point is not a known node.")
        if "length" not in data:
            raise GraphError(f"{label}: missing length.")
        length = _check_length(data["length"], label)

        source, target = id_map[u], id_map[v]
        if source == target:
            self_loops += 1
            continue

        candidate = (length, _key_order(key), data.get("geometry"))
        current = best.get((source, target))
        if current is None:
            best[(source, target)] = candidate
            continue
        parallel_dropped += 1
        # Shortest wins; an exact tie goes to the lowest key.
        if candidate[:2] < current[:2]:
            best[(source, target)] = candidate

    edges: list[Edge] = []
    shapes_kept = shapes_reversed = shapes_unusable = 0
    for source, target in sorted(best):
        length, _order, geometry = best[(source, target)]
        shape = None
        if geometry is not None:
            points = _extract_points(geometry)
            if points is None:
                shapes_unusable += 1
            else:
                shape, was_reversed = _orient_shape(points, coords[source], coords[target])
                shapes_kept += 1
                if was_reversed:
                    shapes_reversed += 1
        try:
            edges.append(Edge(source, target, length, shape))
        except RoadGraphError as error:
            raise GraphError(
                f"{file_path}: edge {source} -> {target}: {error}"
            ) from error

    counts = {
        "edges_in_file": edges_in_file,
        "self_loops_ignored": self_loops,
        "parallel_edges_dropped": parallel_dropped,
        "shapes_kept": shapes_kept,
        "shapes_reversed": shapes_reversed,
        "shapes_unusable": shapes_unusable,
    }
    return edges, counts


# ---------------------------------------------------------------------------
# Step 5: heuristic factor
# ---------------------------------------------------------------------------
def _heuristic_factor(
    coords: dict[int, LatLng], edges: list[Edge]
) -> tuple[float, float | None, int]:
    """Returns (factor, smallest ratio or None, edges shorter than straight line).

    ratio = road length / straight-line distance between the edge's nodes.
    Edges whose end points are at the same place are skipped (nothing to
    compare). The factor keeps A*'s guess from ever overestimating.
    """
    smallest: float | None = None
    shorter = 0
    for edge in edges:
        straight = haversine_m(*coords[edge.source], *coords[edge.target])
        if straight > 0:
            ratio = edge.length_m / straight
            if smallest is None or ratio < smallest:
                smallest = ratio
            if ratio < 1.0:
                shorter += 1
    base = 1.0 if smallest is None else min(1.0, smallest)
    return base * (1.0 - HEURISTIC_MARGIN), smallest, shorter


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------
def load_road_graph(path: str | os.PathLike | None = None) -> RoadGraph:
    """Read a GraphML file and return a RoadGraph. No caching here.

    path=None means the default file. Raises GraphError for any problem.

    load_stats["load_seconds"] covers reading and converting; it stops just
    before the final RoadGraph is built (the stats must be ready by then).
    """
    started = time.perf_counter()
    file_path = _resolve_path(path)
    size = _check_file(file_path)
    ox = _import_osmnx()
    graph = _read_graph(ox, file_path)
    _check_graph_type(graph, file_path)

    id_map, coords = _convert_nodes(graph, file_path)
    edges, counts = _convert_edges(graph, id_map, coords, file_path)
    factor, smallest_ratio, shorter = _heuristic_factor(coords, edges)

    stats: dict[str, Any] = {
        "source_file": str(file_path),
        "source_file_bytes": int(size),
        "nodes": len(coords),
        "edges_in_file": counts["edges_in_file"],
        "edges_kept": len(edges),
        "parallel_edges_dropped": counts["parallel_edges_dropped"],
        "self_loops_ignored": counts["self_loops_ignored"],
        "shapes_kept": counts["shapes_kept"],
        "shapes_reversed": counts["shapes_reversed"],
        "shapes_unusable": counts["shapes_unusable"],
        "min_length_ratio": None if smallest_ratio is None else float(smallest_ratio),
        "edges_shorter_than_straight_line": shorter,
        "heuristic_factor": float(factor),
        "load_seconds": round(time.perf_counter() - started, 3),
        "osmnx_version": str(getattr(ox, "__version__", "unknown")),
    }

    try:
        return RoadGraph(coords, edges, factor, stats)
    except RoadGraphError as error:
        raise GraphError(f"{file_path}: the road graph is invalid: {error}") from error


# Cache of successfully loaded graphs, keyed by resolved absolute path.
_CACHE: dict[Path, RoadGraph] = {}
_CACHE_LOCK = threading.Lock()


def get_road_graph(path: str | os.PathLike | None = None) -> RoadGraph:
    """Like load_road_graph, but loads each file only once.

    Thread-safe: if several threads ask at the same moment, the file is
    loaded once and everyone gets the same (read-only) graph. A failed load
    is not cached, so a later call tries again. (The lock is held while
    loading, so loads of different files also wait for each other.)
    """
    key = _resolve_path(path)
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached is None:
            cached = load_road_graph(key)  # raises on failure: nothing is stored
            _CACHE[key] = cached
        return cached


def clear_graph_cache() -> None:
    """Forget all cached graphs (used by tests; the next get reloads)."""
    with _CACHE_LOCK:
        _CACHE.clear()