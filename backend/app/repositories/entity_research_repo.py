"""Repository for ``entity_research`` and the triage inputs (Epic 12 "Wie is dit?").

``entity_research`` and ``event_entities`` are derived tables in the primary database (never
dual-written to the SQLite cache); article texts and LLM insights are read through the read
session (SQLite cache when enabled, so no Supabase egress).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import Article, EntityResearch, EventEntity, LLMInsight

logger = get_logger(__name__)

_CHUNK_SIZE = 500
# Article text read per article for role cues (bylines and most mentions are at the start).
ARTICLE_PREFIX_CHARS = 6000

TRIAGE_FIELDS: tuple[str, ...] = (
    "name",
    "kind",
    "role_category",
    "role_label",
    "is_foreign",
    "priority",
    "prominence",
    "pm_entity_id",
    "pm_degree",
    "status",
    "status_reason",
    "triaged_at",
)


def _chunks(items: Sequence[Any], size: int = _CHUNK_SIZE) -> Iterable[Sequence[Any]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _recency(row: EventEntity) -> tuple[bool, float, int]:
    moment = row.event_last_updated_at
    return (moment is not None, moment.timestamp() if moment else 0.0, row.event_id)


class EntityResearchRepository:
    """Reads/writes ``entity_research`` and reads ``event_entities`` (primary database)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ------------------------------------------------------------------ entity_research
    async def get_many(self, keys: Iterable[str]) -> dict[str, EntityResearch]:
        wanted = sorted(set(keys))
        rows: dict[str, EntityResearch] = {}
        for chunk in _chunks(wanted):
            result = await self.session.execute(
                select(EntityResearch).where(EntityResearch.entity_key.in_(chunk))
            )
            for row in result.scalars():
                rows[row.entity_key] = row
        return rows

    async def upsert(self, key: str, values: Mapping[str, Any]) -> EntityResearch:
        """Insert or update one row (ORM, dialect independent). Caller commits."""

        row = await self.session.get(EntityResearch, key)
        if row is None:
            row = EntityResearch(entity_key=key, name=str(values.get("name") or key))
            self.session.add(row)
        for field, value in values.items():
            setattr(row, field, value)
        return row

    async def requests_to_triage(self, limit: int) -> list[EntityResearch]:
        """Taps in the app that were not assessed since the tap."""

        result = await self.session.execute(
            select(EntityResearch)
            .where(
                EntityResearch.last_requested_at.is_not(None),
                (EntityResearch.triaged_at.is_(None))
                | (EntityResearch.last_requested_at > EntityResearch.triaged_at),
            )
            .order_by(EntityResearch.last_requested_at.desc())
            .limit(limit)
        )
        return list(result.scalars())

    async def by_status(
        self, statuses: Sequence[str], limit: int | None = None
    ) -> list[EntityResearch]:
        query = (
            select(EntityResearch)
            .where(EntityResearch.status.in_(tuple(statuses)))
            .order_by(EntityResearch.priority.desc(), EntityResearch.entity_key)
        )
        if limit is not None:
            query = query.limit(limit)
        return list((await self.session.execute(query)).scalars())

    async def count_queued_since(self, since: datetime, *, requested: bool) -> int:
        condition = (
            EntityResearch.last_requested_at.is_not(None)
            if requested
            else EntityResearch.last_requested_at.is_(None)
        )
        result = await self.session.execute(
            select(func.count())
            .select_from(EntityResearch)
            .where(EntityResearch.queued_at >= since, condition)
        )
        return int(result.scalar_one())

    async def counts_by_status(self) -> dict[str, int]:
        result = await self.session.execute(
            select(EntityResearch.status, func.count()).group_by(EntityResearch.status)
        )
        return {status: int(count) for status, count in result.all()}

    # ------------------------------------------------------------------ event_entities
    async def changed_entity_keys(
        self, *, computed_after: datetime, updated_after: datetime, limit: int
    ) -> list[str]:
        """Person/org keys of events recomputed since the watermark (most mentioned first)."""

        result = await self.session.execute(
            select(EventEntity.entity_key, func.sum(EventEntity.article_count).label("articles"))
            .where(
                EventEntity.kind.in_(("person", "org")),
                EventEntity.computed_at > computed_after,
                EventEntity.event_last_updated_at >= updated_after,
            )
            .group_by(EventEntity.entity_key)
            .order_by(func.sum(EventEntity.article_count).desc(), EventEntity.entity_key)
            .limit(limit)
        )
        return [key for key, _articles in result.all()]

    async def latest_computed_at(self) -> datetime | None:
        result = await self.session.execute(select(func.max(EventEntity.computed_at)))
        return result.scalar_one_or_none()

    async def entity_rows(
        self, keys: Sequence[str], *, updated_after: datetime | None = None
    ) -> list[EventEntity]:
        """All event rows of these keys (optionally only recent events), newest event first."""

        rows: list[EventEntity] = []
        for chunk in _chunks(sorted(set(keys))):
            query = select(EventEntity).where(EventEntity.entity_key.in_(chunk))
            if updated_after is not None:
                query = query.where(EventEntity.event_last_updated_at >= updated_after)
            rows.extend((await self.session.execute(query)).scalars())
        rows.sort(key=_recency, reverse=True)
        return rows

    async def event_rows_by_slug(self, event_slug: str) -> list[EventEntity]:
        """Entities of one event (resolving an actor key tapped on that event page)."""

        result = await self.session.execute(
            select(EventEntity).where(EventEntity.event_slug == event_slug)
        )
        return list(result.scalars())


