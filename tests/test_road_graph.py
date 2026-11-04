"""Tests for the RoadGraph data structure (road_graph.py)."""

import operator
import random
from dataclasses import FrozenInstanceError
from types import MappingProxyType

import pytest

from app.services.road_graph import Edge, RoadGraph, RoadGraphError, UnknownNodeError
from tests.synthetic_graphs import (
    grid_coord,
    line_graph,
    make_graph,
    one_way_graph,
    two_way,
)

NAN = float("nan")
INF = float("inf")


# ---------------- Edge ----------------
def test_edge_basic_values():
    edge = Edge(1, 2, 100)
    assert (edge.source, edge.target) == (1, 2)
    assert edge.length_m == 100.0 and isinstance(edge.length_m, float)
    assert edge.shape is None


def test_zero_length_edge_is_allowed():
    assert Edge(1, 2, 0).length_m == 0.0


def test_edge_is_read_only():
    with pytest.raises(FrozenInstanceError):
        Edge(1, 2, 100).length_m = 5


@pytest.mark.parametrize("bad", [-1, -0.0001, NAN, INF, -INF, True, False, "10", None, [1]])
def test_bad_edge_length_is_rejected(bad):
    with pytest.raises(RoadGraphError):
        Edge(1, 2, bad)


@pytest.mark.parametrize("bad", ["1", 1.5, None, True, (1,)])
def test_bad_edge_ids_are_rejected(bad):
    with pytest.raises(RoadGraphError):
        Edge(bad, 2, 10)
    with pytest.raises(RoadGraphError):
        Edge(1, bad, 10)


def test_shape_is_stored_as_tuple_of_float_pairs():
    edge = Edge(1, 2, 10, [[12, 77], [13, 78]])
    assert edge.shape == ((12.0, 77.0), (13.0, 78.0))
    assert isinstance(edge.shape, tuple)


@pytest.mark.parametrize(
    "bad_shape",
    [
        [(12.0, 77.0)],  # only one point
        [],  # no points
        [(12.0, 77.0), (91.0, 77.0)],  # latitude out of range
        [(12.0, 77.0), (12.0, NAN)],  # NaN
        [(12.0, 77.0), (12.0, 77.0, 5.0)],  # three values in a point
        [(12.0, 77.0), 5],  # point is not a pair
        [(12.0, 77.0), None],
        "abcd",  # not points at all
        5,  # not a sequence
    ],
)
def test_bad_shape_is_rejected(bad_shape):
    with pytest.raises(RoadGraphError):
        Edge(1, 2, 10, bad_shape)


# ---------------- building and reading a graph ----------------
def test_counts_and_sorted_node_ids():
    graph = line_graph()
    assert graph.node_count == 4
    assert graph.edge_count == 6  # three two-way roads
    assert graph.node_ids == (1, 2, 3, 4)


def test_node_coordinates_are_lat_lng():
    graph = line_graph()
    assert graph.coords(1) == grid_coord(0, 0)
    assert graph.coords(3) == grid_coord(2, 0)
    lat, lng = graph.coords(2)
    assert lat == grid_coord(0, 0)[0] and lng > grid_coord(0, 0)[1]


def test_out_edges_are_sorted_by_target():
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0), 3: grid_coord(2, 0), 4: grid_coord(3, 0)}
    graph = make_graph(nodes, [(1, 4, 5), (1, 2, 5), (1, 3, 5)])
    assert [e.target for e in graph.out_edges(1)] == [2, 3, 4]


def test_out_edges_returns_a_tuple_and_empty_for_a_dead_end():
    graph = one_way_graph()
    assert isinstance(graph.out_edges(1), tuple)
    assert graph.out_edges(3) == ()  # nothing leaves node 3
    assert graph.out_edges(4) == ()  # isolated node


def test_directed_edges_and_lengths_are_preserved_exactly():
    graph = one_way_graph()
    forward = graph.edge(1, 2)
    backward = graph.edge(2, 1)
    assert forward is not None and backward is not None
    assert backward.length_m == 3 * forward.length_m  # asymmetric, kept as given
    assert graph.edge(2, 3) is not None
    assert graph.edge(3, 2) is None  # one-way: no road back
    assert graph.edge(1, 3) is None  # no road at all


