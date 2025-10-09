"""REST API endpoints for event insights retrieval."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import get_async_session
from backend.app.core.logging import get_logger
from backend.app.db.models import Event, LLMInsight
from backend.app.models import AggregationResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1", tags=["insights"])


@router.get("/insights/{event_identifier}")
async def get_event_insights(
    event_identifier: str,
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    """Get LLM-generated insights for a specific event."""
    event_id: int | None = None
    try:
        event_id = int(event_identifier)
        event_stmt = select(Event).where(Event.id == event_id)
    except ValueError:
        event_stmt = select(Event).where(Event.slug == event_identifier)

    event_result = await session.execute(event_stmt)
    event = event_result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_identifier} not found")

    event_id = event.id

    # Get latest insight
    insight_stmt = (
        select(LLMInsight)
        .where(LLMInsight.event_id == event_id)
        .order_by(desc(LLMInsight.generated_at))
        .limit(1)
    )
    insight_result = await session.execute(insight_stmt)
    insight = insight_result.scalar_one_or_none()

    if not insight:
        raise HTTPException(
            status_code=404,
            detail=f"No insights found for event {event_identifier}. Insights may not have been generated yet.",
        )

    # Build aggregation response from insight data
    generated_at = insight.generated_at or datetime.now(timezone.utc)

    aggregation = AggregationResponse(
        query=event.title or f"Event {event_id}",
        generated_at=generated_at,
        llm_provider=insight.provider,
        summary=insight.summary,
        timeline=insight.timeline or [],
        clusters=insight.clusters or [],
        fallacies=insight.fallacies or [],
        frames=insight.frames or [],
        contradictions=insight.contradictions or [],
        coverage_gaps=insight.coverage_gaps or [],
    )

    return {
        "data": aggregation.model_dump(),
        "meta": {
            "event_id": event_id,
            "provider": insight.provider,
            "model": insight.model,
            "generated_at": generated_at.isoformat(),
        },
    }
