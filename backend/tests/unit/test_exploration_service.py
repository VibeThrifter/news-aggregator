# ruff: noqa: S101
"""Tests for the exploration facade, the events-table guard and the scheduler hook (11.8)."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select, update

from backend.app.db.models import Event, EventEntity, EventRelation
from backend.app.services import exploration_service as exploration_module
from backend.app.services.exploration_service import (
    EventNotFoundError,
    ExplorationService,
    get_exploration_service,
    is_entity_stale,
)
from backend.tests.unit._exploration_fixtures import (
    BASE_TIME,
    SeedArticle,
    StatementRecorder,
    event_timestamps,
    make_session_factory,
    make_settings,
    mention,
    real_module,
    seed_event,
    unit_vector,
)

TRUMP = [mention("Donald Trump", "PERSON"), mention("Gaza", "GPE")]
RUTTE = [mention("Mark Rutte", "PERSON"), mention("NAVO", "ORG")]


async def _world(**settings_overrides):
    factory, engine = await make_session_factory()
    ids = {
        "a": await seed_event(
            factory,
            slug="a",
            llm_title="Trump en Gaza",
            embedding=unit_vector(1.0),
            countries=["IL", "US"],
            articles=[SeedArticle("NOS", TRUMP), SeedArticle("AD", TRUMP)],
        ),
        "b": await seed_event(
            factory,
            slug="b",
            llm_title="Opnieuw Trump en Gaza",
            embedding=unit_vector(0.95, 0.312),
            countries=["IL"],
            articles=[SeedArticle("NU.nl", TRUMP), SeedArticle("RTL Nieuws", TRUMP)],
        ),
        "archived": await seed_event(
            factory,
            slug="archived",
            llm_title="Oud Gaza nieuws",
            embedding=unit_vector(0.9, -0.436),
            archived=True,
            articles=[SeedArticle("NOS", TRUMP)],
        ),
        "untitled": await seed_event(
            factory,
            slug="untitled",
            llm_title=None,
            embedding=unit_vector(1.0),
            articles=[SeedArticle("NOS", RUTTE)],
        ),
        "other": await seed_event(
            factory,
            slug="other",
            llm_title="Rutte bij de NAVO",
            embedding=unit_vector(0, 1.0),
            articles=[SeedArticle("NOS", RUTTE), SeedArticle("AD", RUTTE)],
        ),
    }
    service = ExplorationService(
        settings=make_settings(**settings_overrides),
        read_session_factory=factory,
        write_session_factory=factory,
    )
    return factory, engine, ids, service


async def _rows(factory, model):
    async with factory() as session:
        return (await session.execute(select(model))).scalars().all()


def test_is_entity_stale() -> None:
    assert is_entity_stale(None, BASE_TIME)
    assert not is_entity_stale(BASE_TIME, None)
    assert not is_entity_stale(BASE_TIME.replace(tzinfo=None), BASE_TIME)
    assert is_entity_stale(BASE_TIME, BASE_TIME + timedelta(seconds=1))


@pytest.mark.asyncio
async def test_refresh_for_event_writes_entities_and_relations() -> None:
    factory, engine, ids, service = await _world()
    await service.refresh_for_event(ids["other"])  # makes "Trump" non-ubiquitous (idf > 0)
    await service.refresh_for_event(ids["b"])

    outcome = await service.refresh_for_event(
        ids["a"], summary="Verse titel voor A\n\nTekst", correlation_id="cid"
    )

    assert outcome["event_id"] == ids["a"]
    assert outcome["skipped"] is False and outcome["reason"] is None
    assert outcome["entities_written"] == 2
    assert outcome["relations_written"] >= 2
    entities = [row for row in await _rows(factory, EventEntity) if row.event_id == ids["a"]]
    assert {row.entity_key for row in entities} == {"person:donald-trump", "place:gaza"}
    assert {row.event_title for row in entities} == {"Verse titel voor A"}
    relations = await _rows(factory, EventRelation)
    pairs = {(row.event_id, row.related_event_id): row for row in relations}
    assert (ids["a"], ids["b"]) in pairs
    reverse = pairs[(ids["b"], ids["a"])]
    assert reverse.related_title == "Verse titel voor A"  # fresh LLM title from the hook
    assert {"type": "country", "iso": "IL"} in reverse.reasons
    assert any(r.get("key") == "person:donald-trump" for r in reverse.reasons)
    assert all(ids["untitled"] not in pair for pair in pairs)
    assert service.last_runs["event_refresh"]["success"] is True

    untitled = await service.refresh_for_event(ids["untitled"])
    assert untitled["reason"] == "no_llm_title"
    assert untitled["entities_written"] == 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_refresh_for_missing_event_raises() -> None:
    factory, engine, ids, service = await _world()
    with pytest.raises(EventNotFoundError):
        await service.refresh_for_event(424242)
    assert service.last_runs["event_refresh"]["success"] is False
    await engine.dispose()


@pytest.mark.asyncio
async def test_disabled_service_does_nothing() -> None:
    factory, engine, ids, service = await _world(exploration_enabled=False)
    assert (await service.refresh_for_event(ids["a"]))["reason"] == "disabled"
    assert (await service.refresh_active())["skipped"] is True
    backfill = await service.backfill()
    assert backfill["done"] is True and backfill["processed"] == 0
    assert await _rows(factory, EventEntity) == []
    assert await _rows(factory, EventRelation) == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_refresh_active_only_recomputes_stale_entities() -> None:
    factory, engine, ids, service = await _world()

    first = await service.refresh_active()
    assert first["active_events"] == 4  # archived excluded
    assert first["entity_events_refreshed"] == 3  # untitled skipped
    entity_events = {row.event_id for row in await _rows(factory, EventEntity)}
    assert entity_events == {ids["a"], ids["b"], ids["other"]}
    assert first["relations_written"] > 0

    second = await service.refresh_active()
    assert second["entity_events_refreshed"] == 0

    async with factory() as session:  # simulate new articles on B
        await session.execute(
            update(Event)
            .where(Event.id == ids["b"])
            .values(last_updated_at=BASE_TIME + timedelta(hours=3))
        )
        await session.commit()
    service.related_service.cache.events_since = None  # force a full event reload
    service.related_service.cache.loaded_at = None
    third = await service.refresh_active()
    assert third["entity_events_refreshed"] == 1
    assert service.last_runs["refresh_active"]["success"] is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_pages_and_force() -> None:
    factory, engine, ids, service = await _world()

    page1 = await service.backfill(limit=2, offset=0)
    assert page1["processed"] == 2
    assert page1["next_offset"] == 2
    assert page1["done"] is False
    assert page1["total_events"] == 5
    page2 = await service.backfill(limit=2, offset=2)
    page3 = await service.backfill(limit=2, offset=4)
    assert page2["done"] is False and page3["done"] is True
    assert page3["next_offset"] == 5
    written = page1["entities_written"] + page2["entities_written"] + page3["entities_written"]
    assert written == 8  # 4 titled events x 2 entities (untitled is skipped)

    again = await service.backfill(limit=10, offset=0)
    assert again["entity_events_refreshed"] == 0
    assert again["done"] is True
    forced = await service.backfill(limit=10, offset=0, force=True)
    assert forced["entity_events_refreshed"] == 4
    active_only = await service.backfill(limit=10, offset=0, include_archived=False)
    assert active_only["total_events"] == 4
    assert service.last_runs["backfill"]["success"] is True

    status = await service.status()
    assert status["enabled"] is True
    assert status["event_entities_rows"] == 8
    assert status["events_with_entities"] == 4
    assert status["event_relations_rows"] > 0
    assert isinstance(status["entities_last_computed_at"], str)
    assert status["cache"]["events"] == 5
    assert set(status["last_runs"]) == {"event_refresh", "refresh_active", "backfill"}
    await engine.dispose()


@pytest.mark.asyncio
async def test_failures_are_recorded(monkeypatch) -> None:
    factory, engine, ids, service = await _world()

    async def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(service.related_service, "refresh_cache", boom)
    with pytest.raises(RuntimeError):
        await service.refresh_active()
    with pytest.raises(RuntimeError):
        await service.backfill()
    assert service.last_runs["refresh_active"]["error"] == "db down"
    assert service.last_runs["backfill"]["success"] is False
    await engine.dispose()


@pytest.mark.asyncio
async def test_exploration_never_updates_events_table() -> None:
    """Guard: events.last_updated_at has onupdate and drives feed ordering + archiving."""

    factory, engine, ids, service = await _world()
    before = await event_timestamps(factory)
    recorder = StatementRecorder(engine)

    await service.refresh_for_event(ids["a"], summary="Nieuwe titel A\n\nTekst")
    await service.refresh_active()
    await service.backfill(limit=100, force=True)
    await service.status()

    assert recorder.statements, "statement recorder did not capture anything"
    assert recorder.updates_on("events") == []
    assert not [s for s in recorder.statements if s.upper().startswith("INSERT INTO EVENTS ")]
    assert not [s for s in recorder.statements if s.upper().startswith("DELETE FROM EVENTS ")]
    assert await event_timestamps(factory) == before
    await engine.dispose()


def test_get_exploration_service_is_a_singleton(monkeypatch) -> None:
    monkeypatch.setattr(exploration_module, "_exploration_service", None)
    first = get_exploration_service()
    assert get_exploration_service() is first
    assert isinstance(first, ExplorationService)


# ---------------------------------------------------------------------------------------
# Scheduler hook: exploration refresh after event maintenance
# ---------------------------------------------------------------------------------------


class _StubExploration:
    def __init__(self, behaviour: str = "ok") -> None:
        self.behaviour = behaviour
        self.calls: list[str | None] = []

    async def refresh_active(self, correlation_id=None):
        self.calls.append(correlation_id)
        if self.behaviour == "error":
            raise RuntimeError("refresh kapot")
        if self.behaviour == "slow":
            await asyncio.sleep(1)
        return {"active_events": 3, "relations_written": 10}


def _scheduler(monkeypatch, stub: _StubExploration):
    module = real_module("backend.app.core.scheduler")
    monkeypatch.setattr(module, "get_exploration_service", lambda: stub)
    return module, module.NewsAggregatorScheduler()


@pytest.mark.asyncio
async def test_scheduler_exploration_refresh_success(monkeypatch) -> None:
    stub = _StubExploration()
    _, scheduler = _scheduler(monkeypatch, stub)
    await scheduler._run_exploration_refresh("cid-1")
    run = scheduler._exploration_last_run
    assert stub.calls == ["cid-1"]
    assert run["success"] is True
    assert run["stats"]["relations_written"] == 10
    assert run["started_at"] and run["finished_at"]
    assert scheduler.get_job_status()["exploration_last_run"] == run


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("behaviour", "error"), [("error", "refresh kapot"), ("slow", "timed out")]
)
async def test_scheduler_exploration_refresh_failures(monkeypatch, behaviour, error) -> None:
    stub = _StubExploration(behaviour)
    _, scheduler = _scheduler(monkeypatch, stub)
    scheduler.settings.exploration_refresh_timeout_seconds = 0.05
    await scheduler._run_exploration_refresh("cid-2")  # must not raise
    assert scheduler._exploration_last_run["success"] is False
    assert error in scheduler._exploration_last_run["error"]


@pytest.mark.asyncio
async def test_scheduler_exploration_refresh_disabled(monkeypatch) -> None:
    stub = _StubExploration()
    _, scheduler = _scheduler(monkeypatch, stub)
    scheduler.settings.exploration_enabled = False
    await scheduler._run_exploration_refresh("cid-3")
    assert stub.calls == []
    assert scheduler._exploration_last_run is None


@pytest.mark.asyncio
@pytest.mark.parametrize(("outcome", "expected_calls"), [("ok", 1), ("error", 0), ("timeout", 0)])
async def test_maintenance_job_triggers_exploration_after_success(
    monkeypatch, outcome, expected_calls
) -> None:
    stub = _StubExploration()
    module, scheduler = _scheduler(monkeypatch, stub)

    async def healthy():
        return True

    class _Maintenance:
        async def run(self, correlation_id=None):
            if outcome == "error":
                raise RuntimeError("maintenance kapot")
            if outcome == "timeout":
                raise asyncio.TimeoutError
            return SimpleNamespace(as_dict=lambda: {"archived": 1})

    monkeypatch.setattr(module, "ensure_healthy_connection", healthy)
    scheduler._maintenance_service = _Maintenance()
    await scheduler._event_maintenance_job()
    assert len(stub.calls) == expected_calls
