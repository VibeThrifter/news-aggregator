"""Exploration facade for the Onderzoeksmodus (Epic 11, Story 11.8).

Keeps ``event_entities`` (canonical entities per event) and ``event_relations`` (related
events with reasons) up to date:

- ``refresh_for_event``: after insight generation (entities, then relations of one event)
- ``refresh_active``: after the daily event maintenance (stale entities + all active events)
- ``backfill``: paged recomputation for existing events (admin endpoint)

Inputs are read via ``get_read_session()`` (SQLite cache when enabled); the derived tables are
written to the primary database only. The ``events`` table is never written.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.llm.title import extract_title_from_summary
from backend.app.repositories.exploration_repo import ExplorationRepository
from backend.app.services.event_entity_service import (
    EntityRefreshResult,
    EventEntityService,
    SessionFactory,
)
from backend.app.services.related_events_service import (
    EntityRef,
    RelatedEventsService,
    RelationRefreshResult,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.app.nlp.entity_keys import CountryIndex
    from backend.app.services.country_detector import CountryMapping

logger = get_logger(__name__).bind(component="ExplorationService")


class EventNotFoundError(ValueError):
    """Raised when an event does not exist."""


def _default_read_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.dual_write import get_read_session

    return get_read_session()


def _default_write_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.session import get_sessionmaker

    return get_sessionmaker()()


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def is_entity_stale(computed_for: datetime | None, last_updated_at: datetime | None) -> bool:
    """Entities are stale when missing or computed for an older ``events.last_updated_at``."""

    if computed_for is None:
        return True
    if last_updated_at is None:
        return False
    return _as_utc(computed_for) < _as_utc(last_updated_at)


class ExplorationService:
    """Facade combining entity aggregation and related-event scoring."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        read_session_factory: SessionFactory | None = None,
        write_session_factory: SessionFactory | None = None,
        entity_service: EventEntityService | None = None,
        related_service: RelatedEventsService | None = None,
        country_mapping: CountryMapping | CountryIndex | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._read = read_session_factory or _default_read_factory
        self._write = write_session_factory or _default_write_factory
        self.entity_service = entity_service or EventEntityService(
            settings=self.settings,
            read_session_factory=self._read,
            write_session_factory=self._write,
            country_mapping=country_mapping,
        )
        self.related_service = related_service or RelatedEventsService(
            settings=self.settings,
            read_session_factory=self._read,
            write_session_factory=self._write,
            entity_session_factory=self._write,
        )
        # Serialises refreshes within this process (hook, scheduler and admin triggers).
        self._lock = asyncio.Lock()
        self.last_runs: dict[str, dict[str, Any] | None] = {
            "event_refresh": None,
            "refresh_active": None,
            "backfill": None,
        }

    @property
    def enabled(self) -> bool:
        return bool(self.settings.exploration_enabled)

    # ------------------------------------------------------------------ helpers
    def _apply_entities_to_cache(self, result: EntityRefreshResult) -> None:
        cache = self.related_service.cache
        for event_id, entries in result.entities_by_event.items():
            cache.set_entities(
                event_id, {key: EntityRef(kind=kind, name=name) for key, kind, name in entries}
            )

    async def _stale_entity_events(self, event_ids: Sequence[int]) -> list[int]:
        cache = self.related_service.cache
        titled = [event_id for event_id in event_ids if cache.is_candidate(event_id)]
        if not titled:
            return []
        async with self._write() as session:
            freshness = await ExplorationRepository(session).entity_freshness()
        return [
            event_id
            for event_id in titled
            if is_entity_stale(freshness.get(event_id), cache.events[event_id].last_updated_at)
        ]

    def _record(self, name: str, started: float, started_at: datetime, **details: Any) -> None:
        self.last_runs[name] = {
            "started_at": started_at.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "duration_seconds": round(time.monotonic() - started, 3),
            **details,
        }

    def _disabled(self, **details: Any) -> dict[str, Any]:
        return {"skipped": True, "reason": "disabled", **details}

    # ------------------------------------------------------------------ operations
    async def refresh_for_event(
        self,
        event_id: int,
        summary: str | None = None,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        """Recompute entities and relations of one event (e.g. after insight generation)."""

        if not self.enabled:
            return self._disabled(event_id=event_id)
        started, started_at = time.monotonic(), datetime.now(timezone.utc)
        try:
            async with self._lock:
                summaries: Mapping[int, str | None] | None = (
                    {event_id: summary} if summary else None
                )
                entities = await self.entity_service.refresh_events(
                    [event_id], summaries=summaries, correlation_id=correlation_id
                )
                if event_id in entities.missing:
                    raise EventNotFoundError(f"Event {event_id} not found")
                await self.related_service.refresh_cache()
                self._apply_entities_to_cache(entities)
                title = extract_title_from_summary(summary) if summary else None
                if title:
                    self.related_service.cache.set_title(event_id, title)
                relations = await self.related_service.refresh(
                    [event_id], refresh_cache=False, correlation_id=correlation_id
                )
        except Exception as exc:
            self._record("event_refresh", started, started_at, success=False, error=str(exc))
            raise
        outcome = {
            "event_id": event_id,
            "skipped": False,
            "reason": "no_llm_title" if event_id in entities.skipped_no_title else None,
            "entities_written": entities.rows_written,
            "relations_written": relations.rows_written,
            "relations_deleted": relations.deleted_rows + relations.pruned_rows,
        }
        self._record("event_refresh", started, started_at, success=True, **outcome)
        logger.info("exploration_event_refreshed", correlation_id=correlation_id, **outcome)
        return outcome

    async def refresh_active(self, correlation_id: str | None = None) -> dict[str, Any]:
        """Recompute stale entities, then relations for all active (non-archived) events."""

        if not self.enabled:
            return self._disabled()
        started, started_at = time.monotonic(), datetime.now(timezone.utc)
        try:
            async with self._lock:
                await self.related_service.refresh_cache()
                cache = self.related_service.cache
                active = sorted(
                    event_id for event_id, event in cache.events.items() if not event.archived
                )
                stale = await self._stale_entity_events(active)
                entities = await self.entity_service.refresh_events(
                    stale, correlation_id=correlation_id
                )
                self._apply_entities_to_cache(entities)
                relations = await self.related_service.refresh(
                    active, refresh_cache=False, correlation_id=correlation_id
                )
        except Exception as exc:
            self._record("refresh_active", started, started_at, success=False, error=str(exc))
            raise
        stats = {
            "active_events": len(active),
            "entity_events_refreshed": len(entities.events_written),
            "entities_written": entities.rows_written,
            "relations_written": relations.rows_written,
            "relations_deleted": relations.deleted_rows + relations.pruned_rows,
        }
        self._record("refresh_active", started, started_at, success=True, **stats)
        logger.info("exploration_active_refreshed", correlation_id=correlation_id, **stats)
        return stats

    async def backfill(
        self,
        limit: int = 100,
        offset: int = 0,
        include_archived: bool = True,
        force: bool = False,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        """Process one page of events (ordered by id): entities (missing/stale or ``force``)
        and relations. Call repeatedly with ``next_offset`` until ``done``; a second pass
        improves relations of the first pages (the entity index is then complete)."""

        if not self.enabled:
            return self._disabled(
                processed=0,
                entities_written=0,
                relations_written=0,
                next_offset=offset,
                done=True,
            )
        started, started_at = time.monotonic(), datetime.now(timezone.utc)
        try:
            async with self._lock:
                await self.related_service.refresh_cache()
                cache = self.related_service.cache
                ids = sorted(
                    event_id
                    for event_id, event in cache.events.items()
                    if include_archived or not event.archived
                )
                page = ids[offset : offset + limit]
                if force:
                    to_compute = [event_id for event_id in page if cache.is_candidate(event_id)]
                else:
                    to_compute = await self._stale_entity_events(page)
                entities = await self.entity_service.refresh_events(
                    to_compute, correlation_id=correlation_id
                )
                self._apply_entities_to_cache(entities)
                relations: RelationRefreshResult = await self.related_service.refresh(
                    page, refresh_cache=False, correlation_id=correlation_id
                )
        except Exception as exc:
            self._record("backfill", started, started_at, success=False, error=str(exc))
            raise
        next_offset = offset + len(page)
        outcome = {
            "processed": len(page),
            "entities_written": entities.rows_written,
            "relations_written": relations.rows_written,
            "next_offset": next_offset,
            "done": next_offset >= len(ids),
            "total_events": len(ids),
            "entity_events_refreshed": len(entities.events_written),
            "skipped_no_title": len(entities.skipped_no_title),
        }
        self._record("backfill", started, started_at, success=True, offset=offset, **outcome)
        logger.info("exploration_backfill_page", correlation_id=correlation_id, **outcome)
        return outcome

    async def status(self) -> dict[str, Any]:
        """Row counts (primary database), last runs and cache statistics."""

        async with self._write() as session:
            counts = await ExplorationRepository(session).counts()
        return {
            "enabled": self.enabled,
            **{key: _iso(value) for key, value in counts.items()},
            "last_runs": dict(self.last_runs),
            "cache": self.related_service.cache.stats(),
        }


_exploration_service: ExplorationService | None = None


def get_exploration_service() -> ExplorationService:
    """Singleton accessor (the vector cache lives as long as the process)."""

    global _exploration_service
    if _exploration_service is None:
        _exploration_service = ExplorationService()
    return _exploration_service


__all__ = [
    "EventNotFoundError",
    "ExplorationService",
    "get_exploration_service",
    "is_entity_stale",
]
