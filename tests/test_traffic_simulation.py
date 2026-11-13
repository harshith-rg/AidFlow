"""Comprehensive tests for the simulated traffic feature (Phase 9).

Covers:
1. Separation of physical road distance and travel-time costs.
2. Deterministic demo scenario inputs and corridor multipliers.
3. Base graph immutability (overlay never mutates RoadGraph).
4. Congestion changing travel time and route choice (rerouting around traffic).
5. Road closures excluding directed edges, handling one-way edges, and no-route state.
6. A* heuristic admissibility and agreement with Dijkstra under overlays.
7. API endpoints:
   - GET /api/demo/traffic-scenarios
   - POST /api/demo/recommend-simulated (normal equivalence, congestion reranking, delay display)
   - POST /api/demo/route with scenario parameter
   - Error handling (invalid scenarios, invalid coordinates, unreachable targets)
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models.hospital import Hospital, Location
from app.models.schemas import ErrorCode
from app.services.astar import astar
from app.services.dijkstra import dijkstra
from app.services.geo import GeoBox, haversine_m
from app.services.road_graph import Edge, LatLng, RoadGraph
from app.services.routing import PathNotFoundError, find_route, find_route_between_locations
from app.services.traffic import (
    CENTRAL_BENGALURU_CORRIDOR,
    TrafficOverlay,
    get_traffic_overlay,
    list_available_scenarios,
)
from tests.synthetic_graphs import make_graph, one_way_graph, random_graph

DEMO_AS_OF = datetime(2026, 10, 31, 14, 30, tzinfo=timezone.utc)


@pytest.fixture
def client() -> TestClient:
    app = create_app(Settings(time_mode="demo"))
    return TestClient(app, raise_server_exceptions=False)


# -----------------------------------------------------------------------------
# 1. Traffic Overlay Unit Tests & Base Graph Immutability
# -----------------------------------------------------------------------------

def test_list_available_scenarios():
    """Verify available demo scenarios are documented and return deterministic metadata."""
    scenarios = list_available_scenarios()
    ids = [s.scenario_id for s in scenarios]
    assert "normal" in ids
    assert "moderate" in ids
    assert "heavy" in ids
    assert "closure" in ids

    # Check multipliers
    by_id = {s.scenario_id: s for s in scenarios}
    assert by_id["normal"].corridor_factor == 1.0
    assert by_id["moderate"].corridor_factor == 1.6
    assert by_id["heavy"].corridor_factor == 2.5
    assert by_id["closure"].has_closure is True


def test_traffic_overlay_edge_cost_and_distance_separation():
    """Overlay must modify effective travel-time cost without modifying physical edge length."""
    # Build a small graph with one edge inside corridor and one outside
    # Central corridor: lat 12.960..12.990, lng 77.570..77.620
    nodes = {
        1: (12.975, 77.590),  # inside
        2: (12.975, 77.595),  # inside
        3: (12.900, 77.500),  # outside
        4: (12.900, 77.505),  # outside
    }
    len_inside = haversine_m(*nodes[1], *nodes[2])
    len_outside = haversine_m(*nodes[3], *nodes[4])
    edges = [
        Edge(1, 2, len_inside),
        Edge(3, 4, len_outside),
    ]
    graph = RoadGraph(nodes, edges)

    # Moderate overlay (1.6 inside corridor, 1.2 outside)
    mod_overlay = get_traffic_overlay("moderate")
    assert mod_overlay.edge_effective_cost_m(edges[0], graph) == pytest.approx(len_inside * 1.6)
    assert mod_overlay.edge_effective_cost_m(edges[1], graph) == pytest.approx(len_outside * 1.2)

    # Heavy overlay (2.5 inside corridor, 1.5 outside)
    heavy_overlay = get_traffic_overlay("heavy")
    assert heavy_overlay.edge_effective_cost_m(edges[0], graph) == pytest.approx(len_inside * 2.5)
    assert heavy_overlay.edge_effective_cost_m(edges[1], graph) == pytest.approx(len_outside * 1.5)

    # Physical edge length must remain unchanged!
    assert edges[0].length_m == len_inside
    assert edges[1].length_m == len_outside


def test_base_graph_immutability():
    """Applying traffic overlays must never mutate the base RoadGraph."""
    nodes = {1: (12.970, 77.590), 2: (12.972, 77.592), 3: (12.974, 77.594)}
    edges = [Edge(1, 2, 250.0), Edge(2, 3, 300.0)]
    graph = RoadGraph(nodes, edges)

    # Record snapshot of graph state
    initial_edge_count = graph.edge_count
    initial_node_count = graph.node_count
    initial_lengths = [e.length_m for e in graph.all_edges()]
    initial_out = {u: list(graph.out_edges(u)) for u in (1, 2, 3)}

    # Run searches with different overlays
    for scenario in ("normal", "moderate", "heavy", "closure"):
        overlay = get_traffic_overlay(scenario)
        dijkstra(graph, 1, 3, overlay=overlay)
        astar(graph, 1, 3, overlay=overlay)

    # Verify base graph is 100% identical
    assert graph.edge_count == initial_edge_count
    assert graph.node_count == initial_node_count
    assert [e.length_m for e in graph.all_edges()] == initial_lengths
    assert {u: list(graph.out_edges(u)) for u in (1, 2, 3)} == initial_out


def test_road_closure_directed_exclusion():
    """Closure scenario excludes only the specified directed edge, preserving reverse direction."""
    u, v = 10, 20
    overlay = TrafficOverlay(
        scenario_id="closure",
        name="Road closure scenario",
        description="Simulated road blockage on key corridor link forcing detour routing.",
        closed_edges=frozenset([(u, v)]),
    )
    assert overlay.is_edge_closed(Edge(u, v, 100.0)) is True
    assert overlay.is_edge_closed(Edge(v, u, 100.0)) is False  # Reverse direction is NOT closed


# -----------------------------------------------------------------------------
# 2. Congestion Rerouting & Physical Distance Preservation
# -----------------------------------------------------------------------------

def test_congestion_causes_rerouting_around_traffic():
    """Under heavy congestion, algorithm chooses physically longer route that has lower travel-time cost."""
    # Graph with two paths from 1 to 4:
    # Path A: 1 -> 2 -> 4 (inside custom corridor, length 1000m)
    # Path B: 1 -> 3 -> 4 (outside custom corridor, length 1400m)
    nodes = {
        1: (12.970, 77.580),
        2: (12.975, 77.585),  # inside custom corridor
        3: (12.960, 77.570),  # outside custom corridor
        4: (12.970, 77.590),
    }
    # Path A: total 1000m
    e12 = Edge(1, 2, 500.0)
    e24 = Edge(2, 4, 500.0)
    # Path B: total 1400m
    e13 = Edge(1, 3, 700.0)
    e34 = Edge(3, 4, 700.0)

    graph = RoadGraph(nodes, [e12, e24, e13, e34])

    # Custom corridor that only contains node 2:
    custom_corridor = GeoBox(south=12.974, north=12.976, west=77.584, east=77.586)

    # Normal scenario: picks Path A (1000m < 1400m)
    normal_route = find_route(graph, 1, 4, algorithm="astar", overlay=None)
    assert normal_route is not None
    assert normal_route.nodes == (1, 2, 4)
    assert normal_route.distance_m == 1000.0

    # Heavy congestion scenario (multiplier 2.5 on corridor, 1.0 outside):
    # Path A effective cost = 500*2.5 + 500*2.5 = 2500m.
    # Path B effective cost = 700*1.0 + 700*1.0 = 1400m.
    # Algorithm should reroute to Path B!
    heavy_overlay = TrafficOverlay(
        scenario_id="heavy",
        name="Heavy congestion",
        description="Simulated heavy congestion in central corridor.",
        corridor_factor=2.5,
        non_corridor_factor=1.0,
        corridor_box=custom_corridor,
    )
    heavy_route = find_route(graph, 1, 4, algorithm="astar", overlay=heavy_overlay)
    assert heavy_route is not None
    assert heavy_route.nodes == (1, 3, 4)
    # Physical distance MUST be the actual physical length (1400m), NOT inflated by multiplier!
    assert heavy_route.distance_m == 1400.0
    assert heavy_route.effective_cost_m == 1400.0


def test_physical_distance_preserved_when_route_unchanged():
    """When a single path exists, congestion increases effective cost and ETA, but distance_m is unchanged."""
    nodes = {1: (12.975, 77.580), 2: (12.975, 77.585)}
    graph = RoadGraph(nodes, [Edge(1, 2, 500.0)])

    normal_route = find_route(graph, 1, 2, overlay=None)
    assert normal_route.distance_m == 500.0
    assert (normal_route.effective_cost_m or normal_route.distance_m) == 500.0

    heavy_overlay = TrafficOverlay(
        scenario_id="heavy",
        name="Heavy congestion",
        description="Simulated heavy congestion test.",
        corridor_factor=2.5,
        non_corridor_factor=2.5,
    )
    heavy_route = find_route(graph, 1, 2, overlay=heavy_overlay)
    # Physical distance is STRICTLY 500m
    assert heavy_route.distance_m == 500.0
    # Effective cost is 1250m
    assert heavy_route.effective_cost_m == 1250.0


# -----------------------------------------------------------------------------
# 3. Road Closure Rerouting and No-Route Handling
# -----------------------------------------------------------------------------

def test_road_closure_rerouting():
    """Closing the primary edge forces routing to take an alternative detour."""
    nodes = {
        1: (12.970, 77.590),
        2: (12.971, 77.591),
        3: (12.972, 77.592),
        4: (12.973, 77.593),
    }
    # Path 1: 1 -> 2 -> 4 (length 400m)
    # Path 2: 1 -> 3 -> 4 (length 800m)
    edges = [
        Edge(1, 2, 200.0),
        Edge(2, 4, 200.0),
        Edge(1, 3, 400.0),
        Edge(3, 4, 400.0),
    ]
    graph = RoadGraph(nodes, edges)

    # Normal: takes 1 -> 2 -> 4
    route_normal = find_route(graph, 1, 4)
    assert route_normal.nodes == (1, 2, 4)

    # Closure of edge (1, 2): must take 1 -> 3 -> 4
    closure_overlay = TrafficOverlay(
        scenario_id="closure",
        name="Road closure scenario",
        description="Simulated closure",
        closed_edges=frozenset([(1, 2)]),
    )
    route_closed = find_route(graph, 1, 4, overlay=closure_overlay)
    assert route_closed is not None
    assert route_closed.nodes == (1, 3, 4)
    assert (1, 2) not in [(e.source, e.target) for e in route_closed.edges]


def test_road_closure_no_route_when_all_paths_blocked():
    """When the only connection is closed, routing raises PathNotFoundError."""
    nodes = {1: (12.970, 77.590), 2: (12.971, 77.591)}
    graph = RoadGraph(nodes, [Edge(1, 2, 200.0)])

    closure_overlay = TrafficOverlay(
        scenario_id="closure",
        name="Road closure scenario",
        description="Simulated closure",
        closed_edges=frozenset([(1, 2)]),
    )
    with pytest.raises(PathNotFoundError):
        find_route(graph, 1, 2, overlay=closure_overlay)


# -----------------------------------------------------------------------------
# 4. A* Heuristic Admissibility & Dijkstra Agreement
# -----------------------------------------------------------------------------

@pytest.mark.parametrize("seed", [42, 101, 777])
def test_astar_dijkstra_agreement_under_traffic_overlays(seed: int):
    """A* with admissible geographic heuristic must agree with Dijkstra under traffic overlays."""
    graph = random_graph(seed=seed, node_count=12, edge_probability=0.35)
    all_nodes = graph.node_ids

    # Test under heavy congestion
    overlay = get_traffic_overlay("heavy")

    tested_pairs = 0
    for u in all_nodes[:4]:
        for v in all_nodes[4:8]:
            d_res = None
            d_err = False
            try:
                d_res = dijkstra(graph, u, v, overlay=overlay)
            except PathNotFoundError:
                d_err = True

            a_res = None
            a_err = False
            try:
                a_res = astar(graph, u, v, overlay=overlay)
            except PathNotFoundError:
                a_err = True

            assert d_err == a_err, f"Dijkstra error {d_err} != A* error {a_err} for ({u}, {v})"
            if not d_err:
                assert a_res is not None and d_res is not None
                # Both must find paths of identical effective cost and physical distance
                assert a_res.effective_cost_m == pytest.approx(d_res.effective_cost_m, rel=1e-5)
                assert a_res.distance_m == pytest.approx(d_res.distance_m, rel=1e-5)
                tested_pairs += 1

    assert tested_pairs > 0, "At least some pairs must be connected in random graphs"


# -----------------------------------------------------------------------------
# 5. API Tests: /api/demo/traffic-scenarios & /api/demo/recommend-simulated
# -----------------------------------------------------------------------------

def test_api_traffic_scenarios(client: TestClient):
    """GET /api/demo/traffic-scenarios returns 200 with all scenarios."""
    resp = client.get("/api/demo/traffic-scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert "scenarios" in data
    assert "disclaimer" in data
    scen_ids = [s["scenario_id"] for s in data["scenarios"]]
    assert "normal" in scen_ids
    assert "moderate" in scen_ids
    assert "heavy" in scen_ids
    assert "closure" in scen_ids


def test_api_recommend_simulated_normal_matches_baseline(client: TestClient):
    """POST /api/demo/recommend-simulated with scenario='normal' matches baseline recommendation."""
    graph = one_way_graph()
    mock_hospital = Hospital(
        hospital_id="H_TEST",
        name="Test Hospital",
        locality="Test Area",
        location=Location(lat=12.9700, lng=77.5910),
        status="OPEN",
        beds_total=20,
        beds_available=10,
        icu_beds_available=4,
        specialties=("EMERGENCY",),
        last_updated="2026-10-31T14:00:00Z",
        is_demo=True,
    )

    with patch("app.api.routes.get_road_graph", return_value=graph), \
         patch("app.api.routes.load_repository") as mock_repo:
        repo_instance = MagicMock()
        repo_instance.all_hospitals.return_value = [mock_hospital]
        repo_instance.get.return_value = mock_hospital
        repo_instance.meta.as_of = DEMO_AS_OF
        mock_repo.return_value = repo_instance

        req_body = {
            "origin": {"lat": 12.9700, "lng": 77.5900},
            "candidate_hospital_ids": ["H_TEST"],
            "needs": [],
            "scenario": "normal",
        }
        resp = client.post("/api/demo/recommend-simulated", json=req_body)
        assert resp.status_code == 200
        data = resp.json()

        assert data["scenario"]["scenario_id"] == "normal"
        assert data["recommended"]["hospital_id"] == "H_TEST"
        assert data["recommended"]["baseline_eta_min"] == data["recommended"]["simulated_eta_min"]
        assert data["recommended"]["delay_min"] == 0.0
        assert data["route"]["baseline_eta_min"] == data["route"]["simulated_eta_min"]
        assert data["route"]["delay_min"] == 0.0


def test_api_recommend_simulated_reranks_hospitals_under_congestion(client: TestClient):
    """Simulated congestion reranks an initially slower hospital ahead of a congested hospital."""
    nodes = {
        1: (12.970, 77.575),  # origin
        2: (12.975, 77.585),  # H1 (inside corridor)
        3: (12.960, 77.570),  # H2 (outside corridor)
    }
    edges = [
        Edge(1, 2, 1000.0),
        Edge(1, 3, 1400.0),
    ]
    graph = RoadGraph(nodes, edges)

    h1 = Hospital(
        hospital_id="H1",
        name="Congested Central Hospital",
        locality="Central",
        location=Location(lat=12.975, lng=77.585),
        status="OPEN",
        beds_total=50,
        beds_available=10,
        icu_beds_available=2,
        specialties=("EMERGENCY",),
        last_updated="2026-10-31T14:00:00Z",
        is_demo=True,
    )
    h2 = Hospital(
        hospital_id="H2",
        name="Outer Free-Flow Hospital",
        locality="Outer",
        location=Location(lat=12.960, lng=77.570),
        status="OPEN",
        beds_total=50,
        beds_available=10,
        icu_beds_available=2,
        specialties=("EMERGENCY",),
        last_updated="2026-10-31T14:00:00Z",
        is_demo=True,
    )

    with patch("app.api.routes.get_road_graph", return_value=graph), \
         patch("app.api.routes.load_repository") as mock_repo:
        repo_instance = MagicMock()
        repo_instance.all.return_value = [h1, h2]
        repo_instance.get.side_effect = lambda hid: h1 if hid == "H1" else h2
        repo_instance.meta.as_of = DEMO_AS_OF
        mock_repo.return_value = repo_instance

        # 1. Normal scenario: H1 is ranked #1 because 1000m < 1400m
        resp_norm = client.post(
            "/api/demo/recommend-simulated",
            json={"origin": {"lat": 12.970, "lng": 77.575}, "needs": [], "scenario": "normal"},
        )
        assert resp_norm.status_code == 200
        data_norm = resp_norm.json()
        assert data_norm["recommended"]["hospital_id"] == "H1"

        # 2. Heavy congestion scenario:
        # Corridor specifically targets H1 (node 2)
        custom_corridor = GeoBox(south=12.974, north=12.976, west=77.584, east=77.586)
        heavy_overlay = TrafficOverlay(
            scenario_id="heavy",
            name="Heavy congestion",
            description="Severe simulated delay in central corridor.",
            corridor_factor=2.5,
            non_corridor_factor=1.0,
            corridor_box=custom_corridor,
        )

        with patch("app.api.routes.get_traffic_overlay", return_value=heavy_overlay):
            resp_heavy = client.post(
                "/api/demo/recommend-simulated",
                json={"origin": {"lat": 12.970, "lng": 77.575}, "needs": [], "scenario": "heavy"},
            )
            assert resp_heavy.status_code == 200
            data_heavy = resp_heavy.json()
            # H2 must be recommended #1 because H1 was delayed by 2.5x!
            assert data_heavy["recommended"]["hospital_id"] == "H2"
            assert len(data_heavy["alternatives"]) == 1
            assert data_heavy["alternatives"][0]["hospital_id"] == "H1"


def test_api_recommend_simulated_closure_avoids_blocked_segment(client: TestClient):
    """Under closure scenario, recommended route detours around the blocked edge."""
    nodes = {
        1: (12.970, 77.590),
        2: (12.971, 77.591),
        3: (12.972, 77.592),
        4: (12.973, 77.593),
    }
    edges = [
        Edge(1, 2, 200.0),
        Edge(2, 4, 200.0),
        Edge(1, 3, 400.0),
        Edge(3, 4, 400.0),
    ]
    graph = RoadGraph(nodes, edges)

    hosp = Hospital(
        hospital_id="H_DEST",
        name="Dest Hospital",
        locality="Test",
        location=Location(lat=12.973, lng=77.593),
        status="OPEN",
        beds_total=10,
        beds_available=5,
        icu_beds_available=1,
        specialties=("EMERGENCY",),
        last_updated="2026-10-31T14:00:00Z",
        is_demo=True,
    )

    with patch("app.api.routes.get_road_graph", return_value=graph), \
         patch("app.api.routes.load_repository") as mock_repo, \
         patch("app.api.routes.get_traffic_overlay") as mock_overlay_getter:
        repo_instance = MagicMock()
        repo_instance.all.return_value = [hosp]
        repo_instance.get.return_value = hosp
        repo_instance.meta.as_of = DEMO_AS_OF
        mock_repo.return_value = repo_instance

        # Mock closure of (1, 2)
        mock_overlay_getter.return_value = TrafficOverlay(
            scenario_id="closure",
            name="Road closure scenario",
            description="Simulated closure",
            closed_edges=frozenset([(1, 2)]),
        )

        resp = client.post(
            "/api/demo/recommend-simulated",
            json={"origin": {"lat": 12.970, "lng": 77.590}, "needs": [], "scenario": "closure"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["recommended"]["hospital_id"] == "H_DEST"
        # Detour route took 1 -> 3 -> 4, distance 800m = 0.8 km
        assert data["route"]["distance_km"] == 0.8


def test_api_recommend_simulated_no_route_when_unreachable(client: TestClient):
    """When a closure leaves no candidate hospital reachable, returns 422 NO_ROUTE_FOUND."""
    graph = one_way_graph()
    isolated_hospital = Hospital(
        hospital_id="H_ISOLATED",
        name="Isolated Hospital",
        locality="Isolated Area",
        location=Location(lat=12.9750, lng=77.5950),  # Node 4 is disconnected
        status="OPEN",
        beds_total=10,
        beds_available=5,
        icu_beds_available=1,
        specialties=("EMERGENCY",),
        last_updated="2026-10-31T14:00:00Z",
        is_demo=True,
    )

    with patch("app.api.routes.get_road_graph", return_value=graph), \
         patch("app.api.routes.load_repository") as mock_repo:
        repo_instance = MagicMock()
        repo_instance.all.return_value = [isolated_hospital]
        repo_instance.get.return_value = isolated_hospital
        repo_instance.meta.as_of = DEMO_AS_OF
        mock_repo.return_value = repo_instance

        resp = client.post(
            "/api/demo/recommend-simulated",
            json={"origin": {"lat": 12.9700, "lng": 77.5900}, "needs": [], "scenario": "normal"},
        )
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"]["code"] == "NO_ROUTE_FOUND"


def test_api_recommend_simulated_invalid_scenario(client: TestClient):
    """Passing an unrecognised scenario returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/api/demo/recommend-simulated",
        json={"origin": {"lat": 12.9700, "lng": 77.5900}, "scenario": "alien_invasion"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"]["code"] == "INVALID_REQUEST"


def test_api_demo_route_with_scenario(client: TestClient):
    """POST /api/demo/route accepts scenario parameter and routes with overlay."""
    graph = one_way_graph()
    hosp = Hospital(
        hospital_id="H_TEST",
        name="Test Hospital",
        locality="Test Area",
        location=Location(lat=12.9700, lng=77.5910),
        status="OPEN",
        beds_total=20,
        beds_available=10,
        icu_beds_available=4,
        specialties=("EMERGENCY",),
        last_updated="2026-10-31T14:00:00Z",
        is_demo=True,
    )

    with patch("app.api.routes.get_road_graph", return_value=graph), \
         patch("app.api.routes.load_repository") as mock_repo:
        repo_instance = MagicMock()
        repo_instance.get.return_value = hosp
        mock_repo.return_value = repo_instance

        resp = client.post(
            "/api/demo/route",
            json={
                "origin_lat": 12.9700,
                "origin_lng": 77.5900,
                "hospital_id": "H_TEST",
                "scenario": "heavy",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "distance_km" in data
        assert "distance_m" in data
