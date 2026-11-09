"""Phase 6.3: scenario tests on the REAL road map (opt-in, slow).

These tests call POST /recommend-hospital on the larger Bengaluru graph, the one the
service loads by default (app/data/graph/bengaluru_coverage_box.graphml, installed by
`python scripts/setup_graph.py`; 23 of 37 demo hospitals). If that file is missing, the
Phase 0 copy in phase0/output/ is used.

They are OFF by default because loading that graph takes 20 to 80 seconds and
about 1.4 GB of memory. They are skipped unless BOTH are true:
  - the environment variable AIDFLOW_RUN_REAL_MAP_TESTS is set to 1
  - the graph file exists (override the path with AIDFLOW_REAL_GRAPH_PATH)

Windows Command Prompt:
    set AIDFLOW_RUN_REAL_MAP_TESTS=1
    pytest tests\\test_real_map_scenarios.py -v

The tests check properties that must hold on any correct road graph (a route
is never shorter than the straight line, A* equals Dijkstra, closed hospitals
are never chosen, ...) instead of hard-coding exact distances, so they stay
valid if the graph file is regenerated. Hospitals are never assumed to be
inside the graph: the test reads which ones snap onto it.

Hospital behaviour is checked with the demo clock (dataset as_of 2026-10-31).
The real clock is used in one scenario to show the stale-data rule.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.data.hospital_repository import load_repository
from app.main import create_app
from app.services.geo import haversine_m
from app.services.graph_loader import DEFAULT_GRAPH_PATH, load_road_graph
from app.services.routing import find_route
from app.services.snapping import OutOfCoverageError, snap_hospital, snap_to_road

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PHASE0_COPY = PROJECT_ROOT / "phase0" / "output" / "bengaluru_coverage_box.graphml"
GRAPH_PATH = Path(
    os.environ.get(
        "AIDFLOW_REAL_GRAPH_PATH",
        DEFAULT_GRAPH_PATH if DEFAULT_GRAPH_PATH.is_file() else PHASE0_COPY,
    )
)

pytestmark = pytest.mark.skipif(
    os.environ.get("AIDFLOW_RUN_REAL_MAP_TESTS") != "1" or not GRAPH_PATH.is_file(),
    reason=(
        "Real-map tests are opt-in: set AIDFLOW_RUN_REAL_MAP_TESTS=1 and make sure "
        f"the graph file exists ({GRAPH_PATH})."
    ),
)

# Pickup points 0.6 to 1.8 km from the nearest demo hospital (never a hospital's own
# coordinates, which would give a 0.0 min trip).
PICKUPS = {
    "Cubbon Park": (12.9763, 77.5929),
    "Indiranagar": (12.9719, 77.6412),
    "Koramangala": (12.9347, 77.6191),
    "Hebbal": (13.0300, 77.5900),
    "Jayanagar": (12.9308, 77.5838),
}

# Hospitals the demo dataset marks as unsuitable for an ICU request, and always-excluded ones.
NOT_FOR_ICU = {"H06", "H11", "H14", "H17", "H33"}  # no ICU / closed / diverted / no ICU beds
NEVER_OPEN = {"H11", "H14"}  # CLOSED and DIVERTED
OUTSIDE_AREA = "H37"  # deliberately outside Bengaluru coverage


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def graph():
    return load_road_graph(GRAPH_PATH)


@pytest.fixture(scope="module")
def repo():
    return load_repository()


@pytest.fixture(scope="module")
def reachable(graph, repo) -> set[str]:
    """IDs of demo hospitals that snap onto this graph."""
    found = set()
    for hospital in repo.all():
        try:
            snap_hospital(graph, hospital)
            found.add(hospital.hospital_id)
        except OutOfCoverageError:
            pass
    return found


@pytest.fixture(scope="module")
def demo_client(graph):
    """Demo clock: hospitals are fresh, so the ICU-bed rule and bed tie-break apply."""
    with patch("app.api.routes.get_road_graph", lambda *a, **k: graph):
        yield TestClient(create_app(Settings(time_mode="demo")))


@pytest.fixture(scope="module")
def real_clock_client(graph):
    """Real clock: the demo data is days old, so every hospital counts as stale."""
    with patch("app.api.routes.get_road_graph", lambda *a, **k: graph):
        yield TestClient(create_app(Settings(time_mode="real")))


def post(client, origin, needs=(), candidates=None, max_alternatives=2):
    body = {
        "origin": {"lat": origin[0], "lng": origin[1]},
        "needs": list(needs),
        "max_alternatives": max_alternatives,
    }
    if candidates is not None:
        body["candidate_hospital_ids"] = list(candidates)
    return client.post("/recommend-hospital", json=body)


def require(reachable, *ids):
    missing = [i for i in ids if i not in reachable]
    if missing:
        pytest.skip(f"Needs hospitals {missing}, which are not inside this graph.")


def shown_ids(data):
    return [data["recommended"]["hospital_id"]] + [a["hospital_id"] for a in data["alternatives"]]


# ---------------------------------------------------------------------------
# S1. Which hospitals the map can reach
# ---------------------------------------------------------------------------
def test_s1_larger_graph_reaches_most_central_hospitals(reachable):
    assert len(reachable) >= 20  # measured 23 of 37 in Phase 0
    assert {"H01", "H02"} <= reachable
    assert OUTSIDE_AREA not in reachable  # H37 is deliberately outside the area


def test_s1b_phase0_reference_routes_still_hold_on_the_larger_graph(graph, repo, reachable):
    """The larger graph contains every road of the small Phase 0 graph, so a shortest route
    can only stay the same or get shorter (Phase 0: H01 -> H02 5.01 km, H02 -> H01 4.53 km)."""
    require(reachable, "H01", "H02")
    h01, h02 = repo.get("H01"), repo.get("H02")
    snap1, snap2 = snap_hospital(graph, h01), snap_hospital(graph, h02)
    assert snap1.distance_m == pytest.approx(162, abs=1.5)  # Phase 0 snapping distances
    assert snap2.distance_m == pytest.approx(8, abs=1.5)

    straight_km = haversine_m(
        h01.location.lat, h01.location.lng, h02.location.lat, h02.location.lng
    ) / 1000
    for source, target, small_graph_km in ((snap1, snap2, 5.01), (snap2, snap1, 4.53)):
        astar = find_route(graph, source.node_id, target.node_id, "astar")
        dijkstra = find_route(graph, source.node_id, target.node_id, "dijkstra")
        assert astar.total_distance_m == pytest.approx(dijkstra.total_distance_m, rel=1e-7)
        assert straight_km - 0.4 <= astar.total_distance_m / 1000 <= small_graph_km + 0.05


# ---------------------------------------------------------------------------
# S2 to S5. A normal recommendation is a believable road route
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("place", list(PICKUPS))
def test_s2_any_open_hospital_gives_a_real_route(demo_client, graph, reachable, place):
    origin = PICKUPS[place]
    response = post(demo_client, origin)
    assert response.status_code == 200, response.text
    data = response.json()
    rec = data["recommended"]

    assert rec["hospital_id"] in reachable
    assert rec["hospital_id"] not in NEVER_OPEN
    assert rec["distance_km"] > 0 and rec["eta_min"] > 0
    assert data["warnings"] == []
    assert data["assumptions"]["live_traffic"] is False

    route = data["route"]
    assert route["to_hospital_id"] == rec["hospital_id"]
    assert route["distance_km"] == rec["distance_km"] and route["eta_min"] == rec["eta_min"]
    assert len(route["polyline"]) >= 2
    # The line starts at the road node nearest the pickup (snapping offset only).
    start = snap_to_road(graph, *origin)
    assert haversine_m(*route["polyline"][0], *origin) == pytest.approx(start.distance_m, abs=2)


@pytest.mark.parametrize("place", list(PICKUPS))
def test_s3_eta_matches_distance_at_30_kmh(demo_client, place):
    data = post(demo_client, PICKUPS[place]).json()
    for item in [data["recommended"], *data["alternatives"]]:
        # eta = km / 30 * 60 = km * 2, allowing for rounding of both numbers
        assert item["eta_min"] == pytest.approx(item["distance_km"] * 2, abs=0.1)


@pytest.mark.parametrize("place", list(PICKUPS))
def test_s4_road_distance_is_never_shorter_than_the_straight_line(
    demo_client, graph, repo, place
):
    origin = PICKUPS[place]
    data = post(demo_client, origin).json()
    start = snap_to_road(graph, *origin)
    for hospital_id in shown_ids(data):
        hospital = repo.get(hospital_id)
        end = snap_hospital(graph, hospital)
        item = data["recommended"] if hospital_id == data["recommended"]["hospital_id"] else next(
            a for a in data["alternatives"] if a["hospital_id"] == hospital_id
        )
        straight = haversine_m(*origin, hospital.location.lat, hospital.location.lng)
        # Triangle inequality: the road between snapped nodes plus the two snapping offsets
        # can never be shorter than the straight line between the original points.
        assert item["distance_km"] * 1000 + start.distance_m + end.distance_m + 10 >= straight


@pytest.mark.parametrize("place", list(PICKUPS))
def test_s5_astar_and_dijkstra_agree_on_every_returned_hospital(
    demo_client, graph, repo, place
):
    origin = PICKUPS[place]
    data = post(demo_client, origin, max_alternatives=5).json()
    start = snap_to_road(graph, *origin)
    for hospital_id in shown_ids(data):
        end = snap_hospital(graph, repo.get(hospital_id))
        astar = find_route(graph, start.node_id, end.node_id, "astar")
        dijkstra = find_route(graph, start.node_id, end.node_id, "dijkstra")
        assert astar.total_distance_m == pytest.approx(dijkstra.total_distance_m, rel=1e-7)
        item = data["recommended"] if hospital_id == data["recommended"]["hospital_id"] else next(
            a for a in data["alternatives"] if a["hospital_id"] == hospital_id
        )
        assert item["distance_km"] == pytest.approx(astar.total_distance_m / 1000, abs=0.006)


# ---------------------------------------------------------------------------
# S6 to S9. Filtering and ranking on the real map
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("place", list(PICKUPS))
def test_s6_icu_request_never_returns_unsuitable_hospitals(demo_client, place):
    data = post(demo_client, PICKUPS[place], needs=["ICU"], max_alternatives=5).json()
    assert not set(shown_ids(data)) & NOT_FOR_ICU
    assert not set(shown_ids(data)) & {OUTSIDE_AREA}


def test_s7_icu_capable_hospital_with_no_icu_beds_depends_on_data_freshness(
    demo_client, real_clock_client, reachable
):
    """H17 has an ICU but 0 free ICU beds. Fresh data: excluded. Stale data: the bed
    count is ignored, so it stays eligible and the response says the data is stale."""
    require(reachable, "H15", "H17")
    origin = PICKUPS["Hebbal"]

    fresh_both = post(demo_client, origin, ["ICU"], candidates=["H15", "H17"]).json()
    assert shown_ids(fresh_both) == ["H15"]

    fresh_only_h17 = post(demo_client, origin, ["ICU"], candidates=["H17"])
    assert fresh_only_h17.status_code == 422
    assert fresh_only_h17.json()["error"]["code"] == "NO_ELIGIBLE_HOSPITAL"

    stale = post(real_clock_client, origin, ["ICU"], candidates=["H17"])
    assert stale.status_code == 200
    data = stale.json()
    assert data["recommended"]["hospital_id"] == "H17"
    assert data["recommended"]["bed_data_stale"] is True
    assert [w["code"] for w in data["warnings"]] == ["STALE_HOSPITAL_DATA"]


def test_s8_equal_eta_is_decided_by_beds_then_name(demo_client, reachable):
    """H07 and H08 share one location, so their ETA is identical. H07 has more beds."""
    require(reachable, "H07", "H08")
    data = post(demo_client, PICKUPS["Jayanagar"], candidates=["H08", "H07"]).json()
    assert data["recommended"]["hospital_id"] == "H07"
    assert [a["hospital_id"] for a in data["alternatives"]] == ["H08"]
    assert data["recommended"]["eta_min"] == data["alternatives"][0]["eta_min"]


@pytest.mark.parametrize("place", list(PICKUPS))
def test_s9_results_are_ordered_by_eta_and_closed_hospitals_are_never_shown(
    demo_client, place
):
    data = post(demo_client, PICKUPS[place], max_alternatives=5).json()
    etas = [data["recommended"]["eta_min"]] + [a["eta_min"] for a in data["alternatives"]]
    assert etas == sorted(etas)
    assert not set(shown_ids(data)) & NEVER_OPEN
    assert len(shown_ids(data)) == len(set(shown_ids(data)))


def test_s10_every_need_must_be_met(demo_client, repo):
    data = post(demo_client, PICKUPS["Koramangala"], ["TRAUMA", "CARDIAC"], max_alternatives=5).json()
    for hospital_id in shown_ids(data):
        assert {"TRAUMA", "CARDIAC"} <= set(repo.get(hospital_id).specialties)


# ---------------------------------------------------------------------------
# S11 to S14. Failure outcomes
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "origin",
    [(13.10, 77.60), (12.80, 77.60), (28.6139, 77.2090)],
    ids=["north of the map", "south of the map", "Delhi"],
)
def test_s11_pickup_outside_the_map_is_out_of_coverage(demo_client, graph, origin):
    assert not graph.coverage_box.contains(*origin)
    response = post(demo_client, origin)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "OUT_OF_COVERAGE"


def test_s12_no_hospital_meets_the_needs(demo_client, reachable):
    require(reachable, "H01", "H11")
    no_maternity = post(demo_client, PICKUPS["Cubbon Park"], ["MATERNITY"], candidates=["H01"])
    assert no_maternity.status_code == 422
    assert no_maternity.json()["error"]["code"] == "NO_ELIGIBLE_HOSPITAL"

    closed = post(demo_client, PICKUPS["Cubbon Park"], candidates=["H11"])
    assert closed.status_code == 422
    assert closed.json()["error"]["code"] == "NO_ELIGIBLE_HOSPITAL"


def test_s13_hospital_outside_the_map_is_skipped_or_reported_unreachable(
    demo_client, reachable
):
    """P7 (provisional): a hospital outside the loaded graph is skipped silently."""
    require(reachable, "H01")
    only_outside = post(demo_client, PICKUPS["Cubbon Park"], candidates=[OUTSIDE_AREA])
    assert only_outside.status_code == 422
    assert only_outside.json()["error"]["code"] == "NO_ROUTE_FOUND"

    mixed = post(demo_client, PICKUPS["Cubbon Park"], candidates=[OUTSIDE_AREA, "H01"]).json()
    assert shown_ids(mixed) == ["H01"]


def test_s14_bad_requests_are_rejected_before_the_map_is_used(demo_client):
    bad = demo_client.post(
        "/recommend-hospital",
        json={"origin": {"lat": "12.97", "lng": 77.59}, "needs": ["ICU"]},
    )
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "INVALID_COORDINATES"


# ---------------------------------------------------------------------------
# S15 to S16. Repeatability and speed
# ---------------------------------------------------------------------------
def test_s15_same_request_gives_same_answer(demo_client):
    first = post(demo_client, PICKUPS["Indiranagar"], ["ICU"], max_alternatives=3).json()
    second = post(demo_client, PICKUPS["Indiranagar"], ["ICU"], max_alternatives=3).json()
    first.pop("generated_at")
    second.pop("generated_at")
    assert first == second


def test_s16_max_alternatives_is_respected(demo_client):
    for wanted in (0, 1, 3):
        data = post(demo_client, PICKUPS["Cubbon Park"], max_alternatives=wanted).json()
        assert len(data["alternatives"]) == wanted


def test_s17_heaviest_request_finishes_in_reasonable_time(demo_client):
    """Phase 6.2 measured about 1.5 s typical and 3.9 s worst; 20 s is a generous guard."""
    import time

    started = time.perf_counter()
    response = post(demo_client, PICKUPS["Cubbon Park"])  # no needs: routes to every hospital
    assert response.status_code == 200
    assert time.perf_counter() - started < 20
