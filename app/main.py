"""Creates the AidFlow Routing & Hospital Recommendation service.

Run it with:   uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.routes import router
from app.core.config import ConfigError, Settings, load_settings

# Addresses where the React demo UI will run during local development.
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Tests can pass their own Settings."""
    settings = settings or load_settings()

    app = FastAPI(
        title="AidFlow Routing & Hospital Recommendation (DEMO)",
        description=(
            "Prototype service. All hospital data is fictional DEMO data. "
            "ETA is an estimate with no live traffic."
        ),
        version="0.1.0",
    )
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    register_error_handlers(app)
    app.include_router(router)
    return app


def _create_default_app() -> FastAPI:
    """Create the app for uvicorn; a bad setting stops it with a clear message."""
    try:
        return create_app()
    except ConfigError as error:
        raise SystemExit(f"Configuration error: {error}") from error


app = _create_default_app()