"""Tests for GET /health."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

client = TestClient(create_app(Settings()))


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}