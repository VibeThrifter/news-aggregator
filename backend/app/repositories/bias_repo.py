"""Repository helpers for persisting article bias analyses."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import ArticleBiasAnalysis, EventArticle

logger = get_logger(__name__)


@dataclass
class BiasPersistenceResult:
    """Describe the outcome of a bias analysis persistence operation."""

    analysis: ArticleBiasAnalysis
    created: bool


class BiasRepository:
    """Encapsulates read/write operations for article bias analyses."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.log = logger.bind(component="BiasRepository")

    async def get_by_article_id(self, article_id: int) -> Optional[ArticleBiasAnalysis]:
        """Return the most recent bias analysis for an article."""
        stmt = (
            select(ArticleBiasAnalysis)
            .where(ArticleBiasAnalysis.article_id == article_id)
            .order_by(desc(ArticleBiasAnalysis.analyzed_at))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_article_and_provider(
        self, article_id: int, provider: str
    ) -> Optional[ArticleBiasAnalysis]:
        """Return the bias analysis for a specific article/provider combination."""
        stmt = (
            select(ArticleBiasAnalysis)
            .where(ArticleBiasAnalysis.article_id == article_id)
            .where(ArticleBiasAnalysis.provider == provider)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_event_id(self, event_id: int) -> List[ArticleBiasAnalysis]:
        """Return all bias analyses for articles in an event."""
        # First get article IDs for the event
        article_stmt = select(EventArticle.article_id).where(EventArticle.event_id == event_id)

        # Then get bias analyses for those articles
        stmt = (
            select(ArticleBiasAnalysis)
            .where(ArticleBiasAnalysis.article_id.in_(article_stmt))
            .order_by(desc(ArticleBiasAnalysis.analyzed_at))
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_articles_without_analysis(self, limit: int = 10) -> List[int]:
        """Return article IDs that don't have a bias analysis yet."""
        from backend.app.db.models import Article

        # Subquery to get article IDs that have analyses
        analyzed_subq = select(ArticleBiasAnalysis.article_id).distinct()

        # Get articles without analyses
        stmt = (
            select(Article.id)
            .where(Article.id.notin_(analyzed_subq))
            .where(Article.content.isnot(None))
            .where(Article.content != "")
            .order_by(desc(Article.created_at))
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def upsert_analysis(
        self,
        *,
        article_id: int,
        provider: str,
        model: str,
        total_sentences: int,
        journalist_bias_count: int,
        quote_bias_count: int,
        journalist_bias_percentage: float,
        most_frequent_bias: str | None,
        most_frequent_count: int | None,
        average_bias_strength: float | None,
        overall_rating: float,
        journalist_biases: List[Dict[str, Any]],
        quote_biases: List[Dict[str, Any]],
        raw_response: str | None = None,
        analyzed_at: datetime | None = None,
    ) -> BiasPersistenceResult:
        """Create or update a bias analysis for the given article/provider tuple."""

        timestamp = analyzed_at or datetime.now(timezone.utc)
        existing = await self.get_by_article_and_provider(article_id, provider)
        created = False

        if existing:
            existing.model = model
            existing.total_sentences = total_sentences
            existing.journalist_bias_count = journalist_bias_count
            existing.quote_bias_count = quote_bias_count
            existing.journalist_bias_percentage = journalist_bias_percentage
            existing.most_frequent_bias = most_frequent_bias
            existing.most_frequent_count = most_frequent_count
            existing.average_bias_strength = average_bias_strength
            existing.overall_rating = overall_rating
            existing.journalist_biases = journalist_biases
            existing.quote_biases = quote_biases
            existing.raw_response = raw_response
            existing.analyzed_at = timestamp
            analysis = existing
            self.log.info("bias_analysis_updated", article_id=article_id, provider=provider)
        else:
            analysis = ArticleBiasAnalysis(
                article_id=article_id,
                provider=provider,
                model=model,
                total_sentences=total_sentences,
                journalist_bias_count=journalist_bias_count,
                quote_bias_count=quote_bias_count,
                journalist_bias_percentage=journalist_bias_percentage,
                most_frequent_bias=most_frequent_bias,
                most_frequent_count=most_frequent_count,
                average_bias_strength=average_bias_strength,
                overall_rating=overall_rating,
                journalist_biases=journalist_biases,
                quote_biases=quote_biases,
                raw_response=raw_response,
                analyzed_at=timestamp,
            )
            self.session.add(analysis)
            created = True
            self.log.info("bias_analysis_created", article_id=article_id, provider=provider)

        await self.session.flush()
        return BiasPersistenceResult(analysis=analysis, created=created)

    async def delete_by_article_id(self, article_id: int) -> int:
        """Delete all bias analyses for an article. Returns count deleted."""
        from sqlalchemy import delete

        stmt = delete(ArticleBiasAnalysis).where(ArticleBiasAnalysis.article_id == article_id)
        result = await self.session.execute(stmt)
        await self.session.flush()
        return result.rowcount


__all__ = ["BiasRepository", "BiasPersistenceResult"]
