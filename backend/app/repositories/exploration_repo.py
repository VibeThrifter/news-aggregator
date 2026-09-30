"""Repository for the exploration tables ``event_entities`` and ``event_relations`` (Story 11.8).

Both tables hold derived data: they are written to the primary database only (never
dual-written to the SQLite cache) and NEVER touch the ``events`` table.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import Event, EventEntity, EventRelation

logger = get_logger(__name__)

# Keep IN-lists and multi-row inserts well below driver parameter limits.
_CHUNK_SIZE = 500

# Columns updated when a relation row already exists (everything except the pair + id).
RELATION_UPDATE_COLUMNS: tuple[str, ...] = (
    "score",
    "embedding_similarity",
    "entity_overlap",
    "country_overlap",
    "reasons",
    "related_slug",
    "related_title",
    "related_event_type",
    "related_article_count",
    "related_first_seen_at",
    "related_last_updated_at",
    "computed_at",
)


@dataclass(slots=True)
class EntityIndexRow:
    """Minimal entity data needed for relation scoring."""

    event_id: int
    entity_key: str
    kind: str
    name: str
    computed_at: datetime | None


@dataclass(slots=True)
class DisplayFields:
    """Denormalised display fields of an event (LLM title only)."""

    slug: str | None
    title: str
    event_type: str | None
    article_count: int | None
    first_seen_at: datetime | None
    last_updated_at: datetime | None


def _chunks(items: Sequence[Any], size: int = _CHUNK_SIZE) -> Iterable[Sequence[Any]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


class ExplorationRepository:
    """Encapsulates read/write operations for event entities and relations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.log = logger.bind(component="ExplorationRepository")

    # ------------------------------------------------------------------ helpers
    def _dialect_name(self) -> str:
        return self.session.get_bind().dialect.name

    def _insert(self, model: type) -> Any:
        if self._dialect_name() == "postgresql":
            return pg_insert(model)
        return sqlite_insert(model)

    async def existing_event_ids(self, event_ids: Iterable[int]) -> set[int]:
        """Return the subset of ``event_ids`` that exist in ``events`` (read-only)."""

        ids = sorted(set(event_ids))
        found: set[int] = set()
        for chunk in _chunks(ids):
            result = await self.session.execute(select(Event.id).where(Event.id.in_(chunk)))
            found.update(int(row[0]) for row in result.all())
        return found

    # ------------------------------------------------------------------ entities
    async def replace_event_entities(
        self,
        event_ids: Sequence[int],
        rows: Sequence[Mapping[str, Any]],
    ) -> int:
        """Delete all entity rows of ``event_ids`` and insert ``rows``. Returns rows inserted."""

        ids = sorted(set(event_ids))
        for chunk in _chunks(ids):
            await self.session.execute(delete(EventEntity).where(EventEntity.event_id.in_(chunk)))
        inserted = 0
        for chunk in _chunks(list(rows)):
            await self.session.execute(self._insert(EventEntity).values(list(chunk)))
            inserted += len(chunk)
        await self.session.flush()
        return inserted

    async def load_entity_index(self, since: datetime | None = None) -> list[EntityIndexRow]:
        """Load entity keys for all events, or only for events recomputed at/after ``since``."""

        stmt = select(
            EventEntity.event_id,
            EventEntity.entity_key,
            EventEntity.kind,
            EventEntity.name,
            EventEntity.computed_at,
        )
        if since is not None:
            recent = select(EventEntity.event_id).where(EventEntity.computed_at >= since).distinct()
            stmt = stmt.where(EventEntity.event_id.in_(recent))
        result = await self.session.execute(stmt.order_by(EventEntity.event_id))
        return [
            EntityIndexRow(
                event_id=int(row.event_id),
                entity_key=row.entity_key,
                kind=row.kind,
                name=row.name,
                computed_at=row.computed_at,
            )
            for row in result.all()
        ]

    async def entity_freshness(self) -> dict[int, datetime | None]:
        """Map event_id -> the ``events.last_updated_at`` value its entities were computed for."""

        stmt = select(EventEntity.event_id, func.max(EventEntity.event_last_updated_at)).group_by(
            EventEntity.event_id
        )
        result = await self.session.execute(stmt)
        return {int(row[0]): row[1] for row in result.all()}

    # ------------------------------------------------------------------ relations
    async def replace_outgoing_relations(
        self,
        event_ids: Sequence[int],
        rows: Sequence[Mapping[str, Any]],
    ) -> int:
        """Delete all outgoing rows of ``event_ids`` and write ``rows`` (upsert-safe)."""

        ids = sorted(set(event_ids))
        for chunk in _chunks(ids):
            await self.session.execute(
                delete(EventRelation).where(EventRelation.event_id.in_(chunk))
            )
        return await self.upsert_relations(rows)

    async def upsert_relations(self, rows: Sequence[Mapping[str, Any]]) -> int:
        """Insert rows; on (event_id, related_event_id) conflict update the existing row."""

        deduped: dict[tuple[int, int], Mapping[str, Any]] = {}
        for row in rows:
            deduped[(int(row["event_id"]), int(row["related_event_id"]))] = row
        values = list(deduped.values())
        for chunk in _chunks(values):
            stmt = self._insert(EventRelation).values(list(chunk))
            stmt = stmt.on_conflict_do_update(
                index_elements=["event_id", "related_event_id"],
                set_={column: getattr(stmt.excluded, column) for column in RELATION_UPDATE_COLUMNS},
            )
            await self.session.execute(stmt)
        await self.session.flush()
        return len(values)

    async def delete_relation_pairs(self, pairs: Iterable[tuple[int, int]]) -> int:
        """Delete specific (event_id, related_event_id) rows."""

        unique_pairs = sorted(set(pairs))
        deleted = 0
        for chunk in _chunks(unique_pairs):
            result = await self.session.execute(
                delete(EventRelation).where(
                    tuple_(EventRelation.event_id, EventRelation.related_event_id).in_(chunk)
                )
            )
            deleted += result.rowcount or 0
        return deleted

    async def load_incoming_pairs(
        self,
        related_event_ids: Sequence[int],
        *,
        exclude_sources: Iterable[int] = (),
    ) -> list[tuple[int, int]]:
        """Return (event_id, related_event_id) pairs pointing at ``related_event_ids``."""

        excluded = set(exclude_sources)
        pairs: list[tuple[int, int]] = []
        for chunk in _chunks(sorted(set(related_event_ids))):
            result = await self.session.execute(
                select(EventRelation.event_id, EventRelation.related_event_id).where(
                    EventRelation.related_event_id.in_(chunk)
                )
            )
            pairs.extend(
                (int(source), int(target))
                for source, target in result.all()
                if int(source) not in excluded
            )
        return pairs

    async def prune_relations(self, event_ids: Iterable[int], keep: int) -> int:
        """Keep only the ``keep`` best-scoring outgoing rows for each event in ``event_ids``."""

        ids = sorted(set(event_ids))
        deleted = 0
        for chunk in _chunks(ids):
            ranked = (
                select(
                    EventRelation.id.label("id"),
                    func.row_number()
                    .over(
                        partition_by=EventRelation.event_id,
                        order_by=(EventRelation.score.desc(), EventRelation.id.asc()),
                    )
                    .label("rn"),
                )
                .where(EventRelation.event_id.in_(chunk))
                .subquery()
            )
            result = await self.session.execute(
                delete(EventRelation).where(
                    EventRelation.id.in_(select(ranked.c.id).where(ranked.c.rn > keep))
                )
            )
            deleted += result.rowcount or 0
        return deleted

    async def refresh_display_fields(self, event_id: int, display: DisplayFields) -> int:
        """Refresh denormalised fields that describe ``event_id`` in both exploration tables.

        Updates ``event_relations`` rows pointing at the event and the event's own
        ``event_entities`` rows. Never touches the ``events`` table.
        """

        relations = await self.session.execute(
            update(EventRelation)
            .where(EventRelation.related_event_id == event_id)
            .values(
                related_slug=display.slug,
                related_title=display.title,
                related_event_type=display.event_type,
                related_article_count=display.article_count,
                related_first_seen_at=display.first_seen_at,
                related_last_updated_at=display.last_updated_at,
            )
        )
        entities = await self.session.execute(
            update(EventEntity)
            .where(EventEntity.event_id == event_id)
            .values(
                event_slug=display.slug,
                event_title=display.title,
                event_type=display.event_type,
                event_last_updated_at=display.last_updated_at,
            )
        )
        return (relations.rowcount or 0) + (entities.rowcount or 0)

    # ------------------------------------------------------------------ stats
    async def counts(self) -> dict[str, Any]:
        """Row counts and last computation timestamps for the status endpoint."""

        entity_stats = (
            await self.session.execute(
                select(
                    func.count(EventEntity.id),
                    func.count(func.distinct(EventEntity.event_id)),
                    func.max(EventEntity.computed_at),
                )
            )
        ).one()
        relation_stats = (
            await self.session.execute(
                select(
                    func.count(EventRelation.id),
                    func.count(func.distinct(EventRelation.event_id)),
                    func.max(EventRelation.computed_at),
                )
            )
        ).one()
        return {
            "event_entities_rows": int(entity_stats[0] or 0),
            "events_with_entities": int(entity_stats[1] or 0),
            "entities_last_computed_at": entity_stats[2],
            "event_relations_rows": int(relation_stats[0] or 0),
            "events_with_relations": int(relation_stats[1] or 0),
            "relations_last_computed_at": relation_stats[2],
        }


__all__ = [
    "DisplayFields",
    "EntityIndexRow",
    "ExplorationRepository",
    "RELATION_UPDATE_COLUMNS",
]
