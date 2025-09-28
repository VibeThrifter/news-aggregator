"""Database session management utilities."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from backend.app.core.config import get_settings
from backend.app.db.models import Base
from backend.app.core.logging import get_logger

logger = get_logger(__name__)

_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def get_engine() -> AsyncEngine:
    """Return singleton async engine based on current settings."""
    global _engine, _session_factory

    if _engine is None:
        settings = get_settings()
        logger.info("initialising_database_engine", url=settings.database_url)
        _engine = create_async_engine(
            settings.database_url,
            echo=False,
            pool_pre_ping=True,
        )
        _session_factory = async_sessionmaker(
            _engine,
            expire_on_commit=False,
            class_=AsyncSession,
        )

    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return async sessionmaker tied to the engine."""
    global _session_factory
    if _session_factory is None:
        get_engine()
    assert _session_factory is not None
    return _session_factory


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