def test_all_edges_are_ordered_by_source_then_target():
    graph = line_graph()
    pairs = [(e.source, e.target) for e in graph.all_edges()]
    assert pairs == sorted(pairs)
    assert len(pairs) == graph.edge_count


def test_shapes_are_kept_per_edge_direction():
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0)}
    curve = (grid_coord(0, 0), grid_coord(0.5, 0.2), grid_coord(1, 0))
    graph = make_graph(nodes, two_way(1, 2, 50, curve))
    assert graph.edge(1, 2).shape == curve
    assert graph.edge(2, 1).shape == tuple(reversed(curve))


def test_insertion_order_does_not_change_the_graph():
    nodes = {i: grid_coord(i, 0) for i in range(1, 6)}
    edges = []
    for u in range(1, 5):
        edges += two_way(u, u + 1, 10.0 * u)
    shuffled = edges[:]
    random.Random(5).shuffle(shuffled)
    reversed_nodes = dict(reversed(list(nodes.items())))

    a = make_graph(nodes, edges)
    b = make_graph(reversed_nodes, shuffled)
    assert a.node_ids == b.node_ids
    assert a.all_edges() == b.all_edges()
    for node_id in a.node_ids:
        assert a.out_edges(node_id) == b.out_edges(node_id)
        assert a.coords(node_id) == b.coords(node_id)


# ---------------- read-only behaviour ----------------
def test_graph_properties_cannot_be_assigned():
    graph = line_graph()
    with pytest.raises(AttributeError):
        graph.heuristic_factor = 1.0
    with pytest.raises(AttributeError):
        graph.node_count = 99
    with pytest.raises(AttributeError):
        graph.load_stats = {}


def test_changing_the_input_dictionary_afterwards_does_not_change_the_graph():
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0)}
    stats = {"self_loops_ignored": 3}
    graph = make_graph(nodes, two_way(1, 2, 10), load_stats=stats)
    nodes[3] = grid_coord(2, 0)
    nodes[1] = grid_coord(9, 9)
    stats["self_loops_ignored"] = 99
    assert graph.node_count == 2
    assert graph.coords(1) == grid_coord(0, 0)
    assert graph.load_stats["self_loops_ignored"] == 3


def test_load_stats_default_empty_and_read_only():
    graph = line_graph()
    assert dict(graph.load_stats) == {}
    with pytest.raises(TypeError):
        graph.load_stats["x"] = 1


# ---------------- unknown nodes ----------------
@pytest.mark.parametrize("bad", [99, 0, -1, True, "1", None, 1.0, [1]])
def test_unknown_or_malformed_node_ids_raise_unknown_node_error(bad):
    graph = line_graph()
    with pytest.raises(UnknownNodeError):
        graph.coords(bad)
    with pytest.raises(UnknownNodeError):
        graph.out_edges(bad)
    with pytest.raises(UnknownNodeError):
        graph.edge(1, bad)
    with pytest.raises(UnknownNodeError):
        graph.edge(bad, 1)


def test_has_node_and_contains():
    graph = line_graph()
    assert graph.has_node(1) and 1 in graph
    assert not graph.has_node(99) and 99 not in graph
    assert not graph.has_node(True)  # True must not be mistaken for node 1
    assert not graph.has_node([1])


def test_unknown_node_error_is_a_road_graph_error():
    assert issubclass(UnknownNodeError, RoadGraphError)
    assert issubclass(RoadGraphError, ValueError)


# ---------------- validation of the whole graph ----------------
def test_empty_graph_is_rejected():
    with pytest.raises(RoadGraphError):
        RoadGraph({}, [])


def test_nodes_must_be_a_mapping():
    with pytest.raises(RoadGraphError):
        RoadGraph([(1, (12.0, 77.0))], [])


@pytest.mark.parametrize("bad_id", ["1", 1.5, None, True])
def test_bad_node_ids_are_rejected(bad_id):
    with pytest.raises(RoadGraphError):
        RoadGraph({bad_id: (12.0, 77.0)}, [])


@pytest.mark.parametrize(
    "bad_point",
    [(NAN, 77.0), (91.0, 77.0), (12.0, 181.0), (None, 77.0), "ab", (12.0,), 5, None],
)
def test_bad_node_coordinates_are_rejected(bad_point):
    with pytest.raises(RoadGraphError):
        RoadGraph({1: bad_point}, [])


