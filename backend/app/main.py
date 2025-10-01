from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import get_settings
from backend.app.core.scheduler import get_scheduler
from backend.app.routers import aggregate_router
from backend.app.routers.admin import router as admin_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle (startup and shutdown)."""
    # Startup
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
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"] + ([str(origin) for origin in settings.allow_origins] if settings.allow_origins else []),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(aggregate_router)
app.include_router(admin_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
