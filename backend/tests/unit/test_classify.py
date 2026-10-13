"""A failed classification leaves the type unknown instead of 'other'.

Read as 'other', a failure kept the article out of every event of another type: on 2026-10-07,
393 articles during the Claude Code session limit.
"""

from __future__ import annotations

import pytest

from backend.app.llm.client import BaseLLMClient, LLMResponse
from backend.app.nlp import classify


class _Config:
    async def get_value(self, key, default=None):
        return None

    async def get_float(self, key, default=None):
        return default

    async def get_int(self, key, default=None):
        return default


class _LLM(BaseLLMClient):
    provider = "stub"

    def __init__(self, answer: str | None = None, error: Exception | None = None) -> None:
        self.answer = answer
        self.error = error

    async def generate_text(self, prompt, *, temperature=None, max_tokens=None, correlation_id=None):
        if self.error is not None:
            raise self.error
        return LLMResponse(provider="stub", model="stub", content=self.answer or "")


@pytest.fixture(autouse=True)
def _config_without_database(monkeypatch):
    monkeypatch.setattr(classify, "get_llm_config_service", lambda: _Config())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("llm", "expected"),
    [
        (_LLM(answer="Sports\n"), "sports"),
        # The LLM answered, but with no category of the list: it fits none
        (_LLM(answer="tennis"), "other"),
        # No answer at all: the type is unknown and is asked again later
        (_LLM(error=RuntimeError("Claude Code faalde: You've hit your session limit")), None),
    ],
    ids=["category", "no-category", "failed"],
)
async def test_classification_outcome(llm: _LLM, expected: str | None) -> None:
    assert await classify.classify_event_type_llm("Griekspoor verliest in China", "Tekst", llm) == expected
