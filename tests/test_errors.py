"""Tests that failures use the contract's error shape."""

from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.api.errors import AidFlowError
from app.core.config import Settings
from app.main import create_app


class EchoBody(BaseModel):
    value: int


def build_client() -> TestClient:
    """An app with extra dummy routes that exist ONLY inside these tests."""
    app = create_app(Settings())

    @app.post("/_test/echo")
    def echo(body: EchoBody):
        return {"value": body.value}

    @app.get("/_test/contract-error")
    def contract_error():
        raise AidFlowError(
            code="NO_ELIGIBLE_HOSPITAL",
            message="No open hospital with ICU among the 3 candidates.",
            status_code=422,
            details={"candidates": 3},
        )

    @app.get("/_test/crash")
    def crash():
        raise RuntimeError("secret internal detail")

    # raise_server_exceptions=False: let the test see the 500 response
    # instead of re-raising the crash inside the test.
    return TestClient(app, raise_server_exceptions=False)


client = build_client()


def assert_contract_shape(body: dict) -> None:
    """The body must be exactly {"error": {"code", "message", "details"}}."""
    assert set(body.keys()) == {"error"}
    assert set(body["error"].keys()) == {"code", "message", "details"}
    assert isinstance(body["error"]["details"], dict)


def test_own_error_uses_contract_shape():
    response = client.get("/_test/contract-error")
    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "NO_ELIGIBLE_HOSPITAL",
            "message": "No open hospital with ICU among the 3 candidates.",
            "details": {"candidates": 3},
        }
    }


def test_malformed_json_gives_invalid_request_400():
    response = client.post(
        "/_test/echo",
        content="{this is not json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    body = response.json()
    assert_contract_shape(body)
    assert body["error"]["code"] == "INVALID_REQUEST"


def test_wrong_type_gives_invalid_request_400():
    response = client.post("/_test/echo", json={"value": "abc"})
    assert response.status_code == 400
    body = response.json()
    assert_contract_shape(body)
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert len(body["error"]["details"]["problems"]) >= 1


def test_missing_field_gives_invalid_request_400():
    response = client.post("/_test/echo", json={})
    assert response.status_code == 400
    body = response.json()
    assert_contract_shape(body)
    assert body["error"]["code"] == "INVALID_REQUEST"


def test_valid_request_still_works():
    response = client.post("/_test/echo", json={"value": 5})
    assert response.status_code == 200
    assert response.json() == {"value": 5}


def test_crash_gives_internal_error_500_without_leaking_details():
    response = client.get("/_test/crash")
    assert response.status_code == 500
    body = response.json()
    assert_contract_shape(body)
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert "secret internal detail" not in response.text