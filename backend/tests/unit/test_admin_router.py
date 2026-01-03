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

# Stub bias service
dummy_bias_module = types.ModuleType("backend.app.services.bias_service")


@dataclass(slots=True)
class BiasAnalysisOutcome:
    analysis: SimpleNamespace
    created: bool
    payload: SimpleNamespace


class BiasDetectionService:  # pragma: no cover - replaced within individual tests
    async def analyze_article(self, article_id: int, *, correlation_id=None):
        raise NotImplementedError

    async def analyze_batch(self, *, limit: int = 10, correlation_id=None):
        raise NotImplementedError


def get_bias_detection_service():
    return BiasDetectionService()


dummy_bias_module.BiasAnalysisOutcome = BiasAnalysisOutcome
dummy_bias_module.BiasDetectionService = BiasDetectionService
dummy_bias_module.get_bias_detection_service = get_bias_detection_service
sys.modules.setdefault("backend.app.services.bias_service", dummy_bias_module)

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


# Tests for Bias Analysis endpoints (Epic 10, Story 10.3)


@pytest.mark.asyncio
async def test_trigger_bias_analysis_success(monkeypatch):
    """Test successful single article bias analysis."""
    article_id = 42

    analysis = SimpleNamespace(
        provider="mistral",
        model="mistral-small-latest",
        total_sentences=15,
        journalist_bias_count=3,
        quote_bias_count=1,
        journalist_bias_percentage=20.0,
        overall_rating=0.45,
    )
    outcome = BiasAnalysisOutcome(
        analysis=analysis,
        created=True,
        payload=SimpleNamespace(),
    )

    class DummyService:
        async def analyze_article(self, incoming_article_id: int, *, correlation_id=None):
            assert incoming_article_id == article_id
            return outcome

    monkeypatch.setattr(admin, "get_bias_detection_service", lambda: DummyService())

    response = await admin.trigger_bias_analysis(article_id)

    assert response.article_id == article_id
    assert response.provider == "mistral"
    assert response.total_sentences == 15
    assert response.journalist_bias_count == 3
    assert response.quote_bias_count == 1
    assert response.journalist_bias_percentage == 20.0
    assert response.overall_rating == 0.45
    assert response.created is True


@pytest.mark.asyncio
async def test_trigger_bias_analysis_article_not_found(monkeypatch):
    """Test bias analysis with non-existent article."""
    article_id = 999

    class DummyService:
        async def analyze_article(self, incoming_article_id: int, *, correlation_id=None):
            raise ValueError(f"Article {incoming_article_id} not found")

    monkeypatch.setattr(admin, "get_bias_detection_service", lambda: DummyService())

    with pytest.raises(Exception) as exc_info:
        await admin.trigger_bias_analysis(article_id)

    # FastAPI HTTPException
    assert exc_info.value.status_code == 404
    assert "not found" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_trigger_bias_analysis_llm_error(monkeypatch):
    """Test bias analysis with LLM failure."""
    article_id = 42

    class DummyService:
        async def analyze_article(self, incoming_article_id: int, *, correlation_id=None):
            raise RuntimeError("LLM timeout")

    monkeypatch.setattr(admin, "get_bias_detection_service", lambda: DummyService())

    with pytest.raises(Exception) as exc_info:
        await admin.trigger_bias_analysis(article_id)

    assert exc_info.value.status_code == 500
    assert "Bias analysis failed" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_trigger_batch_bias_analysis_success(monkeypatch):
    """Test successful batch bias analysis."""

    class DummyService:
        async def analyze_batch(self, *, limit: int = 10, correlation_id=None):
            return {
                "articles_found": 5,
                "articles_analyzed": 5,
                "articles_failed": 0,
                "failed_article_ids": None,
            }

    monkeypatch.setattr(admin, "get_bias_detection_service", lambda: DummyService())

    response = await admin.trigger_batch_bias_analysis(limit=5)

    assert response.success is True
    assert response.articles_found == 5
    assert response.articles_analyzed == 5
    assert response.articles_failed == 0
    assert response.failed_article_ids is None


@pytest.mark.asyncio
async def test_trigger_batch_bias_analysis_with_failures(monkeypatch):
    """Test batch bias analysis with some failures."""

    class DummyService:
        async def analyze_batch(self, *, limit: int = 10, correlation_id=None):
            return {
                "articles_found": 10,
                "articles_analyzed": 8,
                "articles_failed": 2,
                "failed_article_ids": [101, 102],
            }

    monkeypatch.setattr(admin, "get_bias_detection_service", lambda: DummyService())

    response = await admin.trigger_batch_bias_analysis(limit=10)

    assert response.success is False
    assert response.articles_found == 10
    assert response.articles_analyzed == 8
    assert response.articles_failed == 2
    assert response.failed_article_ids == [101, 102]


@pytest.mark.asyncio
async def test_trigger_batch_bias_analysis_invalid_limit():
    """Test batch bias analysis with invalid limit."""
    with pytest.raises(Exception) as exc_info:
        await admin.trigger_batch_bias_analysis(limit=0)

    assert exc_info.value.status_code == 400
    assert "limit must be between 1 and 50" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_trigger_batch_bias_analysis_limit_too_high():
    """Test batch bias analysis with limit too high."""
    with pytest.raises(Exception) as exc_info:
        await admin.trigger_batch_bias_analysis(limit=100)

    assert exc_info.value.status_code == 400
    assert "limit must be between 1 and 50" in str(exc_info.value.detail)
