"""What every LLM call used, for "AI-gebruik" on the admin dashboard.

The clients note each call here (``note_llm_call``): provider, model, tokens and the pipeline step.
This module only keeps them in memory; the job "LLM Usage" writes them to the local database
(``backend/app/services/llm_usage.py``), so a test or script that calls an LLM writes nothing.

The step comes from the caller: ``with llm_step("factual"): ...``. ``StepLLMClient`` sets its own
(``provider_classification`` → ``classification``).

Claude Code reports the subscription's limits with every call (the ``rate_limit_event`` of
``--output-format stream-json``): how much of the 5-hour window and of the week is used and when
each resets. That is the whole subscription, the owner's own Claude Code sessions too.
"""

from __future__ import annotations

import contextvars
from collections import deque
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from backend.app.core.logging import get_logger

logger = get_logger(__name__).bind(component="LLMUsage")

# Calls not written yet; the oldest go when the job does not run (a script, a stopped database)
MAX_PENDING = 5000

_STEP: contextvars.ContextVar[str | None] = contextvars.ContextVar("llm_step", default=None)
_pending: deque[dict[str, Any]] = deque(maxlen=MAX_PENDING)
_limits: dict[str, Any] | None = None


@contextmanager
def llm_step(step: str) -> Iterator[None]:
    """The pipeline step the LLM calls inside this block are counted under."""

    token = _STEP.set(step)
    try:
        yield
    finally:
        _STEP.reset(token)


def _count(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def token_counts(usage: Mapping[str, Any] | None) -> dict[str, int]:
    """Input (not from a cache), output, cache-read and cache-write tokens of a provider's usage.

    Claude's ``input_tokens`` leaves the cache out. Mistral, DeepSeek and Gemini count cached
    tokens inside the prompt: they move to cache read. Gemini's thinking counts as output.
    """

    usage = usage or {}
    if "input_tokens" in usage or "cache_read_input_tokens" in usage:
        return {
            "input_tokens": _count(usage.get("input_tokens")),
            "output_tokens": _count(usage.get("output_tokens")),
            "cache_read_tokens": _count(usage.get("cache_read_input_tokens")),
            "cache_write_tokens": _count(usage.get("cache_creation_input_tokens")),
        }
    if "promptTokenCount" in usage or "candidatesTokenCount" in usage:
        cached = _count(usage.get("cachedContentTokenCount"))
        prompt = _count(usage.get("promptTokenCount")) + _count(
            usage.get("toolUsePromptTokenCount")
        )
        return {
            "input_tokens": max(0, prompt - cached),
            "output_tokens": _count(usage.get("candidatesTokenCount"))
            + _count(usage.get("thoughtsTokenCount")),
            "cache_read_tokens": cached,
            "cache_write_tokens": 0,
        }
    details = usage.get("prompt_tokens_details")
    cached = _count(usage.get("prompt_cache_hit_tokens")) or (
        _count(details.get("cached_tokens")) if isinstance(details, Mapping) else 0
    )
    return {
        "input_tokens": max(0, _count(usage.get("prompt_tokens")) - cached),
        "output_tokens": _count(usage.get("completion_tokens")),
        "cache_read_tokens": cached,
        "cache_write_tokens": 0,
    }


def note_llm_call(
    *,
    provider: str,
    model: str | None,
    usage: Mapping[str, Any] | None = None,
    step: str | None = None,
    ok: bool = True,
    cost_usd: float | None = None,
    duration_ms: int | None = None,
    rate_limit: Mapping[str, Any] | None = None,
) -> None:
    """Note one call (never raises: counting must not break the call itself)."""

    global _limits
    try:
        now = datetime.now(timezone.utc)
        _pending.append(
            {
                "created_at": now,
                "provider": provider[:32],
                "model": (model or provider)[:80],
                "step": (step or _STEP.get() or "")[:40] or None,
                "ok": ok,
                **token_counts(usage),
                "cost_usd": float(cost_usd) if isinstance(cost_usd, (int, float)) else None,
                "duration_ms": _count(duration_ms) if duration_ms is not None else None,
                "rate_limit": dict(rate_limit) if rate_limit else None,
            }
        )
        if rate_limit:
            _limits = {"at": now, "info": dict(rate_limit)}
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("llm_usage_note_failed", error=str(exc))


def take_pending() -> list[dict[str, Any]]:
    """The calls noted since the last take (and forget them here)."""

    rows = list(_pending)
    _pending.clear()
    return rows


def give_back(rows: list[dict[str, Any]]) -> None:
    """Calls that could not be written: before the ones noted since (the oldest go when full)."""

    newer = list(_pending)
    _pending.clear()
    _pending.extend(rows)
    _pending.extend(newer)


def latest_limits() -> dict[str, Any] | None:
    """The newest limits Claude Code reported here: ``{"at": datetime, "info": {...}}``."""

    return _limits


__all__ = [
    "give_back",
    "latest_limits",
    "llm_step",
    "note_llm_call",
    "take_pending",
    "token_counts",
]
