"""Creates the AidFlow Routing & Hospital Recommendation service.

Run it with:   uvicorn app.main:app --reload
"""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.routes import router
from app.core.config import ConfigError, Settings, load_settings
from app.services.graph_loader import GraphError, get_road_graph

# Addresses where the React demo UI will run during local development.
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

# Uses uvicorn's own logger so these messages show in the console during `uvicorn app.main:app`.
startup_logger = logging.getLogger("uvicorn.error")


def preload_road_graph() -> bool:
    """Load the active road graph once, before the first request. Returns True on success.

    The larger graph takes 20 to 80 seconds to read, so loading it here means the first
    caller does not wait. A missing or unreadable graph must NOT stop the service: it logs
    a clear message and carries on. Every request that needs the graph then gets the
    contract's INTERNAL_ERROR (HTTP 500) response, and the load is retried on the next
    request (a failed load is never cached), so installing the graph later needs no restart.
    """
    startup_logger.info("Loading the road graph (this can take 30 seconds or more)...")
    started = time.perf_counter()
    try:
        graph = get_road_graph()
    except GraphError as error:
        # The error text already tells the user to run scripts/setup_graph.py.
        startup_logger.error(
            "Road graph not loaded: %s Until the graph is installed, endpoints that need it "
            "return 500 INTERNAL_ERROR.",
            error,
        )
        return False
    startup_logger.info(
        "Road graph ready: %d nodes, %d edges, loaded in %.1f s.",
        graph.node_count,
        graph.edge_count,
        time.perf_counter() - started,
    )
    return True


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Runs once when the server starts; the server accepts requests only after this finishes."""
    preload_road_graph()
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Tests can pass their own Settings."""
    settings = settings or load_settings()

    app = FastAPI(
        lifespan=lifespan,
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