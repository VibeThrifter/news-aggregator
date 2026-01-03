"""REST API endpoints for article bias analysis retrieval (Epic 10)."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import Article, ArticleBiasAnalysis, Event, EventArticle
from backend.app.db.session import get_async_session
from backend.app.models import (
    ArticleBiasResponse,
    ArticleBiasResponseMeta,
    BiasAnalysisSummary,
    BiasTypeCount,
    EventBiasSummary,
    EventBiasSummaryMeta,
    SentenceBiasResponse,
    SourceBiasStats,
)
from backend.app.repositories.bias_repo import BiasRepository

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1", tags=["bias"])


def _build_sentence_bias_responses(
    biases: List[Dict],
) -> List[SentenceBiasResponse]:
    """Convert raw bias dictionaries to response models."""
    return [
        SentenceBiasResponse(
            sentence_index=b.get("sentence_index", 0),
            sentence_text=b.get("sentence_text", ""),
            bias_type=b.get("bias_type", "Unknown"),
            bias_source=b.get("bias_source", "journalist"),
            speaker=b.get("speaker"),
            score=b.get("score", 0.0),
            explanation=b.get("explanation", ""),
        )
        for b in biases
    ]


@router.get("/articles/{article_id}/bias")
async def get_article_bias(
    article_id: int,
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    """Get bias analysis for a specific article.

    Returns 404 if the article doesn't exist or has no bias analysis.
    """
    # Verify article exists
    article_stmt = select(Article).where(Article.id == article_id)
    article_result = await session.execute(article_stmt)
    article = article_result.scalar_one_or_none()

    if not article:
        raise HTTPException(status_code=404, detail=f"Article {article_id} not found")

    # Get bias analysis
    repo = BiasRepository(session)
    analysis = await repo.get_by_article_id(article_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No bias analysis found for article {article_id}. "
                "Analysis may not have been performed yet."
            ),
        )

    # Build response
    journalist_biases = _build_sentence_bias_responses(
        analysis.journalist_biases or []
    )
    quote_biases = _build_sentence_bias_responses(analysis.quote_biases or [])

    summary = BiasAnalysisSummary(
        total_sentences=analysis.total_sentences,
        journalist_bias_count=analysis.journalist_bias_count,
        quote_bias_count=analysis.quote_bias_count,
        journalist_bias_percentage=analysis.journalist_bias_percentage,
        most_frequent_journalist_bias=analysis.most_frequent_bias,
        most_frequent_count=analysis.most_frequent_count,
        average_journalist_bias_strength=analysis.average_bias_strength,
        overall_journalist_rating=analysis.overall_rating,
    )

    response = ArticleBiasResponse(
        article_id=article_id,
        analyzed_at=analysis.analyzed_at,
        provider=analysis.provider,
        model=analysis.model,
        summary=summary,
        journalist_biases=journalist_biases,
        quote_biases=quote_biases,
    )

    meta = ArticleBiasResponseMeta(
        article_id=article_id,
        provider=analysis.provider,
        model=analysis.model,
        analyzed_at=analysis.analyzed_at,
    )

    return {
        "data": response.model_dump(),
        "meta": meta.model_dump(),
    }


@router.get("/events/{event_identifier}/bias-summary")
async def get_event_bias_summary(
    event_identifier: str,
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    """Get aggregated bias summary for all articles in an event.

    Returns bias statistics aggregated by source and bias type distribution.
    """
    # Resolve event by ID or slug
    event_id: int | None = None
    try:
        event_id = int(event_identifier)
        event_stmt = select(Event).where(Event.id == event_id)
    except ValueError:
        event_stmt = select(Event).where(Event.slug == event_identifier)

    event_result = await session.execute(event_stmt)
    event = event_result.scalar_one_or_none()

    if not event:
        raise HTTPException(
            status_code=404, detail=f"Event {event_identifier} not found"
        )

    event_id = event.id

    # Get all articles for this event
    article_stmt = (
        select(Article)
        .join(EventArticle, EventArticle.article_id == Article.id)
        .where(EventArticle.event_id == event_id)
    )
    article_result = await session.execute(article_stmt)
    articles = list(article_result.scalars().all())

    total_articles = len(articles)

    if total_articles == 0:
        raise HTTPException(
            status_code=404, detail=f"No articles found for event {event_identifier}"
        )

    # Get bias analyses for event articles
    repo = BiasRepository(session)
    analyses = await repo.get_by_event_id(event_id)

    # Build article_id -> analysis mapping
    analysis_map: Dict[int, ArticleBiasAnalysis] = {
        a.article_id: a for a in analyses
    }

    # Aggregate by source
    source_stats: Dict[str, Dict] = defaultdict(
        lambda: {
            "article_count": 0,
            "analyzed_count": 0,
            "total_rating": 0.0,
            "total_journalist_biases": 0,
        }
    )

    # Count bias types across all analyses
    bias_type_counts: Dict[str, int] = defaultdict(int)

    for article in articles:
        source = article.source_name or "Unknown"
        source_stats[source]["article_count"] += 1

        analysis = analysis_map.get(article.id)
        if analysis:
            source_stats[source]["analyzed_count"] += 1
            source_stats[source]["total_rating"] += analysis.overall_rating
            source_stats[source]["total_journalist_biases"] += (
                analysis.journalist_bias_count
            )

            # Count bias types from journalist biases
            for bias in analysis.journalist_biases or []:
                bias_type = bias.get("bias_type", "Unknown")
                bias_type_counts[bias_type] += 1

    # Build source stats list
    by_source: List[SourceBiasStats] = []
    for source, stats in sorted(source_stats.items()):
        analyzed = stats["analyzed_count"]
        avg_rating = (
            stats["total_rating"] / analyzed if analyzed > 0 else 0.0
        )
        by_source.append(
            SourceBiasStats(
                source=source,
                article_count=stats["article_count"],
                average_rating=round(avg_rating, 3),
                articles_analyzed=analyzed,
                total_journalist_biases=stats["total_journalist_biases"],
            )
        )

    # Build bias type distribution (sorted by count descending)
    bias_type_distribution = [
        BiasTypeCount(bias_type=bt, count=count)
        for bt, count in sorted(
            bias_type_counts.items(), key=lambda x: x[1], reverse=True
        )
    ]

    # Calculate overall average
    articles_analyzed = len(analyses)
    average_bias_rating = None
    if articles_analyzed > 0:
        total_rating = sum(a.overall_rating for a in analyses)
        average_bias_rating = round(total_rating / articles_analyzed, 3)

    summary = EventBiasSummary(
        event_id=event_id,
        total_articles=total_articles,
        articles_analyzed=articles_analyzed,
        average_bias_rating=average_bias_rating,
        by_source=by_source,
        bias_type_distribution=bias_type_distribution,
    )

    meta = EventBiasSummaryMeta(
        event_id=event_id,
        generated_at=datetime.now(timezone.utc),
        total_articles=total_articles,
        articles_analyzed=articles_analyzed,
    )

    return {
        "data": summary.model_dump(),
        "meta": meta.model_dump(),
    }
