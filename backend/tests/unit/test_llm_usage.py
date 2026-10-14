"""AI-gebruik in Beheer: every LLM call noted with its tokens and step, written to the local
database and summarised with the Claude subscription's limits."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.core.config import get_settings
from backend.app.db.models import Base
from backend.app.llm import usage
from backend.app.llm.client import BaseLLMClient, LLMResponse
from backend.app.llm.providers import StepLLMClient
from backend.app.llm.usage import llm_step, note_llm_call, take_pending, token_counts
from backend.app.services.llm_usage import LlmUsageService, claude_windows


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    take_pending()
    monkeypatch.setattr(usage, "_limits", None)
    yield
    take_pending()


async def database():
    """An in-memory SQLite database with the tables."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False)


def limits(now: datetime, *, five_hour: float = 0.24, status: str = "allowed") -> dict:
    """Claude Code's rate_limit_info: the 5-hour window resets in 2 hours, the week in 3 days."""
    five = int((now + timedelta(hours=2)).timestamp())
    week = int((now + timedelta(days=3)).timestamp())
    return {
        "status": status,
        "resetsAt": five,
        "rateLimitType": "five_hour",
        "isUsingOverage": False,
        "unifiedWindows": {
            "five_hour": {"utilization": five_hour, "resetsAt": five},
            "seven_day": {"utilization": 0.4, "resetsAt": week},
        },
    }


def test_tokens_of_every_provider_counted_the_same_way():
    # Claude leaves the cache out of input_tokens
    assert token_counts(
        {
            "input_tokens": 2,
            "output_tokens": 4,
            "cache_read_input_tokens": 535,
            "cache_creation_input_tokens": 3003,
        }
    ) == {
        "input_tokens": 2,
        "output_tokens": 4,
        "cache_read_tokens": 535,
        "cache_write_tokens": 3003,
    }
    # Gemini counts the cache inside the prompt; thinking is output; the search tool's prompt is input
    assert token_counts(
        {
            "promptTokenCount": 100,
            "cachedContentTokenCount": 30,
            "toolUsePromptTokenCount": 10,
            "candidatesTokenCount": 20,
            "thoughtsTokenCount": 5,
        }
    ) == {"input_tokens": 80, "output_tokens": 25, "cache_read_tokens": 30, "cache_write_tokens": 0}
    # Mistral / DeepSeek
    assert token_counts(
        {"prompt_tokens": 50, "completion_tokens": 3, "prompt_cache_hit_tokens": 20}
    ) == {"input_tokens": 30, "output_tokens": 3, "cache_read_tokens": 20, "cache_write_tokens": 0}
    assert token_counts(None) == {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
    }


class Noting(BaseLLMClient):
    provider = "fake"

    async def generate_text(
        self, prompt, *, temperature=None, max_tokens=None, correlation_id=None
    ):
        note_llm_call(provider="fake", model="fake-1", usage={"prompt_tokens": 7})
        return LLMResponse(provider="fake", model="fake-1", content="ok")


async def test_a_step_client_counts_its_calls_under_its_step(monkeypatch):
    classify = StepLLMClient("provider_classification", settings=get_settings())
    backup = StepLLMClient("provider_factual", fallback_keys=(), step="voice_search")

    async def client(self):
        return Noting()

    monkeypatch.setattr(StepLLMClient, "client", client)
    await classify.generate_text("x")
    await backup.generate_text("x")
    with llm_step("bias"):
        note_llm_call(provider="fake", model="fake-1")
    note_llm_call(provider="fake", model="fake-1")

    assert [call["step"] for call in take_pending()] == [
        "classification",
        "voice_search",
        "bias",
        None,
    ]


