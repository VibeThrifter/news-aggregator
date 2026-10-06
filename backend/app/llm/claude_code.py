"""Claude Code as an LLM provider: the ``claude`` command on this machine, not an API key.

Owner's request (2026-10-03): let Claude Code do the AI work instead of DeepSeek, selectable per
pipeline step. Every call starts ``claude -p`` with the prompt on stdin and reads the JSON result
(``--output-format json``). The call uses the login of the user running the backend (their Claude
subscription): ``ANTHROPIC_API_KEY`` is removed from its environment.

- No tools, no MCP servers, no settings or project context (``CLAUDE.md``): it runs in its own
  empty working directory with its own system prompt, so it only answers the prompt.
- Structured answers: the Pydantic schema is passed as ``--json-schema``; the validated
  ``structured_output`` is used, else the text answer is parsed like the other providers do.
- Selectable in ``llm_config`` per step: ``claude-code`` (the model of the CLI or
  ``CLAUDE_CODE_MODEL``) or ``claude-code:<model>`` (``haiku``, ``sonnet``, ``opus`` or a full id).
- At most ``CLAUDE_CODE_MAX_PARALLEL`` calls run at once; each has ``CLAUDE_CODE_TIMEOUT_SECONDS``.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Any, TypeVar

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.llm.client import (
    BaseLLMClient,
    LLMAuthenticationError,
    LLMGenericResult,
    LLMQuotaExhaustedError,
    LLMResponse,
    LLMResponseError,
    LLMResult,
    LLMTimeoutError,
    _normalize_spectrum_values,
    _strip_markdown_fences,
)
from backend.app.llm.schemas import InsightsPayload

logger = get_logger(__name__).bind(component="ClaudeCodeClient")

T = TypeVar("T")

PROVIDER = "claude-code"
SYSTEM_PROMPT = (
    "Je bent een pluriformiteitsanalist die Nederlandstalige nieuwsgebeurtenissen objectief duidt. "
    "Je beantwoordt alleen de opdracht in het bericht, zonder vragen terug en zonder tools."
)
JSON_ONLY = "\n\nAntwoord uitsluitend met één JSON-object, zonder uitleg en zonder codeblok."
# Errors in the answer that mean the subscription limit is reached for now
LIMIT_WORDS = ("usage limit", "rate limit", "limit reached", "too many requests", "overloaded")

# One semaphore per process: at most N claude processes at the same time
_SLOTS: asyncio.Semaphore | None = None
_SLOTS_SIZE = 0


def provider_model(provider: str | None) -> str | None:
    """``claude-code:sonnet`` → ``sonnet``; ``claude-code`` → None (the default model)."""

    if not provider or ":" not in provider:
        return None
    model = provider.split(":", 1)[1].strip()
    return model or None


def is_claude_code(provider: str | None) -> bool:
    name = (provider or "").strip().lower()
    return name in ("claude", "claude-code", "claude_code") or name.startswith(
        ("claude-code:", "claude_code:")
    )


def _slots(size: int) -> asyncio.Semaphore:
    global _SLOTS, _SLOTS_SIZE
    if _SLOTS is None or _SLOTS_SIZE != size:
        _SLOTS, _SLOTS_SIZE = asyncio.Semaphore(max(1, size)), size
    return _SLOTS


def _workdir() -> Path:
    """An empty directory: no CLAUDE.md or project settings to pick up."""

    path = Path(tempfile.gettempdir()) / "pluriformiteit-claude-code"
    path.mkdir(parents=True, exist_ok=True)
    return path


class ClaudeCodeClient(BaseLLMClient):
    """Runs prompts through the local Claude Code CLI (``claude -p``)."""

    provider = PROVIDER

    def __init__(self, *, settings: Settings | None = None, model: str | None = None) -> None:
        self.settings = settings or get_settings()
        self.model = model or self.settings.claude_code_model or None

    @property
    def model_name(self) -> str:
        return f"claude-code:{self.model}" if self.model else "claude-code"

    def _command(self, schema: dict[str, Any] | None) -> list[str]:
        command = [
            self.settings.claude_code_bin,
            "-p",
            "--output-format",
            "json",
            "--tools",
            "",
            "--strict-mcp-config",
            "--setting-sources",
            "",
            "--no-session-persistence",
            "--system-prompt",
            SYSTEM_PROMPT,
        ]
        if self.model:
            command += ["--model", self.model]
        if schema is not None:
            command += ["--json-schema", json.dumps(schema, ensure_ascii=False)]
        return command

    async def _run(
        self, prompt: str, *, schema: dict[str, Any] | None, correlation_id: str | None
    ) -> dict[str, Any]:
        """Start ``claude -p`` and return its JSON result envelope."""

        env = {key: value for key, value in os.environ.items() if key != "ANTHROPIC_API_KEY"}
        timeout = self.settings.claude_code_timeout_seconds
        async with _slots(self.settings.claude_code_max_parallel):
            try:
                process = await asyncio.create_subprocess_exec(
                    *self._command(schema),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(_workdir()),
                    env=env,
                )
            except FileNotFoundError as exc:
                command = self.settings.claude_code_bin
                raise LLMAuthenticationError(
                    f"Claude Code niet gevonden ({command}); installeer het of zet CLAUDE_CODE_BIN"
                ) from exc
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(prompt.encode("utf-8")), timeout=timeout
                )
            except asyncio.TimeoutError as exc:
                process.kill()
                await process.wait()
                raise LLMTimeoutError(
                    f"Claude Code antwoordde niet binnen {timeout} seconden"
                ) from exc

        text = stdout.decode("utf-8", errors="replace").strip()
        try:
            envelope = json.loads(text) if text else {}
        except json.JSONDecodeError:
            envelope = {}
        message = str(envelope.get("result") or stderr.decode("utf-8", errors="replace") or text)[
            :300
        ]
        if process.returncode != 0 or envelope.get("is_error") or not envelope:
            lowered = message.lower()
            if any(word in lowered for word in LIMIT_WORDS):
                raise LLMQuotaExhaustedError(f"Claude Code: {message}", provider=PROVIDER)
            if "login" in lowered or "authenticat" in lowered or "api key" in lowered:
                raise LLMAuthenticationError(f"Claude Code is niet ingelogd: {message}")
            raise LLMResponseError(f"Claude Code faalde: {message}", retryable=True)
        logger.info(
            "llm_call_succeeded",
            provider=PROVIDER,
            model=self.model_name,
            duration_ms=envelope.get("duration_ms"),
            prompt_length=len(prompt),
            correlation_id=correlation_id,
        )
        return envelope

    async def _json(
        self, prompt: str, schema_class: type[T], *, correlation_id: str | None
    ) -> tuple[T, str, dict[str, Any]]:
        """Run with the schema; one retry for a provider hiccup or an answer that does not fit."""

        schema: dict[str, Any] | None = schema_class.model_json_schema()  # type: ignore[attr-defined]
        last: Exception | None = None
        for attempt in (1, 2):
            try:
                envelope = await self._run(
                    prompt + JSON_ONLY, schema=schema, correlation_id=correlation_id
                )
            except LLMResponseError as exc:
                last = exc
                # The schema itself may be what the CLI rejects: the second try goes without it
                schema = None
                continue
            structured = envelope.get("structured_output")
            raw = (
                json.dumps(structured, ensure_ascii=False)
                if structured is not None
                else str(envelope.get("result") or "")
            )
            content = _normalize_spectrum_values(_strip_markdown_fences(raw))
            try:
                return schema_class.model_validate_json(content), content, envelope  # type: ignore[attr-defined]
            except Exception as exc:
                logger.warning(
                    "claude_code_json_invalid",
                    attempt=attempt,
                    error=str(exc)[:200],
                    correlation_id=correlation_id,
                )
                last = LLMResponseError(
                    f"JSON van Claude Code klopt niet: {str(exc)[:200]}", retryable=True
                )
        raise last or LLMResponseError("Claude Code gaf geen antwoord")

    @staticmethod
    def _usage(envelope: dict[str, Any]) -> dict[str, Any] | None:
        usage = envelope.get("usage")
        if not isinstance(usage, dict):
            return None
        return {
            "prompt_tokens": usage.get("input_tokens"),
            "completion_tokens": usage.get("output_tokens"),
            "cost_usd": envelope.get("total_cost_usd"),
        }

    async def generate(self, prompt: str, *, correlation_id: str | None = None) -> LLMResult:
        payload, content, envelope = await self._json(
            prompt, InsightsPayload, correlation_id=correlation_id
        )
        return LLMResult(
            provider=PROVIDER,
            model=self.model_name,
            payload=payload,
            raw_content=content,
            usage=self._usage(envelope),
        )

    async def generate_text(
        self,
        prompt: str,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        correlation_id: str | None = None,
    ) -> LLMResponse:
        envelope = await self._run(prompt, schema=None, correlation_id=correlation_id)
        return LLMResponse(
            provider=PROVIDER,
            model=self.model_name,
            content=str(envelope.get("result") or "").strip(),
            usage=self._usage(envelope),
        )

    async def generate_json(
        self,
        prompt: str,
        schema_class: type[T],
        *,
        correlation_id: str | None = None,
    ) -> LLMGenericResult:
        payload, content, envelope = await self._json(
            prompt, schema_class, correlation_id=correlation_id
        )
        return LLMGenericResult(
            provider=PROVIDER,
            model=self.model_name,
            payload=payload,
            raw_content=content,
            usage=self._usage(envelope),
        )


__all__ = ["ClaudeCodeClient", "is_claude_code", "provider_model"]
