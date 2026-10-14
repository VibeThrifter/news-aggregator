"""Gemini over REST without thinking, for short judgments (``gemini-fast[:model]``).

The voice search (Zoek met AI) plans and checks with an LLM while the admin waits. Through Claude
Code a call took 3-6 s, and it waited for a slot behind the news pipeline: the two calls of one
search took 35 s on 2026-10-08. Gemini Flash with minimal thinking answers in 1-3 s, with the same
verdicts as Sonnet in the test of that night (searches 3 and 5).

The default is ``gemini-3.5-flash``: the free tier counts requests per model and day (20 for
``gemini-2.5-flash``, which the voice search's Google search uses), so a model of its own keeps
that search's quota whole. Gemini 3 takes a thinking level, 2.5 a thinking budget.

The key goes in a header, so it never shows in a logged URL.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, TypeVar

import httpx
from pydantic import ValidationError

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.llm.client import (
    BaseLLMClient,
    LLMAuthenticationError,
    LLMGenericResult,
    LLMRateLimitError,
    LLMResponse,
    LLMResponseError,
    LLMResult,
    LLMTimeoutError,
    _strip_markdown_fences,
)
from backend.app.llm.schemas import InsightsPayload
from backend.app.llm.usage import note_llm_call

logger = get_logger(__name__).bind(component="GeminiFastClient")

GEMINI_FAST = "gemini-fast"
DEFAULT_MODEL = "gemini-3.5-flash"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT_SECONDS = 30.0
# Overloaded (503) comes and goes; one quick retry, then the caller's backup
RETRIES = 1
RETRY_DELAY = 1.0

T = TypeVar("T")


def is_gemini_fast(provider: str | None) -> bool:
    name = (provider or "").strip().lower()
    return name == GEMINI_FAST or name.startswith(f"{GEMINI_FAST}:")


def fast_model(provider: str | None) -> str:
    """``gemini-fast:gemini-3.5-flash`` → ``gemini-3.5-flash``; ``gemini-fast`` → the default."""

    _, _, model = (provider or "").partition(":")
    return model.strip() or DEFAULT_MODEL


class GeminiFastClient(BaseLLMClient):
    """Gemini's generateContent with thinking off: JSON answers in a second or two."""

    provider = GEMINI_FAST

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        model: str | None = None,
        timeout: float = TIMEOUT_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.model = model or DEFAULT_MODEL
        self.timeout = timeout
        self._transport = transport

    @property
    def model_name(self) -> str:
        return f"{GEMINI_FAST}:{self.model}"

    @property
    def thinking(self) -> dict[str, Any]:
        """As little thinking as the model allows (Gemini 3 rejects a budget of 0)."""

        if self.model.startswith("gemini-2"):
            return {"thinkingBudget": 0}
        return {"thinkingLevel": "minimal"}

    async def _call(
        self, prompt: str, config: dict[str, Any], *, correlation_id: str | None
    ) -> tuple[str, dict[str, Any] | None]:
        key = self.settings.gemini_api_key
        if not key:
            raise LLMAuthenticationError(
                "Gemini API key ontbreekt; configureer GEMINI_API_KEY in .env"
            )
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {**config, "thinkingConfig": self.thinking},
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as http:
                for attempt in range(1 + RETRIES):
                    response = await http.post(
                        GEMINI_URL.format(model=self.model),
                        headers={"x-goog-api-key": key},
                        json=body,
                    )
                    if response.status_code < 500 or attempt == RETRIES:
                        break
                    logger.info("gemini_fast_retry", model=self.model, status=response.status_code)
                    await asyncio.sleep(RETRY_DELAY)
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(
                f"Gemini antwoordde niet binnen {self.timeout:.0f} seconden"
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMResponseError(f"Gemini: {type(exc).__name__}", retryable=True) from exc
        status = response.status_code
        if status == 429:
            # Counted too: the free tier's daily limit shows on the admin dashboard
            note_llm_call(provider=GEMINI_FAST, model=self.model, ok=False)
            raise LLMRateLimitError("Gemini: limiet bereikt (429)", provider=GEMINI_FAST)
        if status in (401, 403):
            raise LLMAuthenticationError(f"Gemini weigert de sleutel ({status})")
        if status >= 400:
            raise LLMResponseError(f"Gemini: HTTP {status}", retryable=status >= 500)
        try:
            data = response.json()
        except ValueError as exc:
            raise LLMResponseError("Gemini gaf geen JSON", retryable=True) from exc
        first = (data.get("candidates") or [{}])[0]
        parts = (first.get("content") or {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
        if not text.strip():
            raise LLMResponseError(
                f"Gemini gaf geen tekst ({first.get('finishReason')})", retryable=True
            )
        meta = data.get("usageMetadata") or {}
        usage = {
            "prompt_tokens": meta.get("promptTokenCount"),
            "completion_tokens": meta.get("candidatesTokenCount"),
            "total_tokens": meta.get("totalTokenCount"),
        }
        duration_ms = int((time.monotonic() - started) * 1000)
        note_llm_call(provider=GEMINI_FAST, model=self.model, usage=meta, duration_ms=duration_ms)
        logger.info(
            "llm_call_succeeded",
            provider=GEMINI_FAST,
            model=self.model_name,
            duration_ms=duration_ms,
            prompt_length=len(prompt),
            correlation_id=correlation_id,
        )
        return text, usage

    async def generate_json(
        self,
        prompt: str,
        schema_class: type[T],
        *,
        correlation_id: str | None = None,
    ) -> LLMGenericResult:
        schema = schema_class.model_json_schema()  # type: ignore[attr-defined]
        text, usage = await self._call(
            prompt,
            {"responseMimeType": "application/json", "responseJsonSchema": schema},
            correlation_id=correlation_id,
        )
        content = _strip_markdown_fences(text)
        try:
            payload = schema_class.model_validate_json(content)  # type: ignore[attr-defined]
        except (ValidationError, json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(
                f"JSON van Gemini klopt niet: {str(exc)[:200]}", retryable=True
            ) from exc
        return LLMGenericResult(
            provider=GEMINI_FAST,
            model=self.model_name,
            payload=payload,
            raw_content=content,
            usage=usage,
        )

    async def generate_text(
        self,
        prompt: str,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        correlation_id: str | None = None,
    ) -> LLMResponse:
        config: dict[str, Any] = {}
        if temperature is not None:
            config["temperature"] = temperature
        if max_tokens:
            config["maxOutputTokens"] = max_tokens
        text, usage = await self._call(prompt, config, correlation_id=correlation_id)
        return LLMResponse(provider=GEMINI_FAST, model=self.model_name, content=text, usage=usage)

    async def generate(self, prompt: str, *, correlation_id: str | None = None) -> LLMResult:
        result = await self.generate_json(prompt, InsightsPayload, correlation_id=correlation_id)
        return LLMResult(
            provider=GEMINI_FAST,
            model=self.model_name,
            payload=result.payload,
            raw_content=result.raw_content,
            usage=result.usage,
        )


__all__ = ["DEFAULT_MODEL", "GEMINI_FAST", "GeminiFastClient", "fast_model", "is_gemini_fast"]
