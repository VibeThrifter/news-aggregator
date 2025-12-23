"""Service orchestrating prompt building, LLM calls, and insight persistence."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import aliased

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Event, LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.llm.client import (
    BaseLLMClient,
    DeepSeekClient,
    LLMClientError,
    LLMGenericResult,
    LLMResult,
    MistralClient,
)
from backend.app.services.llm_config_service import get_llm_config_service
from backend.app.llm.prompt_builder import PromptBuilder, PromptGenerationResult
from backend.app.llm.schemas import CriticalPayload, FactualPayload, InsightsPayload
from backend.app.repositories import InsightRepository, InsightPersistenceResult

logger = get_logger(__name__).bind(component="InsightService")


@dataclass(slots=True)
class InsightGenerationOutcome:
    """Return type describing stored insights and associated payload."""

    insight: LLMInsight
    created: bool
    payload: InsightsPayload
    llm_result: LLMResult


class InsightService:
    """Generate LLM insights for events and persist them."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        prompt_builder: PromptBuilder | None = None,
        client: BaseLLMClient | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.session_factory = session_factory or get_sessionmaker()
        self.prompt_builder = prompt_builder or PromptBuilder(settings=self.settings)
        self.client = client or self._build_client()

    def _build_client(
        self, provider: str | None = None, use_reasoner: bool = False
    ) -> BaseLLMClient:
        """Build an LLM client for the specified provider."""
        provider = (provider or self.settings.llm_provider or "mistral").lower()
        if provider == "mistral":
            return MistralClient(settings=self.settings)
        if provider == "deepseek":
            return DeepSeekClient(settings=self.settings, use_reasoner=use_reasoner)
        raise ValueError(f"LLM provider '{provider}' wordt nog niet ondersteund")

    async def _get_client_for_phase(self, phase: str) -> BaseLLMClient:
        """Get the configured LLM client for a specific phase (factual/critical)."""
        config_service = get_llm_config_service()
        provider = await config_service.get_value(f"provider_{phase}", default="mistral")
        use_reasoner = await config_service.get_bool("deepseek_use_reasoner", default=False)
        return self._build_client(provider, use_reasoner=use_reasoner)

    async def generate_for_event(
        self,
        event_id: int,
        *,
        correlation_id: str | None = None,
    ) -> InsightGenerationOutcome:
        """Generate and persist insights for a specific event using 2-phase LLM calls."""

        # Get clients for each phase (may be different providers)
        factual_client = await self._get_client_for_phase("factual")
        critical_client = await self._get_client_for_phase("critical")

        # Phase 1: Factual analysis
        factual_package = await self.prompt_builder.build_factual_prompt_package(event_id, max_articles=None)
        prompt_metadata = self._build_prompt_metadata(factual_package)
        prompt_metadata["phase"] = "two_phase"

        logger.info(
            "insight_generation_phase1_start",
            event_id=event_id,
            provider=factual_client.provider,
            correlation_id=correlation_id,
        )
        factual_result = await factual_client.generate_json(
            factual_package.prompt,
            FactualPayload,
            correlation_id=correlation_id,
        )
        factual_payload: FactualPayload = factual_result.payload

        logger.info(
            "insight_generation_phase1_complete",
            event_id=event_id,
            provider=factual_client.provider,
            summary_length=len(factual_payload.summary),
            correlation_id=correlation_id,
        )

        # Phase 2: Critical analysis (receives summary from phase 1)
        critical_package = await self.prompt_builder.build_critical_prompt_package(
            event_id,
            factual_summary=factual_payload.summary,
            max_articles=None,
        )

        logger.info(
            "insight_generation_phase2_start",
            event_id=event_id,
            provider=critical_client.provider,
            correlation_id=correlation_id,
        )
        critical_result = await critical_client.generate_json(
            critical_package.prompt,
            CriticalPayload,
            correlation_id=correlation_id,
        )
        critical_payload: CriticalPayload = critical_result.payload

        logger.info(
            "insight_generation_phase2_complete",
            event_id=event_id,
            provider=critical_client.provider,
            authority_count=len(critical_payload.authority_analysis),
            correlation_id=correlation_id,
        )

        # Merge both payloads
        merged_payload = InsightsPayload.from_phases(factual_payload, critical_payload)
        payload_dict = merged_payload.model_dump(mode="json")

        # Update metadata with both phases (include provider info)
        prompt_metadata["factual_provider"] = factual_client.provider
        prompt_metadata["factual_model"] = factual_result.model
        prompt_metadata["critical_provider"] = critical_client.provider
        prompt_metadata["critical_model"] = critical_result.model
        prompt_metadata["model"] = critical_result.model  # backwards compat
        prompt_metadata["factual_prompt_length"] = factual_package.prompt_length
        prompt_metadata["critical_prompt_length"] = critical_package.prompt_length
        total_usage: Dict[str, Any] = {}
        if factual_result.usage:
            for k, v in factual_result.usage.items():
                total_usage[f"factual_{k}"] = v
        if critical_result.usage:
            for k, v in critical_result.usage.items():
                total_usage[f"critical_{k}"] = v
        if total_usage:
            prompt_metadata["usage"] = total_usage

        # Create a synthetic LLMResult for backward compatibility
        llm_result = LLMResult(
            provider=critical_result.provider,
            model=critical_result.model,
            payload=merged_payload,
            raw_content=f"FACTUAL:\n{factual_result.raw_content}\n\nCRITICAL:\n{critical_result.raw_content}",
            usage=total_usage if total_usage else None,
        )

        async with self.session_factory() as session:
            repo = InsightRepository(session)
            persistence = await repo.upsert_insight(
                event_id=event_id,
                provider=llm_result.provider,
                model=llm_result.model,
                prompt_metadata=prompt_metadata,
                summary=payload_dict.get("summary"),
                timeline=payload_dict.get("timeline", []),
                clusters=payload_dict.get("clusters", []),
                contradictions=payload_dict.get("contradictions", []),
                fallacies=payload_dict.get("fallacies", []),
                frames=payload_dict.get("frames", []),
                coverage_gaps=payload_dict.get("coverage_gaps", []),
                # Kritische analyse velden
                unsubstantiated_claims=payload_dict.get("unsubstantiated_claims", []),
                authority_analysis=payload_dict.get("authority_analysis", []),
                media_analysis=payload_dict.get("media_analysis", []),
                statistical_issues=payload_dict.get("statistical_issues", []),
                timing_analysis=payload_dict.get("timing_analysis"),
                scientific_plurality=payload_dict.get("scientific_plurality"),
                raw_response=llm_result.raw_content,
            )

            # Verify the saved insight matches the event_id
            if persistence.insight.event_id != event_id:
                await session.rollback()
                raise RuntimeError(
                    f"Data integrity error: insight was saved for event {persistence.insight.event_id} "
                    f"but should be for event {event_id}"
                )

            await session.commit()

        logger.info(
            "insight_generation_completed",
            event_id=event_id,
            provider=llm_result.provider,
            model=llm_result.model,
            created=persistence.created,
            phases=2,
            correlation_id=correlation_id,
        )
        return InsightGenerationOutcome(
            insight=persistence.insight,
            created=persistence.created,
            payload=merged_payload,
            llm_result=llm_result,
        )

    @staticmethod
    def _build_prompt_metadata(package: PromptGenerationResult) -> Dict[str, Any]:
        metadata: Dict[str, Any] = {
            "selected_article_ids": package.selected_article_ids,
            "selected_count": package.selected_count,
            "total_articles": package.total_articles,
            "prompt_length": package.prompt_length,
        }
        return metadata

    async def backfill_missing_insights(
        self,
        *,
        limit: int = 10,
        correlation_id: str | None = None,
    ) -> Dict[str, Any]:
        """Generate insights for events that are missing them.

        This method is designed to be called periodically by a scheduler job
        to catch up on events that didn't get insights due to server restarts
        or other failures.

        Args:
            limit: Maximum number of events to process per run (rate limiting)
            correlation_id: Optional correlation ID for logging

        Returns:
            Statistics about the backfill run
        """
        log = logger.bind(correlation_id=correlation_id, component="backfill")

        # Find active events without insights, ordered by most recently updated first
        async with self.session_factory() as session:
            # Subquery to find event_ids that have insights
            insight_subq = select(LLMInsight.event_id).distinct().subquery()

            # Select active events without insights
            stmt = (
                select(Event.id)
                .outerjoin(insight_subq, Event.id == insight_subq.c.event_id)
                .where(
                    Event.archived_at.is_(None),  # Only active events
                    insight_subq.c.event_id.is_(None),  # No insight exists
                )
                .order_by(Event.last_updated_at.desc())  # Most recent first
                .limit(limit)
            )
            result = await session.execute(stmt)
            event_ids: List[int] = [row[0] for row in result.fetchall()]

        if not event_ids:
            log.info("backfill_no_events_needed")
            return {
                "events_found": 0,
                "events_processed": 0,
                "events_failed": 0,
            }

        log.info("backfill_starting", events_to_process=len(event_ids))

        processed = 0
        failed = 0
        failed_ids: List[int] = []

        for event_id in event_ids:
            try:
                await self.generate_for_event(event_id, correlation_id=correlation_id)
                processed += 1
                log.info("backfill_event_completed", event_id=event_id)
            except Exception as exc:
                failed += 1
                failed_ids.append(event_id)
                log.warning(
                    "backfill_event_failed",
                    event_id=event_id,
                    error=str(exc),
                )

        log.info(
            "backfill_completed",
            events_found=len(event_ids),
            events_processed=processed,
            events_failed=failed,
        )

        return {
            "events_found": len(event_ids),
            "events_processed": processed,
            "events_failed": failed,
            "failed_event_ids": failed_ids if failed_ids else None,
        }


__all__ = ["InsightGenerationOutcome", "InsightService"]
