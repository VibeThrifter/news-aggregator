"""Claude Code as LLM provider: the local `claude` CLI, selectable per step in llm_config.

A fake `claude` script plays the CLI: it prints the JSON envelope of `claude -p --output-format
json` and reports what it was started with (arguments, API key in the environment).
"""

from __future__ import annotations

import json
import stat
import sys
from pathlib import Path

import pytest
from pydantic import BaseModel

from backend.app.core.config import get_settings
from backend.app.llm.claude_code import ClaudeCodeClient, is_claude_code, provider_model
from backend.app.llm.client import LLMQuotaExhaustedError, LLMTimeoutError
from backend.app.llm.providers import build_llm_client

FAKE = """#!{python}
import json, os, sys, time
prompt = sys.stdin.read()
args = sys.argv[1:]
mode = os.environ.get("FAKE_CLAUDE_MODE", "structured")
seen = {{"args": args, "api_key": "ANTHROPIC_API_KEY" in os.environ, "cwd": os.getcwd(), "prompt": prompt}}
with open(os.environ["FAKE_CLAUDE_LOG"], "w") as log:
    json.dump(seen, log)
if mode == "sleep":
    time.sleep(5)
if mode == "limit":
    print(json.dumps({{"type": "result", "is_error": True, "result": "Claude AI usage limit reached|1759500000"}}))
    sys.exit(1)
envelope = {{"type": "result", "subtype": "success", "is_error": False, "duration_ms": 12,
            "usage": {{"input_tokens": 10, "output_tokens": 5}}, "total_cost_usd": 0.001}}
if mode == "structured":
    envelope["structured_output"] = {{"category": "politiek", "reason": "kabinet"}}
    envelope["result"] = "zie structured_output"
else:
    envelope["result"] = "```json\\n{{\\"category\\": \\"economie\\", \\"reason\\": \\"gas\\"}}\\n```"
print(json.dumps(envelope))
"""


class Category(BaseModel):
    category: str
    reason: str


@pytest.fixture
def fake_claude(tmp_path: Path, monkeypatch):
    script = tmp_path / "claude"
    script.write_text(FAKE.format(python=sys.executable))
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "seen.json"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-be-used")
    settings = get_settings().model_copy(
        update={"claude_code_bin": str(script), "claude_code_timeout_seconds": 30}
    )

    def seen() -> dict:
        return json.loads(log.read_text())

    return settings, seen


def test_selectable_per_step_with_a_model():
    assert is_claude_code("claude-code") and is_claude_code("Claude-Code:haiku")
    assert not is_claude_code("deepseek")
    assert provider_model("claude-code:sonnet") == "sonnet"
    assert provider_model("claude-code") is None
    client = build_llm_client("claude-code:haiku", get_settings())
    assert isinstance(client, ClaudeCodeClient) and client.model_name == "claude-code:haiku"


async def test_structured_answer_without_tools_context_or_api_key(fake_claude):
    settings, seen = fake_claude
    client = ClaudeCodeClient(settings=settings, model="haiku")
    result = await client.generate_json("Welke categorie?", Category)

    assert result.payload == Category(category="politiek", reason="kabinet")
    assert result.provider == "claude-code" and result.model == "claude-code:haiku"
    assert result.usage == {"prompt_tokens": 10, "completion_tokens": 5, "cost_usd": 0.001}
    call = seen()
    args = call["args"]
    assert args[:3] == ["-p", "--output-format", "json"]
    assert args[args.index("--tools") + 1] == ""
    assert args[args.index("--model") + 1] == "haiku"
    assert json.loads(args[args.index("--json-schema") + 1])["required"] == ["category", "reason"]
    assert "--strict-mcp-config" in args and "--no-session-persistence" in args
    # The subscription login, never an API key; an empty working directory (no CLAUDE.md)
    assert call["api_key"] is False
    assert "pluriformiteit-claude-code" in call["cwd"]
    assert call["prompt"].startswith("Welke categorie?")


async def test_reads_the_text_answer_when_there_is_no_structured_output(fake_claude, monkeypatch):
    settings, _ = fake_claude
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "text")
    result = await ClaudeCodeClient(settings=settings).generate_json("Welke categorie?", Category)
    assert result.payload.category == "economie"
    text = await ClaudeCodeClient(settings=settings).generate_text("Zeg iets")
    assert text.content.startswith("```json")


async def test_a_reached_limit_is_a_quota_error(fake_claude, monkeypatch):
    settings, _ = fake_claude
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "limit")
    with pytest.raises(LLMQuotaExhaustedError):
        await ClaudeCodeClient(settings=settings).generate_json("x", Category)


async def test_a_call_that_takes_too_long_times_out(fake_claude, monkeypatch):
    settings, _ = fake_claude
    monkeypatch.setenv("FAKE_CLAUDE_MODE", "sleep")
    quick = settings.model_copy(update={"claude_code_timeout_seconds": 1})
    with pytest.raises(LLMTimeoutError):
        await ClaudeCodeClient(settings=quick).generate_text("x")
