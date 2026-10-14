"""gemini-fast: Gemini without thinking for the voice search's plan and check (Story 14.10).

The API is stubbed with httpx.MockTransport.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest
from pydantic import BaseModel

from backend.app.llm import gemini_fast as gf
from backend.app.llm import providers
from backend.app.llm.client import LLMRateLimitError, LLMResponseError
from backend.app.llm.gemini_fast import GeminiFastClient


class Plan(BaseModel):
    kind: str = "generiek"
    terms: list[str] = []


@pytest.fixture(autouse=True)
def no_retry_delay(monkeypatch):
    monkeypatch.setattr(gf, "RETRY_DELAY", 0)


def client(handler, **extra) -> GeminiFastClient:
    return GeminiFastClient(
        settings=SimpleNamespace(gemini_api_key="k"),
        transport=httpx.MockTransport(handler),
        **extra,
    )


def answer(text: str) -> dict:
    return {
        "candidates": [
            {"content": {"parts": [{"text": "denkt", "thought": True}, {"text": text}]}}
        ],
        "usageMetadata": {
            "promptTokenCount": 300,
            "candidatesTokenCount": 40,
            "totalTokenCount": 340,
        },
    }


async def test_asks_json_without_thinking_with_the_key_in_a_header():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=answer('{"kind": "concreet", "terms": ["NSC"]}'))

    result = await client(handler).generate_json("plan", Plan)
    assert result.payload == Plan(kind="concreet", terms=["NSC"])
    # Gemini 2.5 takes a budget instead of a level
    await client(handler, model="gemini-2.5-flash").generate_json("plan", Plan)
    assert seen["body"]["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}
    await client(handler).generate_json("plan", Plan)
    assert result.model == "gemini-fast:gemini-3.5-flash"
    assert result.usage == {"prompt_tokens": 300, "completion_tokens": 40, "total_tokens": 340}
    assert seen["key"] == "k" and "key=" not in seen["url"]
    assert "models/gemini-3.5-flash:generateContent" in seen["url"]
    config = seen["body"]["generationConfig"]
    assert config["thinkingConfig"] == {"thinkingLevel": "minimal"}
    assert config["responseMimeType"] == "application/json"
    assert config["responseJsonSchema"]["properties"]["kind"]["type"] == "string"


async def test_an_overloaded_model_is_asked_once_more():
    statuses = iter([503, 200])

    def handler(_request: httpx.Request) -> httpx.Response:
        status = next(statuses)
        return httpx.Response(status, json=answer('{"kind": "context"}') if status == 200 else {})

    assert (await client(handler).generate_json("plan", Plan)).payload.kind == "context"


@pytest.mark.parametrize(
    ("status", "body", "error", "words"),
    [
        (429, {}, LLMRateLimitError, "429"),
        (500, {}, LLMResponseError, "HTTP 500"),
        (200, {"candidates": [{"finishReason": "SAFETY"}]}, LLMResponseError, "SAFETY"),
        (200, answer("Ik weet het niet."), LLMResponseError, "JSON"),
    ],
)
async def test_failures_raise_for_the_backup(status, body, error, words):
    calls = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(status, json=body)

    with pytest.raises(error, match=words):
        await client(handler).generate_json("plan", Plan)
    # A limit is not asked again; an overloaded or broken model once
    assert len(calls) == (2 if status >= 500 else 1)


async def test_the_provider_is_chosen_in_llm_config(monkeypatch):
    settings = SimpleNamespace(gemini_api_key="k", llm_provider="mistral")
    built = providers.build_llm_client("gemini-fast:gemini-3.1-flash-lite", settings)
    assert isinstance(built, GeminiFastClient) and built.model == "gemini-3.1-flash-lite"
    assert providers.build_llm_client("gemini-fast", settings).model == "gemini-3.5-flash"

    async def resolve(_keys, *, default):
        return "gemini-fast"

    monkeypatch.setattr(providers, "resolve_provider", resolve)
    step = providers.StepLLMClient("provider_voice_search", settings=settings)
    assert await step.resolved() == "gemini-fast"
    assert isinstance(await step.client(), GeminiFastClient)
