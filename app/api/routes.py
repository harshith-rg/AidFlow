"""URL routes of the service.

Phase 1 has only GET /health.
POST /recommend-hospital is added in Phase 5.
"""

from fastapi import APIRouter

from app.models.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse, summary="Is the service running?")
def health() -> HealthResponse:
    """CONTRACT.md section 3: returns exactly {"status": "ok"}."""
    return HealthResponse(status="ok")