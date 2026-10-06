"""Starts the propaganda-model research agent and auto-approval (Epic 12, Story 12.7).

The research itself is a round of the propaganda-model mission agent ``nieuws-scout``: a headless
``claude -p`` session run by the propaganda-model's own ``scripts/agent_runner.py`` (which locks
per label, skips when there are no open targets and logs every round in
``data/agent_runs.jsonl``). After a round, the propaganda-model's deterministic
``scripts/nieuws_autokeur_service.py`` approves the safe structural results.

Budget: at most N rounds per day (counted from the pm run records, so rounds started by launchd
count too), a minimum gap between rounds and only during active hours.

The same runner starts the pm agent ``nieuws-bewijs`` (Story 14.13, evidence for thin links):
another label, account and brief, ``--doel-soort relatie``; afterwards it runs the
propaganda-model's automatic review (``scripts/automatische_beoordeling.py``: bronchecker,
prosecutor, immune gate) instead of the auto-approval of names.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import sys
import time
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from backend.app.core.logging import get_logger

logger = get_logger(__name__).bind(component="NieuwsScoutRunner")

RUN_LABEL = "nieuws-scout"
AGENT_ACCOUNT = "nieuws-scout"
BRIEF = "missies/nieuws_scout_brief.md"
# Story 14.13: the pm agent that looks for evidence for and against thin links
EVIDENCE_LABEL = "nieuws-bewijs"
EVIDENCE_ACCOUNT = "nieuws-bewijs"
EVIDENCE_BRIEF = "missies/nieuws_bewijs_brief.md"
# The pm's automatic review (owner decision 2026-10-06: nobody reviews by hand)
AUTOMATIC_REVIEW_SCRIPT = "scripts/automatische_beoordeling.py"


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


def in_active_hours(now: datetime, start_hour: int, end_hour: int) -> bool:
    """Local-time window [start_hour, end_hour)."""

    return start_hour <= now.hour < end_hour


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
class RunnerConfig:
    project_dir: Path
    python: str = "python3"
    claude_bin: str = "claude"
    model: str = "opus"
    effort: str = "high"
    timeout_seconds: int = 2700
    max_rounds_per_day: int = 4
    min_minutes_between_rounds: int = 30
    active_start_hour: int = 8
    active_end_hour: int = 22
    autokeur_enabled: bool = True
    autokeur_timeout_seconds: int = 300
    # The pm script that decides on what the round proposed (prints one JSON line last)
    autokeur_script: str = "scripts/nieuws_autokeur_service.py"
    label: str = RUN_LABEL
    account: str = AGENT_ACCOUNT
    brief: str = BRIEF
    # Extra arguments for agent_runner.py, e.g. ("--doel-soort", "relatie")
    extra_args: tuple[str, ...] = ()


@dataclass(slots=True)
class RoundState:
    running: bool = False
    started_at: str | None = None
    finished_at: str | None = None
    returncode: int | None = None
    timed_out: bool = False
    output_tail: list[str] = field(default_factory=list)
    autokeur: dict[str, Any] | None = None


class NieuwsScoutRunner:
    """Starts research rounds of one pm agent within the budget (and, for the nieuws-scout,
    runs the auto-approval afterwards)."""

    def __init__(
        self,
        config: RunnerConfig,
        *,
        spawn: SpawnFn = run_process,
        clock: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self.config = config
        self._spawn = spawn
        self._clock = clock
        self._task: asyncio.Task[Any] | None = None
        self._last_start: datetime | None = None
        self.state = RoundState()

    # ------------------------------------------------------------------ paths
    @property
    def runs_path(self) -> Path:
        return self.config.project_dir / "data" / "agent_runs.jsonl"

    def _python(self) -> str:
        return shutil.which(self.config.python) or self.config.python or sys.executable

    def round_command(self) -> list[str]:
        command = [
            self._python(),
            "scripts/agent_runner.py",
            "--agent",
            self.config.account,
            "--label",
            self.config.label,
            "--brief",
            self.config.brief,
            "--skip-permissions",
            "--alleen-bij-open-doelen",
            *self.config.extra_args,
            "--claude-bin",
            self.config.claude_bin,
            "--timeout",
            str(self.config.timeout_seconds),
            # the propaganda model enforces the same budget itself (defense in depth)
            "--max-rondes-per-dag",
            str(self.config.max_rounds_per_day),
            "--actieve-uren",
            f"{self.config.active_start_hour}-{self.config.active_end_hour}",
        ]
        if self.config.model:
            command += ["--model", self.config.model]
        if self.config.effort:
            command += ["--effort", self.config.effort]
        caffeinate = shutil.which("caffeinate") if sys.platform == "darwin" else None
        return [caffeinate, "-i", *command] if caffeinate else command

    def autokeur_command(self) -> list[str]:
        return [self._python(), self.config.autokeur_script, "--once", "--json"]

    # ------------------------------------------------------------------ budget
    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def rounds_today(self, now: datetime | None = None) -> int:
        today = (now or self._clock()).date().isoformat()
        return sum(
            1
            for record in read_run_records(self.runs_path, self.config.label)
            if record.get("datum") == today
        )

    def can_start(self, now: datetime | None = None) -> tuple[bool, str | None]:
        now = now or self._clock()
        if self.running:
            return False, "ronde loopt al"
        if not (self.config.project_dir / "scripts" / "agent_runner.py").exists():
            return False, "propagandamodel-project niet gevonden"
        if not in_active_hours(now, self.config.active_start_hour, self.config.active_end_hour):
            return False, "buiten de actieve uren"
        if self.rounds_today(now) >= self.config.max_rounds_per_day:
            return False, "dagbudget aan rondes bereikt"
        if self._last_start is not None and now - self._last_start < timedelta(
            minutes=self.config.min_minutes_between_rounds
        ):
            return False, "te kort na de vorige ronde"
        return True, None

    # ------------------------------------------------------------------ operations
    def start_round(
        self, on_finished: Callable[[RoundState], Awaitable[None]] | None = None
    ) -> bool:
        """Start a round in the background (returns immediately). False when not allowed."""

        allowed, reason = self.can_start()
        if not allowed:
            logger.info("pm_agent_round_not_started", label=self.config.label, reason=reason)
            return False
        now = self._clock()
        self._last_start = now
        self.state = RoundState(running=True, started_at=now.isoformat())
        self._task = asyncio.create_task(self._run(on_finished))
        logger.info(
            "pm_agent_round_started", label=self.config.label, started_at=self.state.started_at
        )
        return True

    async def _run(self, on_finished: Callable[[RoundState], Awaitable[None]] | None) -> None:
        started = time.monotonic()
        try:
            result = await self._spawn(
                self.round_command(), self.config.project_dir, self.config.timeout_seconds + 120
            )
            self.state.returncode = result.returncode
            self.state.timed_out = result.timed_out
            self.state.output_tail = result.output[-20:]
            if self.config.autokeur_enabled:
                self.state.autokeur = await self.run_autokeur()
        except Exception as exc:  # never let a background task crash silently
            logger.error("pm_agent_round_failed", label=self.config.label, error=str(exc))
            self.state.output_tail = [*self.state.output_tail, f"fout: {exc}"][-20:]
        finally:
            self.state.running = False
            self.state.finished_at = self._clock().isoformat()
            logger.info(
                "pm_agent_round_finished",
                label=self.config.label,
                returncode=self.state.returncode,
                timed_out=self.state.timed_out,
                duration_seconds=round(time.monotonic() - started, 1),
            )
        if on_finished is not None:
            try:
                await on_finished(self.state)
            except Exception as exc:
                logger.error(
                    "pm_agent_after_round_failed", label=self.config.label, error=str(exc)
                )

    async def run_autokeur(self) -> dict[str, Any] | None:
        """Run the pm auto-approval once; parsed JSON summary (None on failure)."""

        if not (self.config.project_dir / self.config.autokeur_script).exists():
            return None
        result = await self._spawn(
            self.autokeur_command(), self.config.project_dir, self.config.autokeur_timeout_seconds
        )
        for line in reversed(result.output):
            line = line.strip()
            if line.startswith("{"):
                try:
                    parsed = json.loads(line)
                except ValueError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
        if result.returncode not in (0, None):
            logger.warning("nieuws_autokeur_failed", returncode=result.returncode)
        return None

    async def wait(self) -> None:
        """Await the current round (tests, shutdown)."""

        if self._task is not None:
            await self._task

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
        allowed, reason = self.can_start()
        return {
            "running": self.running,
            "can_start": allowed,
            "blocked_reason": reason,
            "rounds_today": self.rounds_today(),
            "max_rounds_per_day": self.config.max_rounds_per_day,
            "active_hours": (
                f"{self.config.active_start_hour:02d}-{self.config.active_end_hour:02d}"
            ),
            "current": {
                "started_at": self.state.started_at,
                "finished_at": self.state.finished_at,
                "returncode": self.state.returncode,
                "timed_out": self.state.timed_out,
                "autokeur": self.state.autokeur,
                "output_tail": self.state.output_tail,
            },
            "last_run_record": last,
            "linkedin_session_expired": bool(last and last.get("linkedin_verlopen")),
        }


__all__ = [
    "AUTOMATIC_REVIEW_SCRIPT",
    "EVIDENCE_ACCOUNT",
    "EVIDENCE_BRIEF",
    "EVIDENCE_LABEL",
    "NieuwsScoutRunner",
    "ProcessResult",
    "RoundState",
    "RunnerConfig",
    "in_active_hours",
    "read_run_records",
    "run_process",
]
