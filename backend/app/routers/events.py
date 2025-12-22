"""REST API endpoints for event retrieval."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import get_async_session
from backend.app.core.logging import get_logger
from backend.app.db.models import Article, Event, EventArticle, LLMInsight, NewsSource
from backend.app.models import (
    EventArticleResponse,
    EventDetail,
    EventDetailMeta,
    EventFeedMeta,
    EventListItem,
    EventSourceBreakdownEntry,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1", tags=["events"])


async def _get_main_source_names(session: AsyncSession) -> Set[str]:
    """Get the display names of main sources for filtering events."""
    stmt = select(NewsSource.display_name).where(NewsSource.is_main_source.is_(True))
    result = await session.execute(stmt)
    return {row[0] for row in result.fetchall()}


def _build_source_breakdown(
    articles: List[Article],
) -> List[EventSourceBreakdownEntry]:
    """Build source breakdown from articles."""
    source_counts: dict[tuple[str, Optional[str]], int] = defaultdict(int)

    for article in articles:
        source = article.source_name or "Unknown"
        spectrum = None
        if article.source_metadata and isinstance(article.source_metadata, dict):
            spectrum = article.source_metadata.get("spectrum")
        source_counts[(source, spectrum)] += 1

    return [
        EventSourceBreakdownEntry(
            source=source,
            article_count=count,
            spectrum=str(spectrum) if spectrum is not None else None,
        )
        for (source, spectrum), count in sorted(source_counts.items())
    ]


async def _get_latest_insight(
    session: AsyncSession,
    event_id: int,
) -> Optional[LLMInsight]:
    """Get the latest LLM insight for an event."""
    stmt = (
        select(LLMInsight)
        .where(LLMInsight.event_id == event_id)
        .order_by(desc(LLMInsight.generated_at))
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


@router.get("/events")
async def list_events(
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    """List all events sorted by newest article.

    Only shows events that have at least one article from a "main" source.
    If no main sources are configured, shows all events.
    """
    stmt = (
        select(Event)
        .where(Event.archived_at.is_(None))
        .order_by(desc(Event.last_updated_at))
    )

    result = await session.execute(stmt)
    events = result.scalars().all()

    # Get main source names for filtering
    main_source_names = await _get_main_source_names(session)

    # Get articles for each event to build source breakdown
    event_items: List[EventListItem] = []
    last_updated: Optional[datetime] = None

    for event in events:
        # Get articles for this event
        article_stmt = (
            select(Article)
            .join(EventArticle, EventArticle.article_id == Article.id)
            .where(EventArticle.event_id == event.id)
        )
        article_result = await session.execute(article_stmt)
        articles = list(article_result.scalars().all())

        # Filter: only show events that have at least one article from a main source
        # If no main sources are configured, show all events
        if main_source_names:
            article_sources = {a.source_name for a in articles if a.source_name}
            has_main_source = bool(article_sources & main_source_names)
            if not has_main_source:
                continue

        # Get latest insight for LLM provider
        insight = await _get_latest_insight(session, event.id)

        source_breakdown = _build_source_breakdown(articles) if articles else None

        event_items.append(
            EventListItem(
                id=event.id,
                slug=event.slug,
                title=event.title or f"Event {event.id}",
                description=event.description,
                summary=event.description,
                first_seen_at=event.first_seen_at,
                last_updated_at=event.last_updated_at,
                article_count=event.article_count,
                spectrum_distribution=event.spectrum_distribution,
                source_breakdown=source_breakdown,
                llm_provider=insight.provider if insight else None,
            )
        )

        if not last_updated or (event.last_updated_at and event.last_updated_at > last_updated):
            last_updated = event.last_updated_at

    # Build meta
    meta = EventFeedMeta(
        last_updated_at=last_updated,
        last_updated=last_updated,
        last_refresh_at=last_updated,
        generated_at=datetime.now(timezone.utc),
        llm_provider=event_items[0].llm_provider if event_items else None,
        active_provider=event_items[0].llm_provider if event_items else None,
        total_events=len(event_items),
        event_count=len(event_items),
    )

    return {
        "data": event_items,
        "meta": meta.model_dump(),
    }


@router.get("/events/{event_identifier}")
async def get_event_detail(
    event_identifier: str,
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    """Get detailed information for a specific event by ID or slug."""
    # Try to parse as integer ID first, otherwise treat as slug
    event_id: int | None = None
    try:
        event_id = int(event_identifier)
        stmt = select(Event).where(Event.id == event_id)
    except ValueError:
        # It's a slug
        stmt = select(Event).where(Event.slug == event_identifier)

    result = await session.execute(stmt)
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_identifier} not found")

    # Normalise to the resolved numeric ID for downstream queries.
    event_id = event.id

    # Get articles
    article_stmt = (
        select(Article)
        .join(EventArticle, EventArticle.article_id == Article.id)
        .where(EventArticle.event_id == event.id)
        .order_by(desc(Article.published_at))
    )
    article_result = await session.execute(article_stmt)
    articles = list(article_result.scalars().all())

    # Get latest insight
    insight = await _get_latest_insight(session, event_id)

    # Build article responses
    article_responses = []
    for article in articles:
        spectrum_value = None
        if article.source_metadata and isinstance(article.source_metadata, dict):
            raw_spectrum = article.source_metadata.get("spectrum")
            if raw_spectrum is not None:
                spectrum_value = str(raw_spectrum)

        article_responses.append(
            EventArticleResponse(
                id=article.id,
                title=article.title,
                url=article.url,
                source=article.source_name or "Unknown",
                spectrum=spectrum_value,
                published_at=article.published_at,
                summary=article.summary,
                image_url=article.image_url,
            )
        )

    # Build source breakdown
    source_breakdown = _build_source_breakdown(articles) if articles else None

    # Extract keywords from entities
    keywords: Optional[List[str]] = None
    if event.centroid_entities:
        keywords = [
            entity.get("text", "")
            for entity in event.centroid_entities
            if entity.get("text")
        ][:10]  # Limit to top 10

    # Build response
    event_detail = EventDetail(
        id=event.id,
        slug=event.slug,
        title=event.title or f"Event {event.id}",
        description=event.description,
        summary=event.description,
        first_seen_at=event.first_seen_at,
        last_updated_at=event.last_updated_at,
        article_count=event.article_count,
        spectrum_distribution=event.spectrum_distribution,
        source_breakdown=source_breakdown,
        llm_provider=insight.provider if insight else None,
        articles=article_responses,
        insights_status="available" if insight else "pending",
        insights_generated_at=insight.generated_at if insight else None,
        insights_requested_at=None,  # TODO: Track this separately if needed
        keywords=keywords,
    )

    meta = EventDetailMeta(
        last_updated_at=event.last_updated_at,
        generated_at=datetime.now(timezone.utc),
        llm_provider=insight.provider if insight else None,
        insights_status="available" if insight else "pending",
        insights_generated_at=insight.generated_at if insight else None,
        insights_requested_at=None,
        first_seen_at=event.first_seen_at,
    )

    return {
        "data": event_detail.model_dump(),
        "meta": meta.model_dump(),
    }
