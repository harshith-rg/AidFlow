"""Data shapes (schemas) used by the API.

Phase 1 only needs the error shape and the health shape.
Request and response shapes for /recommend-hospital added in Phase 5.
"""

from typing import Any

from pydantic import BaseModel, Field, field_validator


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


class WarningCode:
    """Warning codes defined in CONTRACT.md section 5 & 8."""

    STALE_HOSPITAL_DATA = "STALE_HOSPITAL_DATA"


class OriginCoordinates(BaseModel):
    """Origin coordinate point for the emergency request."""

    lat: float
    lng: float


class RecommendHospitalRequest(BaseModel):
    """Request payload for POST /recommend-hospital (CONTRACT.md section 4)."""

    case_id: str | None = None
    origin: OriginCoordinates
    needs: list[str]
    candidate_hospital_ids: list[str] | None = None
    max_alternatives: int | None = 2

    @field_validator("max_alternatives", mode="before")
    @classmethod
    def check_max_alternatives_not_bool(cls, v: Any) -> Any:
        if isinstance(v, bool):
            raise ValueError("max_alternatives must be an integer, not boolean")
        return v



class HospitalLocation(BaseModel):
    """Geographic coordinate location of a hospital."""

    lat: float
    lng: float


class RecommendedHospital(BaseModel):
    """Details of the recommended hospital (CONTRACT.md section 5)."""

    hospital_id: str
    name: str
    location: HospitalLocation
    distance_km: float
    eta_min: float
    reason: str
    bed_data_stale: bool


class AlternativeHospital(BaseModel):
    """Details of an alternative hospital (CONTRACT.md section 5)."""

    hospital_id: str
    name: str
    distance_km: float
    eta_min: float
    reason: str
    bed_data_stale: bool


class RouteDetail(BaseModel):
    """Road route to the recommended hospital (CONTRACT.md section 5)."""

    to_hospital_id: str
    distance_km: float
    eta_min: float
    polyline: list[list[float]]


class WarningDetail(BaseModel):
    """Advisory warning returned in the response (CONTRACT.md section 5)."""

    code: str
    message: str


class AssumptionsDetail(BaseModel):
    """Documented assumptions accompanying the recommendation (CONTRACT.md section 5)."""

    eta_method: str = "road distance / assumed average speed"
    average_speed_kmh: float = 30.0
    live_traffic: bool = False
    routing_algorithm: str = "astar"
    hospital_data: str = "DEMO values, not real"


class RecommendHospitalResponse(BaseModel):
    """Success response for POST /recommend-hospital (CONTRACT.md section 5)."""

    case_id: str | None = None
    recommended: RecommendedHospital
    alternatives: list[AlternativeHospital] = Field(default_factory=list)
    route: RouteDetail
    warnings: list[WarningDetail] = Field(default_factory=list)
    assumptions: AssumptionsDetail
    generated_at: str
