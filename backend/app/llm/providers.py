"""LLM provider per pipeline step, chosen in ``llm_config`` (``provider_<step>`` keys).

Event assignment and classification used to construct a ``MistralClient`` directly, so a
Mistral rate limit silently degraded clustering. They now ask for a step client: the provider
is read from ``llm_config`` on every call (a change applies without a restart), falling back to
other keys (usually the provider of the factual analysis) and finally the settings.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TypeVar

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.llm.claude_code import ClaudeCodeClient, is_claude_code, provider_model
from backend.app.llm.client import (
    BaseLLMClient,
    DeepSeekClient,
    GeminiClient,
    LLMGenericResult,
    LLMResponse,
    LLMResult,
    MistralClient,
)

logger = get_logger(__name__).bind(component="LLMProviders")

T = TypeVar("T")


def build_llm_client(provider: str | None, settings: Settings) -> BaseLLMClient:
    """The client for a provider name from llm_config.

    mistral, deepseek, deepseek-r1, gemini, or claude-code[:model] (the local Claude Code CLI).
    """

    name = (provider or "mistral").strip().lower()
    if is_claude_code(name):
        return ClaudeCodeClient(settings=settings, model=provider_model(name))
    if name == "deepseek":
        return DeepSeekClient(settings=settings, use_reasoner=False)
    if name == "deepseek-r1":
        return DeepSeekClient(settings=settings, use_reasoner=True)
    if name == "gemini":
        return GeminiClient(settings=settings)
    return MistralClient(settings=settings)


async def resolve_provider(keys: Sequence[str], *, default: str | None) -> str | None:
    """The first ``llm_config`` value among ``keys``; ``default`` when none is set or readable."""

    from backend.app.services.llm_config_service import get_llm_config_service

    try:
        config = get_llm_config_service()
        for key in keys:
            value = await config.get_value(key)
            if value and value.strip():
                return value.strip()
    except Exception as exc:  # no database (tests, scripts): use the settings
        logger.debug("llm_provider_config_unavailable", keys=list(keys), error=str(exc))
    return default


class StepLLMClient(BaseLLMClient):
    """Resolves its provider from ``llm_config`` per call (e.g. ``provider_classification``)."""

    def __init__(
        self,
        key: str,
        *,
        fallback_keys: Sequence[str] = ("provider_factual",),
        settings: Settings | None = None,
        default: str | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.keys = (key, *fallback_keys)
        self.default = default or self.settings.llm_provider
        self._clients: dict[str, BaseLLMClient] = {}

    @property
    def provider(self) -> str:  # type: ignore[override]
        return f"step:{self.keys[0]}"

    async def client(self) -> BaseLLMClient:
        name = (await resolve_provider(self.keys, default=self.default) or "mistral").lower()
        if name not in self._clients:
            self._clients[name] = build_llm_client(name, self.settings)
        return self._clients[name]

    async def generate(self, prompt: str, *, correlation_id: str | None = None) -> LLMResult:
        return await (await self.client()).generate(prompt, correlation_id=correlation_id)

    async def generate_text(
        self,
        prompt: str,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        correlation_id: str | None = None,
    ) -> LLMResponse:
        return await (await self.client()).generate_text(
            prompt, temperature=temperature, max_tokens=max_tokens, correlation_id=correlation_id
        )

    async def generate_json(
        self,
        prompt: str,
        schema_class: type[T],
        *,
        correlation_id: str | None = None,
    ) -> LLMGenericResult:
        return await (await self.client()).generate_json(
            prompt, schema_class, correlation_id=correlation_id
        )


__all__ = ["StepLLMClient", "build_llm_client", "resolve_provider"]
