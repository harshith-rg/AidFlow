
"""Tests for graph_loader.py.

Success-path tests write tiny synthetic GraphML files with OSMnx's own
saver and load them back through the real loader (no downloads, and the
Bengaluru file is not used).

Error-path tests make osmnx.load_graphml return a hand-made in-memory
graph (see serve()), so they do not depend on how OSMnx round-trips odd
data.
"""

import hashlib
import itertools
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import networkx as nx
import osmnx as ox
import pytest
from shapely.geometry import LineString, Point

from app.services import graph_loader
from app.services.geo import haversine_m
from app.services.graph_loader import (
    DEFAULT_GRAPH_PATH,
    GraphError,
    clear_graph_cache,
    get_road_graph,
    load_road_graph,
)
from app.services.road_graph import RoadGraph, RoadGraphError
from tests.synthetic_graphs import (
    grid_coord,
    make_graph,
    random_graph,
    reference_safe_factor,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MISSING = object()  # marks "leave this attribute out"

# Node 4 is isolated. Lengths are all >= the straight-line distance.
NODES = {
    1: grid_coord(0, 0),
    2: grid_coord(1, 0),
    3: grid_coord(2, 1),
    4: grid_coord(0, 2),
}


def basic_edges():
    return [(1, 2, 120.0), (2, 1, 150.0), (2, 3, 200.0)]


@pytest.fixture(autouse=True)
def fresh_cache():
    clear_graph_cache()
    yield
    clear_graph_cache()


# ---------------------------------------------------------------- helpers
def build_graph(nodes, edges):
    """An OSMnx-style graph. nodes: {id: (lat, lng)}. edges: (u, v, length[, extras]).

    OSMnx stores longitude as x and latitude as y, so we do the same here.
    extras may hold "key" and "geometry". length=MISSING omits the attribute.
    """
    graph = nx.MultiDiGraph(crs="epsg:4326")
    for node_id, (lat, lng) in nodes.items():
        graph.add_node(node_id, x=lng, y=lat)
    for spec in edges:
        u, v, length = spec[0], spec[1], spec[2]
        attrs = dict(spec[3]) if len(spec) > 3 else {}
        if length is not MISSING:
            attrs["length"] = length
        key = attrs.pop("key", None)
        graph.add_edge(u, v, key=key, **attrs)
    return graph


def line(*points):
    """A Shapely LineString from (lat, lng) points (Shapely wants x=lng, y=lat)."""
    return LineString([(lng, lat) for lat, lng in points])


def save(graph, tmp_path, name="road.graphml"):
    path = tmp_path / name
    ox.save_graphml(graph, filepath=path)
    return path


def serve(monkeypatch, tmp_path, graph, name="fake.graphml"):
    """Make osmnx.load_graphml return `graph`. A small placeholder file
    satisfies the loader's file checks."""
    path = tmp_path / name
    path.write_text("placeholder", encoding="utf-8")
    monkeypatch.setattr(ox, "load_graphml", lambda *args, **kwargs: graph)
    return path


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def assert_points(actual, expected):
    assert actual is not None
    assert len(actual) == len(expected)
    for got, want in zip(actual, expected):
        assert got == pytest.approx(want, abs=1e-7)


def count_loads(monkeypatch, delay=0.0):
    """Count calls to load_road_graph (which get_road_graph uses)."""
    calls = []
    real = graph_loader.load_road_graph

    def wrapper(path=None):
        calls.append(path)
        if delay:
            time.sleep(delay)
        return real(path)

    monkeypatch.setattr(graph_loader, "load_road_graph", wrapper)
    return calls


# ============================================================ successful load
def test_valid_file_loads_into_a_road_graph(tmp_path):
    graph = load_road_graph(save(build_graph(NODES, basic_edges()), tmp_path))
    assert isinstance(graph, RoadGraph)
    assert graph.node_ids == (1, 2, 3, 4)
    assert graph.node_count == 4
    assert graph.edge_count == 3


def test_coordinates_are_lat_lng_not_swapped(tmp_path):
    graph = load_road_graph(save(build_graph(NODES, basic_edges()), tmp_path))
    for node_id, expected in NODES.items():
        assert graph.coords(node_id) == pytest.approx(expected, abs=1e-12)
    lat, lng = graph.coords(2)
    assert 12.9 < lat < 13.1 and 77.5 < lng < 77.7


def test_directed_edges_and_lengths_are_preserved(tmp_path):
    graph = load_road_graph(save(build_graph(NODES, basic_edges()), tmp_path))
    assert graph.edge(1, 2).length_m == 120.0
    assert graph.edge(2, 1).length_m == 150.0
    assert graph.edge(2, 3).length_m == 200.0
    assert graph.edge(3, 2) is None
    assert graph.edge(1, 3) is None


def test_isolated_node_is_kept(tmp_path):
    graph = load_road_graph(save(build_graph(NODES, basic_edges()), tmp_path))
    assert graph.has_node(4)
    assert graph.out_edges(4) == ()


def test_accepts_str_and_path(tmp_path):
    path = save(build_graph(NODES, basic_edges()), tmp_path)
    assert load_road_graph(path).node_count == 4
    assert load_road_graph(str(path)).node_count == 4


def test_relative_path_is_resolved(tmp_path, monkeypatch):
    save(build_graph(NODES, basic_edges()), tmp_path, "road.graphml")
    monkeypatch.chdir(tmp_path)
    assert load_road_graph("road.graphml").node_count == 4


def test_directed_graph_that_is_not_a_multigraph_is_rejected(monkeypatch, tmp_path):
    graph = nx.DiGraph()
    graph.add_node(1, x=77.59, y=12.97)
    graph.add_node(2, x=77.60, y=12.97)
    graph.add_edge(1, 2, length=1500.0)
    with pytest.raises(GraphError, match="not a multigraph"):
        load_road_graph(serve(monkeypatch, tmp_path, graph))


def test_rejected_graph_types_are_never_cached(monkeypatch, tmp_path):
    graph = nx.DiGraph()
    graph.add_node(1, x=77.59, y=12.97)
    path = serve(monkeypatch, tmp_path, graph)
    with pytest.raises(GraphError, match="not a multigraph"):
        get_road_graph(path)
    with pytest.raises(GraphError, match="not a multigraph"):
        get_road_graph(path)


def test_directed_multigraph_is_accepted(monkeypatch, tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(1, x=77.59, y=12.97)
    graph.add_node(2, x=77.60, y=12.97)
    graph.add_edge(1, 2, key=0, length=1500.0)
    loaded = load_road_graph(serve(monkeypatch, tmp_path, graph))
    assert loaded.edge_count == 1 and loaded.edge(1, 2).length_m == 1500.0


def test_digit_text_node_ids_become_integers(monkeypatch, tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node("7", x=77.59, y=12.97)
    graph.add_node("8", x=77.60, y=12.97)
    graph.add_edge("7", "8", key=0, length=1500.0)
    loaded = load_road_graph(serve(monkeypatch, tmp_path, graph))
    assert loaded.node_ids == (7, 8)
    assert loaded.edge(7, 8) is not None


def test_random_graphs_survive_a_save_and_load(tmp_path):
    for seed in range(4):
        for bad_data in (False, True):
            original = random_graph(seed, bad_data=bad_data)
            source = nx.MultiDiGraph(crs="epsg:4326")
            for node_id in original.node_ids:
                lat, lng = original.coords(node_id)
                source.add_node(node_id, x=lng, y=lat)
            for edge in original.all_edges():
                source.add_edge(edge.source, edge.target, key=0, length=edge.length_m)

            loaded = load_road_graph(
                save(source, tmp_path, f"r{seed}{bad_data}.graphml")
            )

            assert loaded.node_ids == original.node_ids
            for node_id in original.node_ids:
                assert loaded.coords(node_id) == pytest.approx(
                    original.coords(node_id), abs=1e-12
                )
            assert [
                (e.source, e.target, e.length_m) for e in loaded.all_edges()
            ] == [
                (e.source, e.target, e.length_m) for e in original.all_edges()
            ]
            assert loaded.heuristic_factor == pytest.approx(
                original.heuristic_factor, rel=1e-12
            )


# =============================================================== default path
def test_default_path_is_the_project_graph_file():
    assert DEFAULT_GRAPH_PATH.is_absolute()
    assert DEFAULT_GRAPH_PATH == (
        PROJECT_ROOT / "app" / "data" / "graph" / "bengaluru_coverage_box.graphml"
    )


def test_none_means_the_default_path_whatever_the_working_directory(
    tmp_path, monkeypatch
):
    graph_file = save(
        build_graph(NODES, basic_edges()), tmp_path, "default.graphml"
    )
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setattr(graph_loader, "DEFAULT_GRAPH_PATH", graph_file)

    loaded = load_road_graph()
    assert loaded.node_count == 4
    assert loaded.load_stats["source_file"] == str(graph_file.resolve())
    assert get_road_graph().node_count == 4


# ============================================================== parallel edges
def parallel_specs(len_key0, len_key1):
    shape_a = line(NODES[1], grid_coord(0.5, 0.5), NODES[2])
    shape_b = line(NODES[1], grid_coord(0.5, -0.5), NODES[2])
    return [
        (1, 2, len_key0, {"key": 0, "geometry": shape_a}),
        (1, 2, len_key1, {"key": 1, "geometry": shape_b}),
    ]


SHAPE_A = (NODES[1], grid_coord(0.5, 0.5), NODES[2])
SHAPE_B = (NODES[1], grid_coord(0.5, -0.5), NODES[2])


def test_parallel_edges_keep_the_shortest_and_its_geometry(tmp_path):
    graph = load_road_graph(
        save(build_graph(NODES, parallel_specs(200.0, 150.0)), tmp_path)
    )
    assert graph.edge_count == 1
    assert graph.edge(1, 2).length_m == 150.0
    assert_points(graph.edge(1, 2).shape, SHAPE_B)


def test_parallel_edge_result_does_not_depend_on_listing_order(tmp_path):
    specs = parallel_specs(200.0, 150.0)
    for number, ordering in enumerate((specs, specs[::-1])):
        graph = load_road_graph(
            save(build_graph(NODES, ordering), tmp_path, f"o{number}.graphml")
        )
        assert graph.edge(1, 2).length_m == 150.0
        assert_points(graph.edge(1, 2).shape, SHAPE_B)


def test_exact_tie_goes_to_the_lowest_key_in_either_order(tmp_path):
    specs = parallel_specs(150.0, 150.0)
    for number, ordering in enumerate((specs, specs[::-1])):
        graph = load_road_graph(
            save(build_graph(NODES, ordering), tmp_path, f"t{number}.graphml")
        )
        assert graph.edge(1, 2).length_m == 150.0
        assert_points(graph.edge(1, 2).shape, SHAPE_A)


def test_shorter_edge_without_geometry_does_not_borrow_another_shape(tmp_path):
    specs = [
        (1, 2, 200.0, {"key": 0, "geometry": line(*SHAPE_A)}),
        (1, 2, 150.0, {"key": 1}),
    ]
    graph = load_road_graph(save(build_graph(NODES, specs), tmp_path))
    assert graph.edge(1, 2).length_m == 150.0
    assert graph.edge(1, 2).shape is None


def test_mixed_key_types_give_a_deterministic_winner(monkeypatch, tmp_path):
    mid = {
        "b": grid_coord(0.5, 0.3),
        2: grid_coord(0.5, 0.6),
        "a": grid_coord(0.5, 0.9),
    }
    specs = [
        (1, 2, 150.0, {"key": key, "geometry": line(NODES[1], point, NODES[2])})
        for key, point in mid.items()
    ]
    for ordering in itertools.permutations(specs):
        graph = build_graph(NODES, ordering)
        loaded = load_road_graph(serve(monkeypatch, tmp_path, graph))
        assert_points(loaded.edge(1, 2).shape, (NODES[1], mid[2], NODES[2]))


def test_opposite_directions_are_not_parallel_edges(tmp_path):
    graph = load_road_graph(save(build_graph(NODES, basic_edges()), tmp_path))
    assert graph.edge(1, 2) is not None and graph.edge(2, 1) is not None
    assert graph.load_stats["parallel_edges_dropped"] == 0


# ================================================================= self-loops
def test_self_loops_are_ignored_and_counted(tmp_path):
    edges = basic_edges() + [(1, 1, 50.0), (3, 3, 10.0)]
    graph = load_road_graph(save(build_graph(NODES, edges), tmp_path))
    assert graph.edge_count == 3
    assert graph.edge(1, 1) is None
    assert graph.load_stats["self_loops_ignored"] == 2


def test_self_loop_with_an_invalid_length_is_still_rejected(monkeypatch, tmp_path):
    graph = build_graph(NODES, basic_edges() + [(1, 1, MISSING)])
    with pytest.raises(GraphError, match="length"):
        load_road_graph(serve(monkeypatch, tmp_path, graph))


def test_stats_add_up(tmp_path):
    edges = [
        (1, 2, 120.0, {"key": 0}),
        (1, 2, 130.0, {"key": 1}),
        (1, 2, 140.0, {"key": 2}),
        (2, 1, 150.0),
        (2, 3, 200.0),
        (1, 1, 5.0),
        (4, 4, 5.0),
    ]
    stats = load_road_graph(save(build_graph(NODES, edges), tmp_path)).load_stats
    assert stats["edges_in_file"] == 7
    assert stats["edges_kept"] == 3
    assert stats["parallel_edges_dropped"] == 2
    assert stats["self_loops_ignored"] == 2
    assert stats["edges_in_file"] == (
        stats["edges_kept"]
        + stats["parallel_edges_dropped"]
        + stats["self_loops_ignored"]
    )


# ================================================================== geometry
def test_forward_geometry_is_kept_as_lat_lng_tuples(tmp_path):
    shape = line(NODES[1], grid_coord(0.5, 0.2), NODES[2])
    graph = load_road_graph(
        save(build_graph(NODES, [(1, 2, 120.0, {"geometry": shape})]), tmp_path)
    )
    expected = (NODES[1], grid_coord(0.5, 0.2), NODES[2])
    assert_points(graph.edge(1, 2).shape, expected)
    first_lat, first_lng = graph.edge(1, 2).shape[0]
    assert 12.9 < first_lat < 13.1 and 77.5 < first_lng < 77.7
    assert graph.load_stats["shapes_kept"] == 1
    assert graph.load_stats["shapes_reversed"] == 0


def test_reversed_geometry_is_turned_around(tmp_path):
    shape = line(NODES[2], grid_coord(0.5, 0.2), NODES[1])
    graph = load_road_graph(
        save(build_graph(NODES, [(1, 2, 120.0, {"geometry": shape})]), tmp_path)
    )
    assert_points(
        graph.edge(1, 2).shape,
        (NODES[1], grid_coord(0.5, 0.2), NODES[2]),
    )
    assert graph.load_stats["shapes_reversed"] == 1


def test_orientation_uses_both_end_points_not_just_the_first(tmp_path):
    nodes = {1: grid_coord(0, 0), 2: grid_coord(2, 0)}
    points = (
        grid_coord(1.1, 0),
        grid_coord(1.5, 0.3),
        grid_coord(2, 0),
    )
    graph = load_road_graph(
        save(build_graph(nodes, [(1, 2, 400.0, {"geometry": line(*points)})]), tmp_path)
    )
    assert_points(graph.edge(1, 2).shape, points)
    assert graph.load_stats["shapes_reversed"] == 0


def test_reversed_when_the_last_point_is_near_the_source(tmp_path):
    nodes = {1: grid_coord(0, 0), 2: grid_coord(2, 0)}
    points = (
        grid_coord(2, 0),
        grid_coord(1.5, 0.3),
        grid_coord(0.9, 0),
    )
    graph = load_road_graph(
        save(build_graph(nodes, [(1, 2, 400.0, {"geometry": line(*points)})]), tmp_path)
    )
    assert_points(graph.edge(1, 2).shape, tuple(reversed(points)))
    assert graph.load_stats["shapes_reversed"] == 1


def test_each_direction_gets_its_own_orientation(tmp_path):
    mid = grid_coord(0.5, 0.2)
    shape = line(NODES[1], mid, NODES[2])
    edges = [
        (1, 2, 120.0, {"geometry": shape}),
        (2, 1, 120.0, {"geometry": shape}),
    ]
    graph = load_road_graph(save(build_graph(NODES, edges), tmp_path))
    assert_points(graph.edge(1, 2).shape, (NODES[1], mid, NODES[2]))
    assert_points(graph.edge(2, 1).shape, (NODES[2], mid, NODES[1]))
    assert graph.load_stats["shapes_kept"] == 2
    assert graph.load_stats["shapes_reversed"] == 1


def test_missing_geometry_keeps_the_edge_with_no_shape(tmp_path):
    graph = load_road_graph(save(build_graph(NODES, basic_edges()), tmp_path))
    assert graph.edge_count == 3
    assert all(edge.shape is None for edge in graph.all_edges())
    assert graph.load_stats["shapes_kept"] == 0


def test_unusable_geometry_keeps_the_edge_and_is_counted(monkeypatch, tmp_path):
    edges = [
        (1, 2, 120.0, {"geometry": "not a geometry"}),
        (2, 1, 150.0, {"geometry": Point(77.59, 12.97)}),
        (2, 3, 200.0, {"geometry": LineString([(200.0, 10.0), (201.0, 10.0)])}),
    ]
    loaded = load_road_graph(serve(monkeypatch, tmp_path, build_graph(NODES, edges)))
    assert loaded.edge_count == 3
    assert all(edge.shape is None for edge in loaded.all_edges())
    assert loaded.load_stats["shapes_unusable"] == 3
    assert loaded.load_stats["shapes_kept"] == 0


# ============================================================ heuristic factor
def test_factor_for_normal_data_matches_the_reference(tmp_path):
    graph = load_road_graph(save(build_graph(NODES, basic_edges()), tmp_path))
    reference = reference_safe_factor(make_graph(NODES, basic_edges()))
    assert graph.heuristic_factor == pytest.approx(1 - 1e-6, rel=1e-12)
    assert graph.heuristic_factor == pytest.approx(reference, rel=1e-12)
    assert graph.load_stats["edges_shorter_than_straight_line"] == 0


def test_factor_is_scaled_down_for_a_short_edge(tmp_path):
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0)}
    straight = haversine_m(*nodes[1], *nodes[2])
    edges = [(1, 2, 0.5 * straight), (2, 1, 0.5 * straight)]
    graph = load_road_graph(save(build_graph(nodes, edges), tmp_path))
    assert graph.heuristic_factor == pytest.approx(0.5 * (1 - 1e-6), rel=1e-9)
    assert graph.load_stats["min_length_ratio"] == pytest.approx(0.5, rel=1e-9)
    assert graph.load_stats["edges_shorter_than_straight_line"] == 2


def test_zero_length_edge_between_different_places_gives_factor_zero(tmp_path):
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0)}
    graph = load_road_graph(save(build_graph(nodes, [(1, 2, 0.0)]), tmp_path))
    assert graph.heuristic_factor == 0.0


