"""Repository helpers for article persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import Article
from backend.app.feeds.base import FeedItem
from backend.app.ingestion.parser import ArticleParseResult

logger = get_logger(__name__)


@dataclass
class ArticlePersistenceResult:
    """Wrapper describing persistence outcome."""

    article: Article
    created: bool


class ArticleRepository:
    """Encapsulate article persistence logic."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.log = logger.bind(component="ArticleRepository")

    async def upsert_from_feed_item(
        self,
        feed_item: FeedItem,
        parsed: ArticleParseResult,
    ) -> ArticlePersistenceResult:
        """Persist article content, deduplicating on URL."""

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
            result = await self.session.execute(stmt)
            existing = result.scalar_one()
            return ArticlePersistenceResult(article=existing, created=False)
        except SQLAlchemyError as exc:  # pragma: no cover - defensive
            await self.session.rollback()
            self.log.error("article_persist_failed", error=str(exc), url=feed_item.url)
            raise
