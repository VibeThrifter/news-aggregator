"""Repository helpers for persisting LLM insights."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
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

    async def upsert_insight(
        self,
        *,
        event_id: int,
        provider: str,
        model: str,
        prompt_metadata: Dict[str, Any] | None,
        timeline: list[Dict[str, Any]],
        clusters: list[Dict[str, Any]],
        contradictions: list[Dict[str, Any]],
        fallacies: list[Dict[str, Any]],
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
            existing.timeline = timeline
            existing.clusters = clusters
            existing.contradictions = contradictions
            existing.fallacies = fallacies
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
                timeline=timeline,
                clusters=clusters,
                contradictions=contradictions,
                fallacies=fallacies,
                raw_response=raw_response,
                generated_at=timestamp,
            )
            self.session.add(insight)
            created = True
            self.log.info("insight_created", event_id=event_id, provider=provider)

        await self.session.flush()
        return InsightPersistenceResult(insight=insight, created=created)


__all__ = ["InsightRepository", "InsightPersistenceResult"]
