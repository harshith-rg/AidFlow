"""Tests for A* routing algorithm (app/services/astar.py) and routing facade.

Verifies that A* finds optimal shortest paths, agrees with Dijkstra on costs,
respects one-way streets, uses admissible heuristics, and handles edge cases.
"""

import pytest

from app.services.astar import astar
from app.services.dijkstra import dijkstra
from app.services.geo import haversine_m
from app.services.road_graph import Edge, RoadGraph, UnknownNodeError
from app.services.routing import (
    PathNotFoundError,
    RouteResult,
    find_route,
    find_route_between_locations,
)
from tests.synthetic_graphs import (
    DIAMOND_SHORT_ROUTE,
    detour_graph,
    diamond_graph,
    grid_coord,
    line_graph,
    make_graph,
    one_way_graph,
)


# ---------------------------------------------------------------------------
# Source Equals Destination
# ---------------------------------------------------------------------------
def test_astar_source_equals_destination():
    graph = line_graph()
    result = astar(graph, 1, 1)

    assert isinstance(result, RouteResult)
    assert result.nodes == (1,)
    assert result.total_distance_m == 0.0
    assert result.edges == ()
    assert result.polyline == (graph.coords(1),)


# ---------------------------------------------------------------------------
# Basic Path Finding and Agreement with Dijkstra
# ---------------------------------------------------------------------------
def test_astar_line_graph_agrees_with_dijkstra():
    graph = line_graph()
    astar_res = astar(graph, 1, 4)
    dijkstra_res = dijkstra(graph, 1, 4)

    assert astar_res.nodes == (1, 2, 3, 4)
    assert astar_res.total_distance_m == pytest.approx(dijkstra_res.total_distance_m)
    assert astar_res.nodes == dijkstra_res.nodes


def test_astar_diamond_graph_chooses_shorter_path():
    graph = diamond_graph()
    astar_res = astar(graph, 1, 4)
    dijkstra_res = dijkstra(graph, 1, 4)

    assert astar_res.nodes == DIAMOND_SHORT_ROUTE
    assert astar_res.total_distance_m == pytest.approx(dijkstra_res.total_distance_m)


def test_astar_detour_graph_avoids_winding_direct_road():
    graph = detour_graph()
    astar_res = astar(graph, 1, 3)
    dijkstra_res = dijkstra(graph, 1, 3)

    assert astar_res.nodes == (1, 2, 3)
    assert astar_res.total_distance_m == pytest.approx(dijkstra_res.total_distance_m)


# ---------------------------------------------------------------------------
# Directed Edges and One-Way Streets
# ---------------------------------------------------------------------------
def test_astar_respects_one_way_streets():
    graph = one_way_graph()

    res_12 = astar(graph, 1, 2)
    assert res_12.nodes == (1, 2)

    res_21 = astar(graph, 2, 1)
    assert res_21.nodes == (2, 1)
    assert res_21.total_distance_m == pytest.approx(3 * res_12.total_distance_m)

    res_23 = astar(graph, 2, 3)
    assert res_23.nodes == (2, 3)

    # 3 -> 2 has no road in reverse -> PathNotFoundError
    with pytest.raises(PathNotFoundError, match="No road path exists"):
        astar(graph, 3, 2)


def test_astar_isolated_node_is_unreachable():
    graph = one_way_graph()

    with pytest.raises(PathNotFoundError):
        astar(graph, 1, 4)

    with pytest.raises(PathNotFoundError):
        astar(graph, 4, 1)


# ---------------------------------------------------------------------------
# Unknown and Invalid Node IDs
# ---------------------------------------------------------------------------
def test_astar_unknown_node_raises_unknown_node_error():
    graph = line_graph()

    with pytest.raises(UnknownNodeError):
        astar(graph, 999, 1)

    with pytest.raises(UnknownNodeError):
        astar(graph, 1, 999)


@pytest.mark.parametrize("bad_node", ["1", None, True, False, 1.5, [1]])
def test_astar_invalid_node_type_raises_unknown_node_error(bad_node):
    graph = line_graph()

    with pytest.raises(UnknownNodeError):
        astar(graph, bad_node, 1)

    with pytest.raises(UnknownNodeError):
        astar(graph, 1, bad_node)


def test_astar_invalid_graph_type_raises_type_error():
    with pytest.raises(TypeError, match="graph must be a RoadGraph instance"):
        astar("not_a_graph", 1, 2)


# ---------------------------------------------------------------------------
# Heuristic Behaviors
# ---------------------------------------------------------------------------
def test_astar_with_zero_heuristic_factor_matches_dijkstra():
    # When heuristic factor is 0, A* behaves exactly like Dijkstra
    base_graph = diamond_graph()
    zero_graph = base_graph.with_heuristic_factor(0.0)

    astar_res = astar(zero_graph, 1, 4)
    dijkstra_res = dijkstra(zero_graph, 1, 4)

    assert astar_res.nodes == dijkstra_res.nodes
    assert astar_res.total_distance_m == pytest.approx(dijkstra_res.total_distance_m)


def test_astar_custom_heuristic():
    graph = diamond_graph()

    def custom_h(u: int, target: int) -> float:
        return 0.5 * haversine_m(*graph.coords(u), *graph.coords(target))

    astar_res = astar(graph, 1, 4, heuristic=custom_h)
    dijkstra_res = dijkstra(graph, 1, 4)

    assert astar_res.total_distance_m == pytest.approx(dijkstra_res.total_distance_m)


# ---------------------------------------------------------------------------
# Polyline Geometry
# ---------------------------------------------------------------------------
def test_astar_builds_polyline_from_shapes():
    nodes = {1: grid_coord(0, 0), 2: grid_coord(2, 0)}
    shape_points = (grid_coord(0, 0), grid_coord(1, 1), grid_coord(2, 0))
    edge = Edge(1, 2, 250.0, shape_points)
    graph = RoadGraph(nodes, [edge], heuristic_factor=0.5)

    result = astar(graph, 1, 2)
    assert result.nodes == (1, 2)
    assert result.polyline == shape_points


# ---------------------------------------------------------------------------
# Routing Facade Functions
# ---------------------------------------------------------------------------
def test_find_route_dispatches_astar_and_dijkstra():
    graph = diamond_graph()

    res_astar = find_route(graph, 1, 4, algorithm="astar")
    res_dijkstra = find_route(graph, 1, 4, algorithm="dijkstra")

    assert res_astar.total_distance_m == pytest.approx(res_dijkstra.total_distance_m)

    with pytest.raises(ValueError, match="Unknown routing algorithm"):
        find_route(graph, 1, 4, algorithm="unknown_algo")


def test_find_route_between_locations():
    graph = diamond_graph()
    origin = graph.coords(1)
    dest = graph.coords(4)

    result = find_route_between_locations(graph, origin[0], origin[1], dest[0], dest[1])
    assert result.nodes == (1, 3, 4)
    assert result.total_distance_m > 0.0

