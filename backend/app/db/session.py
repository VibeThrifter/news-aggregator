"""Database session management utilities."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text

from backend.app.core.config import get_settings
from backend.app.db.models import Base
from backend.app.core.logging import get_logger

logger = get_logger(__name__)

_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def _create_engine() -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    """Create a new engine and session factory."""
    settings = get_settings()
    logger.info("initialising_database_engine", url=settings.database_url)
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        pool_pre_ping=True,
        pool_recycle=300,  # Recycle connections after 5 minutes
        pool_size=10,  # Increased from 5 to handle concurrent feed polling
        max_overflow=15,  # Increased from 10 for burst capacity
        pool_timeout=30,  # Wait up to 30 seconds for a connection
    )
    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )
    return engine, factory


def get_engine() -> AsyncEngine:
    """Return singleton async engine based on current settings."""
    global _engine, _session_factory

    if _engine is None:
        _engine, _session_factory = _create_engine()

    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return async sessionmaker tied to the engine."""
    global _session_factory
    if _session_factory is None:
        get_engine()
    assert _session_factory is not None
    return _session_factory


async def check_db_connection() -> bool:
    """
    Check if the database connection is healthy.

    Returns True if connection works, False otherwise.
    """
    global _engine
    if _engine is None:
        return False

    try:
        async with _engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.warning("database_connection_check_failed", error=str(e))
        return False


async def reset_engine() -> None:
    """
    Dispose of the current engine and create a fresh one.

    Call this when the database connection is known to be broken
    (e.g., after DNS failure, network issues).
    """
    global _engine, _session_factory

    if _engine is not None:
        logger.info("disposing_database_engine")
        try:
            await _engine.dispose()
        except Exception as e:
            logger.warning("engine_dispose_error", error=str(e))
        _engine = None
        _session_factory = None

    # Create fresh engine
    _engine, _session_factory = _create_engine()
    logger.info("database_engine_reset_complete")


async def ensure_healthy_connection() -> bool:
    """
    Ensure the database connection is healthy, resetting if necessary.

    Returns True if connection is now healthy, False if reset also failed.
    """
    if await check_db_connection():
        return True

    logger.warning("database_connection_unhealthy_resetting")
    await reset_engine()

    # Check again after reset
    return await check_db_connection()


async def get_async_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency helper for providing a session per request."""
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db() -> None:
    """Create database tables if they do not yet exist."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