def test_edges_between_nodes_at_the_same_place_are_ignored(tmp_path):
    nodes = {1: grid_coord(0, 0), 2: grid_coord(0, 0)}
    graph = load_road_graph(
        save(build_graph(nodes, [(1, 2, 5.0), (2, 1, 5.0)]), tmp_path)
    )
    assert graph.heuristic_factor == pytest.approx(1 - 1e-6, rel=1e-12)
    assert graph.load_stats["min_length_ratio"] is None


def test_graph_without_edges_gets_the_default_safe_factor(monkeypatch, tmp_path):
    graph = load_road_graph(serve(monkeypatch, tmp_path, build_graph(NODES, [])))
    assert graph.edge_count == 0
    assert graph.heuristic_factor == pytest.approx(1 - 1e-6, rel=1e-12)
    assert graph.load_stats["min_length_ratio"] is None


def test_factor_is_computed_on_the_final_graph(tmp_path):
    edges = [
        (1, 2, 200.0, {"key": 0}),
        (1, 2, 120.0, {"key": 1}),
        (2, 1, 150.0),
        (2, 3, 200.0),
        (1, 1, 0.0),
    ]
    graph = load_road_graph(save(build_graph(NODES, edges), tmp_path))
    collapsed = make_graph(
        NODES,
        [(1, 2, 120.0), (2, 1, 150.0), (2, 3, 200.0)],
    )
    assert graph.heuristic_factor == pytest.approx(
        reference_safe_factor(collapsed), rel=1e-12
    )
    assert graph.load_stats["heuristic_factor"] == graph.heuristic_factor