async def test_summary_of_the_app_and_the_subscription():
    sessions = await database()
    now = datetime.now(timezone.utc)
    info = limits(now)
    note_llm_call(
        provider="claude-code",
        model="claude-haiku-5-5",
        step="factual",
        cost_usd=0.01,
        usage={"input_tokens": 100, "output_tokens": 50, "cache_read_input_tokens": 1000},
        rate_limit=info,
    )
    note_llm_call(
        provider="claude-code",
        model="claude-haiku-5-5",
        step="critical",
        cost_usd=0.02,
        usage={"input_tokens": 200, "output_tokens": 80},
        rate_limit=info,
    )
    note_llm_call(
        provider="mistral",
        model="mistral-small-latest",
        step="classification",
        usage={"prompt_tokens": 300, "completion_tokens": 2},
    )
    note_llm_call(
        provider="gemini-fast",
        model="gemini-3.5-flash",
        step="voice_search",
        usage={"promptTokenCount": 40, "candidatesTokenCount": 10},
    )
    note_llm_call(provider="gemini-search", model="gemini-3.5-flash", step="voice_web", ok=False)
    service = LlmUsageService(session_factory=sessions, settings=get_settings())

    summary = await service.summary(now=now)

    claude = summary["claude"]
    assert claude["status"] == "allowed"
    five, week = claude["windows"]
    assert (five["key"], five["utilization"], five["expired"]) == ("five_hour", 0.24, False)
    assert five["started_at"] == five["resets_at"] - timedelta(hours=5)
    assert (week["key"], week["utilization"]) == ("seven_day", 0.4)

    window, today, seven_days = summary["periods"]
    assert [p["key"] for p in summary["periods"]] == ["five_hour", "today", "seven_day"]
    assert window["subscription_window"] is True and window["since"] == five["started_at"]
    assert seven_days["since"] == week["started_at"]
    totals = window["totals"]
    assert (totals["calls"], totals["failed"]) == (5, 1)
    assert totals["input_tokens"] == 100 + 200 + 300 + 40
    assert totals["cache_read_tokens"] == 1000
    assert totals["cost_usd"] == pytest.approx(0.03)
    claude_model = next(m for m in window["models"] if m["provider"] == "claude-code")
    assert (claude_model["model"], claude_model["calls"]) == ("claude-haiku-5-5", 2)
    assert claude_model["tokens"] == 100 + 50 + 1000 + 200 + 80
    mistral = next(m for m in window["models"] if m["provider"] == "mistral")
    assert mistral["cost_usd"] is None
    assert window["steps"][0]["step"] == "factual"  # the most tokens first
    assert {s["step"] for s in window["steps"]} == {
        "factual",
        "critical",
        "classification",
        "voice_search",
        "voice_web",
    }

    # The free tier counts requests per model, whichever route asked; a 429 is not a request
    gemini = summary["gemini"]
    assert gemini["limit"] == get_settings().gemini_free_daily_requests
    assert gemini["models"] == [{"model": "gemini-3.5-flash", "requests": 1, "limited": True}]
    assert gemini["resets_at"] > now


async def test_after_a_restart_the_newest_stored_limits_count(monkeypatch):
    sessions = await database()
    now = datetime.now(timezone.utc)
    note_llm_call(
        provider="claude-code", model="claude-haiku-5-5", rate_limit=limits(now, five_hour=0.1)
    )
    note_llm_call(
        provider="claude-code", model="claude-haiku-5-5", rate_limit=limits(now, five_hour=0.3)
    )
    note_llm_call(provider="mistral", model="mistral-small-latest")
    service = LlmUsageService(session_factory=sessions, settings=get_settings())
    assert await service.flush() == 3
    monkeypatch.setattr(usage, "_limits", None)

    summary = await service.summary(now=now)

    assert summary["claude"]["windows"][0]["utilization"] == 0.3


async def test_without_a_measurement_the_periods_are_the_last_hours():
    sessions = await database()
    now = datetime.now(timezone.utc)
    service = LlmUsageService(session_factory=sessions, settings=get_settings())

    summary = await service.summary(now=now)

    assert summary["claude"] is None
    window = summary["periods"][0]
    assert window["subscription_window"] is False
    assert window["since"] == now - timedelta(hours=5)
    assert window["totals"]["calls"] == 0 and window["totals"]["cost_usd"] is None


def test_a_window_that_reset_since_the_measurement_is_expired():
    measured = datetime.now(timezone.utc) - timedelta(hours=6)
    claude = claude_windows({"at": measured, "info": limits(measured)}, datetime.now(timezone.utc))
    five, week = claude["windows"]
    assert five["expired"] is True and week["expired"] is False


async def test_calls_stay_noted_when_the_database_cannot_take_them():
    def broken():
        raise RuntimeError("database down")

    note_llm_call(provider="mistral", model="mistral-small-latest")
    service = LlmUsageService(session_factory=broken, settings=get_settings())
    with pytest.raises(RuntimeError):
        await service.flush()
    note_llm_call(provider="mistral", model="mistral-large-latest")

    assert [call["model"] for call in take_pending()] == [
        "mistral-small-latest",
        "mistral-large-latest",
    ]
