# ruff: noqa: S101
"""The exploration refresh after insight generation must never break it (Story 11.8)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select

from backend.app.db.models import LLMInsight
from backend.app.llm.client import BaseLLMClient, LLMGenericResult, LLMResult
from backend.app.llm.prompt_builder import PromptGenerationResult
from backend.app.llm.schemas import CriticalPayload, FactualPayload, InsightsPayload
from backend.app.llm.title import extract_title_from_summary
from backend.tests.unit._exploration_fixtures import (
    make_session_factory,
    make_settings,
    real_module,
    seed_event,
)

SUMMARY = (
    "Demonstratie op het Malieveld\n\n" + "Een uitgebreide samenvatting van de demonstratie. " * 5
)


class _PromptBuilder:
    def __init__(self) -> None:
        self.result = PromptGenerationResult(
            prompt="PROMPT",
            prompt_length=6,
            selected_article_ids=[1],
            selected_count=1,
            total_articles=1,
        )

    async def build_factual_prompt_package(self, event_id: int, max_articles=None):
        return self.result

    async def build_critical_prompt_package(
        self, event_id: int, factual_summary: str, max_articles=None
    ):
        return self.result


class _Client(BaseLLMClient):
    provider = "mistral"

    def __init__(self) -> None:
        self.factual = FactualPayload(summary=SUMMARY, timeline=[], clusters=[], contradictions=[])
        self.critical = CriticalPayload(
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

    async def generate(self, prompt: str, *, correlation_id=None) -> LLMResult:  # pragma: no cover
        payload = InsightsPayload.from_phases(self.factual, self.critical)
        return LLMResult(provider="mistral", model="m", payload=payload, raw_content="{}")

    async def generate_json(self, prompt: str, schema_class, *, correlation_id=None):
        payload = self.factual if schema_class is FactualPayload else self.critical
        return LLMGenericResult(
            provider="mistral",
            model="mistral-small-latest",
            payload=payload,
            raw_content=payload.model_dump_json(),
            usage=None,
        )


async def _service(monkeypatch, hook=None, **settings_overrides):
    module = real_module("backend.app.services.insight_service")
    factory, engine = await make_session_factory()
    event_id = await seed_event(factory, slug="malieveld", llm_title=None)
    client = _Client()
    service = module.InsightService(
        session_factory=factory,
        prompt_builder=_PromptBuilder(),
        client=client,
        settings=make_settings(mistral_api_key="test", **settings_overrides),
        exploration_hook=hook,
    )

    async def client_for_phase(phase: str):
        return client

    monkeypatch.setattr(service, "_get_client_for_phase", client_for_phase)
    return module, service, factory, engine, event_id


async def _insight_count(factory) -> int:
    async with factory() as session:
        return len((await session.execute(select(LLMInsight))).scalars().all())


def test_insight_service_keeps_title_alias() -> None:
    module = real_module("backend.app.services.insight_service")
    assert module._extract_title_from_summary is extract_title_from_summary


@pytest.mark.asyncio
async def test_hook_receives_event_summary_and_correlation_id(monkeypatch) -> None:
    calls: list[tuple[int, dict[str, Any]]] = []

    async def hook(event_id: int, **kwargs: Any):
        calls.append((event_id, kwargs))
        return {"entities_written": 1}

    _, service, factory, engine, event_id = await _service(monkeypatch, hook)
    outcome = await service.generate_for_event(
        event_id, correlation_id="cid-9", skip_international_enrichment=True
    )
    assert outcome.insight.event_id == event_id
    assert calls == [(event_id, {"summary": SUMMARY, "correlation_id": "cid-9"})]
    await engine.dispose()


@pytest.mark.asyncio
async def test_hook_failure_does_not_break_insight_generation(monkeypatch) -> None:
    async def hook(event_id: int, **kwargs: Any):
        raise RuntimeError("exploration kapot")

    _, service, factory, engine, event_id = await _service(monkeypatch, hook)
    outcome = await service.generate_for_event(event_id, skip_international_enrichment=True)
    assert outcome.created is True
    assert await _insight_count(factory) == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_slow_hook_times_out_without_failing(monkeypatch) -> None:
    async def hook(event_id: int, **kwargs: Any):
        await asyncio.sleep(1)

    module, service, factory, engine, event_id = await _service(monkeypatch, hook)
    monkeypatch.setattr(module, "EXPLORATION_HOOK_TIMEOUT_SECONDS", 0.01)
    outcome = await service.generate_for_event(event_id, skip_international_enrichment=True)
    assert outcome.created is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_hook_skipped_when_exploration_disabled(monkeypatch) -> None:
    calls: list[int] = []

    async def hook(event_id: int, **kwargs: Any):
        calls.append(event_id)

    _, service, factory, engine, event_id = await _service(
        monkeypatch, hook, exploration_enabled=False
    )
    await service.generate_for_event(event_id, skip_international_enrichment=True)
    assert calls == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_default_hook_uses_exploration_service(monkeypatch) -> None:
    calls: list[tuple[int, str | None]] = []

    async def refresh_for_event(event_id: int, summary=None, correlation_id=None):
        calls.append((event_id, summary))

    exploration = real_module("backend.app.services.exploration_service")
    monkeypatch.setattr(
        exploration,
        "get_exploration_service",
        lambda: SimpleNamespace(refresh_for_event=refresh_for_event),
    )
    _, service, factory, engine, event_id = await _service(monkeypatch)
    await service.generate_for_event(event_id, skip_international_enrichment=True)
    assert calls == [(event_id, SUMMARY)]
    await engine.dispose()
