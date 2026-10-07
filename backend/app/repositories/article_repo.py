"""Repository helpers for article persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List
import asyncio

from sqlalchemy import select, and_, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from backend.app.core.logging import get_logger
from backend.app.db.models import Article
from backend.app.feeds.base import FeedItem
from backend.app.ingestion.parser import ArticleParseResult

# Sources that use source_article_id for deduplication (e.g., AD with LIVE articles)
SOURCES_WITH_ARTICLE_ID = {"AD"}

logger = get_logger(__name__)


@dataclass
class ArticlePersistenceResult:
    """Wrapper describing persistence outcome."""

    article: Article
    created: bool


@dataclass
class ArticleEnrichmentPayload:
    """Structure holding enrichment outputs to persist on an article."""

    normalized_text: str
    normalized_tokens: List[str]
    embedding: bytes
    tfidf_vector: Dict[str, float]
    entities: List[Dict[str, object]]
    # Enhanced fields for better clustering
    extracted_dates: List[str]
    extracted_locations: List[str]
    event_type: str
    enriched_at: datetime


class ArticleRepository:
    """Encapsulate article persistence logic."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.log = logger.bind(component="ArticleRepository")

    async def _find_by_source_article_id(
        self, source_name: str, source_article_id: str
    ) -> Article | None:
        """Find an existing article by its source-specific article ID.

        This is used for sources like AD that update LIVE articles with new URLs
        but keep the same underlying article ID in the URL (e.g., ~a5f2f6c34).

        We search in source_metadata->>'source_article_id' for matching articles
        from the same source.
        """
        # PostgreSQL JSONB query for source_article_id in source_metadata
        stmt = select(Article).where(
            and_(
                Article.source_name == source_name,
                Article.source_metadata["source_article_id"].as_string() == source_article_id,
            )
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=2),
        retry=retry_if_exception_type(OperationalError),
        reraise=True
    )
    async def upsert_from_feed_item(
        self,
        feed_item: FeedItem,
        parsed: ArticleParseResult,
    ) -> ArticlePersistenceResult:
        """Persist article content, deduplicating on URL or source_article_id.

        For sources like AD that update LIVE articles (changing the URL slug but
        keeping the same article ID), we deduplicate on source_article_id to avoid
        storing multiple versions of the same article.
        """
        source_name = feed_item.source_metadata.get("name")
        source_article_id = feed_item.source_metadata.get("source_article_id")

        # Check for existing article by source_article_id (for sources that support it)
        if source_name in SOURCES_WITH_ARTICLE_ID and source_article_id:
            existing = await self._find_by_source_article_id(source_name, source_article_id)
            if existing:
                self.log.info(
                    "article_duplicate_detected_by_source_id",
                    source_article_id=source_article_id,
                    source=source_name,
                    existing_url=existing.url,
                    new_url=feed_item.url,
                    guid=feed_item.guid,
                )
                return ArticlePersistenceResult(article=existing, created=False)

        # Fall back to URL- and guid-based deduplication. A feed may move an article to another
        # URL while keeping its guid (RTL Boulevard); matching only on the URL then made the insert
        # fail on the unique guid and dropped the whole batch.
        existing = await self._find_existing(feed_item.url, feed_item.guid)

        if existing:
            self.log.info(
                "article_duplicate_detected",
                url=feed_item.url,
                guid=feed_item.guid,
            )
            return ArticlePersistenceResult(article=existing, created=False)

        article = Article(
            guid=feed_item.guid,
            url=feed_item.url,
            title=feed_item.title,
            summary=feed_item.summary or parsed.summary,
            content=parsed.text,
            source_name=feed_item.source_metadata.get("name"),
            source_metadata=feed_item.source_metadata,
            published_at=feed_item.published_at,
            image_url=feed_item.image_url,
            fetched_at=datetime.now(timezone.utc),
        )

        try:
            # A savepoint: a conflict only undoes this insert, not the rest of the batch
            async with self.session.begin_nested():
                self.session.add(article)
                await self.session.flush()
            self.log.info(
                "article_persisted",
                article_id=article.id,
                url=article.url,
                source=article.source_name,
            )
            return ArticlePersistenceResult(article=article, created=True)
        except IntegrityError as exc:
            self.log.warning(
                "article_persist_integrity_error",
                url=feed_item.url,
                error=str(exc),
            )
            # Inserted concurrently, or the guid/URL already exists: return that row
            existing = await self._find_existing(feed_item.url, feed_item.guid)
            if existing is None:
                # Should not happen, but handle gracefully
                self.log.error(
                    "article_not_found_after_integrity_error",
                    url=feed_item.url,
                )
                raise ValueError(f"Article not found after integrity error: {feed_item.url}")
            return ArticlePersistenceResult(article=existing, created=False)
        except SQLAlchemyError as exc:  # pragma: no cover - defensive
            await self.session.rollback()
            self.log.error("article_persist_failed", error=str(exc), url=feed_item.url)
            raise

    async def known_items(self, items: List[FeedItem]) -> set[str]:
        """Keys (guid, else URL) of the feed items that are already stored, in one query.

        A feed repeats its latest items every poll. Fetching each page again before seeing the
        duplicate (for some sites with a browser) made a poll run past its timeout.
        """
        if not items:
            return set()
        urls = {item.url for item in items}
        guids = {item.guid for item in items if item.guid}
        stmt = select(Article.url, Article.guid).where(or_(Article.url.in_(urls), Article.guid.in_(guids)))
        rows = (await self.session.execute(stmt)).all()
        stored_urls = {row.url for row in rows}
        stored_guids = {row.guid for row in rows if row.guid}
        known = {
            item.guid or item.url
            for item in items
            if item.url in stored_urls or (item.guid and item.guid in stored_guids)
        }
        # AD keeps the article id when a live article gets a new URL
        for item in items:
            source_name = item.source_metadata.get("name")
            source_article_id = item.source_metadata.get("source_article_id")
            if (item.guid or item.url) in known or source_name not in SOURCES_WITH_ARTICLE_ID or not source_article_id:
                continue
            if await self._find_by_source_article_id(source_name, source_article_id):
                known.add(item.guid or item.url)
        return known

    async def _find_existing(self, url: str, guid: str | None) -> Article | None:
        """The stored article with this URL, else with this guid."""

        result = await self.session.execute(select(Article).where(Article.url == url))
        existing = result.scalars().first()
        if existing is None and guid:
            result = await self.session.execute(select(Article).where(Article.guid == guid))
            existing = result.scalars().first()
        return existing

    async def apply_enrichment(self, article_id: int, payload: ArticleEnrichmentPayload) -> Article:
        """Update an article row with NLP enrichment outputs."""

        stmt = select(Article).where(Article.id == article_id)
        result = await self.session.execute(stmt)
        article = result.scalar_one_or_none()
        if article is None:
            raise ValueError(f"Article {article_id} not found")

        article.normalized_text = payload.normalized_text
        article.normalized_tokens = payload.normalized_tokens
        article.embedding = payload.embedding
        article.tfidf_vector = payload.tfidf_vector
        article.entities = payload.entities
        article.extracted_dates = payload.extracted_dates
        article.extracted_locations = payload.extracted_locations
        article.event_type = payload.event_type
        article.enriched_at = payload.enriched_at

        await self.session.flush()
        self.log.info(
            "article_enriched",
            article_id=article.id,
            token_count=len(payload.normalized_tokens),
            entity_count=len(payload.entities),
        )
        return article
