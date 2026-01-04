"""Dual-write session management for Supabase + SQLite.

This module provides a unified session manager that:
1. READS from SQLite cache (when enabled) - zero Supabase egress
2. WRITES to both Supabase AND SQLite - keeps them in sync

Story: INFRA-1 (Supabase Egress Optimization)

Usage:
    # Get a session for reading (uses SQLite if configured)
    async with get_read_session() as session:
        repo = ArticleRepository(session)
        articles = await repo.fetch_articles()

    # Get a session for writing (auto dual-write if SQLite enabled)
    async with get_write_session() as writer:
        # writer.primary is Supabase, writer.cache is SQLite (or None)
        repo = ArticleRepository(writer.primary)
        result = await repo.upsert_from_feed_item(item, parsed)

        # Sync to cache if enabled
        if writer.cache:
            cache_repo = ArticleRepository(writer.cache)
            await cache_repo.sync_article(result.article)
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.db.session import get_sessionmaker
from backend.app.db.sqlite_session import get_sqlite_sessionmaker

logger = get_logger(__name__)


@dataclass
class DualWriteContext:
    """Container for dual-write sessions."""

    primary: AsyncSession  # Always Supabase (source of truth for writes)
    cache: Optional[AsyncSession]  # SQLite cache (None if disabled)

    async def commit_both(self) -> None:
        """Commit both sessions (primary first, then cache)."""
        await self.primary.commit()
        if self.cache:
            await self.cache.commit()

    async def rollback_both(self) -> None:
        """Rollback both sessions."""
        await self.primary.rollback()
        if self.cache:
            await self.cache.rollback()


@asynccontextmanager
async def get_read_session() -> AsyncIterator[AsyncSession]:
    """Get a session for reading data.

    If SQLite cache is enabled (BACKEND_READ_SOURCE=sqlite), reads from local cache.
    Otherwise, reads from Supabase.

    This is the primary mechanism for eliminating egress costs:
    - Production PC: Reads from SQLite (zero egress)
    - Development laptop: Reads from Supabase (some egress, acceptable for dev)
    """
    settings = get_settings()

    if settings.use_sqlite_cache:
        logger.debug("read_session_source", source="sqlite")
        session_factory = get_sqlite_sessionmaker()
    else:
        logger.debug("read_session_source", source="supabase")
        session_factory = get_sessionmaker()

    async with session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


@asynccontextmanager
async def get_write_session() -> AsyncIterator[DualWriteContext]:
    """Get sessions for writing data with optional dual-write to cache.

    Always writes to Supabase (source of truth).
    If SQLite cache is enabled, also provides a cache session for syncing.

    Usage pattern:
        async with get_write_session() as writer:
            # Write to Supabase
            supabase_repo = SomeRepository(writer.primary)
            result = await supabase_repo.save(data)

            # Sync to SQLite cache if enabled
            if writer.cache:
                cache_repo = SomeRepository(writer.cache)
                await cache_repo.save(data)

            await writer.commit_both()
    """
    settings = get_settings()
    primary_factory = get_sessionmaker()

    async with primary_factory() as primary_session:
        cache_session: Optional[AsyncSession] = None

        if settings.use_sqlite_cache:
            sqlite_factory = get_sqlite_sessionmaker()
            cache_session = sqlite_factory()

        try:
            context = DualWriteContext(primary=primary_session, cache=cache_session)
            yield context
        except Exception:
            await primary_session.rollback()
            if cache_session:
                await cache_session.rollback()
            raise
        finally:
            await primary_session.close()
            if cache_session:
                await cache_session.close()


@asynccontextmanager
async def get_supabase_session() -> AsyncIterator[AsyncSession]:
    """Get a direct Supabase session (bypassing cache).

    Use this when you explicitly need to read from Supabase,
    e.g., for the initial sync script.
    """
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


@asynccontextmanager
async def get_sqlite_session() -> AsyncIterator[AsyncSession]:
    """Get a direct SQLite cache session.

    Use this when you explicitly need to write to SQLite,
    e.g., for the initial sync script.
    """
    session_factory = get_sqlite_sessionmaker()
    async with session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


def get_read_source() -> str:
    """Return the current read source for logging/debugging."""
    settings = get_settings()
    return "sqlite" if settings.use_sqlite_cache else "supabase"


async def sync_entities_to_cache(entities: list, entity_type: str) -> int:
    """Sync a batch of entities to SQLite cache after Supabase commit.

    This is called after a successful Supabase commit to replicate the data
    to local SQLite cache. Accepts that there's a small window where Supabase
    has data that SQLite doesn't (yet).

    Args:
        entities: List of SQLAlchemy model instances to sync
        entity_type: Name of the entity type for logging

    Returns:
        Number of entities synced
    """
    settings = get_settings()
    if not settings.use_sqlite_cache:
        return 0

    if not entities:
        return 0

    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    def model_to_dict(record) -> dict:
        """Convert a SQLAlchemy model to a dictionary."""
        return {
            c.name: getattr(record, c.name)
            for c in record.__table__.columns
        }

    synced = 0
    sqlite_factory = get_sqlite_sessionmaker()

    try:
        async with sqlite_factory() as session:
            for entity in entities:
                record_dict = model_to_dict(entity)
                model_class = type(entity)

                stmt = sqlite_insert(model_class).values(**record_dict)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["id"],
                    set_=record_dict,
                )
                await session.execute(stmt)
                synced += 1

            await session.commit()
            logger.info(
                "entities_synced_to_cache",
                entity_type=entity_type,
                count=synced,
            )
    except Exception as e:
        logger.warning(
            "cache_sync_failed",
            entity_type=entity_type,
            error=str(e),
            count=len(entities),
        )
        # Don't raise - cache sync failure shouldn't break the main flow

    return synced


async def sync_article_to_cache(article) -> bool:
    """Sync a single article to SQLite cache.

    Convenience wrapper for syncing a single article.
    """
    result = await sync_entities_to_cache([article], "article")
    return result > 0


async def sync_event_to_cache(event) -> bool:
    """Sync a single event to SQLite cache.

    Convenience wrapper for syncing a single event.
    """
    result = await sync_entities_to_cache([event], "event")
    return result > 0


async def sync_event_article_to_cache(event_article) -> bool:
    """Sync a single event-article link to SQLite cache.

    Convenience wrapper for syncing a single event-article relationship.
    """
    result = await sync_entities_to_cache([event_article], "event_article")
    return result > 0


async def sync_insight_to_cache(insight) -> bool:
    """Sync a single LLM insight to SQLite cache.

    Convenience wrapper for syncing a single insight.
    """
    result = await sync_entities_to_cache([insight], "llm_insight")
    return result > 0


__all__ = [
    "DualWriteContext",
    "get_read_session",
    "get_write_session",
    "get_supabase_session",
    "get_sqlite_session",
    "get_read_source",
    "sync_entities_to_cache",
    "sync_article_to_cache",
    "sync_event_to_cache",
    "sync_event_article_to_cache",
    "sync_insight_to_cache",
]
