"""Startup loading of the road graph (Phase 6).

The service loads the active graph once when it starts, so the first request does
not wait 20 to 80 seconds. These tests check that:
  - the graph is loaded at startup, exactly once, and requests reuse it;
  - a missing or unreadable graph does NOT stop the service from starting;
  - while the graph is missing, requests get the contract-shaped 500 INTERNAL_ERROR
    (and /health still works);
  - installing the graph later needs no restart.

They use small synthetic GraphML files in a temporary folder, never the real graph.
Only `with TestClient(app)` runs the startup step; plain `TestClient(app)` does not.
"""

from __future__ import annotations

import math

import networkx as nx
import osmnx as ox
import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.core.config import Settings
from app.main import create_app, preload_road_graph
from app.services import graph_loader
from app.services.graph_loader import GraphError

STEP = 0.004  # about 440 m between road nodes, so every demo hospital snaps within 500 m
LATS = [12.896 + i * STEP for i in range(40)]
LNGS = [77.516 + j * STEP for j in range(44)]
ORIGIN = {"lat": 12.9763, "lng": 77.5929}  # Cubbon Park, inside the grid


def _distance_m(lat1, lng1, lat2, lng2) -> float:
    p = math.radians
    a = (
        math.sin(p(lat2 - lat1) / 2) ** 2
        + math.cos(p(lat1)) * math.cos(p(lat2)) * math.sin(p(lng2 - lng1) / 2) ** 2
    )
    return 2 * 6371000 * math.asin(math.sqrt(a))


def write_grid_graphml(path) -> None:
    """Write a two-way grid of roads covering the larger coverage box."""
    graph = nx.MultiDiGraph(crs="epsg:4326")
    for i, lat in enumerate(LATS):
        for j, lng in enumerate(LNGS):
            graph.add_node(i * 100 + j, y=lat, x=lng)
    for i in range(len(LATS)):
        for j in range(len(LNGS)):
            for di, dj in ((0, 1), (1, 0)):
                i2, j2 = i + di, j + dj
                if i2 < len(LATS) and j2 < len(LNGS):
                    length = _distance_m(LATS[i], LNGS[j], LATS[i2], LNGS[j2])
                    for u, v in ((i * 100 + j, i2 * 100 + j2), (i2 * 100 + j2, i * 100 + j)):
                        graph.add_edge(u, v, length=length, osmid=1, oneway=False)
    ox.save_graphml(graph, path)


@pytest.fixture
def graph_file(tmp_path, monkeypatch):
    """Point the service's default graph at a temporary path, with an empty cache."""
    path = tmp_path / "bengaluru_coverage_box.graphml"
    monkeypatch.setattr(graph_loader, "DEFAULT_GRAPH_PATH", path)
    graph_loader.clear_graph_cache()
    yield path
    graph_loader.clear_graph_cache()


@pytest.fixture(scope="module")
def grid_bytes(tmp_path_factory) -> bytes:
    path = tmp_path_factory.mktemp("grid") / "grid.graphml"
    write_grid_graphml(path)
    return path.read_bytes()


def recommend(client):
    return client.post(
        "/recommend-hospital",
        json={"origin": ORIGIN, "needs": ["ICU"], "max_alternatives": 2},
    )


def test_graph_is_loaded_once_at_startup_and_reused(graph_file, grid_bytes, monkeypatch):
    graph_file.write_bytes(grid_bytes)
    loads = []
    real_load = graph_loader.load_road_graph

    def counting_load(path=None):
        loads.append(path)
        return real_load(path)

    monkeypatch.setattr(graph_loader, "load_road_graph", counting_load)

    with TestClient(create_app(Settings(time_mode="demo")), raise_server_exceptions=False) as client:
        assert len(loads) == 1, "the graph should already be loaded when startup finishes"
        assert graph_file in graph_loader._CACHE
        for _ in range(3):
            response = recommend(client)
            assert response.status_code == 200, response.text
    assert len(loads) == 1, "requests must reuse the graph loaded at startup"


def test_plain_test_client_does_not_load_the_graph(graph_file, grid_bytes, monkeypatch):
    """Existing tests build TestClient(app) without `with`; startup must not run for them."""
    graph_file.write_bytes(grid_bytes)
    calls = []
    monkeypatch.setattr(app_main, "get_road_graph", lambda *a, **k: calls.append(1))
    TestClient(create_app(Settings())).get("/health")
    assert calls == []


def test_missing_graph_does_not_stop_the_service(graph_file):
    assert not graph_file.exists()
    assert preload_road_graph() is False  # logs the problem, does not raise

    with TestClient(create_app(Settings()), raise_server_exceptions=False) as client:
        assert client.get("/health").json() == {"status": "ok"}


def test_missing_graph_gives_the_contract_error_shape(graph_file):
    with TestClient(create_app(Settings()), raise_server_exceptions=False) as client:
        response = recommend(client)

    assert response.status_code == 500
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "details"}
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert "scripts/setup_graph.py" in body["error"]["message"]
    assert str(graph_file) not in response.text  # no local file paths in the response


def test_bad_request_still_gets_its_own_error_while_graph_is_missing(graph_file):
    """Request problems are reported before the graph is needed (validation order)."""
    with TestClient(create_app(Settings()), raise_server_exceptions=False) as client:
        response = client.post(
            "/recommend-hospital", json={"origin": {"lat": "x", "lng": 77.59}, "needs": []}
        )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_COORDINATES"


def test_unreadable_graph_does_not_stop_the_service(graph_file):
    graph_file.write_text("this is not a GraphML file", encoding="utf-8")
    assert preload_road_graph() is False
    with TestClient(create_app(Settings()), raise_server_exceptions=False) as client:
        assert recommend(client).status_code == 500
        assert client.get("/health").status_code == 200


def test_graph_installed_after_startup_is_used_without_restart(graph_file, grid_bytes):
    with TestClient(create_app(Settings(time_mode="demo")), raise_server_exceptions=False) as client:
        assert recommend(client).status_code == 500  # graph missing

        graph_file.write_bytes(grid_bytes)  # e.g. the user runs scripts/setup_graph.py
        response = recommend(client)
        assert response.status_code == 200, response.text
        assert response.json()["recommended"]["hospital_id"].startswith("H")


def test_preload_reports_success(graph_file, grid_bytes):
    graph_file.write_bytes(grid_bytes)
    assert preload_road_graph() is True


def test_preload_failure_is_a_graph_error_not_a_crash(monkeypatch):
    def boom(*args, **kwargs):
        raise GraphError("Road graph file not found: /somewhere/else.graphml")

    monkeypatch.setattr(app_main, "get_road_graph", boom)
    assert preload_road_graph() is False
