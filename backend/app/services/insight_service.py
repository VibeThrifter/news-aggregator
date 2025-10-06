"""Service orchestrating prompt building, LLM calls, and insight persistence."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.llm.client import (
    BaseLLMClient,
    LLMClientError,
    LLMResult,
    MistralClient,
)
from backend.app.llm.prompt_builder import PromptBuilder, PromptGenerationResult
from backend.app.llm.schemas import InsightsPayload
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
        """Generate and persist insights for a specific event."""

        package = await self.prompt_builder.build_prompt_package(event_id, max_articles=None)
        prompt_metadata = self._build_prompt_metadata(package)

        llm_result = await self.client.generate(package.prompt, correlation_id=correlation_id)
        payload_dict = llm_result.payload.model_dump(mode="json")
        prompt_metadata["model"] = llm_result.model
        if llm_result.usage:
            prompt_metadata["usage"] = llm_result.usage

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
                raw_response=llm_result.raw_content,
            )
            await session.commit()

        logger.info(
            "insight_generation_completed",
            event_id=event_id,
            provider=llm_result.provider,
            model=llm_result.model,
            created=persistence.created,
            correlation_id=correlation_id,
        )
        return InsightGenerationOutcome(
            insight=persistence.insight,
            created=persistence.created,
            payload=llm_result.payload,
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
