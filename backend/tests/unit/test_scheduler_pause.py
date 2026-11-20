"""Pauze: the admin switches off everything that looks for something new, to save AI tokens.

The website keeps working: the backend still publishes and does what someone asks for with a
button. The switch survives a restart.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.tests.unit._exploration_fixtures import real_module

# What must go on while paused: maintenance, usage, the research of the propaganda model, and
# (when configured) publishing and requests
KEEPS_RUNNING = {
    "event_maintenance",
    "llm_usage",
    "voice_search",
    "bias_requests",
    "publish_supabase",
    # the propaganda model works off its queue (owner 2026-11-19)
    "entity_research",
    "evidence_research",
    "propagandamodel_sync",
}


def _scheduler(tmp_path):
    module = real_module("backend.app.core.scheduler")
    scheduler = module.NewsAggregatorScheduler()
    scheduler._state_file = tmp_path / "scheduler_state.json"

    async def no_poll() -> None:  # a resume polls right away: never the real feeds in a test
        return None

    scheduler._poll_feeds_job = no_poll
    return module, scheduler


def _next_runs(scheduler) -> dict[str, datetime | None]:
    return {job.id: job.next_run_time for job in scheduler.scheduler.get_jobs()}


@pytest.mark.asyncio
async def test_pause_stops_the_news_and_the_ai_work_only(tmp_path) -> None:
    module, scheduler = _scheduler(tmp_path)
    scheduler.start()
    try:
        state = scheduler.set_paused(True)
        runs = _next_runs(scheduler)

        assert state["paused"] is True
        since = datetime.fromisoformat(state["since"])
        assert datetime.now(timezone.utc) - since < timedelta(minutes=1)
        assert "RSS Feed Polling" in state["paused_jobs"]
        for job_id in ("poll_rss_feeds", "insight_backfill", "international_enrichment"):
            assert runs[job_id] is None
        for job_id, next_run in runs.items():
            assert (next_run is None) == (job_id in module.PAUSED_JOB_IDS), job_id
        assert KEEPS_RUNNING.isdisjoint(module.PAUSED_JOB_IDS)
        assert scheduler.get_job_status()["pause"]["paused"] is True
    finally:
        scheduler.scheduler.shutdown(wait=False)


@pytest.mark.asyncio
async def test_resume_starts_the_jobs_again_and_polls_right_away(tmp_path) -> None:
    _, scheduler = _scheduler(tmp_path)
    scheduler.start()
    try:
        scheduler.set_paused(True)
        state = scheduler.set_paused(False)
        runs = _next_runs(scheduler)

        assert state == {"paused": False, "since": None, "paused_jobs": []}
        assert all(next_run is not None for next_run in runs.values())
        assert abs(runs["poll_rss_feeds"] - datetime.now(timezone.utc)) < timedelta(minutes=1)
        assert runs["insight_backfill"] > datetime.now(timezone.utc)
    finally:
        scheduler.scheduler.shutdown(wait=False)


@pytest.mark.asyncio
async def test_a_restart_stays_paused(tmp_path) -> None:
    _, scheduler = _scheduler(tmp_path)
    since = scheduler.set_paused(True)["since"]  # not started: only the state file

    module, restarted = _scheduler(tmp_path)
    restarted.start()
    try:
        runs = _next_runs(restarted)

        assert restarted.pause_state()["since"] == since
        assert runs["poll_rss_feeds"] is None
        assert all(runs[job_id] is None for job_id in runs if job_id in module.PAUSED_JOB_IDS)
        assert runs["event_maintenance"] is not None
    finally:
        restarted.scheduler.shutdown(wait=False)


@pytest.mark.asyncio
async def test_pausing_twice_keeps_the_first_moment(tmp_path) -> None:
    _, scheduler = _scheduler(tmp_path)

    first = scheduler.set_paused(True)["since"]
    second = scheduler.set_paused(True)["since"]

    assert first == second
