"""Repository helpers for persisting LLM insights."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import LLMInsight

logger = get_logger(__name__)


@dataclass
class InsightPersistenceResult:
    """Describe the outcome of an insight persistence operation."""

    insight: LLMInsight
    created: bool


class InsightRepository:
    """Encapsulates read/write operations for LLM insights."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.log = logger.bind(component="InsightRepository")

    async def get_by_event_and_provider(self, event_id: int, provider: str) -> Optional[LLMInsight]:
        stmt = (
            select(LLMInsight)
            .where(LLMInsight.event_id == event_id)
            .where(LLMInsight.provider == provider)
        )
        result = await self.session.execute(stmt)
        insight = result.scalar_one_or_none()
        return insight

    async def get_latest_insight(self, event_id: int) -> Optional[LLMInsight]:
        """Return the most recent insight for an event regardless of provider."""

        stmt = (
            select(LLMInsight)
            .where(LLMInsight.event_id == event_id)
            .order_by(desc(LLMInsight.generated_at))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert_insight(
        self,
        *,
        event_id: int,
        provider: str,
        model: str,
        prompt_metadata: Dict[str, Any] | None,
        summary: str | None,
        timeline: list[Dict[str, Any]],
        clusters: list[Dict[str, Any]],
        contradictions: list[Dict[str, Any]],
        fallacies: list[Dict[str, Any]],
        frames: list[Dict[str, Any]] | None = None,
        coverage_gaps: list[Dict[str, Any]] | None = None,
        # Nieuwe kritische analyse velden
        unsubstantiated_claims: list[Dict[str, Any]] | None = None,
        authority_analysis: list[Dict[str, Any]] | None = None,
        media_analysis: list[Dict[str, Any]] | None = None,
        scientific_plurality: Dict[str, Any] | None = None,
        raw_response: str | None,
        generated_at: datetime | None = None,
    ) -> InsightPersistenceResult:
        """Create or update an insight for the given event/provider tuple."""

        timestamp = generated_at or datetime.now(timezone.utc)
        existing = await self.get_by_event_and_provider(event_id, provider)
        created = False

        if existing:
            existing.model = model
            existing.prompt_metadata = prompt_metadata
            existing.summary = summary
            existing.timeline = timeline
            existing.clusters = clusters
            existing.contradictions = contradictions
            existing.fallacies = fallacies
            existing.frames = frames
            existing.coverage_gaps = coverage_gaps
            existing.unsubstantiated_claims = unsubstantiated_claims
            existing.authority_analysis = authority_analysis
            existing.media_analysis = media_analysis
            existing.scientific_plurality = scientific_plurality
            existing.raw_response = raw_response
            existing.generated_at = timestamp
            insight = existing
            self.log.info("insight_updated", event_id=event_id, provider=provider)
        else:
            insight = LLMInsight(
                event_id=event_id,
                provider=provider,
                model=model,
                prompt_metadata=prompt_metadata,
                summary=summary,
                timeline=timeline,
                clusters=clusters,
                contradictions=contradictions,
                fallacies=fallacies,
                frames=frames,
                coverage_gaps=coverage_gaps,
                unsubstantiated_claims=unsubstantiated_claims,
                authority_analysis=authority_analysis,
                media_analysis=media_analysis,
                scientific_plurality=scientific_plurality,
                raw_response=raw_response,
                generated_at=timestamp,
            )
            self.session.add(insight)
            created = True
            self.log.info("insight_created", event_id=event_id, provider=provider)

        await self.session.flush()
        return InsightPersistenceResult(insight=insight, created=created)


__all__ = ["InsightRepository", "InsightPersistenceResult"]
