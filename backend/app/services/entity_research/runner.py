"""What the propaganda-model research agents did (Epic 12 Story 12.7, Story 14.13).

The research itself is a round of a propaganda-model mission agent: ``nieuws-scout`` (names in
the news) or ``nieuws-bewijs`` (evidence for thin links). Since 2026-10-07 the propaganda model
schedules these rounds itself (launchd, during its active hours) and runs its own approval
afterwards; the news app no longer starts them. Its ``scripts/agent_runner.py`` logs every round
in ``data/agent_runs.jsonl``.

This module only reads: the run records of one agent and the state of the LinkedIn brake, for
the admin status endpoints.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import sys
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

RUN_LABEL = "nieuws-scout"
# Story 14.13: the pm agent that looks for evidence for and against thin links
EVIDENCE_LABEL = "nieuws-bewijs"


@dataclass(slots=True)
class ProcessResult:
    returncode: int | None
    output: list[str]
    timed_out: bool = False


SpawnFn = Callable[[Sequence[str], Path, float], Awaitable[ProcessResult]]


async def run_process(command: Sequence[str], cwd: Path, timeout: float) -> ProcessResult:
    """Run a command, keep the last 60 output lines, kill the process group on timeout."""

    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=dict(os.environ),
        start_new_session=True,
    )
    tail: deque[str] = deque(maxlen=60)

    async def pump() -> None:
        if process.stdout is None:
            return
        async for raw in process.stdout:
            tail.append(raw.decode("utf-8", "replace").rstrip())

    try:
        await asyncio.wait_for(asyncio.gather(pump(), process.wait()), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        await process.wait()
        return ProcessResult(process.returncode, list(tail), timed_out=True)
    return ProcessResult(process.returncode, list(tail))


def read_run_records(path: Path, label: str = RUN_LABEL, limit: int = 200) -> list[dict[str, Any]]:
    """Run records of one label from the pm ``data/agent_runs.jsonl`` (newest last)."""

    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    records: list[dict[str, Any]] = []
    for line in lines[-2000:]:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict) and record.get("label") == label:
            records.append(record)
    return records[-limit:]


@dataclass(slots=True)
class PmAgentConfig:
    project_dir: Path
    python: str = "python3"
    active_start_hour: int = 8
    active_end_hour: int = 22
    label: str = RUN_LABEL


class PmAgentRuns:
    """Read-only view of the rounds of one pm agent (the propaganda model schedules them)."""

    def __init__(
        self,
        config: PmAgentConfig,
        *,
        spawn: SpawnFn = run_process,
        clock: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self.config = config
        self._spawn = spawn
        self._clock = clock

    @property
    def runs_path(self) -> Path:
        return self.config.project_dir / "data" / "agent_runs.jsonl"

    def _python(self) -> str:
        return shutil.which(self.config.python) or self.config.python or sys.executable

    def rounds_today(self, now: datetime | None = None) -> int:
        today = (now or self._clock()).date().isoformat()
        return sum(
            1
            for record in read_run_records(self.runs_path, self.config.label)
            if record.get("datum") == today
        )

    async def linkedin_status(self) -> dict[str, Any] | None:
        """``tools/linkedin/snelheidsrem.py status --json`` of the propaganda model."""

        script = self.config.project_dir / "tools" / "linkedin" / "snelheidsrem.py"
        if not script.exists():
            return None
        result = await self._spawn(
            [self._python(), str(script), "status", "--json"], self.config.project_dir, 20
        )
        text = "\n".join(result.output).strip()
        start = text.find("{")
        if start < 0:
            return None
        try:
            parsed = json.loads(text[start:])
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def status(self) -> dict[str, Any]:
        records = read_run_records(self.runs_path, self.config.label)
        last = records[-1] if records else None
        return {
            "label": self.config.label,
            "scheduled_by": "propagandamodel",
            "rounds_today": self.rounds_today(),
            "active_hours": (
                f"{self.config.active_start_hour:02d}-{self.config.active_end_hour:02d}"
            ),
            "last_run_record": last,
            "linkedin_session_expired": bool(last and last.get("linkedin_verlopen")),
        }


__all__ = [
    "EVIDENCE_LABEL",
    "PmAgentConfig",
    "PmAgentRuns",
    "ProcessResult",
    "RUN_LABEL",
    "read_run_records",
    "run_process",
]
