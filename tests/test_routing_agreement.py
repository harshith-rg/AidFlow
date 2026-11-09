"""NetworkX agreement tests and random-trip validation (mandatory Phase 3 requirement).

NetworkX serves as an independent reference implementation to rigorously verify:
  1. Our Dijkstra vs. NetworkX Dijkstra.
  2. Our A* vs. NetworkX Dijkstra.
  3. Reachability agreement (finding paths when they exist, failing when unreachable).
  4. Shortest-path total distance agreement within floating-point tolerance.
  5. Validity of returned paths (every hop uses a valid directed edge).
  6. Directed-road and one-way behavior.
  7. Deterministic random-trip tests across seeded synthetic graphs.
  8. Integration check on the real Bengaluru road graph if present.
"""

from pathlib import Path

import networkx as nx
import pytest

from app.services.astar import astar
from app.services.dijkstra import dijkstra
from app.services.geo import haversine_m
from app.services.graph_loader import DEFAULT_GRAPH_PATH, get_road_graph
from app.services.road_graph import RoadGraph
from app.services.routing import PathNotFoundError
from app.services.snapping import snap_hospital, snap_to_road
from tests.synthetic_graphs import (
    detour_graph,
    diamond_graph,
    grid_coord,
    line_graph,
    make_graph,
    one_way_graph,
    random_graph,
)


# ---------------------------------------------------------------------------
# Helper: Convert RoadGraph to NetworkX DiGraph for independent verification
# ---------------------------------------------------------------------------
def _to_networkx(graph: RoadGraph) -> nx.DiGraph:
    """Build an independent NetworkX DiGraph from a RoadGraph."""
    nx_g = nx.DiGraph()
    for node_id in graph.node_ids:
        lat, lng = graph.coords(node_id)
        nx_g.add_node(node_id, lat=lat, lng=lng)
    for edge in graph.all_edges():
        nx_g.add_edge(edge.source, edge.target, weight=edge.length_m)
    return nx_g


def _verify_path_validity(graph: RoadGraph, path_nodes: tuple[int, ...], reported_cost: float):
    """Verify that a path follows valid directed edges and sum of weights matches cost."""
    assert len(path_nodes) >= 1
    if len(path_nodes) == 1:
        assert reported_cost == 0.0
        return

    accumulated = 0.0
    for u, v in zip(path_nodes[:-1], path_nodes[1:]):
        edge = graph.edge(u, v)
        assert edge is not None, f"Edge ({u} -> {v}) does not exist in graph!"
        accumulated += edge.length_m

    assert reported_cost == pytest.approx(accumulated, rel=1e-7, abs=1e-5)


# ---------------------------------------------------------------------------
# Synthetic Graphs: Comprehensive Agreement with NetworkX
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "graph_factory",
    [
        line_graph,
        diamond_graph,
        detour_graph,
        one_way_graph,
    ],
)
def test_all_pairs_agreement_on_synthetic_graphs(graph_factory):
    graph = graph_factory()
    nx_g = _to_networkx(graph)

    for source in graph.node_ids:
        for target in graph.node_ids:
            nx_has_path = nx.has_path(nx_g, source, target)

            if nx_has_path:
                expected_dist = nx.shortest_path_length(
                    nx_g, source, target, weight="weight"
                )

                # 1. Dijkstra check
                dijkstra_res = dijkstra(graph, source, target)
                assert dijkstra_res.total_distance_m == pytest.approx(
                    expected_dist, rel=1e-7, abs=1e-5
                )
                _verify_path_validity(
                    graph, dijkstra_res.nodes, dijkstra_res.total_distance_m
                )

                # 2. A* check
                astar_res = astar(graph, source, target)
                assert astar_res.total_distance_m == pytest.approx(
                    expected_dist, rel=1e-7, abs=1e-5
                )
                _verify_path_validity(
                    graph, astar_res.nodes, astar_res.total_distance_m
                )

                # 3. Dijkstra and A* cost agreement
                assert dijkstra_res.total_distance_m == pytest.approx(
                    astar_res.total_distance_m, rel=1e-7, abs=1e-5
                )

            else:
                # Both must raise PathNotFoundError when unreachable
                with pytest.raises(PathNotFoundError):
                    dijkstra(graph, source, target)
                with pytest.raises(PathNotFoundError):
                    astar(graph, source, target)


