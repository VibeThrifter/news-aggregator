from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import get_settings
from backend.app.core.logging import configure_logging
from backend.app.core.scheduler import get_scheduler
from backend.app.routers import (
    aggregate_router,
    events_router,
    exports_router,
    insights_router,
)
from backend.app.routers.admin import router as admin_router
from backend.app.routers.health import router as health_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle (startup and shutdown)."""
    # Startup
    # Configure logging with rotating file handler (Story 5.1)
    settings = get_settings()
    configure_logging(
        log_level="INFO",
        json_format=False,  # Use console format for development
        log_file="logs/app.log"
    )

    scheduler = get_scheduler()
    scheduler.start()
    yield
    # Shutdown
    scheduler.shutdown()


app = FastAPI(title="News360 Aggregator", version="0.1.0", lifespan=lifespan)

settings = get_settings()
# Always enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ] + ([str(origin) for origin in settings.allow_origins] if settings.allow_origins else []),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(aggregate_router)
app.include_router(events_router)
app.include_router(insights_router)
app.include_router(admin_router)
app.include_router(exports_router)
app.include_router(health_router)  # Story 5.1: Enhanced health endpoint