# ================================================================ load_stats
def test_load_stats_are_complete_and_json_friendly(tmp_path):
    path = save(build_graph(NODES, basic_edges()), tmp_path)
    graph = load_road_graph(path)
    stats = dict(graph.load_stats)

    assert set(stats) == {
        "source_file",
        "source_file_bytes",
        "nodes",
        "edges_in_file",
        "edges_kept",
        "parallel_edges_dropped",
        "self_loops_ignored",
        "shapes_kept",
        "shapes_reversed",
        "shapes_unusable",
        "min_length_ratio",
        "edges_shorter_than_straight_line",
        "heuristic_factor",
        "load_seconds",
        "osmnx_version",
    }
    json.dumps(stats)
    assert stats["source_file"] == str(path.resolve())
    assert stats["source_file_bytes"] == path.stat().st_size
    assert stats["nodes"] == 4
    assert stats["edges_in_file"] == 3 and stats["edges_kept"] == 3
    assert stats["osmnx_version"] == ox.__version__
    assert stats["load_seconds"] >= 0
    assert stats["heuristic_factor"] == graph.heuristic_factor


# ============================================================= invalid files
def test_graph_error_is_its_own_exception_class():
    assert issubclass(GraphError, Exception)
    assert not issubclass(GraphError, ValueError)
    assert not issubclass(GraphError, RoadGraphError)


