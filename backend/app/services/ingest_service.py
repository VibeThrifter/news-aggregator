"""
Ingest service for orchestrating RSS feed polling and article collection.

This service manages the registry of feed readers and provides the main poll_feeds()
orchestration method used by the scheduler according to Story 1.1 requirements.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from typing import Any, Dict, List, Optional

import structlog
import httpx
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import get_settings
from backend.app.db.session import get_sessionmaker
from backend.app.feeds.base import FeedItem, FeedReader, FeedReaderError
from backend.app.feeds.nos import NosRssReader
from backend.app.feeds.nunl import NuRssReader
from backend.app.ingestion import (
    ArticleFetchError,
    ArticleParseError,
    ArticleParseResult,
    SourceProfile,
    fetch_article_html,
    load_source_profiles,
    naive_extract_text,
    parse_article_html,
)
from backend.app.repositories import ArticleRepository
from backend.app.services.event_service import EventService
from backend.app.services.enrich_service import ArticleEnrichmentService

logger = structlog.get_logger()


class IngestService:
    """Service for managing RSS feed ingestion across multiple sources."""

    def __init__(
        self,
        *,
        session_factory: Optional[async_sessionmaker[AsyncSession]] = None,
    ) -> None:
        """Initialize ingest service with registered feed readers."""

        self.settings = get_settings()
        self.readers: Dict[str, FeedReader] = {}
        self.reader_profiles: Dict[str, SourceProfile] = {}
        self.profiles_catalog = load_source_profiles()
        self.session_factory = session_factory or get_sessionmaker()
        self.enrichment_service = ArticleEnrichmentService(session_factory=self.session_factory)
        self.event_service = EventService(session_factory=self.session_factory)
        self._register_readers()

    def _register_readers(self) -> None:
        """Register available feed readers with their configured URLs."""
        try:
            # Register NOS RSS reader
            nos_profile = self._resolve_profile("nos_rss", default_url=self.settings.rss_nos_url)
            nos_reader = NosRssReader(str(nos_profile.feed_url or self.settings.rss_nos_url))
            self.readers[nos_reader.id] = nos_reader
            self.reader_profiles[nos_reader.id] = nos_profile
            logger.info("Registered feed reader", reader_id=nos_reader.id, url=self.settings.rss_nos_url)

            # Register NU.nl RSS reader
            nunl_profile = self._resolve_profile("nunl_rss", default_url=self.settings.rss_nunl_url)
            nunl_reader = NuRssReader(str(nunl_profile.feed_url or self.settings.rss_nunl_url))
            self.readers[nunl_reader.id] = nunl_reader
            self.reader_profiles[nunl_reader.id] = nunl_profile
            logger.info("Registered feed reader", reader_id=nunl_reader.id, url=self.settings.rss_nunl_url)

            logger.info("Feed reader registration complete", total_readers=len(self.readers))

        except Exception as e:
            logger.error("Failed to register feed readers", error=str(e))
            raise

    async def poll_feeds(self, correlation_id: str = None) -> Dict[str, Any]:
        """
        Poll all registered feed readers and collect feed items.

        This is the main orchestration method called by the scheduler.

        Args:
            correlation_id: Optional correlation ID for request tracing

        Returns:
            Dict containing polling results with statistics and any errors

        """
        logger_ctx = logger.bind(correlation_id=correlation_id) if correlation_id else logger
        logger_ctx.info("Starting RSS feed polling", reader_count=len(self.readers))

        results: Dict[str, Any] = {
            "success": True,
            "total_readers": len(self.readers),
            "successful_readers": 0,
            "failed_readers": 0,
            "total_items": 0,
            "items_by_source": {},
            "errors": [],
            "ingestion_stats": {},
        }

        # Poll all readers concurrently
        tasks = []
        for reader_id, reader in self.readers.items():
            task = asyncio.create_task(
                self._poll_reader_and_ingest(reader, correlation_id),
                name=f"poll_ingest_{reader_id}",
            )
            tasks.append((reader_id, task))

        # Wait for all tasks to complete
        for reader_id, task in tasks:
            try:
                items, ingestion_stats = await task
                results["successful_readers"] += 1
                results["total_items"] += len(items)
                results["items_by_source"][reader_id] = {
                    "count": len(items),
                    "items": [self._serialize_item(item) for item in items]
                }
                results["ingestion_stats"][reader_id] = ingestion_stats
                logger_ctx.info("Feed reader completed successfully",
                              reader_id=reader_id, item_count=len(items))

            except Exception as e:
                results["failed_readers"] += 1
                results["success"] = False
                error_info = {
                    "reader_id": reader_id,
                    "error": str(e),
                    "error_type": type(e).__name__
                }
                results["errors"].append(error_info)
                logger_ctx.error("Feed reader failed",
                               reader_id=reader_id, error=str(e))

        # Log summary
        logger_ctx.info("RSS feed polling completed",
                      total_readers=results["total_readers"],
                      successful_readers=results["successful_readers"],
                      failed_readers=results["failed_readers"],
                      total_items=results["total_items"],
                      overall_success=results["success"])

        return results

    def _resolve_profile(self, reader_id: str, *, default_url: str) -> SourceProfile:
        profile = self.profiles_catalog.get(reader_id)
        if profile is None:
            profile = SourceProfile(
                id=reader_id,
                feed_url=default_url,
                fetch_strategy="simple",
                user_agent=None,
                parser="trafilatura",
                cookie_ttl_minutes=0,
            )
        elif not profile.feed_url:
            profile = profile.model_copy(update={"feed_url": default_url})
        return profile


    async def _poll_reader_and_ingest(
        self,
        reader: FeedReader,
        correlation_id: Optional[str] = None,
    ) -> tuple[List[FeedItem], Dict[str, Any]]:
        """Fetch feed items and run them through the article ingestion pipeline."""

        items = await self._poll_single_reader(reader, correlation_id)
        profile = self.reader_profiles.get(reader.id)
        ingestion_stats = await self.process_feed_items(
            reader_id=reader.id,
            items=items,
            profile=profile,
            correlation_id=correlation_id,
        )
        return items, ingestion_stats

    async def _poll_single_reader(self, reader: FeedReader, correlation_id: str = None) -> List[FeedItem]:
        """
        Poll a single feed reader with error handling and logging.

        Args:
            reader: The feed reader to poll
            correlation_id: Optional correlation ID for request tracing

        Returns:
            List of FeedItem objects from the reader

        Raises:
            FeedReaderError: When the reader fails after retries
        """
        logger_ctx = logger.bind(
            reader_id=reader.id,
            feed_url=reader.feed_url,
            correlation_id=correlation_id
        ) if correlation_id else logger.bind(reader_id=reader.id, feed_url=reader.feed_url)

        try:
            logger_ctx.debug("Polling feed reader")

            # Fetch items directly - HTTP client is now lazily initialized
            items = await reader.fetch()

            logger_ctx.info("Feed reader polling successful", item_count=len(items))
            return items

        except FeedReaderError as e:
            logger_ctx.error("Feed reader error", error=str(e))
            raise

        except Exception as e:
            logger_ctx.error("Unexpected error polling feed reader", error=str(e))
            raise FeedReaderError(f"Unexpected error in {reader.id}: {e}")

    def _serialize_item(self, item: FeedItem) -> Dict[str, Any]:
        """Serialize a FeedItem to a dictionary for JSON response."""
        return {
            "guid": item.guid,
            "url": item.url,
            "title": item.title,
            "summary": item.summary,
            "published_at": item.published_at.isoformat(),
            "source_metadata": item.source_metadata
        }

    async def process_feed_items(
        self,
        *,
        reader_id: str,
        items: List[FeedItem],
        profile: Optional[SourceProfile],
        correlation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run items through fetch → parse → persist sequence."""

        stats = {
            "ingested": 0,
            "duplicates": 0,
            "fetch_failures": 0,
            "parse_failures": 0,
            "enriched": 0,
            "enrichment_skipped": 0,
            "events_created": 0,
            "events_linked": 0,
            "events_skipped": 0,
        }

        if not items:
            return stats

        session_maker = self.session_factory
        logger_ctx = logger.bind(reader_id=reader_id, correlation_id=correlation_id)

        async with session_maker() as session:  # type: AsyncSession
            repo = ArticleRepository(session)
            new_article_ids: List[int] = []
            async for result in self._process_items_stream(
                session=session,
                repo=repo,
                items=items,
                reader_id=reader_id,
                profile=profile,
                correlation_id=correlation_id,
            ):
                status = result["status"]
                stats[status] += 1
                article_id = result.get("article_id")
                if status == "ingested" and article_id is not None:
                    new_article_ids.append(article_id)

            try:
                await session.commit()
            except SQLAlchemyError as exc:  # pragma: no cover - defensive
                logger_ctx.error("article_commit_failed", error=str(exc))
                await session.rollback()
                raise

        if new_article_ids:
            enrichment_stats = await self.enrichment_service.enrich_by_ids(new_article_ids)
            stats["enriched"] = enrichment_stats.get("processed", 0)
            stats["enrichment_skipped"] = enrichment_stats.get("skipped", 0)
            event_stats = await self._assign_events(
                article_ids=new_article_ids,
                correlation_id=correlation_id,
            )
            stats.update(event_stats)

        return stats

    async def _assign_events(
        self,
        *,
        article_ids: List[int],
        correlation_id: Optional[str],
    ) -> Dict[str, int]:
        assignments = {
            "events_created": 0,
            "events_linked": 0,
            "events_skipped": 0,
        }
        for article_id in article_ids:
            result = await self.event_service.assign_article(article_id, correlation_id=correlation_id)
            if result is None:
                assignments["events_skipped"] += 1
            elif result.created:
                assignments["events_created"] += 1
            else:
                assignments["events_linked"] += 1
        return assignments

    async def _process_items_stream(
        self,
        *,
        session: AsyncSession,
        repo: ArticleRepository,
        items: List[FeedItem],
        reader_id: str,
        profile: Optional[SourceProfile],
        correlation_id: Optional[str],
    ) -> AsyncGenerator[Dict[str, Any], None]:
        logger_ctx = logger.bind(reader_id=reader_id, correlation_id=correlation_id)
        headers = {"User-Agent": (profile.user_agent if profile and profile.user_agent else "News360Ingest/0.1")}
        if profile and profile.headers:
            headers.update(profile.headers)

        async with httpx.AsyncClient(
            timeout=20.0,
            headers=headers,
            follow_redirects=True,
        ) as client:
            for item in items:
                try:
                    html = await fetch_article_html(
                        item.url,
                        profile=profile,
                        client=client,
                        logger=logger_ctx.bind(article_url=item.url),
                    )
                except ArticleFetchError:
                    logger_ctx.warning(
                        "article_fetch_failed_skip",
                        url=item.url,
                        guid=item.guid,
                    )
                    yield {"status": "fetch_failures", "article_id": None}
                    continue

                try:
                    parsed = parse_article_html(html, url=item.url)
                except ArticleParseError:
                    if profile and profile.parser and profile.parser != "trafilatura":
                        fallback_text = naive_extract_text(html)
                        if fallback_text:
                            summary = fallback_text[:320] or (item.summary or "")
                            parsed = ArticleParseResult(text=fallback_text, summary=summary)
                            logger_ctx.info(
                                "article_parse_fallback",
                                parser=profile.parser,
                                url=item.url,
                                guid=item.guid,
                            )
                        else:
                            logger_ctx.warning(
                                "article_parse_failed_skip",
                                url=item.url,
                                guid=item.guid,
                                reason="fallback_empty",
                            )
                            yield {"status": "parse_failures", "article_id": None}
                            continue
                    else:
                        logger_ctx.warning(
                            "article_parse_failed_skip",
                            url=item.url,
                            guid=item.guid,
                        )
                        yield {"status": "parse_failures", "article_id": None}
                        continue

                persistence = await repo.upsert_from_feed_item(item, parsed)
                if persistence.created:
                    logger_ctx.info(
                        "article_ingested",
                        article_id=persistence.article.id,
                        url=item.url,
                    )
                    yield {"status": "ingested", "article_id": persistence.article.id}
                else:
                    yield {"status": "duplicates", "article_id": persistence.article.id}

    def get_reader_info(self) -> Dict[str, Any]:
        """Get information about registered feed readers."""
        return {
            "readers": {
                reader_id: {
                    "id": reader.id,
                    "url": reader.feed_url,
                    "source_metadata": reader.source_metadata
                }
                for reader_id, reader in self.readers.items()
            },
            "total_count": len(self.readers)
        }

    async def test_readers(self) -> Dict[str, Any]:
        """Test all registered readers without full polling (for health checks)."""
        results = {}

        for reader_id, reader in self.readers.items():
            try:
                # Reader is ready to use without context manager
                # HTTP client will be lazily initialized on first use
                results[reader_id] = {"status": "ok", "url": reader.feed_url}
            except Exception as e:
                results[reader_id] = {"status": "error", "error": str(e), "url": reader.feed_url}

        return results


# Global service instance
_ingest_service: IngestService = None


def get_ingest_service() -> IngestService:
    """Get the global ingest service instance (singleton pattern)."""
    global _ingest_service
    if _ingest_service is None:
        _ingest_service = IngestService()
    return _ingest_service
