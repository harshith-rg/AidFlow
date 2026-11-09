"""Error handling: failures become the contract's error shape.

    {"error": {"code": "...", "message": "...", "details": {}}}

Later phases just write:
    raise AidFlowError("NO_ROUTE_FOUND", "No road path ...", 422)
and the handlers below do the formatting.

Only the error codes in CONTRACT.md section 6 are used.
Unknown URLs (404) and wrong methods (405) are NOT handled here:
that is proposal P9 and is not implemented until the team approves it.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.models.schemas import ErrorBody, ErrorCode, ErrorResponse

logger = logging.getLogger("aidflow.errors")


class AidFlowError(Exception):
    """An expected failure, with a contract code and an HTTP status."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def build_error_response(
    code: str,
    message: str,
    status_code: int,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    """Create the JSON error response in the contract shape."""
    body = ErrorResponse(
        error=ErrorBody(code=code, message=message, details=details or {})
    )
    return JSONResponse(status_code=status_code, content=body.model_dump())


async def handle_aidflow_error(request: Request, exc: AidFlowError) -> JSONResponse:
    """Expected failures raised by our own code."""
    return build_error_response(exc.code, exc.message, exc.status_code, exc.details)


async def handle_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Bad input (missing fields, wrong types, malformed JSON) -> 400.

    FastAPI normally answers 422 in its own format. The contract says 400
    and its own shape, so we translate:
    - CONTRACT.md section 6: origin missing, not numeric, or out of range
      yields INVALID_COORDINATES.
    - Other missing or wrong-typed fields yield INVALID_REQUEST.
    """
    problems = []
    is_bad_json = False
    has_origin_error = False

    for err in exc.errors():
        if err.get("type") == "json_invalid":
            is_bad_json = True
        loc = [str(part) for part in err.get("loc", ())]
        if "origin" in loc or "origin_lat" in loc or "origin_lng" in loc:
            has_origin_error = True
        problems.append(
            {
                "location": loc,
                "problem": str(err.get("msg", "")),
                "type": str(err.get("type", "")),
            }
        )

    if is_bad_json:
        return build_error_response(
            ErrorCode.INVALID_REQUEST,
            "Request body is not valid JSON.",
            400,
            {"problems": problems},
        )

    if has_origin_error:
        return build_error_response(
            ErrorCode.INVALID_COORDINATES,
            "Origin coordinates are missing, not numeric, or invalid.",
            400,
            {"problems": problems},
        )

    return build_error_response(
        ErrorCode.INVALID_REQUEST,
        "The request has missing or invalid fields.",
        400,
        {"problems": problems},
    )


async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    """Safety net: any crash becomes INTERNAL_ERROR with a JSON body.

    The real problem goes to the server log, NOT to the client,
    so internal details are not leaked.
    """
    logger.exception("Unexpected error while handling %s", request.url.path)
    return build_error_response(
        ErrorCode.INTERNAL_ERROR,
        "An unexpected error occurred. Please try again or contact the service owner.",
        500,
    )


def register_error_handlers(app: FastAPI) -> None:
    """Attach all handlers to the app."""
    app.add_exception_handler(AidFlowError, handle_aidflow_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(Exception, handle_unexpected_error)