"""Searching the web with a model that has a search engine (Zoek met AI, Story 14.10).

The voice search used to search Google News itself, fetch every page and let an LLM read them:
about a minute, and publishers behind a consent or pay wall (DPG, Mediahuis, BNR) gave no text.
A model with a search engine does this in one call. ``gemini-search[:model]`` is Gemini with
Google Search ("grounding"): it cites Google redirect links, which are resolved here to the
publisher's URL. Only links of the answer's own search results count; a link the model wrote
itself is dropped.

Chosen in ``llm_config`` (``provider_voice_web``): ``gemini-search[:model]``, or ``google-news``
for no search model (the voice search then searches Google News and reads the pages itself).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

import httpx

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.llm.providers import resolve_provider

logger = get_logger(__name__).bind(component="WebSearch")

GEMINI_SEARCH = "gemini-search"
GOOGLE_NEWS = "google-news"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Grounding links point here and redirect to the publisher
REDIRECT_HOST = "vertexaisearch.cloud.google.com"
RESOLVE_TIMEOUT = 10.0
RETRIES = 1
RETRY_DELAY = 2.0


class WebSearchError(RuntimeError):
    """The search model failed (limit, key, network, no answer): the caller falls back."""


@dataclass
class WebAnswer:
    text: str
    queries: list[str] = field(default_factory=list)
    # The links of the search results the answer rests on
    links: list[str] = field(default_factory=list)
    ms: int = 0
    usage: dict[str, Any] = field(default_factory=dict)


class WebSearch(Protocol):
    name: str

    async def search(self, prompt: str) -> WebAnswer: ...

    async def publisher_urls(self, answer: WebAnswer, cited: Sequence[str]) -> list[str | None]: ...


def same_url(url: str) -> str:
    parts = urlsplit(url.strip())
    host = parts.netloc.lower().removeprefix("www.")
    return urlunsplit((parts.scheme.lower(), host, parts.path.rstrip("/"), "", ""))


class GeminiWebSearch:
    """Gemini with Google Search: one call searches Google and reads what it finds."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_GEMINI_MODEL,
        timeout: float = 60.0,
        thinking_budget: int | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.thinking_budget = thinking_budget
        self._transport = transport
        self.name = f"{GEMINI_SEARCH}:{model}"

    def _client(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout, transport=self._transport)

    async def search(self, prompt: str) -> WebAnswer:
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
        }
        if self.thinking_budget is not None:
            body["generationConfig"] = {"thinkingConfig": {"thinkingBudget": self.thinking_budget}}
        started = time.monotonic()
        try:
            async with self._client(self.timeout) as http:
                for attempt in range(1 + RETRIES):
                    # The key in a header: a URL with ?key= ends up in the log
                    response = await http.post(
                        GEMINI_URL.format(model=self.model),
                        headers={"x-goog-api-key": self.api_key},
                        json=body,
                    )
                    # Overloaded (503) comes and goes; a limit (429) does not, and retries count
                    if response.status_code < 500 or attempt == RETRIES:
                        break
                    logger.info("web_search_retry", model=self.model, status=response.status_code)
                    await asyncio.sleep(RETRY_DELAY)
        except httpx.TimeoutException as exc:
            raise WebSearchError("Google zoeken duurde te lang") from exc
        except httpx.HTTPError as exc:
            raise WebSearchError(f"Google zoeken mislukte ({type(exc).__name__})") from exc
        if response.status_code == 429:
            raise WebSearchError("Gemini: limiet bereikt (429)")
        if response.status_code >= 400:
            raise WebSearchError(f"Gemini: HTTP {response.status_code}")
        try:
            data = response.json()
        except ValueError as exc:
            raise WebSearchError("Gemini gaf geen JSON") from exc
        candidates = data.get("candidates") or []
        if not candidates:
            raise WebSearchError("Gemini gaf geen antwoord")
        first = candidates[0]
        parts = (first.get("content") or {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts)
        if not text.strip():
            raise WebSearchError(f"Gemini gaf geen tekst ({first.get('finishReason')})")
        meta = first.get("groundingMetadata") or {}
        links = [
            (chunk.get("web") or {}).get("uri") or "" for chunk in meta.get("groundingChunks") or []
        ]
        return WebAnswer(
            text=text,
            queries=[str(q) for q in meta.get("webSearchQueries") or []],
            links=[link for link in links if link],
            ms=int((time.monotonic() - started) * 1000),
            usage=data.get("usageMetadata") or {},
        )

    async def publisher_urls(self, answer: WebAnswer, cited: Sequence[str]) -> list[str | None]:
        """The publisher's URL behind each cited link; None when it is not a search result.

        A grounding link resolves to the publisher (a link the model garbled does not resolve). A
        plain link counts only when one of the answer's grounding links resolves to it.
        """

        async with self._client(RESOLVE_TIMEOUT) as http:

            async def resolve(link: str) -> str | None:
                if urlsplit(link).netloc.lower() != REDIRECT_HOST:
                    return None
                try:
                    response = await http.get(link, follow_redirects=False)
                except httpx.HTTPError:
                    return None
                location = response.headers.get("location", "")
                return location if response.is_redirect and location.startswith("http") else None

            resolved = await asyncio.gather(*(resolve(link) for link in cited))
            plain = [link for link in cited if urlsplit(link).netloc.lower() != REDIRECT_HOST]
            grounded: dict[str, str] = {}
            if plain and answer.links:
                for url in await asyncio.gather(*(resolve(link) for link in answer.links)):
                    if url:
                        grounded[same_url(url)] = url
        urls: list[str | None] = []
        for link, url in zip(cited, resolved, strict=True):
            if url is None and link.startswith("http"):
                url = grounded.get(same_url(link))
            urls.append(url)
        return urls


async def web_search_for(
    key: str = "provider_voice_web", *, settings: Settings | None = None
) -> WebSearch | None:
    """The search model chosen in ``llm_config``; None for google-news (or without a Gemini key)."""

    settings = settings or get_settings()
    value = (await resolve_provider((key,), default=GEMINI_SEARCH) or GEMINI_SEARCH).strip().lower()
    name, _, model = value.partition(":")
    if name != GEMINI_SEARCH:
        return None
    if not settings.gemini_api_key:
        logger.warning("web_search_without_key", key=key, provider=value)
        return None
    return GeminiWebSearch(
        api_key=settings.gemini_api_key,
        model=model.strip() or DEFAULT_GEMINI_MODEL,
        timeout=settings.voice_search_web_timeout_seconds,
        thinking_budget=settings.voice_search_web_thinking_budget,
    )


__all__ = [
    "GEMINI_SEARCH",
    "GOOGLE_NEWS",
    "GeminiWebSearch",
    "WebAnswer",
    "WebSearch",
    "WebSearchError",
    "web_search_for",
]
