"""Contract tests for POST /route."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.graph_loader import GraphError
from tests.synthetic_graphs import grid_coord, one_way_graph
import app.api.routes as api_routes


def make_client():
    return TestClient(
        create_app(Settings(preload_graph=False)),
        raise_server_exceptions=False,
    )


def assert_error(response, status, code):
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str)
    assert isinstance(body["error"]["details"], dict)


def valid_payload():
    start = grid_coord(0, 0)
    end = grid_coord(2, 0)

    return {
        "origin_lat": start[0],
        "origin_lng": start[1],
        "destination_lat": end[0],
        "destination_lng": end[1],
    }


def test_route_success_returns_provider_contract(monkeypatch):
    graph = one_way_graph()
    monkeypatch.setattr(api_routes, "get_road_graph", lambda: graph)

    response = make_client().post("/route", json=valid_payload())

    assert response.status_code == 200

    body = response.json()

    assert body["status"] == "ok"
    assert body["distance_km"] > 0
    assert body["duration_min"] > 0
    assert body["source"] == "python_astar"
    assert body["assumptions"]["routing_algorithm"] == "astar"
    assert body["assumptions"]["live_traffic"] is False
    assert len(body["polyline"]) >= 2


def test_route_rejects_out_of_range_origin():
    response = make_client().post(
        "/route",
        json={**valid_payload(), "origin_lat": 91},
    )

    assert_error(response, 400, "INVALID_COORDINATES")


def test_route_rejects_out_of_range_destination():
    response = make_client().post(
        "/route",
        json={**valid_payload(), "destination_lat": -91},
    )

    assert_error(response, 400, "INVALID_COORDINATES")


def test_route_returns_out_of_coverage(monkeypatch):
    monkeypatch.setattr(
        api_routes, "get_road_graph", lambda: one_way_graph()
    )

    response = make_client().post(
        "/route",
        json={
            **valid_payload(),
            "origin_lat": 25.0,
            "origin_lng": 85.0,
        },
    )

    assert_error(response, 422, "OUT_OF_COVERAGE")


def test_route_returns_no_route_for_unreachable_path(monkeypatch):
    monkeypatch.setattr(
        api_routes, "get_road_graph", lambda: one_way_graph()
    )

    start = grid_coord(2, 0)
    end = grid_coord(0, 0)

    response = make_client().post(
        "/route",
        json={
            "origin_lat": start[0],
            "origin_lng": start[1],
            "destination_lat": end[0],
            "destination_lng": end[1],
        },
    )

    assert_error(response, 422, "NO_ROUTE_FOUND")


def test_route_returns_internal_error_when_graph_missing(monkeypatch):
    def missing_graph():
        raise GraphError("test graph missing")

    monkeypatch.setattr(
        api_routes, "get_road_graph", missing_graph
    )

    response = make_client().post(
        "/route", json=valid_payload()
    )

    assert_error(response, 500, "INTERNAL_ERROR")


def test_route_rejects_missing_destination_field():
    payload = valid_payload()
    payload.pop("destination_lng")

    response = make_client().post("/route", json=payload)

    assert_error(response, 400, "INVALID_REQUEST")


def test_route_rejects_malformed_json():
    response = make_client().post(
        "/route",
        content="{not-json",
        headers={"Content-Type": "application/json"},
    )

    assert_error(response, 400, "INVALID_REQUEST")
