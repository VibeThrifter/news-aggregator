# ruff: noqa: S101
"""Tests for the exploration admin endpoints (Story 11.8)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.app.routers import admin
from backend.app.services.exploration_service import EventNotFoundError


class _StubService:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[str, dict]] = []

    async def refresh_for_event(self, event_id: int, summary=None, correlation_id=None):
        self.calls.append(("event", {"event_id": event_id}))
        if self.error:
            raise self.error
        return {
            "event_id": event_id,
            "skipped": False,
            "reason": None,
            "entities_written": 12,
            "relations_written": 20,
            "relations_deleted": 3,
        }

    async def backfill(self, limit=100, offset=0, include_archived=True, force=False):
        self.calls.append(
            (
                "backfill",
                {
                    "limit": limit,
                    "offset": offset,
                    "include_archived": include_archived,
                    "force": force,
                },
            )
        )
        return {
            "processed": limit,
            "entities_written": 40,
            "relations_written": 80,
            "next_offset": offset + limit,
            "done": False,
            "total_events": 1300,
            "entity_events_refreshed": 5,
            "skipped_no_title": 1,
        }

    async def refresh_active(self, correlation_id=None):
        self.calls.append(("refresh", {}))
        return {
            "active_events": 250,
            "entity_events_refreshed": 12,
            "entities_written": 300,
            "relations_written": 2900,
            "relations_deleted": 40,
        }

    async def status(self):
        return {
            "enabled": True,
            "event_entities_rows": 100,
            "events_with_entities": 10,
            "entities_last_computed_at": "2026-09-30T10:00:00+00:00",
            "event_relations_rows": 120,
            "events_with_relations": 10,
            "relations_last_computed_at": None,
            "last_runs": {"event_refresh": None, "refresh_active": None, "backfill": None},
            "cache": {"events": 10},
        }


@pytest.fixture()
def stub(monkeypatch) -> _StubService:
    service = _StubService()
    monkeypatch.setattr(admin, "get_exploration_service", lambda: service)
    return service


@pytest.mark.asyncio
async def test_trigger_exploration_event(stub) -> None:
    response = await admin.trigger_exploration_event(42)
    assert response.event_id == 42
    assert response.entities_written == 12
    assert response.relations_written == 20
    assert stub.calls == [("event", {"event_id": 42})]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "status_code"),
    [(EventNotFoundError("Event 7 not found"), 404), (RuntimeError("db down"), 500)],
)
async def test_trigger_exploration_event_errors(monkeypatch, error, status_code) -> None:
    monkeypatch.setattr(admin, "get_exploration_service", lambda: _StubService(error))
    with pytest.raises(HTTPException) as exc_info:
        await admin.trigger_exploration_event(7)
    assert exc_info.value.status_code == status_code


@pytest.mark.asyncio
async def test_trigger_exploration_event_disabled(monkeypatch) -> None:
    class _Disabled(_StubService):
        async def refresh_for_event(self, event_id: int, summary=None, correlation_id=None):
            return {"skipped": True, "reason": "disabled", "event_id": event_id}

    monkeypatch.setattr(admin, "get_exploration_service", lambda: _Disabled())
    response = await admin.trigger_exploration_event(3)
    assert response.skipped is True and response.reason == "disabled"
    assert response.entities_written == 0


@pytest.mark.asyncio
async def test_trigger_exploration_backfill(stub) -> None:
    response = await admin.trigger_exploration_backfill(
        limit=50, offset=100, include_archived=False, force=True
    )
    assert response.processed == 50
    assert response.next_offset == 150
    assert response.done is False
    assert stub.calls == [
        ("backfill", {"limit": 50, "offset": 100, "include_archived": False, "force": True})
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("limit", "offset", "message"),
    [
        (0, 0, "limit must be between 1 and 500"),
        (501, 0, "limit must be between 1 and 500"),
        (10, -1, "offset must be >= 0"),
    ],
)
async def test_trigger_exploration_backfill_validation(stub, limit, offset, message) -> None:
    with pytest.raises(HTTPException) as exc_info:
        await admin.trigger_exploration_backfill(limit=limit, offset=offset)
    assert exc_info.value.status_code == 400
    assert message in exc_info.value.detail
    assert stub.calls == []


@pytest.mark.asyncio
async def test_trigger_exploration_refresh(stub) -> None:
    response = await admin.trigger_exploration_refresh()
    assert response.active_events == 250
    assert response.relations_written == 2900
    assert stub.calls == [("refresh", {})]


@pytest.mark.asyncio
async def test_exploration_status(stub) -> None:
    response = await admin.exploration_status()
    assert response.enabled is True
    assert response.event_entities_rows == 100
    assert response.relations_last_computed_at is None
    assert response.cache == {"events": 10}


def test_routes_are_registered() -> None:
    paths = {route.path for route in admin.router.routes}
    assert "/admin/trigger/exploration/{event_id}" in paths
    assert "/admin/trigger/exploration-backfill" in paths
    assert "/admin/trigger/exploration-refresh" in paths
    assert "/admin/exploration/status" in paths
