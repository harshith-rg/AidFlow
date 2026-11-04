"""Data shapes (schemas) used by the API.

Phase 1 only needs the error shape and the health shape.
Request and response shapes for /recommend-hospital come in Phase 5.
"""

from typing import Any

from pydantic import BaseModel, Field


class ErrorCode:
    """Error codes defined in CONTRACT.md section 6.

    No other codes are used. New codes (such as the proposed P9 ones)
    are added only after the whole team approves them.
    """

    INVALID_REQUEST = "INVALID_REQUEST"
    INVALID_COORDINATES = "INVALID_COORDINATES"
    OUT_OF_COVERAGE = "OUT_OF_COVERAGE"
    NO_ELIGIBLE_HOSPITAL = "NO_ELIGIBLE_HOSPITAL"
    NO_ROUTE_FOUND = "NO_ROUTE_FOUND"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorBody(BaseModel):
    """The inside of an error: code, message, details (contract section 6)."""

    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    """Every failure looks like: {"error": {"code", "message", "details"}}."""

    error: ErrorBody


class HealthResponse(BaseModel):
    """GET /health returns exactly {"status": "ok"}."""

    status: str