"""Tests for the Phase 3 demo routing API and contract error compliance."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.errors import AidFlowError
from app.core.config import Settings
from app.main import create_app
from app.models.hospital import Hospital, Location
from app.models.schemas import ErrorCode
from app.services.graph_loader import GraphError
from tests.synthetic_graphs import one_way_graph


def assert_contract_error(response, expected_status: int, expected_code: str) -> dict:
    """Verify that the response matches CONTRACT.md section 6 specification."""
    assert response.status_code == expected_status
    body = response.json()
    assert "error" in body, f"Expected 'error' key in response body, got {body}"
    err = body["error"]
    assert set(err.keys()) == {"code", "message", "details"}
    assert err["code"] == expected_code
    assert isinstance(err["message"], str)
    assert len(err["message"]) > 0
    assert isinstance(err["details"], dict)
    return body


@pytest.fixture
def client() -> TestClient:
    app = create_app(Settings())
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def mock_hospital() -> Hospital:
    """Synthetic hospital located close to node 2 of one_way_graph."""
    return Hospital(
        hospital_id="H_TEST",
        name="Test Synthetic Hospital",
        locality="Test Area",
        location=Location(lat=12.9700, lng=77.5910),
        status="open",
        beds_total=20,
        beds_available=10,
        icu_beds_available=4,
        specialties=("emergency",),
        last_updated="2026-11-01T12:00:00Z",
        is_demo=True,
    )


def test_demo_route_success(client: TestClient, mock_hospital: Hospital):
    """A valid request with reachable route returns 200 and route details."""
    graph = one_way_graph()  # 1 -> 2 exists

    with patch("app.api.routes.get_road_graph", return_value=graph), \
         patch("app.api.routes.load_repository") as mock_repo:
        repo_instance = MagicMock()
        repo_instance.get.return_value = mock_hospital
        mock_repo.return_value = repo_instance

        # Node 1 coords: lat ~12.97, lng ~77.59
        resp = client.post(
            "/api/demo/route",
            json={
                "origin_lat": 12.9700,
                "origin_lng": 77.5900,
                "hospital_id": "H_TEST",
                "algorithm": "astar",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "hospital" in data
        assert "origin_snap" in data
        assert "hospital_snap" in data
        assert "distance_km" in data
        assert "distance_m" in data
        assert "node_count" in data
        assert "edge_count" in data
        assert "polyline" in data
        assert len(data["polyline"]) >= 2


def test_demo_route_invalid_coordinates(client: TestClient):
    """Latitude > 90 or <-90 or Longitude > 180 or <-180 returns 400 INVALID_COORDINATES."""
    resp = client.post(
        "/api/demo/route",
        json={
            "origin_lat": 999.0,
            "origin_lng": 77.5900,
            "hospital_id": "H01",
            "algorithm": "astar",
        },
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_COORDINATES)


def test_demo_route_unknown_hospital(client: TestClient):
    """Requesting an unknown hospital ID returns 400 INVALID_REQUEST."""
    graph = one_way_graph()

    with patch("app.api.routes.get_road_graph", return_value=graph), \
         patch("app.api.routes.load_repository") as mock_repo:
        repo_instance = MagicMock()
        repo_instance.get.return_value = None
        mock_repo.return_value = repo_instance

        resp = client.post(
            "/api/demo/route",
            json={
                "origin_lat": 12.9700,
                "origin_lng": 77.5900,
                "hospital_id": "NON_EXISTENT_HOSPITAL",
                "algorithm": "astar",
            },
        )
        assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


def test_demo_route_unknown_algorithm(client: TestClient):
    """Requesting an unsupported algorithm returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/api/demo/route",
        json={
            "origin_lat": 12.9700,
            "origin_lng": 77.5900,
            "hospital_id": "H01",
            "algorithm": "floyd_warshall",
        },
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


def test_demo_route_out_of_coverage(client: TestClient):
    """Coordinates far outside graph coverage area return 422 OUT_OF_COVERAGE."""
    graph = one_way_graph()

    with patch("app.api.routes.get_road_graph", return_value=graph):
        resp = client.post(
            "/api/demo/route",
            json={
                "origin_lat": 25.0000,
                "origin_lng": 85.0000,
                "hospital_id": "H01",
                "algorithm": "astar",
            },
        )
        assert_contract_error(resp, 422, ErrorCode.OUT_OF_COVERAGE)


def test_demo_route_no_route_found_unreachable(client: TestClient):
    """When target node cannot be reached along directed edges, returns 422 NO_ROUTE_FOUND."""
    graph = one_way_graph()
    # In one_way_graph:
    # 1 -> 2, 2 -> 3 (one-way). Node 4 is isolated at (12.975, 77.595).
    # Hospital at isolated node 4
    isolated_hospital = Hospital(
        hospital_id="H_ISOLATED",
        name="Isolated Hospital",
        locality="Test Area",
        location=Location(lat=12.9750, lng=77.5950),
        status="open",
        beds_total=10,
        beds_available=5,
        icu_beds_available=1,
        specialties=("emergency",),
        last_updated="2026-11-01T12:00:00Z",
        is_demo=True,
    )

    with patch("app.api.routes.get_road_graph", return_value=graph), \
         patch("app.api.routes.load_repository") as mock_repo:
        repo_instance = MagicMock()
        repo_instance.get.return_value = isolated_hospital
        mock_repo.return_value = repo_instance

        # Origin snaps to node 1. No path exists from 1 to isolated node 4.
        resp = client.post(
            "/api/demo/route",
            json={
                "origin_lat": 12.9700,
                "origin_lng": 77.5900,
                "hospital_id": "H_ISOLATED",
                "algorithm": "astar",
            },
        )
        assert_contract_error(resp, 422, ErrorCode.NO_ROUTE_FOUND)


def test_demo_route_graph_error_internal_error(client: TestClient):
    """When road graph cannot be loaded, returns 500 INTERNAL_ERROR."""
    with patch("app.api.routes.get_road_graph", side_effect=GraphError("Graph file missing")):
        resp = client.post(
            "/api/demo/route",
            json={
                "origin_lat": 12.9700,
                "origin_lng": 77.5900,
                "hospital_id": "H01",
                "algorithm": "astar",
            },
        )
        assert_contract_error(resp, 500, ErrorCode.INTERNAL_ERROR)
