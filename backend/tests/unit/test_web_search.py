"""Zoek met AI (Story 14.10): the search model (Gemini with Google Search), with Google stubbed."""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest

from backend.app.llm import web_search as ws
from backend.app.llm.web_search import GeminiWebSearch, WebAnswer, WebSearchError

REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/"


@pytest.fixture(autouse=True)
def no_retry_delay(monkeypatch):
    monkeypatch.setattr(ws, "RETRY_DELAY", 0)


def gemini(handler, **extra) -> GeminiWebSearch:
    return GeminiWebSearch(api_key="k", transport=httpx.MockTransport(handler), **extra)


def answer(text: str, **metadata) -> dict:
    return {
        "candidates": [{"content": {"parts": [{"text": text}]}, "groundingMetadata": metadata}],
        "usageMetadata": {"promptTokenCount": 534, "thoughtsTokenCount": 2691},
    }


async def test_search_asks_gemini_with_google_search():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json=answer(
                '{"results": []}',
                webSearchQueries=["NSC bestuur reactie Gotink"],
                groundingChunks=[{"web": {"uri": REDIRECT + "x", "title": "nieuws.nl"}}],
            ),
        )

    result = await gemini(handler).search("zoek")
    assert result.text == '{"results": []}'
    assert result.queries == ["NSC bestuur reactie Gotink"]
    assert result.links == [REDIRECT + "x"]
    assert result.usage["thoughtsTokenCount"] == 2691
    assert "models/gemini-2.5-flash:generateContent" in seen["url"]
    # The key in a header, never in the URL (httpx logs URLs)
    assert seen["key"] == "k" and "key=" not in seen["url"]
    assert seen["body"]["tools"] == [{"google_search": {}}]
    assert "generationConfig" not in seen["body"]

    await gemini(handler, thinking_budget=512).search("zoek")
    assert seen["body"]["generationConfig"] == {"thinkingConfig": {"thinkingBudget": 512}}


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(429, json={}), "429"),
        (httpx.Response(500, json={}), "HTTP 500"),
        (httpx.Response(200, json={"candidates": []}), "geen antwoord"),
        (httpx.Response(200, json=answer("")), "geen tekst"),
        (httpx.Response(200, text="<html>"), "geen JSON"),
    ],
)
async def test_search_failures_are_web_search_errors(response, message):
    with pytest.raises(WebSearchError, match=message):
        await gemini(lambda _request: response).search("zoek")


async def test_an_overloaded_model_is_asked_once_more():
    responses = [httpx.Response(503, json={}), httpx.Response(200, json=answer('{"results": []}'))]
    calls: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return responses.pop(0)

    result = await gemini(handler).search("zoek")
    assert result.text == '{"results": []}' and len(calls) == 2

    calls.clear()
    with pytest.raises(WebSearchError, match="429"):
        await gemini(lambda _request: calls.append(1) or httpx.Response(429, json={})).search(
            "zoek"
        )
    assert len(calls) == 1  # a limit is not retried: retries count toward it


async def test_a_timeout_is_a_web_search_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("te traag", request=request)

    with pytest.raises(WebSearchError, match="te lang"):
        await gemini(handler).search("zoek")


async def test_only_links_of_the_search_results_count():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/good"):
            return httpx.Response(302, headers={"location": "https://www.trouw.nl/a"})
        if request.url.path.endswith("/chunk"):
            return httpx.Response(302, headers={"location": "https://www.ad.nl/b"})
        return httpx.Response(404)

    search = gemini(handler)
    result = WebAnswer(text="", links=[REDIRECT + "chunk"])
    urls = await search.publisher_urls(
        result,
        [
            REDIRECT + "good",
            REDIRECT + "garbled",  # the model mangled the link: it does not resolve
            "https://ad.nl/b/",  # a plain link that is one of the search results
            "https://www.made-up.nl/c",  # a plain link that is not
            "geen link",
        ],
    )
    assert urls == ["https://www.trouw.nl/a", None, "https://www.ad.nl/b", None, None]


async def test_the_search_model_is_chosen_in_llm_config(monkeypatch):
    settings = SimpleNamespace(
        gemini_api_key="k",
        voice_search_web_timeout_seconds=30.0,
        voice_search_web_thinking_budget=None,
    )

    def choose(value: str | None) -> None:
        async def resolve(_keys, *, default):
            return value or default

        monkeypatch.setattr(ws, "resolve_provider", resolve)

    choose(None)
    web = await ws.web_search_for(settings=settings)
    assert web is not None and web.name == "gemini-search:gemini-2.5-flash"
    assert web.timeout == 30.0
    choose("gemini-search:gemini-3-flash-preview")
    web = await ws.web_search_for(settings=settings)
    assert web is not None and web.model == "gemini-3-flash-preview"
    choose("google-news")
    assert await ws.web_search_for(settings=settings) is None
    choose(None)
    assert await ws.web_search_for(settings=SimpleNamespace(gemini_api_key=None)) is None
