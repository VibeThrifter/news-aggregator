"""Service orchestrating prompt building, LLM calls, and insight persistence."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.llm.client import (
    BaseLLMClient,
    LLMClientError,
    LLMGenericResult,
    LLMResult,
    MistralClient,
)
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

    def _build_client(self) -> BaseLLMClient:
        provider = (self.settings.llm_provider or "mistral").lower()
        if provider == "mistral":
            return MistralClient(settings=self.settings)
        raise ValueError(f"LLM provider '{provider}' wordt nog niet ondersteund")

    async def generate_for_event(
        self,
        event_id: int,
        *,
        correlation_id: str | None = None,
    ) -> InsightGenerationOutcome:
        """Generate and persist insights for a specific event using 2-phase LLM calls."""

        # Phase 1: Factual analysis
        factual_package = await self.prompt_builder.build_factual_prompt_package(event_id, max_articles=None)
        prompt_metadata = self._build_prompt_metadata(factual_package)
        prompt_metadata["phase"] = "two_phase"

        logger.info(
            "insight_generation_phase1_start",
            event_id=event_id,
            correlation_id=correlation_id,
        )
        factual_result = await self.client.generate_json(
            factual_package.prompt,
            FactualPayload,
            correlation_id=correlation_id,
        )
        factual_payload: FactualPayload = factual_result.payload

        logger.info(
            "insight_generation_phase1_complete",
            event_id=event_id,
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
            correlation_id=correlation_id,
        )
        critical_result = await self.client.generate_json(
            critical_package.prompt,
            CriticalPayload,
            correlation_id=correlation_id,
        )
        critical_payload: CriticalPayload = critical_result.payload

        logger.info(
            "insight_generation_phase2_complete",
            event_id=event_id,
            authority_count=len(critical_payload.authority_analysis),
            correlation_id=correlation_id,
        )

        # Merge both payloads
        merged_payload = InsightsPayload.from_phases(factual_payload, critical_payload)
        payload_dict = merged_payload.model_dump(mode="json")

        # Update metadata with both phases
        prompt_metadata["model"] = critical_result.model
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


__all__ = ["InsightGenerationOutcome", "InsightService"]
