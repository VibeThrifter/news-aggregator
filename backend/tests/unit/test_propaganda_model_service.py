# ruff: noqa: S101
"""Tests for the propaganda-model writer, sync service and scheduler job (Story 11.17)."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.core.config import DEFAULT_PROPAGANDA_DB_PATH, REPO_ROOT
from backend.app.db.models import PmAlias, PmEntity, PmMeta, PmRelation, PmSource
from backend.app.services import propaganda_model_sync as pm
from backend.app.services.propaganda_model_sync import (
    PropagandaModelSyncService,
    UnsecuredTargetError,
    get_propaganda_sync_service,
    load_snapshot,
    read_sync_meta,
    table_counts,
    verify_target_secured,
    write_snapshot,
)
from backend.tests.unit._exploration_fixtures import (
    make_session_factory,
    make_settings,
    real_module,
)
from backend.tests.unit._pm_fixtures import create_pm_database


@pytest.fixture()
def pm_db(tmp_path: Path) -> Path:
    return create_pm_database(tmp_path / "propaganda-model")


@asynccontextmanager
async def _database():
    """In-memory SQLite with all tables (async generator fixtures are not supported here)."""

    session_factory, engine = await make_session_factory()
    try:
        yield session_factory
    finally:
        await engine.dispose()


def _service(factory, pm_db: Path, **overrides) -> PropagandaModelSyncService:
    settings = make_settings(propaganda_db_path=str(pm_db), **overrides)
    return PropagandaModelSyncService(settings=settings, write_session_factory=factory)


async def _count(factory, model) -> int:
    async with factory() as session:
        return int((await session.execute(select(func.count()).select_from(model))).scalar_one())


# ------------------------------------------------------------------------------ settings


def test_settings_defaults_and_resolution() -> None:
    settings = make_settings()
    assert settings.propaganda_sync_enabled is True
    assert settings.propaganda_sync_interval_minutes == 60
    assert Path(settings.propaganda_db_path) == DEFAULT_PROPAGANDA_DB_PATH
    assert DEFAULT_PROPAGANDA_DB_PATH == (
        REPO_ROOT.parent / "propaganda-model" / "data" / "propaganda_model.db"
    )
    assert Path(make_settings(propaganda_db_path="").propaganda_db_path) == (
        DEFAULT_PROPAGANDA_DB_PATH
    )
    relative = make_settings(propaganda_db_path="data/pm.db").propaganda_db_path
    assert Path(relative) == REPO_ROOT / "data" / "pm.db"
    assert make_settings(propaganda_db_path="/abs/pm.db").propaganda_db_path == "/abs/pm.db"


def test_env_example_documents_propaganda_settings() -> None:
    text = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    for key in (
        "PROPAGANDA_DB_PATH",
        "PROPAGANDA_SYNC_ENABLED",
        "PROPAGANDA_SYNC_INTERVAL_MINUTES",
    ):
        assert key in text


# -------------------------------------------------------------------------------- writer


async def test_write_snapshot_full_refresh(pm_db: Path) -> None:
    async with _database() as factory:
        snapshot = load_snapshot(pm_db)
        async with factory() as session:
            counts = await write_snapshot(session, snapshot, batch_size=2)
        assert counts == snapshot.counts()
        # a second write replaces everything (no duplicates)
        async with factory() as session:
            await write_snapshot(session, snapshot)
        assert await _count(factory, PmEntity) == len(snapshot.entities)
        assert await _count(factory, PmRelation) == len(snapshot.relations)
        assert await _count(factory, PmSource) == len(snapshot.sources)
        assert await _count(factory, PmAlias) == len(snapshot.aliases)
        async with factory() as session:
            meta = await read_sync_meta(session)
            assert meta == snapshot.meta
            assert await table_counts(session) == {
                "pm_entities": len(snapshot.entities),
                "pm_relations": len(snapshot.relations),
                "pm_sources": len(snapshot.sources),
                "pm_aliases": len(snapshot.aliases),
            }
            entity = await session.get(PmEntity, 1)
            assert entity.slug == "1-dpg-media" and entity.degree == 2
            assert entity.synced_at is not None
            relation = await session.get(PmRelation, 100)
            assert relation.certainty_label == "onderbouwd" and relation.source_count == 3
            assert relation.filter == "eigendom"
            assert relation.filters == ["eigendom", "advertentie"]
            assert (await session.get(PmRelation, 111)).filters == []


async def test_write_snapshot_rolls_back_on_error(pm_db: Path) -> None:
    async with _database() as factory:
        snapshot = load_snapshot(pm_db)
        async with factory() as session:
            await write_snapshot(session, snapshot)
        broken = load_snapshot(pm_db)
        broken.relations.append(dict(broken.relations[0]))  # duplicate primary key
        async with factory() as session:
            with pytest.raises(Exception):  # noqa: B017 - IntegrityError from the driver
                await write_snapshot(session, broken)
        # the previous snapshot is still complete
        assert await _count(factory, PmRelation) == len(snapshot.relations)
        assert await _count(factory, PmMeta) == len(snapshot.meta)


async def test_read_sync_meta_and_counts_without_tables() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        assert await read_sync_meta(session) == {}
        assert await verify_target_secured(session) == []  # not PostgreSQL
    await engine.dispose()


class _FakeResult:
    def __init__(self, value) -> None:
        self.value = value

    def all(self):
        return self.value

    def scalar_one(self):
        return self.value

    def scalars(self):
        return self.value


class _FakePostgresSession:
    """Scripted answers for the pg_catalog queries of verify_target_secured."""

    def __init__(self, *, rls: bool, policies: int, anon_select: bool) -> None:
        self.rls, self.policies, self.anon_select = rls, policies, anon_select
        self.executed: list[str] = []

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

    async def execute(self, statement, params=None):
        sql = str(statement)
        self.executed.append(sql)
        if "relrowsecurity" in sql:
            return _FakeResult([(name, self.rls) for name in pm.PM_TABLES])
        if "pg_policies" in sql:
            return _FakeResult(self.policies)
        if "pg_roles" in sql:
            return _FakeResult(["anon", "authenticated"])
        if "has_table_privilege" in sql:
            return _FakeResult(self.anon_select and params["role"] == "anon")
        raise AssertionError(f"unexpected statement {sql}")


async def test_verify_target_secured_on_postgres() -> None:
    secure = _FakePostgresSession(rls=True, policies=0, anon_select=False)
    assert await verify_target_secured(secure) == []
    insecure = _FakePostgresSession(rls=False, policies=2, anon_select=True)
    problems = await verify_target_secured(insecure)
    assert "row level security disabled on pm_entities" in problems
    assert "2 policies on pm_* tables (expected none)" in problems
    assert "anon can SELECT pm_meta" in problems
    assert not any("authenticated can SELECT" in problem for problem in problems)


async def test_write_snapshot_refuses_unsecured_postgres(pm_db: Path) -> None:
    session = _FakePostgresSession(rls=True, policies=0, anon_select=True)
    with pytest.raises(UnsecuredTargetError, match="005_propagandamodel.sql"):
        await write_snapshot(session, load_snapshot(pm_db))
    assert not any("DELETE" in sql.upper() for sql in session.executed)


# ------------------------------------------------------------------------------- service


async def test_sync_writes_then_skips_until_the_file_changes(pm_db: Path) -> None:
    async with _database() as factory:
        service = _service(factory, pm_db)
        first = await service.sync()
        assert first["skipped"] is False and first["entities"] == 15 and first["relations"] == 9
        assert first["version"].startswith("0.10.1+live.")
        assert service.last_run["success"] is True

        second = await service.sync()
        assert second["skipped"] is True and second["reason"] == "unchanged"
        assert second["db_mtime"] == first["db_mtime"]

        forced = await service.sync(force=True)
        assert forced["skipped"] is False and forced["forced"] is True

        stat = pm_db.stat()
        os.utime(pm_db, (stat.st_atime, stat.st_mtime + 60))
        changed = await service.sync()
        assert changed["skipped"] is False and changed["db_mtime"] != first["db_mtime"]
        assert await _count(factory, PmEntity) == 15


async def test_sync_reruns_when_the_row_format_changed(pm_db: Path) -> None:
    """Rows written by an older sync (no/other pm_meta.format) are refreshed, not skipped."""

    async with _database() as factory:
        service = _service(factory, pm_db)
        await service.sync()
        assert (await service.status())["up_to_date"] is True
        async with factory() as session:
            await session.execute(delete(PmMeta).where(PmMeta.key == "format"))
            await session.commit()
        assert (await service.status())["up_to_date"] is False
        rerun = await service.sync()
        assert rerun["skipped"] is False
        async with factory() as session:
            assert (await read_sync_meta(session))["format"] == pm.SNAPSHOT_FORMAT
        assert (await service.sync())["skipped"] is True


async def test_sync_detects_wal_changes(pm_db: Path) -> None:
    async with _database() as factory:
        service = _service(factory, pm_db)
        await service.sync()
        wal = pm_db.with_name(pm_db.name + "-wal")
        wal.write_bytes(b"")
        os.utime(wal, (pm_db.stat().st_mtime + 120, pm_db.stat().st_mtime + 120))
        assert (await service.sync())["skipped"] is False


async def test_sync_disabled_and_missing_file(pm_db: Path, tmp_path: Path) -> None:
    async with _database() as factory:
        disabled = _service(factory, pm_db, propaganda_sync_enabled=False)
        assert (await disabled.sync()) | {"db_path": None} == {
            "skipped": True,
            "reason": "disabled",
            "db_path": None,
            "forced": False,
        }
        missing = _service(factory, tmp_path / "missing.db")
        result = await missing.sync(force=True)
        assert result["skipped"] is True and result["reason"] == "db_missing"
        assert await _count(factory, PmEntity) == 0


async def test_sync_failure_is_recorded_and_raised(pm_db: Path) -> None:
    async with _database() as factory:

        def boom(path: Path):
            raise RuntimeError("kapot")

        service = PropagandaModelSyncService(
            settings=make_settings(propaganda_db_path=str(pm_db)),
            write_session_factory=factory,
            loader=boom,
        )
        with pytest.raises(RuntimeError, match="kapot"):
            await service.sync()
        assert service.last_run["success"] is False and service.last_run["error"] == "kapot"


async def test_status(pm_db: Path, tmp_path: Path) -> None:
    async with _database() as factory:
        service = _service(factory, pm_db)
        before = await service.status()
        assert before["enabled"] is True and before["db_exists"] is True
        assert before["synced"] == {} and before["up_to_date"] is False
        assert before["counts"] == {
            "pm_entities": 0,
            "pm_relations": 0,
            "pm_sources": 0,
            "pm_aliases": 0,
        }
        await service.sync()
        after = await service.status()
        assert after["up_to_date"] is True
        assert after["synced"]["entity_count"] == "15"
        assert after["counts"]["pm_relations"] == 9
        assert after["last_run"]["success"] is True
        assert after["interval_minutes"] == 60

        missing = await _service(factory, tmp_path / "missing.db").status()
        assert missing["db_exists"] is False and missing["db_mtime"] is None


async def test_status_without_tables(pm_db: Path) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    service = _service(async_sessionmaker(engine, expire_on_commit=False), pm_db)
    status = await service.status()
    assert status["counts"] == {} and status["synced"] == {}
    await engine.dispose()


def test_singleton(monkeypatch) -> None:
    monkeypatch.setattr(pm, "_propaganda_sync_service", None)
    first = get_propaganda_sync_service()
    assert get_propaganda_sync_service() is first


async def test_sync_is_serialised(pm_db: Path) -> None:
    async with _database() as factory:
        service = _service(factory, pm_db)
        results = await asyncio.gather(service.sync(), service.sync())
        assert sorted(result["skipped"] for result in results) == [False, True]


# ----------------------------------------------------------------------------- scheduler


class _StubSync:
    def __init__(self, behaviour: str = "ok") -> None:
        self.behaviour = behaviour
        self.calls: list[str | None] = []

    async def sync(self, force: bool = False, correlation_id: str | None = None):
        self.calls.append(correlation_id)
        if self.behaviour == "error":
            raise RuntimeError("sync kapot")
        if self.behaviour == "slow":
            await asyncio.sleep(1)
        return {"skipped": False, "reason": None, "entities": 3}


def _scheduler(monkeypatch, stub: _StubSync, *, healthy: bool = True):
    module = real_module("backend.app.core.scheduler")
    monkeypatch.setattr(module, "get_propaganda_sync_service", lambda: stub)

    async def _healthy() -> bool:
        return healthy

    monkeypatch.setattr(module, "ensure_healthy_connection", _healthy)
    return module, module.NewsAggregatorScheduler()


def test_scheduler_registers_propaganda_job(monkeypatch) -> None:
    module, scheduler = _scheduler(monkeypatch, _StubSync())
    scheduler.settings.propaganda_sync_interval_minutes = 45
    scheduler.setup_jobs()
    job = scheduler.scheduler.get_job("propagandamodel_sync")
    assert job is not None and job.name == "Propagandamodel Sync"
    assert job.max_instances == 1
    assert job.trigger.interval.total_seconds() == 45 * 60


def test_scheduler_skips_propaganda_job_when_disabled(monkeypatch) -> None:
    module, scheduler = _scheduler(monkeypatch, _StubSync())
    scheduler.settings.propaganda_sync_enabled = False
    scheduler.setup_jobs()
    assert scheduler.scheduler.get_job("propagandamodel_sync") is None


async def test_scheduler_propaganda_job_success(monkeypatch) -> None:
    stub = _StubSync()
    module, scheduler = _scheduler(monkeypatch, stub)
    await scheduler._propaganda_sync_job()
    run = scheduler._propaganda_sync_last_run
    assert len(stub.calls) == 1 and stub.calls[0]
    assert run["success"] is True and run["result"]["entities"] == 3
    assert run["started_at"] and run["finished_at"]
    assert scheduler.get_job_status()["propagandamodel_last_run"] == run


@pytest.mark.parametrize(("behaviour", "error"), [("error", "sync kapot"), ("slow", "timed out")])
async def test_scheduler_propaganda_job_failures(monkeypatch, behaviour, error) -> None:
    module, scheduler = _scheduler(monkeypatch, _StubSync(behaviour))
    monkeypatch.setattr(module, "PROPAGANDA_SYNC_TIMEOUT_SECONDS", 0.05)
    await scheduler._propaganda_sync_job()  # must not raise
    assert scheduler._propaganda_sync_last_run["success"] is False
    assert error in scheduler._propaganda_sync_last_run["error"]


async def test_scheduler_propaganda_job_unhealthy_database(monkeypatch) -> None:
    stub = _StubSync()
    module, scheduler = _scheduler(monkeypatch, stub, healthy=False)
    await scheduler._propaganda_sync_job()
    assert stub.calls == []
    assert scheduler._propaganda_sync_last_run["error"] == "database connection unhealthy"


def test_job_status_when_stopped(monkeypatch) -> None:
    module, scheduler = _scheduler(monkeypatch, _StubSync())
    scheduler._propaganda_sync_last_run = {"success": True, "at": datetime.now(timezone.utc)}
    status = scheduler.get_job_status()
    assert status["status"] == "stopped"
    assert status["propagandamodel_last_run"]["success"] is True
