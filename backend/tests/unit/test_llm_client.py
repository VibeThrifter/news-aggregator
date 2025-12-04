from __future__ import annotations

import json

import httpx
import pytest

from backend.app.core.config import Settings
from backend.app.llm.client import (
    LLMAuthenticationError,
    LLMResponseError,
    LLMResult,
    LLMTimeoutError,
    MistralClient,
)


@pytest.mark.asyncio
async def test_mistral_client_success_parses_payload() -> None:
    payload = {
        "summary": "Dit is een uitgebreide samenvatting van het nieuws over het protest. " * 10,
        "timeline": [
            {
                "time": "2024-02-12T10:00:00+00:00",
                "headline": "Politie grijpt in bij protest",
                "sources": ["https://example.com/a"],
                "spectrum": "mainstream",
            }
        ],
        "clusters": [
            {
                "label": "Neutraal-feitelijk",
                "spectrum": "mainstream",
                "source_types": ["public_broadcaster"],
                "summary": "NOS en RTL leggen nadruk op geweldloos verloop.",
                "sources": [
                    {
                        "title": "Liveblog protest",
                        "url": "https://example.com/a",
                        "spectrum": "mainstream",
                        "stance": "beschrijvend",
                    }
                ],
            }
        ],
        "contradictions": [],
        "fallacies": [],
        "frames": [
            {
                "frame_type": "conflict",
                "technique": "",
                "description": "Het conflict frame benadrukt de spanning tussen demonstranten en politie.",
                "sources": ["https://example.com/a"],
                "spectrum": "mainstream",
            }
        ],
        "coverage_gaps": [],
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-key"
        body = json.loads(request.content.decode())
        assert body["model"] == "mistral-small-latest"
        return httpx.Response(
            200,
            json={
                "model": "mistral-small-latest",
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(payload),
                        }
                    }
                ],
                "usage": {"prompt_tokens": 123, "completion_tokens": 42},
            },
        )

    settings = Settings(
        mistral_api_key="test-key",
        llm_model_name="mistral-small-latest",
        llm_api_base_url="https://test.mistral.ai/v1",
        llm_api_timeout_seconds=10,
        llm_api_max_retries=0,
    )
    client = MistralClient(settings=settings, transport=httpx.MockTransport(handler))

    result = await client.generate("prompt")
    assert isinstance(result, LLMResult)
    assert result.provider == "mistral"
    assert result.model == "mistral-small-latest"
    assert result.payload.timeline[0].headline == "Politie grijpt in bij protest"
    assert str(result.payload.clusters[0].sources[0].url) == "https://example.com/a"
    assert result.usage == {"prompt_tokens": 123, "completion_tokens": 42}


@pytest.mark.asyncio
async def test_mistral_client_raises_on_invalid_json() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "model": "mistral-small-latest",
                "choices": [
                    {
                        "message": {
                            "content": "{invalid-json",
                        }
                    }
                ],
            },
        )

    settings = Settings(mistral_api_key="test-key", llm_api_max_retries=0)
    client = MistralClient(settings=settings, transport=httpx.MockTransport(handler))

    with pytest.raises(LLMResponseError):
        await client.generate("prompt")


@pytest.mark.asyncio
async def test_mistral_client_handles_timeouts() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timeout", request=request)

    settings = Settings(
        mistral_api_key="test-key",
        llm_api_timeout_seconds=1,
        llm_api_max_retries=1,
        llm_api_retry_backoff_seconds=0,
    )
    client = MistralClient(settings=settings, transport=httpx.MockTransport(handler))

    with pytest.raises(LLMTimeoutError):
        await client.generate("prompt")


@pytest.mark.asyncio
async def test_mistral_client_raises_on_missing_key() -> None:
    client = MistralClient(settings=Settings(mistral_api_key=None))
    with pytest.raises(LLMAuthenticationError):
        await client.generate("prompt")