def test_missing_file(tmp_path):
    with pytest.raises(GraphError, match="not found"):
        load_road_graph(tmp_path / "nope.graphml")


def test_directory_instead_of_file(tmp_path):
    with pytest.raises(GraphError, match="not a file"):
        load_road_graph(tmp_path)


def test_empty_file(tmp_path):
    path = tmp_path / "empty.graphml"
    path.write_bytes(b"")
    with pytest.raises(GraphError, match="empty"):
        load_road_graph(path)


def test_file_that_is_not_graphml(tmp_path):
    path = tmp_path / "bad.graphml"
    path.write_text("this is not xml at all", encoding="utf-8")

    with pytest.raises(GraphError) as info:
        load_road_graph(path)

    assert "bad.graphml" in str(info.value)


def test_wrong_path_type():
    with pytest.raises(GraphError, match="string or a Path"):
        load_road_graph(123)


def test_osmnx_not_installed(tmp_path, monkeypatch):
    path = tmp_path / "any.graphml"
    path.write_text("placeholder", encoding="utf-8")
    monkeypatch.setitem(sys.modules, "osmnx", None)

    with pytest.raises(GraphError, match="osmnx"):
        load_road_graph(path)


@pytest.mark.parametrize("make", [nx.Graph, nx.MultiGraph])
def test_undirected_graph_is_rejected(make, monkeypatch, tmp_path):
    graph = make()
    graph.add_node(1, x=77.59, y=12.97)

    with pytest.raises(GraphError, match="not directed"):
        load_road_graph(serve(monkeypatch, tmp_path, graph))