class TriageInputRepository:
    """Article texts and LLM authority analyses (read session: SQLite cache when enabled)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def article_snippets(self, article_ids: Sequence[int]) -> dict[int, dict[str, Any]]:
        """id -> {source_name, url, published_at, entities, content (first 6000 chars)}."""

        articles: dict[int, dict[str, Any]] = {}
        for chunk in _chunks(sorted(set(article_ids))):
            result = await self.session.execute(
                select(
                    Article.id,
                    Article.source_name,
                    Article.url,
                    Article.published_at,
                    Article.entities,
                    func.substr(Article.content, 1, ARTICLE_PREFIX_CHARS).label("content"),
                ).where(Article.id.in_(chunk))
            )
            for row in result.all():
                articles[row.id] = {
                    "source_name": row.source_name,
                    "url": row.url,
                    "published_at": row.published_at,
                    "entities": row.entities or [],
                    "content": row.content or "",
                }
        return articles

    async def article_refs(self, article_ids: Sequence[int]) -> dict[int, dict[str, Any]]:
        """id -> {source_name, url, published_at} (no text; for organisations)."""

        articles: dict[int, dict[str, Any]] = {}
        for chunk in _chunks(sorted(set(article_ids))):
            result = await self.session.execute(
                select(Article.id, Article.source_name, Article.url, Article.published_at).where(
                    Article.id.in_(chunk)
                )
            )
            for row in result.all():
                articles[row.id] = {
                    "source_name": row.source_name,
                    "url": row.url,
                    "published_at": row.published_at,
                    "entities": [],
                    "content": "",
                }
        return articles

    async def authorities_by_event(
        self, event_ids: Sequence[int]
    ) -> dict[int, list[dict[str, Any]]]:
        """Latest ``authority_analysis`` per event."""

        latest: dict[int, tuple[datetime | None, list[dict[str, Any]]]] = {}
        for chunk in _chunks(sorted(set(event_ids))):
            result = await self.session.execute(
                select(
                    LLMInsight.event_id, LLMInsight.generated_at, LLMInsight.authority_analysis
                ).where(LLMInsight.event_id.in_(chunk))
            )
            for event_id, generated_at, authorities in result.all():
                current = latest.get(event_id)
                if current is None or (
                    generated_at and (current[0] is None or generated_at > current[0])
                ):
                    latest[event_id] = (generated_at, list(authorities or []))
        return {event_id: items for event_id, (_at, items) in latest.items()}


__all__ = [
    "ARTICLE_PREFIX_CHARS",
    "EntityResearchRepository",
    "TRIAGE_FIELDS",
    "TriageInputRepository",
]