def test_edge_to_unknown_node_is_rejected():
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0)}
    with pytest.raises(RoadGraphError):
        make_graph(nodes, [(1, 3, 10)])  # target 3 does not exist
    with pytest.raises(RoadGraphError):
        make_graph(nodes, [(3, 1, 10)])  # source 3 does not exist


def test_self_loop_is_rejected():
    with pytest.raises(RoadGraphError):
        make_graph({1: grid_coord(0, 0)}, [(1, 1, 10)])


def test_duplicate_edge_is_rejected():
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0)}
    with pytest.raises(RoadGraphError):
        make_graph(nodes, [(1, 2, 10), (1, 2, 20)])


def test_opposite_directions_are_not_duplicates():
    nodes = {1: grid_coord(0, 0), 2: grid_coord(1, 0)}
    graph = make_graph(nodes, [(1, 2, 10), (2, 1, 20)])
    assert graph.edge_count == 2


def test_edges_must_be_edge_objects():
    with pytest.raises(RoadGraphError):
        RoadGraph({1: grid_coord(0, 0), 2: grid_coord(1, 0)}, [(1, 2, 10)])


def test_graph_without_edges_is_allowed():
    graph = make_graph({1: grid_coord(0, 0)}, [])
    assert graph.edge_count == 0 and graph.out_edges(1) == ()


def test_two_nodes_may_share_the_same_coordinates():
    graph = make_graph({1: grid_coord(0, 0), 2: grid_coord(0, 0)}, two_way(1, 2, 5))
    assert graph.edge_count == 2


# ---------------- heuristic factor ----------------
def test_default_factor_is_zero_the_safe_value():
    graph = make_graph({1: grid_coord(0, 0)}, [])
    assert graph.heuristic_factor == 0.0


@pytest.mark.parametrize("value", [0, 0.0, 0.5, 1, 1.0])
def test_valid_factors_are_accepted(value):
    graph = make_graph({1: grid_coord(0, 0)}, [], heuristic_factor=value)
    assert graph.heuristic_factor == float(value)


@pytest.mark.parametrize("bad", [-0.0001, 1.0001, NAN, INF, True, "0.5", None])
def test_invalid_factors_are_rejected(bad):
    with pytest.raises(RoadGraphError):
        make_graph({1: grid_coord(0, 0)}, [], heuristic_factor=bad)


def test_with_heuristic_factor_returns_a_new_graph_and_keeps_the_old_one():
    original = line_graph()
    changed = original.with_heuristic_factor(0.5)
    assert changed is not original
    assert changed.heuristic_factor == 0.5
    assert original.heuristic_factor != 0.5
    assert changed.node_ids == original.node_ids
    assert changed.all_edges() == original.all_edges()
    for node_id in original.node_ids:
        assert changed.coords(node_id) == original.coords(node_id)


def test_with_heuristic_factor_validates_the_value():
    with pytest.raises(RoadGraphError):
        line_graph().with_heuristic_factor(1.5)


# ---------------- coverage box (D4) ----------------
def test_coverage_box_is_the_bounding_box_of_the_nodes():
    box = line_graph().coverage_box
    assert box.south == box.north == grid_coord(0, 0)[0]
    assert box.west == grid_coord(0, 0)[1]
    assert box.east == grid_coord(3, 0)[1]
    assert box.contains(*grid_coord(1.5, 0)) is True
    assert box.contains(*grid_coord(4, 0)) is False


def test_coverage_box_includes_isolated_nodes():
    box = one_way_graph().coverage_box  # node 4 sits at grid (5, 5)
    assert box.north == grid_coord(5, 5)[0]
    assert box.east == grid_coord(5, 5)[1]


def test_repr_mentions_the_sizes():
    text = repr(line_graph())
    assert "nodes=4" in text and "edges=6" in text


# ---------------- internal mappings are read-only ----------------
# These tests look at private attributes on purpose: the design promise is
# that even the internal lookup tables cannot be changed by accident.
# NOTE: MappingProxyType has no __setitem__/__delitem__ methods, so we use
# the operator module (or normal item syntax), which raises TypeError.
INTERNAL_MAPPINGS = ["_coords", "_out", "_lookup"]


