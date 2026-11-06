"""Tests for location snapping (app/services/snapping.py).

Verifies coordinate validation, boundary conditions, tie-breaking,
distance threshold limits, and error handling.
"""

import math
from dataclasses import dataclass

import pytest

from app.services.geo import CoordinateError, haversine_m
from app.services.road_graph import RoadGraph
from app.services.snapping import (
    OutOfCoverageError,
    SnapResult,
    SnappingError,
    snap_hospital,
    snap_location,
    snap_point,
    snap_to_road,
)
from tests.synthetic_graphs import (
    BASE_LAT,
    BASE_LNG,
    diamond_graph,
    grid_coord,
    line_graph,
    make_graph,
    one_way_graph,
)

NAN = float("nan")
INF = float("inf")


# ---------------------------------------------------------------------------
# Basic Snapping
# ---------------------------------------------------------------------------
def test_snap_exact_node_location_has_zero_distance():
    graph = line_graph()
    node_coords = graph.coords(1)
    result = snap_to_road(graph, node_coords[0], node_coords[1])

    assert isinstance(result, SnapResult)
    assert result.node_id == 1
    assert result.distance_m == 0.0
    assert result.coords == node_coords


def test_snap_result_supports_unpacking_and_attributes():
    graph = line_graph()
    target_coord = graph.coords(2)
    result = snap_to_road(graph, target_coord[0], target_coord[1])

    node_id, distance_m, coords = result
    assert node_id == 2
    assert distance_m == 0.0
    assert coords == target_coord

    # Attribute access
    assert result.node_id == 2
    assert result.distance_m == 0.0
    assert result.coords == target_coord


def test_snap_finds_closest_node():
    graph = diamond_graph()  # Nodes at (0,0), (1,1), (1,-1), (2,0)
    coord_2 = graph.coords(2)
    # A point slightly offset from node 2 but safely inside diamond bounding box
    query_lat = coord_2[0] - 0.0001
    query_lng = coord_2[1] - 0.0001

    result = snap_to_road(graph, query_lat, query_lng)
    assert result.node_id == 2
    expected_dist = haversine_m(query_lat, query_lng, *coord_2)
    assert result.distance_m == pytest.approx(expected_dist, rel=1e-6)


# ---------------------------------------------------------------------------
# Deterministic Tie-Breaking
# ---------------------------------------------------------------------------
def test_snap_tie_breaking_picks_lowest_node_id():
    # Two nodes placed symmetrically around the query point
    # Node 10 at (BASE_LAT, BASE_LNG - 0.001)
    # Node 20 at (BASE_LAT, BASE_LNG + 0.001)
    # Query point at (BASE_LAT, BASE_LNG): exactly equidistant to both
    nodes = {
        20: (BASE_LAT, BASE_LNG + 0.001),
        10: (BASE_LAT, BASE_LNG - 0.001),
    }
    graph = make_graph(nodes, [(10, 20, 200.0), (20, 10, 200.0)])

    result = snap_to_road(graph, BASE_LAT, BASE_LNG)
    assert result.node_id == 10  # Lowest ID wins


def test_snap_tie_breaking_is_order_independent():
    # Test with nodes in reverse order in input dict
    nodes = {
        50: (BASE_LAT, BASE_LNG - 0.001),
        30: (BASE_LAT, BASE_LNG + 0.001),
    }
    graph = make_graph(nodes, [(30, 50, 200.0), (50, 30, 200.0)])

    result = snap_to_road(graph, BASE_LAT, BASE_LNG)
    assert result.node_id == 30


# ---------------------------------------------------------------------------
# Coverage Box and Boundaries
# ---------------------------------------------------------------------------
def test_snap_point_outside_coverage_box_raises_out_of_coverage():
    graph = line_graph()
    box = graph.coverage_box

    # North of box
    with pytest.raises(OutOfCoverageError, match="outside the road network coverage area"):
        snap_to_road(graph, box.north + 0.01, (box.west + box.east) / 2)

    # South of box
    with pytest.raises(OutOfCoverageError, match="outside the road network coverage area"):
        snap_to_road(graph, box.south - 0.01, (box.west + box.east) / 2)

    # East of box
    with pytest.raises(OutOfCoverageError, match="outside the road network coverage area"):
        snap_to_road(graph, (box.south + box.north) / 2, box.east + 0.01)

    # West of box
    with pytest.raises(OutOfCoverageError, match="outside the road network coverage area"):
        snap_to_road(graph, (box.south + box.north) / 2, box.west - 0.01)


