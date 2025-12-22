"""Repository helpers for managing news source configurations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import NewsSource

logger = get_logger(__name__)


@dataclass
class SourcePersistenceResult:
    """Describe the outcome of a source persistence operation."""

    source: NewsSource
    created: bool


class NewsSourceRepository:
    """Encapsulates read/write operations for news source configurations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.log = logger.bind(component="NewsSourceRepository")

    async def get_all(self) -> List[NewsSource]:
        """Get all news sources."""
        stmt = select(NewsSource).order_by(NewsSource.display_name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_enabled(self) -> List[NewsSource]:
        """Get all enabled news sources."""
        stmt = (
            select(NewsSource)
            .where(NewsSource.enabled.is_(True))
            .order_by(NewsSource.display_name)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_main_sources(self) -> List[NewsSource]:
        """Get all main news sources (used for event display)."""
        stmt = (
            select(NewsSource)
            .where(NewsSource.is_main_source.is_(True))
            .order_by(NewsSource.display_name)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_enabled_source_ids(self) -> List[str]:
        """Get source_ids of all enabled sources."""
        sources = await self.get_enabled()
        return [s.source_id for s in sources]

    async def get_main_source_names(self) -> List[str]:
        """Get display_names of all main sources."""
        sources = await self.get_main_sources()
        return [s.display_name for s in sources]

    async def get_by_source_id(self, source_id: str) -> Optional[NewsSource]:
        """Get a news source by its source_id."""
        stmt = select(NewsSource).where(NewsSource.source_id == source_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert(
        self,
        *,
        source_id: str,
        display_name: str,
        feed_url: str,
        spectrum: str | None = None,
        enabled: bool = True,
        is_main_source: bool = False,
    ) -> SourcePersistenceResult:
        """Create or update a news source configuration."""
        existing = await self.get_by_source_id(source_id)
        created = False

        if existing:
            existing.display_name = display_name
            existing.feed_url = feed_url
            existing.spectrum = spectrum
            existing.enabled = enabled
            existing.is_main_source = is_main_source
            source = existing
            self.log.info("source_updated", source_id=source_id)
        else:
            source = NewsSource(
                source_id=source_id,
                display_name=display_name,
                feed_url=feed_url,
                spectrum=spectrum,
                enabled=enabled,
                is_main_source=is_main_source,
            )
            self.session.add(source)
            created = True
            self.log.info("source_created", source_id=source_id)

        await self.session.flush()
        return SourcePersistenceResult(source=source, created=created)

    async def update_enabled(self, source_id: str, enabled: bool) -> Optional[NewsSource]:
        """Update the enabled status of a source."""
        source = await self.get_by_source_id(source_id)
        if source:
            source.enabled = enabled
            await self.session.flush()
            self.log.info("source_enabled_updated", source_id=source_id, enabled=enabled)
        return source

    async def update_is_main(self, source_id: str, is_main: bool) -> Optional[NewsSource]:
        """Update the is_main_source status of a source."""
        source = await self.get_by_source_id(source_id)
        if source:
            source.is_main_source = is_main
            await self.session.flush()
            self.log.info("source_is_main_updated", source_id=source_id, is_main=is_main)
        return source

    async def bulk_update_enabled(self, source_ids: List[str], enabled: bool) -> int:
        """Bulk update enabled status for multiple sources."""
        stmt = (
            update(NewsSource)
            .where(NewsSource.source_id.in_(source_ids))
            .values(enabled=enabled)
        )
        result = await self.session.execute(stmt)
        await self.session.flush()
        self.log.info("sources_bulk_enabled_updated", count=result.rowcount, enabled=enabled)
        return result.rowcount

    async def bulk_update_is_main(self, source_ids: List[str], is_main: bool) -> int:
        """Bulk update is_main_source status for multiple sources."""
        stmt = (
            update(NewsSource)
            .where(NewsSource.source_id.in_(source_ids))
            .values(is_main_source=is_main)
        )
        result = await self.session.execute(stmt)
        await self.session.flush()
        self.log.info("sources_bulk_is_main_updated", count=result.rowcount, is_main=is_main)
        return result.rowcount


__all__ = ["NewsSourceRepository", "SourcePersistenceResult"]
