"""Tests for Phase 5 POST /recommend-hospital (CONTRACT.md sections 3-6)."""

import re
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.errors import AidFlowError
from app.core.config import Settings
from app.main import create_app
from app.models.hospital import Hospital, Location
from app.models.schemas import ErrorCode, WarningCode
from app.services.graph_loader import GraphError
from app.services.routing import PathNotFoundError
from tests.synthetic_graphs import one_way_graph


def assert_contract_error(response, expected_status: int, expected_code: str) -> dict:
    """Verify that the response matches CONTRACT.md section 6 specification."""
    assert response.status_code == expected_status
    body = response.json()
    assert "error" in body, f"Expected 'error' in response body, got {body}"
    err = body["error"]
    assert set(err.keys()) == {"code", "message", "details"}
    assert err["code"] == expected_code
    assert isinstance(err["message"], str) and len(err["message"]) > 0
    assert isinstance(err["details"], dict)
    return body


@pytest.fixture
def client() -> TestClient:
    """Default client with real clock settings."""
    app = create_app(Settings(time_mode="real"))
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def demo_client() -> TestClient:
    """Client configured with demo time mode so hospitals updated at dataset as_of are fresh."""
    app = create_app(Settings(time_mode="demo"))
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Success Responses & Schema Conformance
# ---------------------------------------------------------------------------
def test_recommend_hospital_success_with_case_id(demo_client: TestClient):
    """CONTRACT.md section 5: complete success response shape and field verification."""
    payload = {
        "case_id": "C-1042",
        "origin": {"lat": 12.9716, "lng": 77.5946},
        "needs": ["ICU"],
        "candidate_hospital_ids": ["H01", "H02"],
        "max_alternatives": 2,
    }
    resp = demo_client.post("/recommend-hospital", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    # Top-level fields
    assert set(data.keys()) == {
        "case_id",
        "recommended",
        "alternatives",
        "route",
        "warnings",
        "assumptions",
        "generated_at",
    }
    assert data["case_id"] == "C-1042"

    # Recommended hospital shape
    rec = data["recommended"]
    assert set(rec.keys()) == {
        "hospital_id",
        "name",
        "location",
        "distance_km",
        "eta_min",
        "reason",
        "bed_data_stale",
    }
    assert rec["hospital_id"] in ("H01", "H02")
    assert isinstance(rec["name"], str) and len(rec["name"]) > 0
    assert "lat" in rec["location"] and "lng" in rec["location"]
    assert isinstance(rec["distance_km"], (int, float)) and rec["distance_km"] > 0
    assert isinstance(rec["eta_min"], (int, float)) and rec["eta_min"] > 0
    assert isinstance(rec["reason"], str) and "Nearest open hospital with ICU" in rec["reason"]
    assert rec["bed_data_stale"] is False

    # Alternatives shape
    alts = data["alternatives"]
    assert isinstance(alts, list)
    assert len(alts) <= 2
    if len(alts) > 0:
        alt = alts[0]
        assert set(alt.keys()) == {
            "hospital_id",
            "name",
            "distance_km",
            "eta_min",
            "reason",
            "bed_data_stale",
        }
        assert alt["hospital_id"] in ("H01", "H02")
        assert alt["hospital_id"] != rec["hospital_id"]
        assert "slower than recommended" in alt["reason"] or "same ETA" in alt["reason"]

    # Route shape
    route = data["route"]
    assert set(route.keys()) == {"to_hospital_id", "distance_km", "eta_min", "polyline"}
    assert route["to_hospital_id"] == rec["hospital_id"]
    assert route["distance_km"] == rec["distance_km"]
    assert route["eta_min"] == rec["eta_min"]
    assert isinstance(route["polyline"], list)
    assert len(route["polyline"]) >= 2
    for point in route["polyline"]:
        assert isinstance(point, list)
        assert len(point) == 2
        assert -90.0 <= point[0] <= 90.0
        assert -180.0 <= point[1] <= 180.0

    # Assumptions shape
    assumptions = data["assumptions"]
    assert assumptions == {
        "eta_method": "road distance / assumed average speed",
        "average_speed_kmh": 30,
        "live_traffic": False,
        "routing_algorithm": "astar",
        "hospital_data": "DEMO values, not real",
    }

    # ISO 8601 UTC timestamp format: YYYY-MM-DDTHH:MM:SSZ
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", data["generated_at"])


def test_recommend_hospital_without_case_id(demo_client: TestClient):
    """When case_id is omitted, it should be null/omitted in the response."""
    payload = {
        "origin": {"lat": 12.9716, "lng": 77.5946},
        "needs": ["ICU"],
    }
    resp = demo_client.post("/recommend-hospital", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["case_id"] is None
    assert data["recommended"]["hospital_id"] in ("H01", "H02")


def test_empty_needs_matches_any_open_hospital(demo_client: TestClient):
    """Empty needs array is valid and matches any open hospital."""
    payload = {
        "origin": {"lat": 12.9716, "lng": 77.5946},
        "needs": [],
        "candidate_hospital_ids": ["H01", "H02"],
    }
    resp = demo_client.post("/recommend-hospital", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    # Reason for empty needs starts with "Nearest open hospital ("
    assert data["recommended"]["reason"].startswith("Nearest open hospital (")


# ---------------------------------------------------------------------------
# max_alternatives Handling
# ---------------------------------------------------------------------------
def test_max_alternatives_zero(demo_client: TestClient):
    """max_alternatives=0 returns an empty alternatives list."""
    payload = {
        "origin": {"lat": 12.9716, "lng": 77.5946},
        "needs": ["ICU"],
        "candidate_hospital_ids": ["H01", "H02"],
        "max_alternatives": 0,
    }
    resp = demo_client.post("/recommend-hospital", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["alternatives"] == []


def test_max_alternatives_one(demo_client: TestClient):
    """max_alternatives=1 caps alternatives list to at most 1 item."""
    payload = {
        "origin": {"lat": 12.9716, "lng": 77.5946},
        "needs": ["ICU"],
        "candidate_hospital_ids": ["H01", "H02"],
        "max_alternatives": 1,
    }
    resp = demo_client.post("/recommend-hospital", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["alternatives"]) <= 1


def test_max_alternatives_negative_rejected(client: TestClient):
    """Negative max_alternatives returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": [],
            "max_alternatives": -1,
        },
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


def test_max_alternatives_greater_than_five_rejected(client: TestClient):
    """max_alternatives > 5 returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": [],
            "max_alternatives": 6,
        },
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


def test_max_alternatives_boolean_rejected(client: TestClient):
    """Boolean max_alternatives returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": [],
            "max_alternatives": True,
        },
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


# ---------------------------------------------------------------------------
# candidate_hospital_ids Handling
# ---------------------------------------------------------------------------
def test_candidate_hospital_ids_single_target(demo_client: TestClient):
    """Restricting candidates to H01 returns H01 and 0 alternatives."""
    payload = {
        "origin": {"lat": 12.9716, "lng": 77.5946},
        "needs": ["ICU"],
        "candidate_hospital_ids": ["H01"],
    }
    resp = demo_client.post("/recommend-hospital", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["recommended"]["hospital_id"] == "H01"
    assert data["alternatives"] == []


def test_candidate_hospital_ids_unknown_id(client: TestClient):
    """Unknown candidate ID returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": ["ICU"],
            "candidate_hospital_ids": ["H999"],
        },
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


def test_candidate_hospital_ids_empty_list(client: TestClient):
    """Empty candidate list returns 422 NO_ELIGIBLE_HOSPITAL."""
    resp = client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": ["ICU"],
            "candidate_hospital_ids": [],
        },
    )
    assert_contract_error(resp, 422, ErrorCode.NO_ELIGIBLE_HOSPITAL)