def test_graph_without_nodes_is_rejected(monkeypatch, tmp_path):
    with pytest.raises(GraphError, match="no nodes"):
        load_road_graph(
            serve(monkeypatch, tmp_path, nx.MultiDiGraph())
        )


def test_node_without_coordinates_is_rejected(monkeypatch, tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(1, y=12.97)

    with pytest.raises(GraphError, match="node 1"):
        load_road_graph(serve(monkeypatch, tmp_path, graph))


@pytest.mark.parametrize(
    "x, y",
    [
        (77.59, 95.0),
        (200.0, 12.97),
        (float("nan"), 12.97),
        ("77.59", 12.97),
        (None, 12.97),
        (77.59, None),
    ],
)
def test_bad_node_coordinates_are_rejected(x, y, monkeypatch, tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(1, x=x, y=y)

    with pytest.raises(GraphError, match="node 1"):
        load_road_graph(serve(monkeypatch, tmp_path, graph))


@pytest.mark.parametrize("bad_id", ["abc", 1.5, True])
def test_non_integer_node_ids_are_rejected(bad_id, monkeypatch, tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(bad_id, x=77.59, y=12.97)

    with pytest.raises(GraphError, match="integer"):
        load_road_graph(serve(monkeypatch, tmp_path, graph))


def test_duplicate_node_ids_after_conversion_are_rejected(
    monkeypatch, tmp_path
):
    graph = nx.MultiDiGraph()
    graph.add_node("1", x=77.59, y=12.97)
    graph.add_node(1, x=77.60, y=12.97)

    with pytest.raises(GraphError, match="duplicate"):
        load_road_graph(serve(monkeypatch, tmp_path, graph))


def test_missing_edge_length_in_a_real_file(tmp_path):
    path = save(
        build_graph(NODES, [(1, 2, MISSING), (2, 1, 150.0)]),
        tmp_path,
    )

    with pytest.raises(GraphError, match="length"):
        load_road_graph(path)


@pytest.mark.parametrize(
    "bad_length",
    [MISSING, -1.0, float("nan"), float("inf"), "12", True, None],
)
def test_bad_edge_lengths_are_rejected(bad_length, monkeypatch, tmp_path):
    graph = build_graph(
        NODES,
        [(1, 2, 120.0), (2, 1, bad_length)],
    )

    with pytest.raises(GraphError, match="length"):
        load_road_graph(serve(monkeypatch, tmp_path, graph))


def test_error_messages_name_the_file(monkeypatch, tmp_path):
    graph = build_graph(NODES, [(1, 2, MISSING)])

    with pytest.raises(GraphError) as info:
        load_road_graph(
            serve(monkeypatch, tmp_path, graph, name="fake.graphml")
        )

    assert "fake.graphml" in str(info.value)


def test_road_graph_rejection_is_wrapped_in_graph_error(
    monkeypatch, tmp_path
):
    def refuse(*args, **kwargs):
        raise RoadGraphError("boom")

    path = save(build_graph(NODES, basic_edges()), tmp_path)
    monkeypatch.setattr(graph_loader, "RoadGraph", refuse)

    with pytest.raises(GraphError, match="boom"):
        load_road_graph(path)


# ====================================================================== cache
def test_same_file_returns_the_same_object_and_loads_once(
    tmp_path, monkeypatch
):
    path = save(build_graph(NODES, basic_edges()), tmp_path)
    calls = count_loads(monkeypatch)

    first = get_road_graph(path)
    second = get_road_graph(path)

    assert first is second
    assert len(calls) == 1


def test_different_spellings_of_one_path_share_a_cache_entry(
    tmp_path, monkeypatch
):
    path = save(
        build_graph(NODES, basic_edges()),
        tmp_path,
        "road.graphml",
    )
    calls = count_loads(monkeypatch)
    monkeypatch.chdir(tmp_path)

    first = get_road_graph(path)

    assert get_road_graph(str(path)) is first
    assert get_road_graph("road.graphml") is first
    assert len(calls) == 1


def test_different_files_give_different_objects(tmp_path):
    first = get_road_graph(
        save(build_graph(NODES, basic_edges()), tmp_path, "a.graphml")
    )
    second = get_road_graph(
        save(build_graph(NODES, basic_edges()), tmp_path, "b.graphml")
    )

    assert first is not second


def test_failed_load_is_not_cached(tmp_path, monkeypatch):
    path = tmp_path / "later.graphml"
    calls = count_loads(monkeypatch)

    with pytest.raises(GraphError):
        get_road_graph(path)

    ox.save_graphml(
        build_graph(NODES, basic_edges()),
        filepath=path,
    )

    graph = get_road_graph(path)

    assert graph.node_count == 4
    assert get_road_graph(path) is graph
    assert len(calls) == 2


def test_clear_graph_cache_forces_a_reload(tmp_path, monkeypatch):
    path = save(build_graph(NODES, basic_edges()), tmp_path)
    calls = count_loads(monkeypatch)

    first = get_road_graph(path)
    clear_graph_cache()
    second = get_road_graph(path)

    assert first is not second
    assert len(calls) == 2


def test_concurrent_first_calls_load_only_once(tmp_path, monkeypatch):
    path = save(build_graph(NODES, basic_edges()), tmp_path)
    calls = count_loads(monkeypatch, delay=0.2)

    results = []
    errors = []

    def worker():
        try:
            results.append(get_road_graph(path))
        except Exception as error:
            errors.append(error)

    threads = [threading.Thread(target=worker) for _ in range(8)]

    for thread in threads:
        thread.start()

    for thread in threads:
        thread.join()

    assert not errors
    assert len(calls) == 1
    assert len(results) == 8
    assert all(result is results[0] for result in results)


# ============================================================ file integrity
def test_loading_never_changes_the_file(tmp_path):
    path = save(build_graph(NODES, basic_edges()), tmp_path)
    before = sha256(path)

    load_road_graph(path)
    get_road_graph(path)

    assert sha256(path) == before


def test_failed_loading_never_changes_the_file(tmp_path):
    path = tmp_path / "bad.graphml"
    path.write_text("this is not xml at all", encoding="utf-8")
    before = sha256(path)

    with pytest.raises(GraphError):
        load_road_graph(path)

    assert sha256(path) == before


# ================================================================ lazy import
def test_importing_the_module_does_not_import_osmnx():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "import app.services.graph_loader; "
                "print('osmnx' in sys.modules)"
            ),
        ],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "False"
