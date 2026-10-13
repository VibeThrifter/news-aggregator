"""Event Maintenance runs once a day, also when the backend restarts more often than that.

With a 24-hour interval trigger it never ran from 2026-10-02 to 2026-10-08: every restart started
the count again.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.tests.unit._exploration_fixtures import real_module


def _scheduler(monkeypatch, tmp_path, *, succeeds: bool = True):
    module = real_module("backend.app.core.scheduler")
    scheduler = module.NewsAggregatorScheduler()
    scheduler._state_file = tmp_path / "scheduler_state.json"
    runs: list[datetime] = []

    async def maintenance_job() -> bool:
        runs.append(datetime.now(timezone.utc))
        return succeeds

    monkeypatch.setattr(scheduler, "_event_maintenance_job", maintenance_job)
    return module, scheduler, runs


def _last_run(scheduler) -> datetime:
    state = json.loads(scheduler._state_file.read_text())
    return datetime.fromisoformat(state["event_maintenance_last_run"])


@pytest.mark.asyncio
async def test_maintenance_runs_when_it_never_ran_and_remembers_it(monkeypatch, tmp_path) -> None:
    _, scheduler, runs = _scheduler(monkeypatch, tmp_path)

    await scheduler._event_maintenance_when_due()

    assert len(runs) == 1
    assert datetime.now(timezone.utc) - _last_run(scheduler) < timedelta(minutes=1)
    assert scheduler.get_job_status()["event_maintenance_last_run"] == _last_run(scheduler).isoformat()


@pytest.mark.asyncio
async def test_a_restart_does_not_start_the_day_again(monkeypatch, tmp_path) -> None:
    _, scheduler, runs = _scheduler(monkeypatch, tmp_path)
    await scheduler._event_maintenance_when_due()

    _, restarted, runs_after_restart = _scheduler(monkeypatch, tmp_path)
    await restarted._event_maintenance_when_due()
    await restarted._event_maintenance_when_due()

    assert len(runs) == 1
    assert runs_after_restart == []


@pytest.mark.asyncio
@pytest.mark.parametrize(("hours_ago", "runs_expected"), [(23, 0), (25, 1)])
async def test_maintenance_runs_again_a_day_after_the_last_run(
    monkeypatch, tmp_path, hours_ago: int, runs_expected: int
) -> None:
    _, scheduler, runs = _scheduler(monkeypatch, tmp_path)
    last_run = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    scheduler._state_file.write_text(json.dumps({"event_maintenance_last_run": last_run.isoformat()}))

    await scheduler._event_maintenance_when_due()

    assert len(runs) == runs_expected


@pytest.mark.asyncio
async def test_a_failed_run_is_tried_again_at_the_next_check(monkeypatch, tmp_path) -> None:
    _, scheduler, runs = _scheduler(monkeypatch, tmp_path, succeeds=False)

    await scheduler._event_maintenance_when_due()
    await scheduler._event_maintenance_when_due()

    assert len(runs) == 2
    assert not scheduler._state_file.exists()


@pytest.mark.asyncio
async def test_a_manual_run_counts_as_the_days_run(monkeypatch, tmp_path) -> None:
    module, scheduler, _ = _scheduler(monkeypatch, tmp_path)

    async def healthy() -> bool:
        return True

    class _Maintenance:
        async def run(self, correlation_id=None):
            return SimpleNamespace(as_dict=lambda: {"events_archived": 3})

    monkeypatch.setattr(module, "ensure_healthy_connection", healthy)
    scheduler._maintenance_service = _Maintenance()

    result = await scheduler.run_event_maintenance_now()

    assert result["success"] is True
    assert datetime.now(timezone.utc) - _last_run(scheduler) < timedelta(minutes=1)


def test_the_job_looks_every_hour_from_a_few_minutes_after_the_start(monkeypatch, tmp_path) -> None:
    module, scheduler, _ = _scheduler(monkeypatch, tmp_path)

    scheduler.setup_jobs()
    job = scheduler.scheduler.get_job("event_maintenance")

    assert job.trigger.interval == timedelta(minutes=module.MAINTENANCE_CHECK_MINUTES) == timedelta(hours=1)
    first_check = job.next_run_time - datetime.now(timezone.utc)
    assert timedelta(minutes=4) < first_check <= timedelta(minutes=module.MAINTENANCE_FIRST_CHECK_MINUTES)
