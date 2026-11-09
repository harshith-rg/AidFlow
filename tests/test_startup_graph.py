"""Startup loading of the road graph (Phase 6), end to end through the real app.

The service loads the active graph once when it starts, so the first request does
not wait 20 to 80 seconds. These tests check that:
  - the graph is loaded at startup, exactly once, and requests reuse it;
  - a missing or unreadable graph does NOT stop the service from starting;
  - while the graph is missing, requests get the contract-shaped 500 INTERNAL_ERROR
    (and /health still works, and bad requests still get their own 400 error);
  - installing the graph later needs no restart;
  - AIDFLOW_PRELOAD_GRAPH=false turns the preload off, and AIDFLOW_GRAPH_PATH moves the graph.

They use a small synthetic GraphML file in a temporary folder, never the real graph.
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
from app.main import create_app
from app.services import graph_loader

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
    monkeypatch.delenv("AIDFLOW_GRAPH_PATH", raising=False)
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


def count_loads(monkeypatch):
    loads = []
    real_load = graph_loader.load_road_graph

    def counting_load(path=None):
        loads.append(path)
        return real_load(path)

    monkeypatch.setattr(graph_loader, "load_road_graph", counting_load)
    return loads


def test_graph_is_loaded_once_at_startup_and_reused(graph_file, grid_bytes, monkeypatch):
    graph_file.write_bytes(grid_bytes)
    loads = count_loads(monkeypatch)
    app = create_app(Settings(time_mode="demo"))

    with TestClient(app, raise_server_exceptions=False) as client:
        assert len(loads) == 1, "the graph should already be loaded when startup finishes"
        assert graph_file in graph_loader._CACHE
        assert app.state.graph_startup_time_s is not None
        for _ in range(3):
            response = recommend(client)
            assert response.status_code == 200, response.text
    assert len(loads) == 1, "requests must reuse the graph loaded at startup"


def test_preload_can_be_turned_off(graph_file, grid_bytes, monkeypatch):
    graph_file.write_bytes(grid_bytes)
    loads = count_loads(monkeypatch)

    with TestClient(
        create_app(Settings(time_mode="demo", preload_graph=False)), raise_server_exceptions=False
    ) as client:
        assert loads == []  # nothing loaded at startup
        assert recommend(client).status_code == 200  # loaded on the first request instead
    assert len(loads) == 1


def test_plain_test_client_does_not_load_the_graph(graph_file, grid_bytes, monkeypatch):
    """Existing tests build TestClient(app) without `with`; startup must not run for them."""
    graph_file.write_bytes(grid_bytes)
    calls = []
    monkeypatch.setattr(app_main, "get_road_graph", lambda *a, **k: calls.append(1))
    TestClient(create_app(Settings())).get("/health")
    assert calls == []


def test_missing_graph_does_not_stop_the_service(graph_file):
    assert not graph_file.exists()
    app = create_app(Settings())
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert app.state.graph_startup_time_s is None


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
    with TestClient(create_app(Settings()), raise_server_exceptions=False) as client:
        assert client.get("/health").status_code == 200
        response = recommend(client)
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"


def test_graph_installed_after_startup_is_used_without_restart(graph_file, grid_bytes):
    with TestClient(create_app(Settings(time_mode="demo")), raise_server_exceptions=False) as client:
        assert recommend(client).status_code == 500  # graph missing

        graph_file.write_bytes(grid_bytes)  # e.g. the user runs scripts/setup_graph.py
        response = recommend(client)
        assert response.status_code == 200, response.text
        assert response.json()["recommended"]["hospital_id"].startswith("H")


def test_graph_path_can_be_moved_with_an_environment_variable(
    graph_file, grid_bytes, tmp_path, monkeypatch
):
    elsewhere = tmp_path / "somewhere" / "my_graph.graphml"
    elsewhere.parent.mkdir()
    elsewhere.write_bytes(grid_bytes)
    monkeypatch.setenv("AIDFLOW_GRAPH_PATH", str(elsewhere))
    assert not graph_file.exists()

    with TestClient(create_app(Settings(time_mode="demo")), raise_server_exceptions=False) as client:
        assert recommend(client).status_code == 200
    assert elsewhere.resolve() in graph_loader._CACHE
