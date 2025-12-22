"""Repository helpers for article persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List
import asyncio

from sqlalchemy import select, and_
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
                Article.source_metadata["source_article_id"].astext == source_article_id,
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

        # Fall back to URL-based deduplication
        stmt = select(Article).where(Article.url == feed_item.url)
        result = await self.session.execute(stmt)
        existing = result.scalar_one_or_none()

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
            await self.session.rollback()
            self.log.warning(
                "article_persist_integrity_error",
                url=feed_item.url,
                error=str(exc),
            )
            # try to re-read to return existing if inserted concurrently
            # Need to create a fresh query after rollback
            refetch_stmt = select(Article).where(Article.url == feed_item.url)
            refetch_result = await self.session.execute(refetch_stmt)
            existing = refetch_result.scalar_one_or_none()
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
