from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Type, TypeVar

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.core.config import Settings
from backend.app.db.models import Base, Event, LLMInsight
from backend.app.llm.client import BaseLLMClient, LLMGenericResult, LLMResult
from backend.app.llm.prompt_builder import PromptGenerationResult
from backend.app.llm.schemas import CriticalPayload, FactualPayload, InsightsPayload
from backend.app.services.insight_service import InsightGenerationOutcome, InsightService

T = TypeVar("T")


class StubPromptBuilder:
    def __init__(self, result: PromptGenerationResult) -> None:
        self._result = result

    async def build_prompt_package(self, event_id: int, max_articles: int | None = None) -> PromptGenerationResult:  # noqa: D401
        return self._result

    async def build_factual_prompt_package(self, event_id: int, max_articles: int | None = None) -> PromptGenerationResult:  # noqa: D401
        return self._result

    async def build_critical_prompt_package(self, event_id: int, factual_summary: str, max_articles: int | None = None) -> PromptGenerationResult:  # noqa: D401
        return self._result


class StubLLMClient(BaseLLMClient):
    provider = "mistral"

    def __init__(self, factual_payload: FactualPayload, critical_payload: CriticalPayload) -> None:
        self._factual = factual_payload
        self._critical = critical_payload

    async def generate(self, prompt: str, *, correlation_id: str | None = None) -> LLMResult:
        # Fallback - not used in two-phase approach
        merged = InsightsPayload.from_phases(self._factual, self._critical)
        return LLMResult(
            provider="mistral",
            model="mistral-small-latest",
            payload=merged,
            raw_content=merged.model_dump_json(),
            usage={"prompt_tokens": 123},
        )

    async def generate_json(
        self,
        prompt: str,
        schema_class: Type[T],
        *,
        correlation_id: str | None = None
    ) -> LLMGenericResult:
        # Return the appropriate payload based on schema type
        if schema_class == FactualPayload:
            payload = self._factual
        elif schema_class == CriticalPayload:
            payload = self._critical
        else:
            raise ValueError(f"Unexpected schema: {schema_class}")

        return LLMGenericResult(
            provider="mistral",
            model="mistral-small-latest",
            payload=payload,
            raw_content=payload.model_dump_json(),
            usage={"prompt_tokens": 123},
        )


@pytest.mark.asyncio
async def test_insight_service_persists_payload() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        event = Event(
            slug="test-event",
            title="Demonstratie op het Malieveld",
            first_seen_at=now,
            last_updated_at=now,
            article_count=3,
        )
        session.add(event)
        await session.commit()
        await session.refresh(event)
        event_id = event.id

    prompt_package = PromptGenerationResult(
        prompt="PROMPT",
        prompt_length=1200,
        selected_article_ids=[1, 2, 3],
        selected_count=3,
        total_articles=5,
    )

    factual_payload = FactualPayload(
        summary="Dit is een uitgebreide samenvatting van de demonstratie op het Malieveld. " * 5,
        timeline=[
            {
                "time": "2024-02-12T10:00:00+00:00",
                "headline": "Voorbereidingen starten",
                "sources": ["https://example.com/a"],
                "spectrum": "mainstream",
            }
        ],
        clusters=[
            {
                "label": "Neutraal-feitelijk",
                "spectrum": "mainstream",
                "source_types": ["public_broadcaster"],
                "summary": "NOS en RTL benoemen het vreedzame karakter.",
                "sources": [
                    {
                        "title": "NOS liveblog",
                        "url": "https://example.com/a",
                        "spectrum": "mainstream",
                        "stance": "neutraal",
                    }
                ],
            }
        ],
        contradictions=[],
    )

    critical_payload = CriticalPayload(
        fallacies=[],
        frames=[],
        coverage_gaps=[],
        unsubstantiated_claims=[],
        authority_analysis=[],
        media_analysis=[],
        statistical_issues=[],
        timing_analysis=None,
        scientific_plurality=None,
    )

    service = InsightService(
        session_factory=session_factory,
        prompt_builder=StubPromptBuilder(prompt_package),
        client=StubLLMClient(factual_payload, critical_payload),
        settings=Settings(mistral_api_key="test-key"),
    )

    outcome = await service.generate_for_event(event_id)
    assert isinstance(outcome, InsightGenerationOutcome)
    assert outcome.created is True
    assert outcome.insight.provider == "mistral"
    assert outcome.insight.model == "mistral-small-latest"
    assert outcome.insight.prompt_metadata["selected_article_ids"] == [1, 2, 3]

    async with session_factory() as session:
        stored = await session.get(LLMInsight, outcome.insight.id)
        assert stored is not None
        assert stored.timeline[0]["headline"] == "Voorbereidingen starten"
        # Usage now has factual_prompt_tokens and critical_prompt_tokens
        assert stored.prompt_metadata["usage"]["factual_prompt_tokens"] == 123
        # Raw response now contains both phases
        assert "FACTUAL" in stored.raw_response
        assert "Voorbereidingen starten" in stored.raw_response

    await engine.dispose()
