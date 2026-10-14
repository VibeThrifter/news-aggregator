from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.core.config import get_settings
from backend.app.core.logging import configure_logging, get_logger
from backend.app.core.scheduler import get_scheduler
from backend.app.db.session import init_db
from backend.app.db.supabase import supabase_configured
from backend.app.services.llm_usage import get_llm_usage_service
from backend.app.services.publish_service import get_publish_service
from backend.app.routers import (
    aggregate_router,
    bias_router,
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
        log_level=settings.log_level,
        json_format=False,  # Use console format for development
        log_file="logs/app.log"
    )

    # Initialize database tables
    await init_db()
    if supabase_configured():
        # Story INFRA-2: every change of a published table is noted for Supabase. A table without
        # its trigger is logged (publish_tables_without_trigger); the backend starts regardless
        try:
            await get_publish_service().ensure_local_schema()
        except Exception as exc:
            get_logger(__name__).error("publish_schema_failed", error=str(exc)[:300])

    scheduler = get_scheduler()
    scheduler.start()
    yield
    # Shutdown
    scheduler.shutdown()
    try:  # AI-gebruik: the calls noted since the last write
        await get_llm_usage_service().flush()
    except Exception as exc:
        get_logger(__name__).warning("llm_usage_flush_failed", error=str(exc)[:300])
    await scheduler.close_connections()


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
    ] + settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(aggregate_router)
app.include_router(bias_router)  # Epic 10: Article bias analysis endpoints
app.include_router(events_router)
app.include_router(insights_router)
app.include_router(admin_router)
app.include_router(exports_router)
app.include_router(health_router)  # Story 5.1: Enhanced health endpoint
