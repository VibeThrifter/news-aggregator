"""SQLite cache session management for local backend reads.

This module provides session management for the local SQLite cache used to
eliminate Supabase egress costs. The backend reads from SQLite while
writes go to both Supabase and SQLite (dual-write pattern).

Story: INFRA-1 (Supabase Egress Optimization)
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Base

logger = get_logger(__name__)

_sqlite_engine: Optional[AsyncEngine] = None
_sqlite_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def _get_sqlite_url() -> str:
    """Build SQLite connection URL from settings."""
    settings = get_settings()
    cache_path = Path(settings.sqlite_cache_path)

    # Ensure parent directory exists
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    return f"sqlite+aiosqlite:///{cache_path}"


def _create_sqlite_engine() -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    """Create a new SQLite engine and session factory."""
    url = _get_sqlite_url()
    logger.info("initialising_sqlite_cache_engine", url=url)

    engine = create_async_engine(
        url,
        echo=False,
        # SQLite-specific settings
        connect_args={"check_same_thread": False},
    )

    # Enable WAL mode and foreign keys for better concurrency
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-64000")  # 64MB cache
        cursor.close()

    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )
    return engine, factory


def get_sqlite_engine() -> AsyncEngine:
    """Return singleton SQLite async engine."""
    global _sqlite_engine, _sqlite_session_factory

    if _sqlite_engine is None:
        _sqlite_engine, _sqlite_session_factory = _create_sqlite_engine()

    return _sqlite_engine


def get_sqlite_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return async sessionmaker for SQLite cache."""
    global _sqlite_session_factory
    if _sqlite_session_factory is None:
        get_sqlite_engine()
    assert _sqlite_session_factory is not None
    return _sqlite_session_factory


async def init_sqlite_cache() -> None:
    """Create SQLite cache tables if they don't exist."""
    engine = get_sqlite_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("sqlite_cache_tables_initialized")


async def check_sqlite_connection() -> bool:
    """Check if SQLite cache connection is healthy."""
    global _sqlite_engine
    if _sqlite_engine is None:
        return False

    try:
        async with _sqlite_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.warning("sqlite_cache_connection_check_failed", error=str(e))
        return False


async def dispose_sqlite_engine() -> None:
    """Dispose of the SQLite engine (for cleanup)."""
    global _sqlite_engine, _sqlite_session_factory

    if _sqlite_engine is not None:
        logger.info("disposing_sqlite_cache_engine")
        try:
            await _sqlite_engine.dispose()
        except Exception as e:
            logger.warning("sqlite_engine_dispose_error", error=str(e))
        _sqlite_engine = None
        _sqlite_session_factory = None


def is_sqlite_cache_enabled() -> bool:
    """Check if SQLite cache is enabled in settings."""
    settings = get_settings()
    return settings.use_sqlite_cache


__all__ = [
    "get_sqlite_engine",
    "get_sqlite_sessionmaker",
    "init_sqlite_cache",
    "check_sqlite_connection",
    "dispose_sqlite_engine",
    "is_sqlite_cache_enabled",
]