# ---------------------------------------------------------------------------
# Directed Roads / Asymmetry Test
# ---------------------------------------------------------------------------
def test_directed_asymmetry_matches_networkx():
    graph = one_way_graph()
    nx_g = _to_networkx(graph)

    # 1 -> 2
    d_12 = dijkstra(graph, 1, 2).total_distance_m
    nx_12 = nx.shortest_path_length(nx_g, 1, 2, weight="weight")
    assert d_12 == pytest.approx(nx_12)

    # 2 -> 1 (different cost!)
    d_21 = dijkstra(graph, 2, 1).total_distance_m
    nx_21 = nx.shortest_path_length(nx_g, 2, 1, weight="weight")
    assert d_21 == pytest.approx(nx_21)
    assert d_21 != d_12

    # 2 -> 3 exists, 3 -> 2 does not exist
    assert nx.has_path(nx_g, 2, 3)
    assert not nx.has_path(nx_g, 3, 2)
    assert dijkstra(graph, 2, 3).total_distance_m == pytest.approx(
        nx.shortest_path_length(nx_g, 2, 3, weight="weight")
    )
    with pytest.raises(PathNotFoundError):
        dijkstra(graph, 3, 2)


# ---------------------------------------------------------------------------
# Equal-Cost Alternatives
# ---------------------------------------------------------------------------
def test_equal_cost_alternatives_preserve_validity_and_cost():
    nodes = {
        1: grid_coord(0, 0),
        2: grid_coord(1, 1),
        3: grid_coord(1, -1),
        4: grid_coord(2, 0),
    }
    # Two paths 1->2->4 and 1->3->4 with identical distance 100m + 100m = 200m
    edges = [
        (1, 2, 100.0),
        (2, 4, 100.0),
        (1, 3, 100.0),
        (3, 4, 100.0),
    ]
    graph = make_graph(nodes, edges)
    nx_g = _to_networkx(graph)

    expected_len = nx.shortest_path_length(nx_g, 1, 4, weight="weight")
    d_res = dijkstra(graph, 1, 4)
    a_res = astar(graph, 1, 4)

    assert d_res.total_distance_m == pytest.approx(expected_len)
    assert a_res.total_distance_m == pytest.approx(expected_len)
    _verify_path_validity(graph, d_res.nodes, d_res.total_distance_m)
    _verify_path_validity(graph, a_res.nodes, a_res.total_distance_m)


# ---------------------------------------------------------------------------
# Deterministic Random-Trip Agreement Tests
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("seed", [42, 101, 777, 2026, 9999])
def test_random_trip_agreement_clean_data(seed):
    """Test on deterministic random graphs where roads are >= straight line."""
    graph = random_graph(seed=seed, node_count=15, edge_probability=0.3, bad_data=False)
    nx_g = _to_networkx(graph)

    for source in graph.node_ids:
        for target in graph.node_ids:
            nx_has_path = nx.has_path(nx_g, source, target)

            if nx_has_path:
                expected_dist = nx.shortest_path_length(
                    nx_g, source, target, weight="weight"
                )

                d_res = dijkstra(graph, source, target)
                a_res = astar(graph, source, target)

                # Cost comparison against NetworkX reference
                assert d_res.total_distance_m == pytest.approx(
                    expected_dist, rel=1e-6, abs=1e-5
                )
                assert a_res.total_distance_m == pytest.approx(
                    expected_dist, rel=1e-6, abs=1e-5
                )

                # Dijkstra and A* agree
                assert d_res.total_distance_m == pytest.approx(
                    a_res.total_distance_m, rel=1e-6, abs=1e-5
                )

                # Path validity
                _verify_path_validity(graph, d_res.nodes, d_res.total_distance_m)
                _verify_path_validity(graph, a_res.nodes, a_res.total_distance_m)
            else:
                with pytest.raises(PathNotFoundError):
                    dijkstra(graph, source, target)
                with pytest.raises(PathNotFoundError):
                    astar(graph, source, target)