def test_candidate_hospital_ids_duplicates_handled(demo_client: TestClient):
    """Duplicate candidate IDs are deduplicated cleanly without ranking errors."""
    payload = {
        "origin": {"lat": 12.9716, "lng": 77.5946},
        "needs": ["ICU"],
        "candidate_hospital_ids": ["H01", "H01"],
    }
    resp = demo_client.post("/recommend-hospital", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["recommended"]["hospital_id"] == "H01"
    assert data["alternatives"] == []


# ---------------------------------------------------------------------------
# Needs Validation
# ---------------------------------------------------------------------------
def test_unknown_need_rejected(client: TestClient):
    """Needs vocabulary check: unknown need returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": ["DENTAL"],
        },
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


def test_lowercase_need_rejected(client: TestClient):
    """Vocabulary check is strict uppercase; 'icu' returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": ["icu"],
        },
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


def test_missing_needs_field_rejected(client: TestClient):
    """Missing needs field in body returns 400 INVALID_REQUEST."""
    resp = client.post(
        "/recommend-hospital",
        json={"origin": {"lat": 12.9716, "lng": 77.5946}},
    )
    assert_contract_error(resp, 400, ErrorCode.INVALID_REQUEST)


# ---------------------------------------------------------------------------
# Contract-Defined Error Codes (CONTRACT.md Section 6)
# ---------------------------------------------------------------------------
def test_invalid_coordinates_latitude_out_of_range(client: TestClient):
    """Latitude > 90 or < -90 returns 400 INVALID_COORDINATES."""
    resp1 = client.post(
        "/recommend-hospital",
        json={"origin": {"lat": 999.0, "lng": 77.5946}, "needs": []},
    )
    assert_contract_error(resp1, 400, ErrorCode.INVALID_COORDINATES)

    resp2 = client.post(
        "/recommend-hospital",
        json={"origin": {"lat": -95.0, "lng": 77.5946}, "needs": []},
    )
    assert_contract_error(resp2, 400, ErrorCode.INVALID_COORDINATES)


