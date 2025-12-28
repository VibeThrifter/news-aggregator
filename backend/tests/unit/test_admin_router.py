from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace
import sys
import types

import pytest
from fastapi.responses import JSONResponse


# Stub heavy dependencies before importing the router module to keep tests lightweight.
dummy_scheduler_module = types.ModuleType("backend.app.core.scheduler")
dummy_scheduler_module.get_scheduler = lambda: SimpleNamespace(
    run_poll_feeds_now=lambda **_: {"status": "ok"},
    run_event_maintenance_now=lambda **_: {"status": "ok"},
    get_job_status=lambda **_: {"status": "idle"},
)
sys.modules.setdefault("backend.app.core.scheduler", dummy_scheduler_module)

dummy_enrich_module = types.ModuleType("backend.app.services.enrich_service")


class _StubArticleEnrichmentService:
    def __init__(self, **kwargs):  # Accept any kwargs like session_factory
        pass

    async def enrich_pending(self, limit=None):  # pragma: no cover - unused in these tests
        return {"status": "stub"}


dummy_enrich_module.ArticleEnrichmentService = _StubArticleEnrichmentService
sys.modules.setdefault("backend.app.services.enrich_service", dummy_enrich_module)

dummy_insight_module = types.ModuleType("backend.app.services.insight_service")


@dataclass(slots=True)
class InsightGenerationOutcome:
    insight: SimpleNamespace
    created: bool
    payload: object
    llm_result: SimpleNamespace


class InsightService:  # pragma: no cover - replaced within individual tests
    async def generate_for_event(self, event_id: int, *, correlation_id=None):
        raise NotImplementedError


dummy_insight_module.InsightGenerationOutcome = InsightGenerationOutcome
dummy_insight_module.InsightService = InsightService
sys.modules.setdefault("backend.app.services.insight_service", dummy_insight_module)

from backend.app.routers import admin


@pytest.mark.asyncio
async def test_trigger_generate_insights_returns_json_api(monkeypatch):
    now = datetime.now(timezone.utc)
    event_id = 65

    outcome = InsightGenerationOutcome(
        insight=SimpleNamespace(id=999, event_id=event_id, generated_at=now),
        created=True,
        payload=SimpleNamespace(),
        llm_result=SimpleNamespace(
            provider="mistral",
            model="mistral-small-latest",
            usage={"prompt_tokens": 120, "completion_tokens": 32},
        ),
    )

    class DummyService:
        async def generate_for_event(self, incoming_event_id: int, *, correlation_id=None):
            assert incoming_event_id == event_id
            return outcome

    monkeypatch.setattr(admin, "InsightService", lambda: DummyService())

    response = await admin.trigger_generate_insights(event_id)

    assert response["data"]["type"] == "insight-job"
    assert response["data"]["attributes"]["status"] == "created"
    assert response["links"]["insights"] == f"/api/v1/insights/{event_id}"
    assert response["meta"]["provider"] == "mistral"
    assert response["meta"]["usage"] == {"prompt_tokens": 120, "completion_tokens": 32}


@pytest.mark.asyncio
async def test_trigger_generate_insights_event_not_found(monkeypatch):
    event_id = 123

    class DummyService:
        async def generate_for_event(self, incoming_event_id: int, *, correlation_id=None):  # pragma: no cover - defensive
            raise ValueError(f"Event {incoming_event_id} not found")

    monkeypatch.setattr(admin, "InsightService", lambda: DummyService())

    response = await admin.trigger_generate_insights(event_id)

    assert isinstance(response, JSONResponse)
    assert response.status_code == 404
    payload = json.loads(response.body)
    assert payload["error"]["code"] == "EVENT_NOT_FOUND"


@pytest.mark.asyncio
async def test_trigger_generate_insights_unexpected_error(monkeypatch):
    event_id = 55

    class DummyService:
        async def generate_for_event(self, incoming_event_id: int, *, correlation_id=None):  # pragma: no cover - defensive
            raise RuntimeError("llm down")

    monkeypatch.setattr(admin, "InsightService", lambda: DummyService())

    response = await admin.trigger_generate_insights(event_id)

    assert isinstance(response, JSONResponse)
    assert response.status_code == 500
    payload = json.loads(response.body)
    assert payload["error"]["code"] == "INSIGHT_GENERATION_FAILED"
    assert payload["error"]["details"]["reason"] == "llm down"
