"""Tests for GET /health and application lifecycle."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.graph_loader import GraphError
from app.services.road_graph import RoadGraph

client = TestClient(create_app(Settings(preload_graph=False)))


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_lifespan_starts_app_when_graph_is_missing():
    """If road graph is missing/unreadable at startup, app still starts and health check returns 200."""
    with patch("app.main.get_road_graph", side_effect=GraphError("Graph file missing")):
        app = create_app(Settings(preload_graph=True))
        with TestClient(app) as test_client:
            resp = test_client.get("/health")
            assert resp.status_code == 200
            assert resp.json() == {"status": "ok"}
            assert app.state.graph_startup_time_s is None


def test_lifespan_preloads_graph_when_enabled():
    """When graph is available, lifespan preloads it and records startup time."""
    from unittest.mock import MagicMock
    mock_g = MagicMock(node_count=10, edge_count=20)
    with patch("app.main.get_road_graph", return_value=mock_g):
        app = create_app(Settings(preload_graph=True))
        with TestClient(app) as test_client:
            resp = test_client.get("/health")
            assert resp.status_code == 200
            assert resp.json() == {"status": "ok"}
            assert app.state.graph_startup_time_s is not None