@pytest.mark.parametrize("name", INTERNAL_MAPPINGS)
def test_internal_mappings_are_read_only_proxies(name):
    assert isinstance(getattr(line_graph(), name), MappingProxyType)


@pytest.mark.parametrize("name", INTERNAL_MAPPINGS)
def test_changing_an_existing_entry_raises_type_error(name):
    mapping = getattr(line_graph(), name)
    key = next(iter(mapping))
    with pytest.raises(TypeError):
        mapping[key] = None


@pytest.mark.parametrize("name", INTERNAL_MAPPINGS)
def test_adding_a_new_entry_raises_type_error(name):
    mapping = getattr(line_graph(), name)
    with pytest.raises(TypeError):
        mapping["brand-new-key"] = None


@pytest.mark.parametrize("name", INTERNAL_MAPPINGS)
def test_deleting_an_entry_raises_type_error(name):
    mapping = getattr(line_graph(), name)
    key = next(iter(mapping))
    with pytest.raises(TypeError):
        del mapping[key]


@pytest.mark.parametrize("name", INTERNAL_MAPPINGS)
def test_failed_modification_attempts_leave_the_contents_unchanged(name):
    graph = line_graph()
    mapping = getattr(graph, name)
    before = dict(mapping)
    key = next(iter(mapping))
    for action in (
        lambda: operator.setitem(mapping, key, None),  # change an entry
        lambda: operator.setitem(mapping, "new", None),  # add an entry
        lambda: operator.delitem(mapping, key),  # delete an entry
    ):
        with pytest.raises(TypeError):
            action()
    assert dict(mapping) == before
    assert graph.node_count == 4 and graph.edge_count == 6


@pytest.mark.parametrize("name", INTERNAL_MAPPINGS)
def test_internal_mappings_of_a_graph_without_edges_are_also_read_only(name):
    graph = make_graph({1: grid_coord(0, 0)}, [])
    mapping = getattr(graph, name)
    assert isinstance(mapping, MappingProxyType)
    with pytest.raises(TypeError):
        mapping["new"] = None


def test_internal_mappings_keep_deterministic_sorted_order():
    nodes = {i: grid_coord(i, 0) for i in range(1, 6)}
    edges = []
    for u in range(1, 5):
        edges += two_way(u, u + 1, 10.0 * u)
    shuffled = edges[:]
    random.Random(11).shuffle(shuffled)
    graph = make_graph(dict(reversed(list(nodes.items()))), shuffled)

    assert list(graph._coords) == sorted(graph._coords)
    assert list(graph._out) == sorted(graph._out)
    assert list(graph._lookup) == sorted(graph._lookup)
    for node_id in graph.node_ids:
        targets = [e.target for e in graph._out[node_id]]
        assert targets == sorted(targets)


def test_internal_mappings_agree_with_the_public_methods():
    graph = one_way_graph()
    for node_id in graph.node_ids:
        assert graph._coords[node_id] == graph.coords(node_id)
        assert graph._out[node_id] == graph.out_edges(node_id)
    for edge in graph.all_edges():
        assert graph._lookup[(edge.source, edge.target)] is edge
        assert graph.edge(edge.source, edge.target) is edge


def test_values_inside_the_internal_mappings_are_immutable_types():
    graph = line_graph()
    assert all(isinstance(point, tuple) for point in graph._coords.values())
    assert all(isinstance(edges, tuple) for edges in graph._out.values())
    with pytest.raises(FrozenInstanceError):
        graph._lookup[(1, 2)].length_m = 1.0


def test_with_heuristic_factor_works_with_read_only_mappings():
    original = line_graph()
    changed = original.with_heuristic_factor(0.25)

    # Same map, different factor.
    assert changed.heuristic_factor == 0.25
    assert dict(changed._coords) == dict(original._coords)
    assert dict(changed._out) == dict(original._out)
    assert dict(changed._lookup) == dict(original._lookup)

    # The copy has its OWN read-only mappings (not shared with the original).
    for name in INTERNAL_MAPPINGS:
        assert getattr(changed, name) is not getattr(original, name)
        assert isinstance(getattr(changed, name), MappingProxyType)
        with pytest.raises(TypeError):
            getattr(changed, name)["new"] = None

    # The original is untouched.
    assert original.heuristic_factor != 0.25