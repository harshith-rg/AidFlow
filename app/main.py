"""Creates the AidFlow Routing & Hospital Recommendation service.

Run it with:   uvicorn app.main:app --reload
"""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.routes import router
from app.core.config import ConfigError, Settings, load_settings
from app.services.graph_loader import GraphError, get_road_graph

# Uvicorn's own logger, so the startup messages are visible in the console while the
# graph loads (the default "aidflow.*" loggers print nothing below WARNING).
logger = logging.getLogger("uvicorn.error")

# Addresses where the React demo UI will run during local development.
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for the application.

    Preloads the configured active road graph at server startup so that incoming
    requests do not pay the graph-load delay. If the road graph file is missing
    or invalid, the server still starts normally, and endpoints return the contract-shaped
    500 INTERNAL_ERROR error when called.
    """
    settings: Settings = getattr(app.state, "settings", None) or load_settings()
    if getattr(settings, "preload_graph", True):
        t0 = time.perf_counter()
        try:
            logger.info("Preloading the road graph (this can take 20 to 80 seconds)...")
            graph = get_road_graph()
            elapsed = time.perf_counter() - t0
            app.state.graph_startup_time_s = elapsed
            logger.info(
                "Road graph preloaded in %.2f s (%d nodes, %d edges).",
                elapsed,
                graph.node_count,
                graph.edge_count,
            )
        except GraphError as err:
            logger.warning(
                "Road graph could not be loaded at server startup: %s "
                "The server will still run, and routing endpoints will return "
                "the contract-specified error until scripts/setup_graph.py is run.",
                err,
            )
            app.state.graph_startup_time_s = None
    yield


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
        lifespan=lifespan,
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