def test_invalid_coordinates_longitude_out_of_range(client: TestClient):
    """Longitude > 180 or < -180 returns 400 INVALID_COORDINATES."""
    resp1 = client.post(
        "/recommend-hospital",
        json={"origin": {"lat": 12.9716, "lng": 200.0}, "needs": []},
    )
    assert_contract_error(resp1, 400, ErrorCode.INVALID_COORDINATES)

    resp2 = client.post(
        "/recommend-hospital",
        json={"origin": {"lat": 12.9716, "lng": -250.0}, "needs": []},
    )
    assert_contract_error(resp2, 400, ErrorCode.INVALID_COORDINATES)


def test_out_of_coverage(client: TestClient):
    """Origin coordinate outside road network bounding box returns 422 OUT_OF_COVERAGE."""
    resp = client.post(
        "/recommend-hospital",
        json={"origin": {"lat": 13.5, "lng": 77.5946}, "needs": ["ICU"]},
    )
    assert_contract_error(resp, 422, ErrorCode.OUT_OF_COVERAGE)


def test_no_eligible_hospital_unmatched_needs(demo_client: TestClient):
    """When no open hospital supports all requested needs, returns 422 NO_ELIGIBLE_HOSPITAL."""
    # Restrict candidates to H02 (which lacks CARDIAC) and ask for CARDIAC
    resp = demo_client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": ["CARDIAC"],
            "candidate_hospital_ids": ["H02"],
        },
    )
    assert_contract_error(resp, 422, ErrorCode.NO_ELIGIBLE_HOSPITAL)


def test_no_route_found_when_unreachable(client: TestClient):
    """When no road route connects origin to any eligible hospital, returns 422 NO_ROUTE_FOUND."""
    with patch("app.api.routes.find_route", side_effect=PathNotFoundError("No path")):
        resp = client.post(
            "/recommend-hospital",
            json={
                "origin": {"lat": 12.9716, "lng": 77.5946},
                "needs": ["ICU"],
                "candidate_hospital_ids": ["H01"],
            },
        )
        assert_contract_error(resp, 422, ErrorCode.NO_ROUTE_FOUND)


def test_internal_error_on_missing_graph(client: TestClient):
    """When graph fails to load, returns 500 INTERNAL_ERROR naming scripts/setup_graph.py with no path leaks."""
    with patch("app.api.routes.get_road_graph", side_effect=GraphError("Graph file C:\\abs\\path not found")):
        resp = client.post(
            "/recommend-hospital",
            json={"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"]},
        )
        body = assert_contract_error(resp, 500, ErrorCode.INTERNAL_ERROR)
        msg = body["error"]["message"]
        assert "scripts/setup_graph.py" in msg
        assert "C:\\" not in resp.text
        assert "/home" not in resp.text


# ---------------------------------------------------------------------------
# Staleness & Warnings Handling
# ---------------------------------------------------------------------------
def test_stale_data_warning_in_real_mode(client: TestClient):
    """In real time mode, historical demo data is older than 60m: bed_data_stale is True and warning is returned."""
    resp = client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": ["ICU"],
            "candidate_hospital_ids": ["H01", "H02"],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["recommended"]["bed_data_stale"] is True
    assert len(data["warnings"]) >= 1
    warning = data["warnings"][0]
    assert warning["code"] == WarningCode.STALE_HOSPITAL_DATA
    assert "60" in warning["message"]


def test_fresh_data_in_demo_mode(demo_client: TestClient):
    """In demo time mode, H01 and H02 records are fresh: bed_data_stale is False and warnings list is empty."""
    resp = demo_client.post(
        "/recommend-hospital",
        json={
            "origin": {"lat": 12.9716, "lng": 77.5946},
            "needs": ["ICU"],
            "candidate_hospital_ids": ["H01", "H02"],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["recommended"]["bed_data_stale"] is False
    assert data["warnings"] == []

