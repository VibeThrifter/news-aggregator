# ruff: noqa: S101
"""Tests for the propaganda-model admin endpoints (Story 11.17)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.app.routers import admin
from backend.app.services.propaganda_model_sync import UnsecuredTargetError


class _StubService:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[bool] = []

    async def sync(self, force: bool = False, correlation_id: str | None = None):
        self.calls.append(force)
        if self.error:
            raise self.error
        if not force:
            return {
                "skipped": True,
                "reason": "unchanged",
                "db_mtime": "2026-09-30T12:00:00+00:00",
                "db_path": "/pm.db",
                "forced": False,
            }
        return {
            "skipped": False,
            "reason": None,
            "version": "0.1.0+live.20260930",
            "db_mtime": "2026-09-30T12:00:00+00:00",
            "entities": 1195,
            "relations": 2091,
            "sources": 2287,
            "aliases": 1425,
            "db_path": "/pm.db",
            "forced": True,
        }

    async def status(self):
        return {
            "enabled": True,
            "db_path": "/pm.db",
            "db_exists": True,
            "db_mtime": "2026-09-30T12:00:00+00:00",
            "interval_minutes": 60,
            "synced": {"version": "0.1.0+live.20260930", "entity_count": "1195"},
            "up_to_date": True,
            "counts": {"pm_entities": 1195, "pm_relations": 2091},
            "last_run": None,
        }


@pytest.fixture()
def stub(monkeypatch) -> _StubService:
    service = _StubService()
    monkeypatch.setattr(admin, "get_propaganda_sync_service", lambda: service)
    return service


async def test_trigger_sync_unchanged(stub) -> None:
    response = await admin.trigger_propagandamodel_sync()
    assert response.skipped is True and response.reason == "unchanged"
    assert response.entities == 0
    assert stub.calls == [False]


async def test_trigger_sync_forced(stub) -> None:
    response = await admin.trigger_propagandamodel_sync(force=True)
    assert response.skipped is False and response.forced is True
    assert response.relations == 2091 and response.version == "0.1.0+live.20260930"
    assert stub.calls == [True]


@pytest.mark.parametrize(
    ("error", "status_code"),
    [(UnsecuredTargetError("anon can SELECT pm_entities"), 409), (RuntimeError("db down"), 500)],
)
async def test_trigger_sync_errors(monkeypatch, error, status_code) -> None:
    monkeypatch.setattr(admin, "get_propaganda_sync_service", lambda: _StubService(error))
    with pytest.raises(HTTPException) as exc_info:
        await admin.trigger_propagandamodel_sync()
    assert exc_info.value.status_code == status_code


async def test_status(stub) -> None:
    response = await admin.propagandamodel_status()
    assert response.enabled is True and response.up_to_date is True
    assert response.counts["pm_relations"] == 2091
    assert response.synced["version"] == "0.1.0+live.20260930"


def test_routes_are_registered() -> None:
    routes = {(route.path, tuple(sorted(route.methods))) for route in admin.router.routes}
    assert ("/admin/trigger/propagandamodel-sync", ("POST",)) in routes
    assert ("/admin/propagandamodel/status", ("GET",)) in routes
