"""Tiny hand-built road maps for tests (no files, no downloads).

All maps sit near Bengaluru. grid_coord(x, y) places a node on a small grid:
x goes EAST (longitude grows), y goes NORTH (latitude grows).
One grid step is about 111 m.

Road lengths are set as (straight-line distance x multiplier). A multiplier
of 1.0 is a perfectly straight road; larger means a winding road.
"""

import random
from collections.abc import Iterable

from app.services.geo import haversine_m
from app.services.road_graph import Edge, LatLng, RoadGraph

BASE_LAT = 12.97
BASE_LNG = 77.59
GRID_STEP_DEG = 0.001

# For maps where every road is at least as long as its straight line.
# (1 - 1e-6): the small safety margin from the plan's heuristic rule.
SAFE_FACTOR = 0.999999

# The shortest route through diamond_graph(), from node 1 to node 4.
DIAMOND_SHORT_ROUTE = (1, 3, 4)


def grid_coord(x: float, y: float, step: float = GRID_STEP_DEG) -> LatLng:
    """(lat, lng) of a grid position. x = east (lng), y = north (lat)."""
    return (BASE_LAT + y * step, BASE_LNG + x * step)


def straight_m(nodes: dict[int, LatLng], a: int, b: int) -> float:
    """Straight-line distance between two nodes of a nodes-dictionary."""
    return haversine_m(*nodes[a], *nodes[b])


def two_way(u: int, v: int, length: float, shape=None) -> list[tuple]:
    """A two-way road = two directed edges. A shape is reversed for the
    opposite direction."""
    back_shape = None if shape is None else tuple(reversed(tuple(shape)))
    return [(u, v, length, shape), (v, u, length, back_shape)]


def make_graph(
    nodes: dict[int, LatLng],
    edges: Iterable[tuple],
    heuristic_factor: float = 0.0,
    load_stats=None,
) -> RoadGraph:
    """Build a RoadGraph from short tuples (source, target, length[, shape])."""
    built = []
    for item in edges:
        if len(item) == 3:
            source, target, length = item
            shape = None
        else:
            source, target, length, shape = item
        built.append(Edge(source, target, length, shape))
    return RoadGraph(nodes, built, heuristic_factor, load_stats)


# ---------------- measuring a map (independent of the real loader) ----------------
def min_length_ratio(graph: RoadGraph) -> float | None:
    """Smallest (edge length / straight-line distance) over all edges whose
    end points are in different places. None if there is no such edge."""
    ratios = []
    for edge in graph.all_edges():
        straight = haversine_m(
            *graph.coords(edge.source), *graph.coords(edge.target)
        )
        if straight > 0:
            ratios.append(edge.length_m / straight)
    return min(ratios) if ratios else None


def reference_safe_factor(graph: RoadGraph) -> float:
    """The plan's safe heuristic factor, calculated independently:
    min(1, smallest ratio) x (1 - 1e-6). Used by tests to check the real
    graph loader later."""
    ratio = min_length_ratio(graph)
    base = 1.0 if ratio is None else min(1.0, ratio)
    return base * (1 - 1e-6)


# ---------------- fixed test maps ----------------
def line_graph() -> RoadGraph:
    """Four nodes on a perfectly straight line, 1-2-3-4, two-way roads whose
    length EQUALS the straight-line distance (road = straight line)."""
    nodes = {i + 1: grid_coord(i, 0) for i in range(4)}
    edges: list[tuple] = []
    for u in (1, 2, 3):
        edges += two_way(u, u + 1, straight_m(nodes, u, u + 1))
    return make_graph(nodes, edges, SAFE_FACTOR)


def diamond_graph() -> RoadGraph:
    """Two routes from node 1 to node 4: via node 2 (winding, x1.5) and via
    node 3 (less winding, x1.1). The shorter route is DIAMOND_SHORT_ROUTE."""
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 1), 3: grid_coord(1, -1), 4: grid_coord(2, 0)}
    edges: list[tuple] = []
    for u, v, multiplier in ((1, 2, 1.5), (2, 4, 1.5), (1, 3, 1.1), (3, 4, 1.1)):
        edges += two_way(u, v, straight_m(nodes, u, v) * multiplier)
    return make_graph(nodes, edges, SAFE_FACTOR)


def detour_graph() -> RoadGraph:
    """Nodes 1, 2, 3 in a line. The direct road 1-3 is very winding (x3.0),
    so the better route goes through node 2 (x1.1 on each part)."""
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0), 3: grid_coord(2, 0)}
    edges: list[tuple] = []
    edges += two_way(1, 3, straight_m(nodes, 1, 3) * 3.0)
    edges += two_way(1, 2, straight_m(nodes, 1, 2) * 1.1)
    edges += two_way(2, 3, straight_m(nodes, 2, 3) * 1.1)
    return make_graph(nodes, edges, SAFE_FACTOR)


def one_way_graph() -> RoadGraph:
    """Directed roads and a disconnected node.

        1 -> 2   (length L)
        2 -> 1   (length 3 x L: the way back is much longer)
        2 -> 3   (one-way: there is NO road 3 -> 2)
        4        (isolated: no roads at all)
    """
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0), 3: grid_coord(2, 0), 4: grid_coord(5, 5)}
    length_12 = straight_m(nodes, 1, 2) * 1.2
    length_23 = straight_m(nodes, 2, 3) * 1.2
    edges = [(1, 2, length_12), (2, 1, 3 * length_12), (2, 3, length_23)]
    return make_graph(nodes, edges, SAFE_FACTOR)


def random_graph(
    seed: int,
    node_count: int = 10,
    edge_probability: float = 0.25,
    bad_data: bool = False,
    heuristic_factor: float | None = None,
) -> RoadGraph:
    """A seeded random map. The same seed always gives the same map.

    Each ordered pair of nodes may get a one-way edge, so some roads are
    one-way and some nodes may be unreachable. Normally every road is at
    least as long as its straight line. With bad_data=True about 20% of
    roads are SHORTER than their straight line (a data flaw the heuristic
    safety factor must cope with).

    heuristic_factor=None means: use reference_safe_factor(graph).
    """
    rng = random.Random(seed)
    nodes = {
        i: (BASE_LAT + rng.uniform(0, 0.02), BASE_LNG + rng.uniform(0, 0.02))
        for i in range(1, node_count + 1)
    }
    edges = []
    for u in range(1, node_count + 1):
        for v in range(1, node_count + 1):
            if u == v:
                continue
            # Draw the same random numbers whether or not bad_data is on,
            # so bad_data only changes the lengths, not the map's shape.
            wanted = rng.random() < edge_probability
            multiplier = rng.uniform(1.0, 2.0)
            bad_roll = rng.random()
            bad_multiplier = rng.uniform(0.2, 0.9)
            if not wanted:
                continue
            if bad_data and bad_roll < 0.2:
                multiplier = bad_multiplier
            edges.append((u, v, straight_m(nodes, u, v) * multiplier))

    graph = make_graph(nodes, edges, 0.0)
    factor = reference_safe_factor(graph) if heuristic_factor is None else heuristic_factor
    return graph.with_heuristic_factor(factor)