@pytest.mark.parametrize("seed", [123, 456, 789])
def test_random_trip_agreement_with_bad_data_heuristic_safety(seed):
    """Test on graphs with bad data (some edges shorter than straight-line).

    The reference safe factor scales down the heuristic so A* remains admissible
    and never overestimates even with flawed road geometry.
    """
    graph = random_graph(seed=seed, node_count=12, edge_probability=0.35, bad_data=True)
    nx_g = _to_networkx(graph)

    for source in graph.node_ids:
        for target in graph.node_ids:
            nx_has_path = nx.has_path(nx_g, source, target)

            if nx_has_path:
                expected_dist = nx.shortest_path_length(
                    nx_g, source, target, weight="weight"
                )

                d_res = dijkstra(graph, source, target)
                a_res = astar(graph, source, target)

                assert d_res.total_distance_m == pytest.approx(
                    expected_dist, rel=1e-6, abs=1e-5
                )
                assert a_res.total_distance_m == pytest.approx(
                    expected_dist, rel=1e-6, abs=1e-5
                )
                assert d_res.total_distance_m == pytest.approx(
                    a_res.total_distance_m, rel=1e-6, abs=1e-5
                )

                _verify_path_validity(graph, d_res.nodes, d_res.total_distance_m)
                _verify_path_validity(graph, a_res.nodes, a_res.total_distance_m)
            else:
                with pytest.raises(PathNotFoundError):
                    dijkstra(graph, source, target)
                with pytest.raises(PathNotFoundError):
                    astar(graph, source, target)


# ---------------------------------------------------------------------------
# Real Bengaluru Graph Integration Check (when file is available)
# ---------------------------------------------------------------------------
# The exact numbers below (162 m, 5.01 km, 46 nodes, ...) were measured in Phase 0 on the SMALL
# central-Bengaluru graph. The service now loads the larger coverage-box graph by default, so this
# test names the small graph explicitly instead of using the default. It is skipped if that file
# is not on this computer (the larger graph is checked in tests/test_real_map_scenarios.py).
SMALL_GRAPH_CANDIDATES = (
    DEFAULT_GRAPH_PATH.parent / "bengaluru_small_full.graphml",
    DEFAULT_GRAPH_PATH.parents[3] / "phase0" / "output" / "bengaluru_small_full.graphml",
)
SMALL_GRAPH_PATH = next((p for p in SMALL_GRAPH_CANDIDATES if p.is_file()), None)


@pytest.mark.skipif(
    SMALL_GRAPH_PATH is None,
    reason="Small Bengaluru GraphML file (Phase 0 graph) not found locally",
)
def test_real_bengaluru_graph_snapping_and_routing():
    """Verify Phase 3 routing against the small Bengaluru road graph and Phase 0 results."""
    graph = get_road_graph(SMALL_GRAPH_PATH)

    # Known demo hospital coordinates
    h01_coords = (12.9767, 77.5713)
    h02_coords = (12.9857, 77.6057)

    # 1. Location snapping
    snap_h01 = snap_to_road(graph, h01_coords[0], h01_coords[1])
    snap_h02 = snap_to_road(graph, h02_coords[0], h02_coords[1])

    # Verified in Phase 0: H01 snaps to node 12121597668 (~162m), H02 snaps to node 294079863 (~8m)
    assert snap_h01.node_id == 12121597668
    assert round(snap_h01.distance_m) == 162
    assert snap_h02.node_id == 294079863
    assert round(snap_h02.distance_m) == 8

    # 2. Shortest path routing H01 -> H02
    route_fwd_d = dijkstra(graph, snap_h01.node_id, snap_h02.node_id)
    route_fwd_a = astar(graph, snap_h01.node_id, snap_h02.node_id)

    # Cost agreement between Dijkstra and A*
    assert route_fwd_d.total_distance_m == pytest.approx(
        route_fwd_a.total_distance_m, rel=1e-7
    )
    # Phase 0 measured 5.01 km (5008 m) with 46 nodes
    assert route_fwd_d.distance_km == pytest.approx(5.01, abs=0.02)
    assert route_fwd_d.node_count == 46
    assert route_fwd_a.node_count == 46

    # 3. Shortest path routing H02 -> H01 (reverse direction differs due to one-way roads)
    route_rev_d = dijkstra(graph, snap_h02.node_id, snap_h01.node_id)
    route_rev_a = astar(graph, snap_h02.node_id, snap_h01.node_id)

    assert route_rev_d.total_distance_m == pytest.approx(
        route_rev_a.total_distance_m, rel=1e-7
    )
    # Phase 0 measured 4.53 km (4531 m) with 60 nodes
    assert route_rev_d.distance_km == pytest.approx(4.53, abs=0.02)
    assert route_rev_d.node_count == 60

    # 4. Asymmetry check: forward and reverse paths have distinct distances
    assert abs(route_fwd_d.total_distance_m - route_rev_d.total_distance_m) > 400.0

    # 5. Polyline verification
    assert len(route_fwd_a.polyline) >= route_fwd_a.node_count
    assert route_fwd_a.polyline[0] == graph.coords(snap_h01.node_id)
    assert route_fwd_a.polyline[-1] == graph.coords(snap_h02.node_id)

