"""Tests for geo.py: distances, coordinate validation, GeoBox."""

import math

import pytest

from app.services.geo import (
    EARTH_RADIUS_M,
    CoordinateError,
    GeoBox,
    haversine_m,
    validate_lat_lng,
)


# ---------------- haversine ----------------
def test_same_point_is_zero():
    assert haversine_m(12.97, 77.59, 12.97, 77.59) == 0.0


def test_one_degree_of_longitude_on_the_equator():
    expected = EARTH_RADIUS_M * math.radians(1)
    assert haversine_m(0, 0, 0, 1) == pytest.approx(expected, rel=1e-9)


def test_one_degree_of_latitude_anywhere():
    expected = EARTH_RADIUS_M * math.radians(1)
    assert haversine_m(12.0, 77.0, 13.0, 77.0) == pytest.approx(expected, rel=1e-9)


def test_quarter_and_half_of_the_earth():
    assert haversine_m(0, 0, 90, 0) == pytest.approx(
        EARTH_RADIUS_M * math.pi / 2, rel=1e-9
    )
    assert haversine_m(0, 0, 0, 180) == pytest.approx(EARTH_RADIUS_M * math.pi, rel=1e-9)
    # Opposite poles / opposite sides must not crash (asin guard).
    assert haversine_m(90, 0, -90, 0) == pytest.approx(EARTH_RADIUS_M * math.pi, rel=1e-9)


def test_distance_is_the_same_in_both_directions():
    forward = haversine_m(12.9767, 77.5713, 12.9857, 77.6057)
    backward = haversine_m(12.9857, 77.6057, 12.9767, 77.5713)
    assert forward == pytest.approx(backward, rel=1e-12)


def test_demo_hospitals_h01_h02_are_about_3_9_km_apart():
    # Original dataset coordinates of H01 and H02. Sanity check only:
    # Phase 0 measured 3.95 km between the SNAPPED nodes, which differ slightly.
    metres = haversine_m(12.9767, 77.5713, 12.9857, 77.6057)
    assert 3800 < metres < 3900


def test_argument_order_matters_so_a_swap_changes_the_answer():
    # Points one degree apart, so a lat/lng swap makes a large difference.
    # (For very short distances in Bengaluru, a swap changes the result by
    # only a few tens of metres, so a short-distance test would be too weak.)
    correct = haversine_m(12.0, 77.0, 13.0, 78.0)
    swapped = haversine_m(77.0, 12.0, 78.0, 13.0)
    assert abs(correct - swapped) > 1000


# ---------------- validate_lat_lng: good values ----------------
def test_valid_pair_is_returned_as_floats():
    assert validate_lat_lng(12.9716, 77.5946) == (12.9716, 77.5946)
    result = validate_lat_lng(13, 77)  # integers are fine
    assert result == (13.0, 77.0)
    assert all(isinstance(v, float) for v in result)


@pytest.mark.parametrize(
    "lat, lng",
    [(90, 180), (-90, -180), (90, -180), (-90, 180), (0, 0)],
)
def test_limits_are_accepted(lat, lng):
    assert validate_lat_lng(lat, lng) == (float(lat), float(lng))


# ---------------- validate_lat_lng: bad values ----------------
BAD_NUMBERS = [None, "12.9", "", True, False, [1.0], float("nan"), float("inf"), float("-inf")]


@pytest.mark.parametrize("bad", BAD_NUMBERS)
def test_bad_latitude_is_rejected(bad):
    with pytest.raises(CoordinateError):
        validate_lat_lng(bad, 77.59)


@pytest.mark.parametrize("bad", BAD_NUMBERS)
def test_bad_longitude_is_rejected(bad):
    with pytest.raises(CoordinateError):
        validate_lat_lng(12.97, bad)


@pytest.mark.parametrize(
    "lat, lng",
    [(91, 77), (-90.0001, 77), (12, 181), (12, -180.0001)],
)
def test_out_of_range_is_rejected(lat, lng):
    with pytest.raises(CoordinateError):
        validate_lat_lng(lat, lng)


def test_longitude_used_as_latitude_is_caught_when_above_90():
    # A longitude such as 120 can never be a latitude.
    with pytest.raises(CoordinateError):
        validate_lat_lng(120.0, 12.97)


def test_coordinate_error_is_a_value_error():
    assert issubclass(CoordinateError, ValueError)


# ---------------- GeoBox ----------------
BOX = GeoBox(south=12.96, north=13.00, west=77.56, east=77.62)


def test_point_inside_the_box():
    assert BOX.contains(12.98, 77.59) is True


@pytest.mark.parametrize(
    "lat, lng",
    [(12.96, 77.56), (13.00, 77.62), (12.96, 77.62), (13.00, 77.56), (12.98, 77.56)],
)
def test_border_and_corner_points_count_as_inside(lat, lng):
    assert BOX.contains(lat, lng) is True


@pytest.mark.parametrize(
    "lat, lng",
    [(12.9599, 77.59), (13.0001, 77.59), (12.98, 77.5599), (12.98, 77.6201)],
)
def test_points_just_outside_are_rejected(lat, lng):
    assert BOX.contains(lat, lng) is False


def test_lat_and_lng_are_not_mixed_up_in_contains():
    # Swapped arguments put the point far outside the box.
    assert BOX.contains(77.59, 12.98) is False


def test_box_from_points():
    box = GeoBox.from_points([(12.97, 77.59), (12.99, 77.57), (12.96, 77.61)])
    assert box == GeoBox(south=12.96, north=12.99, west=77.57, east=77.61)


def test_box_from_a_single_point_is_allowed():
    box = GeoBox.from_points([(12.97, 77.59)])
    assert box.contains(12.97, 77.59) is True
    assert box.contains(12.9701, 77.59) is False


def test_box_from_no_points_is_an_error():
    with pytest.raises(ValueError):
        GeoBox.from_points([])


def test_box_with_reversed_sides_is_an_error():
    with pytest.raises(ValueError):
        GeoBox(south=13.0, north=12.0, west=77.0, east=78.0)
    with pytest.raises(ValueError):
        GeoBox(south=12.0, north=13.0, west=78.0, east=77.0)


# ---------------- GeoBox: range checks ----------------
def test_box_covering_the_whole_world_is_allowed():
    box = GeoBox(south=-90, north=90, west=-180, east=180)
    assert box.contains(0, 0) is True
    assert box.contains(90, 180) is True
    assert box.contains(-90, -180) is True


@pytest.mark.parametrize(
    "south, north, west, east",
    [
        (-90.0001, 13.0, 77.0, 78.0),  # south below -90
        (12.0, 90.0001, 77.0, 78.0),  # north above 90
        (91.0, 92.0, 77.0, 78.0),  # both latitudes out of range
        (12.0, 13.0, -180.0001, 78.0),  # west below -180
        (12.0, 13.0, 77.0, 180.0001),  # east above 180
        (12.0, 13.0, 181.0, 182.0),  # both longitudes out of range
    ],
)
def test_box_with_out_of_range_boundaries_is_an_error(south, north, west, east):
    with pytest.raises(ValueError):
        GeoBox(south=south, north=north, west=west, east=east)


@pytest.mark.parametrize("which", ["south", "north", "west", "east"])
def test_box_with_nan_boundary_is_an_error(which):
    values = {"south": 12.0, "north": 13.0, "west": 77.0, "east": 78.0}
    values[which] = float("nan")
    with pytest.raises(ValueError):
        GeoBox(**values)


def test_box_from_points_with_out_of_range_point_is_an_error():
    with pytest.raises(ValueError):
        GeoBox.from_points([(12.97, 77.59), (95.0, 77.60)])