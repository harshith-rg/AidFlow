"""Tests for Dijkstra routing algorithm (app/services/dijkstra.py).

Verifies directed shortest-path calculation, source-equals-destination,
unreachable destinations, invalid node IDs, polyline construction, and
tie-breaking behavior.
"""

import pytest

from app.services.dijkstra import dijkstra
from app.services.road_graph import Edge, RoadGraph, UnknownNodeError
from app.services.routing import PathNotFoundError, RouteResult
from tests.synthetic_graphs import (
    DIAMOND_SHORT_ROUTE,
    detour_graph,
    diamond_graph,
    grid_coord,
    line_graph,
    make_graph,
    one_way_graph,
    two_way,
)


# ---------------------------------------------------------------------------
# Source Equals Destination
# ---------------------------------------------------------------------------
def test_dijkstra_source_equals_destination():
    graph = line_graph()
    result = dijkstra(graph, 1, 1)

    assert isinstance(result, RouteResult)
    assert result.nodes == (1,)
    assert result.total_distance_m == 0.0
    assert result.distance_km == 0.0
    assert result.edges == ()
    assert result.polyline == (graph.coords(1),)
    assert result.node_count == 1
    assert result.edge_count == 0


def test_dijkstra_result_unpacking():
    graph = line_graph()
    nodes, dist = dijkstra(graph, 1, 2)
    assert nodes == (1, 2)
    assert dist > 0.0


# ---------------------------------------------------------------------------
# Basic Path Finding on Synthetic Graphs
# ---------------------------------------------------------------------------
def test_dijkstra_line_graph():
    graph = line_graph()
    result = dijkstra(graph, 1, 4)

    assert result.nodes == (1, 2, 3, 4)
    expected_dist = sum(
        graph.edge(u, u + 1).length_m for u in (1, 2, 3)
    )
    assert result.total_distance_m == pytest.approx(expected_dist)
    assert len(result.edges) == 3
    assert [e.source for e in result.edges] == [1, 2, 3]
    assert [e.target for e in result.edges] == [2, 3, 4]


def test_dijkstra_diamond_graph_chooses_shorter_path():
    graph = diamond_graph()
    result = dijkstra(graph, 1, 4)

    # Route via node 3 is x1.1, route via node 2 is x1.5
    assert result.nodes == DIAMOND_SHORT_ROUTE
    assert result.nodes == (1, 3, 4)


def test_dijkstra_detour_graph_avoids_winding_direct_road():
    graph = detour_graph()
    result = dijkstra(graph, 1, 3)

    # Direct 1->3 is winding (x3.0), detour 1->2->3 is (1.1 + 1.1 = 2.2)
    assert result.nodes == (1, 2, 3)


# ---------------------------------------------------------------------------
# Directed Edges and One-Way Streets
# ---------------------------------------------------------------------------
def test_dijkstra_respects_one_way_streets():
    graph = one_way_graph()

    # 1 -> 2 is length L
    res_12 = dijkstra(graph, 1, 2)
    assert res_12.nodes == (1, 2)

    # 2 -> 1 is length 3*L (different path cost in reverse direction!)
    res_21 = dijkstra(graph, 2, 1)
    assert res_21.nodes == (2, 1)
    assert res_21.total_distance_m == pytest.approx(3 * res_12.total_distance_m)

    # 2 -> 3 is one-way
    res_23 = dijkstra(graph, 2, 3)
    assert res_23.nodes == (2, 3)

    # 3 -> 2 has NO road in reverse -> PathNotFoundError
    with pytest.raises(PathNotFoundError, match="No road path exists"):
        dijkstra(graph, 3, 2)

    # 3 -> 1 has NO road -> PathNotFoundError
    with pytest.raises(PathNotFoundError, match="No road path exists"):
        dijkstra(graph, 3, 1)


def test_dijkstra_isolated_node_is_unreachable():
    graph = one_way_graph()  # Node 4 is isolated

    with pytest.raises(PathNotFoundError):
        dijkstra(graph, 1, 4)

    with pytest.raises(PathNotFoundError):
        dijkstra(graph, 4, 1)

    # But 4 -> 4 still succeeds with 0 distance
    res_44 = dijkstra(graph, 4, 4)
    assert res_44.nodes == (4,)
    assert res_44.total_distance_m == 0.0


# ---------------------------------------------------------------------------
# Unknown and Invalid Node IDs
# ---------------------------------------------------------------------------
def test_dijkstra_unknown_node_raises_unknown_node_error():
    graph = line_graph()

    with pytest.raises(UnknownNodeError):
        dijkstra(graph, 999, 1)

    with pytest.raises(UnknownNodeError):
        dijkstra(graph, 1, 999)


@pytest.mark.parametrize("bad_node", ["1", None, True, False, 1.5, [1]])
def test_dijkstra_invalid_node_type_raises_unknown_node_error(bad_node):
    graph = line_graph()

    with pytest.raises(UnknownNodeError):
        dijkstra(graph, bad_node, 1)

    with pytest.raises(UnknownNodeError):
        dijkstra(graph, 1, bad_node)


def test_dijkstra_invalid_graph_type_raises_type_error():
    with pytest.raises(TypeError, match="graph must be a RoadGraph instance"):
        dijkstra("not_a_graph", 1, 2)


# ---------------------------------------------------------------------------
# Polyline Geometry
# ---------------------------------------------------------------------------
def test_dijkstra_builds_polyline_from_shapes():
    # Construct an edge with custom curved shape
    nodes = {1: grid_coord(0, 0), 2: grid_coord(2, 0)}
    shape_points = (grid_coord(0, 0), grid_coord(1, 1), grid_coord(2, 0))
    edge = Edge(1, 2, 250.0, shape_points)
    graph = RoadGraph(nodes, [edge])

    result = dijkstra(graph, 1, 2)
    assert result.nodes == (1, 2)
    assert result.polyline == shape_points


def test_dijkstra_builds_polyline_without_duplicate_junctures():
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0), 3: grid_coord(2, 0)}
    shape_12 = (grid_coord(0, 0), grid_coord(0.5, 0.5), grid_coord(1, 0))
    shape_23 = (grid_coord(1, 0), grid_coord(1.5, 0.5), grid_coord(2, 0))

    edges = [
        Edge(1, 2, 150.0, shape_12),
        Edge(2, 3, 150.0, shape_23),
    ]
    graph = RoadGraph(nodes, edges)

    result = dijkstra(graph, 1, 3)
    # The middle juncture grid_coord(1, 0) should appear only ONCE in polyline
    assert len(result.polyline) == 5
    assert result.polyline == (
        shape_12[0],
        shape_12[1],
        shape_12[2],
        shape_23[1],
        shape_23[2],
    )


# ---------------------------------------------------------------------------
# Deterministic Tie-Breaking
# ---------------------------------------------------------------------------
def test_dijkstra_is_deterministic_on_equal_cost_paths():
    # Diamond graph with identical lengths on both paths
    nodes = {
        1: grid_coord(0, 0),
        2: grid_coord(1, 1),
        3: grid_coord(1, -1),
        4: grid_coord(2, 0),
    }
    # Both paths have exact length 100m
    edges = [
        (1, 2, 100.0),
        (2, 4, 100.0),
        (1, 3, 100.0),
        (3, 4, 100.0),
    ]
    graph = make_graph(nodes, edges)

    # Run multiple times to confirm exact determinism
    first_result = dijkstra(graph, 1, 4)
    for _ in range(20):
        repeat_result = dijkstra(graph, 1, 4)
        assert repeat_result.nodes == first_result.nodes
        assert repeat_result.total_distance_m == first_result.total_distance_m

