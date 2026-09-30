# ruff: noqa: S101
"""Admin endpoints and scheduler job of the entity research (Epic 12, Story 12.7)."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from backend.app.routers import admin
from backend.tests.unit._exploration_fixtures import real_module


class _StubService:
    def __init__(self, behaviour: str = "ok") -> None:
        self.behaviour = behaviour
        self.keys: list[str] = []
        self.cycles = 0

    async def run_cycle(self, correlation_id: str | None = None):
        self.cycles += 1
        if self.behaviour == "error":
            raise RuntimeError("cyclus kapot")
        if self.behaviour == "slow":
            await asyncio.sleep(1)
        return {
            "skipped": False,
            "status": {"updated": 1},
            "triage": {"assessed": 3},
            "enqueue": {"queued": 2, "skipped": {}},
            "round_started": True,
        }

    async def research_key(self, key: str, correlation_id: str | None = None):
        self.keys.append(key)
        if self.behaviour == "error":
            raise RuntimeError("kapot")
        if key.endswith("onbekend"):
            return {"key": key, "found": False, "reason": "Niet gevonden in het nieuws"}
        return {
            "key": key,
            "found": True,
            "status": "wachtrij",
            "role_category": "politicus",
            "priority": 78.6,
            "round_started": True,
        }

    async def status(self):
        return {
            "enabled": True,
            "pm_db": "/pm.db",
            "pm_db_exists": True,
            "pm_server": False,
            "pm_token_present": True,
            "counts": {"wachtrij": 2},
            "budget": {"auto_today": 2, "auto_max": 12, "requests_today": 0, "requests_max": 30},
            "runner": {"running": False},
            "linkedin": None,
            "last_runs": {"cycle": None},
            "watermark": None,
        }


@pytest.fixture()
def stub(monkeypatch) -> _StubService:
    service = _StubService()
    monkeypatch.setattr(admin, "get_entity_research_service", lambda: service)
    return service


async def test_trigger_cycle(stub) -> None:
    response = await admin.trigger_entity_research()
    assert response.skipped is False and response.round_started is True
    assert response.enqueue == {"queued": 2, "skipped": {}} and stub.cycles == 1


async def test_trigger_cycle_error(monkeypatch) -> None:
    monkeypatch.setattr(admin, "get_entity_research_service", lambda: _StubService("error"))
    with pytest.raises(HTTPException) as error:
        await admin.trigger_entity_research()
    assert error.value.status_code == 500


async def test_trigger_key(stub) -> None:
    response = await admin.trigger_entity_research_key("person:anouk-verbeek")
    assert response.status == "wachtrij" and response.priority == 78.6
    assert stub.keys == ["person:anouk-verbeek"]


@pytest.mark.parametrize(
    ("key", "code"), [("anouk", 400), ("place:dorp", 400), ("person:onbekend", 404)]
)
async def test_trigger_key_rejections(stub, key: str, code: int) -> None:
    with pytest.raises(HTTPException) as error:
        await admin.trigger_entity_research_key(key)
    assert error.value.status_code == code


async def test_trigger_key_error(monkeypatch) -> None:
    monkeypatch.setattr(admin, "get_entity_research_service", lambda: _StubService("error"))
    with pytest.raises(HTTPException) as error:
        await admin.trigger_entity_research_key("org:nordvind")
    assert error.value.status_code == 500


async def test_status(stub) -> None:
    response = await admin.entity_research_status()
    assert response.counts == {"wachtrij": 2} and response.budget["auto_max"] == 12
    assert response.pm_server is False and response.linkedin is None


# ------------------------------------------------------------------ scheduler
def _scheduler(monkeypatch, stub: _StubService, *, healthy: bool = True):
    module = real_module("backend.app.core.scheduler")
    monkeypatch.setattr(module, "get_entity_research_service", lambda: stub)

    async def _healthy() -> bool:
        return healthy

    monkeypatch.setattr(module, "ensure_healthy_connection", _healthy)
    return module, module.NewsAggregatorScheduler()


def test_scheduler_registers_entity_research_job(monkeypatch) -> None:
    module, scheduler = _scheduler(monkeypatch, _StubService())
    scheduler.settings.entity_research_interval_minutes = 20
    scheduler.setup_jobs()
    job = scheduler.scheduler.get_job("entity_research")
    assert job is not None and job.name == "Entity Research" and job.max_instances == 1
    assert job.trigger.interval.total_seconds() == 20 * 60


def test_scheduler_skips_entity_research_when_disabled(monkeypatch) -> None:
    module, scheduler = _scheduler(monkeypatch, _StubService())
    scheduler.settings.entity_research_enabled = False
    scheduler.setup_jobs()
    assert scheduler.scheduler.get_job("entity_research") is None


async def test_scheduler_job_success(monkeypatch) -> None:
    stub = _StubService()
    module, scheduler = _scheduler(monkeypatch, stub)
    await scheduler._entity_research_job()
    run = scheduler._entity_research_last_run
    assert run["success"] is True and run["result"]["round_started"] is True and stub.cycles == 1
    assert scheduler.get_job_status()["entity_research_last_run"] == run


@pytest.mark.parametrize(("behaviour", "error"), [("error", "cyclus kapot"), ("slow", "timed out")])
async def test_scheduler_job_failures(monkeypatch, behaviour: str, error: str) -> None:
    module, scheduler = _scheduler(monkeypatch, _StubService(behaviour))
    monkeypatch.setattr(module, "ENTITY_RESEARCH_TIMEOUT_SECONDS", 0.05)
    await scheduler._entity_research_job()  # must not raise
    assert scheduler._entity_research_last_run["success"] is False
    assert error in scheduler._entity_research_last_run["error"]


async def test_scheduler_job_unhealthy_database(monkeypatch) -> None:
    stub = _StubService()
    module, scheduler = _scheduler(monkeypatch, stub, healthy=False)
    await scheduler._entity_research_job()
    assert stub.cycles == 0
    assert scheduler._entity_research_last_run["error"] == "database connection unhealthy"
