"""
Source service for managing news source configurations.

This service handles:
- Initialization of sources from feed readers
- Enabling/disabling sources for polling
- Setting main vs supplementary sources for display
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.db.session import get_sessionmaker
from backend.app.db.models import NewsSource
from backend.app.repositories import NewsSourceRepository

logger = structlog.get_logger()


@dataclass
class SourceInfo:
    """Information about a news source for API responses."""

    source_id: str
    display_name: str
    feed_url: str
    spectrum: str | int | float | None
    enabled: bool
    is_main_source: bool

    def to_dict(self) -> Dict[str, Any]:
        # Convert spectrum from stored string back to numeric if possible
        spectrum_value = self.spectrum
        if isinstance(spectrum_value, str):
            # Try to convert numeric strings back to numbers for API response
            try:
                if "." in spectrum_value:
                    spectrum_value = float(spectrum_value)
                else:
                    spectrum_value = int(spectrum_value)
            except (ValueError, TypeError):
                pass  # Keep as string (e.g., "alternative")

        return {
            "source_id": self.source_id,
            "display_name": self.display_name,
            "feed_url": self.feed_url,
            "spectrum": spectrum_value,
            "enabled": self.enabled,
            "is_main_source": self.is_main_source,
        }


# Default source configuration: which sources should be main sources by default
DEFAULT_MAIN_SOURCES = {"nos_rss"}  # NOS is the baseline


class SourceService:
    """Service for managing news source configurations."""

    def __init__(
        self,
        *,
        session_factory: Optional[async_sessionmaker[AsyncSession]] = None,
    ) -> None:
        self.session_factory = session_factory or get_sessionmaker()
        self.log = logger.bind(component="SourceService")

    async def get_all_sources(self) -> List[SourceInfo]:
        """Get all configured news sources."""
        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)
            sources = await repo.get_all()
            return [self._to_source_info(s) for s in sources]

    async def get_enabled_sources(self) -> List[SourceInfo]:
        """Get all enabled news sources."""
        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)
            sources = await repo.get_enabled()
            return [self._to_source_info(s) for s in sources]

    async def get_main_sources(self) -> List[SourceInfo]:
        """Get all main news sources."""
        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)
            sources = await repo.get_main_sources()
            return [self._to_source_info(s) for s in sources]

    async def get_enabled_source_ids(self) -> List[str]:
        """Get source_ids of all enabled sources."""
        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)
            return await repo.get_enabled_source_ids()

    async def get_main_source_names(self) -> List[str]:
        """Get display_names of all main sources."""
        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)
            return await repo.get_main_source_names()

    async def update_source_enabled(
        self, source_id: str, enabled: bool
    ) -> Optional[SourceInfo]:
        """Update the enabled status of a source."""
        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)
            source = await repo.update_enabled(source_id, enabled)
            await session.commit()
            if source:
                self.log.info(
                    "source_enabled_updated",
                    source_id=source_id,
                    enabled=enabled,
                )
                return self._to_source_info(source)
            return None

    async def update_source_is_main(
        self, source_id: str, is_main: bool
    ) -> Optional[SourceInfo]:
        """Update the is_main_source status of a source."""
        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)
            source = await repo.update_is_main(source_id, is_main)
            await session.commit()
            if source:
                self.log.info(
                    "source_is_main_updated",
                    source_id=source_id,
                    is_main=is_main,
                )
                return self._to_source_info(source)
            return None

    async def initialize_sources_from_readers(
        self, readers: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Initialize news sources from registered feed readers.

        This creates source entries for any reader that doesn't have one yet,
        using defaults for enabled (True) and is_main_source (based on DEFAULT_MAIN_SOURCES).

        Args:
            readers: Dict of reader_id -> reader instance

        Returns:
            Stats about created/existing sources
        """
        stats = {"created": 0, "existing": 0, "total": len(readers)}

        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)

            for reader_id, reader in readers.items():
                metadata = reader.source_metadata
                display_name = metadata.get("name", reader_id)
                spectrum_raw = metadata.get("spectrum")
                # Convert numeric spectrum to string for storage
                spectrum = str(spectrum_raw) if spectrum_raw is not None else None
                feed_url = reader.feed_url

                # Check if source already exists
                existing = await repo.get_by_source_id(reader_id)
                if existing:
                    stats["existing"] += 1
                    continue

                # Create new source with defaults
                is_main = reader_id in DEFAULT_MAIN_SOURCES
                await repo.upsert(
                    source_id=reader_id,
                    display_name=display_name,
                    feed_url=feed_url,
                    spectrum=spectrum,
                    enabled=True,
                    is_main_source=is_main,
                )
                stats["created"] += 1
                self.log.info(
                    "source_initialized",
                    source_id=reader_id,
                    display_name=display_name,
                    is_main=is_main,
                )

            await session.commit()

        self.log.info("sources_initialization_complete", **stats)
        return stats

    async def sync_spectrum_from_readers(
        self, readers: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Sync spectrum values from feed readers to existing sources.

        This updates the spectrum for all existing sources based on their
        reader's source_metadata.

        Args:
            readers: Dict of reader_id -> reader instance

        Returns:
            Stats about updated sources
        """
        stats = {"updated": 0, "not_found": 0, "total": len(readers)}

        async with self.session_factory() as session:
            repo = NewsSourceRepository(session)

            for reader_id, reader in readers.items():
                metadata = reader.source_metadata
                spectrum_raw = metadata.get("spectrum")
                # Convert numeric spectrum to string for storage
                spectrum = str(spectrum_raw) if spectrum_raw is not None else None

                existing = await repo.get_by_source_id(reader_id)
                if existing:
                    if existing.spectrum != spectrum:
                        old_spectrum = existing.spectrum
                        existing.spectrum = spectrum
                        await session.flush()
                        stats["updated"] += 1
                        self.log.info(
                            "source_spectrum_updated",
                            source_id=reader_id,
                            old_spectrum=old_spectrum,
                            new_spectrum=spectrum,
                        )
                else:
                    stats["not_found"] += 1

            await session.commit()

        self.log.info("sources_spectrum_sync_complete", **stats)
        return stats

    def _to_source_info(self, source: NewsSource) -> SourceInfo:
        """Convert a NewsSource model to SourceInfo dataclass."""
        return SourceInfo(
            source_id=source.source_id,
            display_name=source.display_name,
            feed_url=source.feed_url,
            spectrum=source.spectrum,
            enabled=source.enabled,
            is_main_source=source.is_main_source,
        )


# Global service instance
_source_service: Optional[SourceService] = None


def get_source_service() -> SourceService:
    """Get the global source service instance (singleton pattern)."""
    global _source_service
    if _source_service is None:
        _source_service = SourceService()
    return _source_service
