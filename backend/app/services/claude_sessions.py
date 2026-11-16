"""Claude Code usage per source, read from the session transcripts in ``~/.claude/projects``.

The subscription's limit is shared by everything that runs ``claude`` on this Mac: the news app's
own calls, the agents of the propaganda model (scheduled rounds and the scripts that call
``claude -p``) and the owner's own sessions. Anthropic only reports the total, so this reads what
each session wrote down and groups it per source, so the owner can see who uses the week.
Parsed files are cached on (path, mtime, size); a day-old transcript is never read twice.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECTS_DIR = Path.home() / ".claude" / "projects"
AGENT_PROMPT = re.compile(r'missie-ronde \(ronde\d+\) van de agent "([^"]+)"')
TEMP_DIR = re.compile(r"-T-([a-z][a-z_-]*?)-[a-z0-9_-]{8}$")
PROJECT_PREFIX = "-Users-macbook-Workspace-"

# (path, mtime, size) -> (source, [(timestamp, input, output, cache_read, cache_write), ...])
_cache: dict[tuple[str, float, int], tuple[str, list[tuple[str, int, int, int, int]]]] = {}


def _text(content: Any) -> str:
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return content if isinstance(content, str) else ""


def _source(directory: str, first_prompt: str) -> str:
    agent = AGENT_PROMPT.search(first_prompt)
    if agent:
        return f"Agent {agent.group(1)}"
    temp = TEMP_DIR.search(directory)
    if temp:
        return f"Script {temp.group(1)}"
    project = directory.removeprefix(PROJECT_PREFIX).removeprefix("-Users-macbook") or "thuis"
    return f"Eigen sessies · {project}"


def _parse(path: Path) -> tuple[str, list[tuple[str, int, int, int, int]]]:
    first = ""
    rows: list[tuple[str, int, int, int, int]] = []
    with path.open(errors="replace") as handle:
        for line in handle:
            if not first and '"type":"user"' in line:
                try:
                    first = _text(json.loads(line)["message"]["content"])[:400]
                except (ValueError, KeyError, TypeError):
                    pass
            if '"usage"' not in line or '"type":"assistant"' not in line:
                continue
            try:
                data = json.loads(line)
                usage = data["message"]["usage"]
                rows.append(
                    (
                        data.get("timestamp", ""),
                        int(usage.get("input_tokens") or 0),
                        int(usage.get("output_tokens") or 0),
                        int(usage.get("cache_read_input_tokens") or 0),
                        int(usage.get("cache_creation_input_tokens") or 0),
                    )
                )
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
    return _source(path.parent.name, first), rows


def _collect(since: datetime) -> list[dict[str, Any]]:
    cutoff = since.timestamp()
    stamp = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    totals: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"sessions": 0, "messages": 0, "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0}
    )
    if not PROJECTS_DIR.is_dir():
        return []
    for path in PROJECTS_DIR.glob("*/*.jsonl"):
        try:
            stat = path.stat()
            if stat.st_mtime < cutoff:
                continue
            key = (str(path), stat.st_mtime, stat.st_size)
            if key not in _cache:
                _cache.update({key: _parse(path)})
            source, rows = _cache[key]
        except OSError:
            continue
        counted = [row for row in rows if row[0] >= stamp]
        if not counted:
            continue
        entry = totals[source]
        entry["sessions"] += 1
        entry["messages"] += len(counted)
        entry["input_tokens"] += sum(row[1] for row in counted)
        entry["output_tokens"] += sum(row[2] for row in counted)
        entry["cache_read_tokens"] += sum(row[3] for row in counted)
        entry["cache_write_tokens"] += sum(row[4] for row in counted)
    result = []
    for source, entry in totals.items():
        # what counts against the limit: new input, cache writes and output (cache reads are cheap)
        entry["tokens"] = entry["input_tokens"] + entry["output_tokens"] + entry["cache_write_tokens"]
        result.append({"source": source, **entry})
    result.sort(key=lambda item: item["tokens"], reverse=True)
    return result


async def sessions_since(since: datetime) -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(_collect, since)
    except Exception:  # an unreadable transcript must not break the usage page
        return []