def test_snap_exact_coverage_boundary_points_are_accepted():
    graph = line_graph()
    box = graph.coverage_box

    # Exact corners of bounding box are inside coverage
    for lat in (box.south, box.north):
        for lng in (box.west, box.east):
            result = snap_to_road(graph, lat, lng)
            assert isinstance(result, SnapResult)
            assert result.node_id in graph.node_ids


# ---------------------------------------------------------------------------
# Maximum Distance Limits
# ---------------------------------------------------------------------------
def test_snap_within_max_distance_succeeds():
    graph = line_graph()
    c = graph.coords(1)
    # 500m limit, distance is 0m
    result = snap_to_road(graph, c[0], c[1], max_distance_m=500.0)
    assert result.node_id == 1


def test_snap_exceeding_max_distance_raises_out_of_coverage():
    graph = line_graph()
    c = graph.coords(1)
    # Query point slightly away from node 1 (about 110m away along latitude)
    query_lat = c[0] + 0.001
    query_lng = c[1]

    # Node 1 is inside coverage box if box has height
    # Let's create a graph with a box that covers the query point
    nodes = {
        1: grid_coord(0, 0),
        2: grid_coord(2, 2),
    }
    g = make_graph(nodes, [(1, 2, 300.0), (2, 1, 300.0)])
    # Query point at grid_coord(0.5, 0.5) is inside coverage
    q = grid_coord(0.5, 0.5)
    dist = haversine_m(q[0], q[1], *g.coords(1))

    # Setting limit smaller than dist raises OutOfCoverageError
    with pytest.raises(OutOfCoverageError, match="exceeding the maximum allowed snapping distance"):
        snap_to_road(g, q[0], q[1], max_distance_m=dist / 2)


@pytest.mark.parametrize("bad_limit", [-1.0, -0.001, NAN, INF, -INF, "500", True, False])
def test_bad_max_distance_is_rejected(bad_limit):
    graph = line_graph()
    c = graph.coords(1)
    with pytest.raises(ValueError):
        snap_to_road(graph, c[0], c[1], max_distance_m=bad_limit)


# ---------------------------------------------------------------------------
# Invalid Coordinates
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "lat,lng",
    [
        (91.0, 77.0),
        (-91.0, 77.0),
        (12.0, 181.0),
        (12.0, -181.0),
        (NAN, 77.0),
        (12.0, NAN),
        (INF, 77.0),
        (12.0, INF),
        ("12.0", 77.0),
        (12.0, "77.0"),
        (None, 77.0),
        (12.0, None),
        (True, 77.0),
        (12.0, False),
    ],
)
def test_invalid_coordinates_raise_coordinate_error(lat, lng):
    graph = line_graph()
    with pytest.raises(CoordinateError):
        snap_to_road(graph, lat, lng)


# ---------------------------------------------------------------------------
# Invalid Graph Arguments
# ---------------------------------------------------------------------------
def test_invalid_graph_type_raises_type_error():
    with pytest.raises(TypeError, match="graph must be a RoadGraph instance"):
        snap_to_road("not_a_graph", 12.97, 77.59)


# ---------------------------------------------------------------------------
# Aliases and Hospital Helper
# ---------------------------------------------------------------------------
def test_snap_point_and_snap_location_are_aliases():
    assert snap_point is snap_to_road
    assert snap_location is snap_to_road


def test_snap_hospital_dict():
    graph = line_graph()
    c = graph.coords(3)
    hospital_dict = {
        "hospital_id": "H99",
        "name": "Test Hospital",
        "location": {"lat": c[0], "lng": c[1]},
    }
    result = snap_hospital(graph, hospital_dict)
    assert result.node_id == 3
    assert result.distance_m == 0.0


def test_snap_hospital_dataclass():
    @dataclass
    class Location:
        lat: float
        lng: float

    @dataclass
    class HospitalObj:
        hospital_id: str
        location: Location

    graph = line_graph()
    c = graph.coords(4)
    h_obj = HospitalObj(hospital_id="H01", location=Location(lat=c[0], lng=c[1]))

    result = snap_hospital(graph, h_obj)
    assert result.node_id == 4
    assert result.distance_m == 0.0


def test_snap_hospital_invalid_shape_raises_snapping_error():
    graph = line_graph()
    with pytest.raises(SnappingError):
        snap_hospital(graph, {"no_location": 123})
    with pytest.raises(SnappingError):
        snap_hospital(graph, "invalid_type")
