"""Related events ("Volg het spoor") for the exploration UI (Epic 11, Story 11.8).

Relations are scored with brute-force cosine similarity over ``events.centroid_embedding``
(all events, including archived ones - the hnswlib index only holds recent active events),
idf-weighted overlap of the canonical entities in ``event_entities`` and Jaccard overlap of
``events.detected_countries``. Rows are written for both directions into ``event_relations``.
Nothing in this module writes to ``events``.
"""

from __future__ import annotations

import asyncio
import math
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Event, LLMInsight
from backend.app.nlp.entity_keys import kind_weight, split_entity_key
from backend.app.repositories.exploration_repo import EntityIndexRow, ExplorationRepository
from backend.app.services.event_entity_service import latest_titles, title_query

logger = get_logger(__name__).bind(component="RelatedEventsService")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# Candidates: top-N by cosine (all events) + every event sharing an entity.
CANDIDATE_POOL = 200
# A pair is skipped when it is neither topically close nor sharing meaningful entities.
SKIP_MAX_COSINE = 0.35
SKIP_MAX_ENTITY_OVERLAP = 0.08
# Add a "topic" reason when the centroids are this similar.
TOPIC_MIN_COSINE = 0.55
MAX_ENTITY_REASONS = 3
MAX_COUNTRY_REASONS = 3
# Floor for the weighted entity union: two events that only share a very common entity
# (e.g. "Nederland", idf ~ 0) must not reach an overlap of 1.0.
ENTITY_UNION_FLOOR = 3.0
# Events per persistence transaction.
RELATION_BATCH_SIZE = 100
# Delta loads re-read this window so rows committed late (timestamp taken before a slow
# commit) are never missed.
DELTA_SAFETY_MARGIN = timedelta(minutes=10)

_SLUG_MAX = 255
_TITLE_MAX = 512


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _max_time(*values: datetime | None) -> datetime | None:
    present = [value for value in values if value is not None]
    return max(present) if present else None


def _clamp_watermark(observed: datetime | None, ceiling: datetime) -> datetime | None:
    return None if observed is None else min(observed, ceiling)


@dataclass(slots=True)
class CachedEvent:
    """Event metadata kept in memory for scoring and display fields."""

    event_id: int
    slug: str | None = None
    event_type: str | None = None
    article_count: int = 0
    first_seen_at: datetime | None = None
    last_updated_at: datetime | None = None
    archived: bool = False
    countries: frozenset[str] = frozenset()
    title: str | None = None


@dataclass(frozen=True, slots=True)
class EntityRef:
    """Kind and display name of an entity within one event."""

    kind: str
    name: str


@dataclass(frozen=True, slots=True)
class RelationParams:
    """Scoring parameters (from settings)."""

    top_k: int = 12
    min_score: float = 0.30
    weight_embedding: float = 0.55
    weight_entities: float = 0.35
    weight_countries: float = 0.10

    @classmethod
    def from_settings(cls, settings: Settings) -> RelationParams:
        return cls(
            top_k=settings.related_events_top_k,
            min_score=settings.related_events_min_score,
            weight_embedding=settings.related_events_weight_embedding,
            weight_entities=settings.related_events_weight_entities,
            weight_countries=settings.related_events_weight_countries,
        )


@dataclass(frozen=True, slots=True)
class PairScore:
    """Score of the relation ``source_id`` -> ``related_id``."""

    source_id: int
    related_id: int
    score: float
    cosine: float
    entity_overlap: float
    country_overlap: float


class EventVectorCache:
    """In-memory snapshot of all events (incl. archived) for relation scoring.

    Loaded once, then refreshed with deltas (``last_updated_at``/``archived_at``,
    ``llm_insights.generated_at`` and ``event_entities.computed_at``).
    """

    def __init__(self, dimension: int | None = None) -> None:
        self.events: dict[int, CachedEvent] = {}
        self.vectors: dict[int, np.ndarray] = {}
        self.entities: dict[int, dict[str, EntityRef]] = {}
        self.postings: dict[str, set[int]] = {}
        self.loaded_at: datetime | None = None
        self.refreshed_at: datetime | None = None
        self.events_since: datetime | None = None
        self.titles_since: datetime | None = None
        self.entities_since: datetime | None = None
        # Expected embedding size (settings.embedding_dimension); inferred when not given.
        self._configured_dimension = dimension
        self._dimension: int | None = dimension
        self._lock = asyncio.Lock()
        self._matrix: np.ndarray | None = None
        self._matrix_ids: list[int] = []
        self._row_index: dict[int, int] = {}
        self._idf: dict[str, float] = {}
        self._totals: dict[int, float] = {}
        self._matrix_dirty = True
        self._weights_dirty = True

    # ------------------------------------------------------------------ mutation
    @property
    def loaded(self) -> bool:
        return self.loaded_at is not None

    def clear(self) -> None:
        self.events.clear()
        self.vectors.clear()
        self.entities.clear()
        self.postings.clear()
        self.events_since = self.titles_since = self.entities_since = None
        self._dimension = self._configured_dimension
        self._matrix_dirty = self._weights_dirty = True

    def upsert_event(self, event: CachedEvent, embedding: Sequence[float] | None = None) -> None:
        """Insert/replace event metadata; keeps the known title when ``event.title`` is None."""

        previous = self.events.get(event.event_id)
        if event.title is None and previous is not None:
            event.title = previous.title
        self.events[event.event_id] = event
        vector = self._normalise(embedding)
        if vector is not None:
            self.vectors[event.event_id] = vector
        else:
            self.vectors.pop(event.event_id, None)
        self._matrix_dirty = True

    def set_title(self, event_id: int, title: str | None) -> None:
        event = self.events.get(event_id)
        if event is None:
            event = CachedEvent(event_id=event_id)
            self.events[event_id] = event
        if event.title != title:
            event.title = title
            self._matrix_dirty = True

    def set_entities(self, event_id: int, entities: Mapping[str, EntityRef]) -> None:
        for key in self.entities.pop(event_id, {}):
            posting = self.postings.get(key)
            if posting is not None:
                posting.discard(event_id)
                if not posting:
                    del self.postings[key]
        if entities:
            self.entities[event_id] = dict(entities)
            for key in entities:
                self.postings.setdefault(key, set()).add(event_id)
        self._weights_dirty = True

    def remove_event(self, event_id: int) -> None:
        self.set_entities(event_id, {})
        self.events.pop(event_id, None)
        self.vectors.pop(event_id, None)
        self._matrix_dirty = True

    def _normalise(self, embedding: Sequence[float] | None) -> np.ndarray | None:
        if not embedding:
            return None
        try:
            vector = np.asarray(embedding, dtype=np.float32).reshape(-1)
        except (TypeError, ValueError):
            return None
        if self._dimension is None:
            self._dimension = int(vector.shape[0])
        if vector.shape[0] != self._dimension:
            return None
        norm = float(np.linalg.norm(vector))
        if not math.isfinite(norm) or norm == 0.0:
            return None
        return vector / norm

    # ------------------------------------------------------------------ derived data
    def is_candidate(self, event_id: int) -> bool:
        """Events without an LLM title are never shown as related events."""

        event = self.events.get(event_id)
        return event is not None and bool(event.title)

    def _ensure_derived(self) -> None:
        if self._matrix_dirty:
            ids = sorted(event_id for event_id in self.vectors if self.is_candidate(event_id))
            self._matrix_ids = ids
            self._row_index = {event_id: row for row, event_id in enumerate(ids)}
            self._matrix = np.vstack([self.vectors[event_id] for event_id in ids]) if ids else None
            self._matrix_dirty = False
        if self._weights_dirty:
            total_events = len(self.entities)
            self._idf = {
                key: math.log((total_events + 1) / (len(posting) + 1))
                for key, posting in self.postings.items()
            }
            self._totals = {
                event_id: sum(self.weight(key) for key in keys)
                for event_id, keys in self.entities.items()
            }
            self._weights_dirty = False

    def idf(self, key: str) -> float:
        self._ensure_derived()
        return self._idf.get(key, 0.0)

    def weight(self, key: str) -> float:
        """Entity weight = kind weight x idf."""

        kind, _ = split_entity_key(key)
        return kind_weight(kind) * self._idf.get(key, 0.0)

    # ------------------------------------------------------------------ scoring
    def cosine(self, event_a: int, event_b: int) -> float:
        vector_a, vector_b = self.vectors.get(event_a), self.vectors.get(event_b)
        if vector_a is None or vector_b is None:
            return 0.0
        return float(np.clip(np.dot(vector_a, vector_b), -1.0, 1.0))

    def entity_overlap(self, event_a: int, event_b: int, shared: float | None = None) -> float:
        self._ensure_derived()
        keys_a, keys_b = self.entities.get(event_a), self.entities.get(event_b)
        if not keys_a or not keys_b:
            return 0.0
        if shared is None:
            shared = sum(self.weight(key) for key in keys_a.keys() & keys_b.keys())
        union = self._totals.get(event_a, 0.0) + self._totals.get(event_b, 0.0) - shared
        if shared <= 0.0:
            return 0.0
        return min(1.0, shared / max(union, ENTITY_UNION_FLOOR))

    def country_overlap(self, event_a: int, event_b: int) -> float:
        countries_a = self.events[event_a].countries if event_a in self.events else frozenset()
        countries_b = self.events[event_b].countries if event_b in self.events else frozenset()
        union = countries_a | countries_b
        if not union:
            return 0.0
        return len(countries_a & countries_b) / len(union)

    def pair_score(
        self,
        source_id: int,
        related_id: int,
        params: RelationParams,
        *,
        cosine: float | None = None,
        shared: float | None = None,
    ) -> PairScore | None:
        """Score ``source_id`` -> ``related_id``; None when skipped or below ``min_score``."""

        if source_id == related_id or not self.is_candidate(related_id):
            return None
        if source_id not in self.events:
            return None
        cos = self.cosine(source_id, related_id) if cosine is None else cosine
        overlap = self.entity_overlap(source_id, related_id, shared)
        if cos < SKIP_MAX_COSINE and overlap < SKIP_MAX_ENTITY_OVERLAP:
            return None
        countries = self.country_overlap(source_id, related_id)
        score = (
            params.weight_embedding * max(cos, 0.0)
            + params.weight_entities * overlap
            + params.weight_countries * countries
        )
        score = min(1.0, max(0.0, score))
        if score < params.min_score:
            return None
        return PairScore(
            source_id=source_id,
            related_id=related_id,
            score=score,
            cosine=cos,
            entity_overlap=overlap,
            country_overlap=countries,
        )

    def top_related(self, event_id: int, params: RelationParams) -> list[PairScore]:
        """Return the ``top_k`` related events of ``event_id`` (best first)."""

        self._ensure_derived()
        if event_id not in self.events:
            return []
        similarities: np.ndarray | None = None
        candidates: set[int] = set()
        vector = self.vectors.get(event_id)
        if vector is not None and self._matrix is not None:
            similarities = self._matrix @ vector
            pool = min(CANDIDATE_POOL + 1, similarities.shape[0])
            top_rows = np.argpartition(-similarities, pool - 1)[:pool]
            candidates.update(self._matrix_ids[int(row)] for row in top_rows)

        shared_weights: dict[int, float] = {}
        for key in self.entities.get(event_id, {}):
            weight = self.weight(key)
            if weight <= 0.0:
                continue
            for other in self.postings.get(key, ()):
                shared_weights[other] = shared_weights.get(other, 0.0) + weight
        candidates.update(shared_weights)
        candidates.discard(event_id)

        scores: list[PairScore] = []
        for other in candidates:
            if not self.is_candidate(other):
                continue
            cosine = 0.0
            if similarities is not None and other in self._row_index:
                cosine = float(np.clip(similarities[self._row_index[other]], -1.0, 1.0))
            pair = self.pair_score(
                event_id,
                other,
                params,
                cosine=cosine,
                shared=shared_weights.get(other, 0.0),
            )
            if pair is not None:
                scores.append(pair)
        scores.sort(key=lambda pair: (-pair.score, pair.related_id))
        return scores[: params.top_k]

    def reasons(self, viewer_id: int, other_id: int, pair: PairScore) -> list[dict[str, Any]]:
        """Why ``other_id`` is related, described from ``viewer_id``'s perspective."""

        self._ensure_derived()
        viewer = self.events.get(viewer_id)
        other = self.events.get(other_id)
        if viewer is None or other is None:
            return []
        shared_countries = sorted(viewer.countries & other.countries)
        viewer_entities = self.entities.get(viewer_id, {})
        other_entities = self.entities.get(other_id, {})
        shared_keys = sorted(
            (key for key in viewer_entities.keys() & other_entities.keys() if self.weight(key) > 0),
            key=lambda key: (-self.weight(key), key),
        )
        reasons: list[dict[str, Any]] = []
        for key in shared_keys:
            ref = viewer_entities[key]
            if ref.kind == "country" and split_entity_key(key)[1].upper() in shared_countries:
                continue  # already covered by a country reason
            reasons.append({"type": "entity", "key": key, "name": ref.name, "kind": ref.kind})
            if len(reasons) >= MAX_ENTITY_REASONS:
                break
        reasons.extend(
            {"type": "country", "iso": iso} for iso in shared_countries[:MAX_COUNTRY_REASONS]
        )
        if viewer.event_type and viewer.event_type == other.event_type:
            reasons.append({"type": "category", "value": viewer.event_type})
        if pair.cosine >= TOPIC_MIN_COSINE:
            reasons.append({"type": "topic", "similarity": round(pair.cosine, 2)})
        return reasons

    # ------------------------------------------------------------------ loading
    def stats(self) -> dict[str, Any]:
        return {
            "events": len(self.events),
            "events_with_title": sum(1 for event in self.events.values() if event.title),
            "events_with_embedding": len(self.vectors),
            "events_with_entities": len(self.entities),
            "entity_keys": len(self.postings),
            "loaded_at": self.loaded_at.isoformat() if self.loaded_at else None,
            "refreshed_at": self.refreshed_at.isoformat() if self.refreshed_at else None,
        }

    async def refresh(
        self,
        *,
        read_session_factory: SessionFactory,
        entity_session_factory: SessionFactory,
        full: bool = False,
    ) -> dict[str, Any]:
        """Load everything (first call / ``full``) or only what changed since the last load."""

        async with self._lock:
            started = datetime.now(timezone.utc)
            full = full or not self.loaded
            events_since = None if full else self.events_since
            titles_since = None if full else self.titles_since
            entities_since = None if full else self.entities_since

            async with read_session_factory() as session:
                event_stmt = select(
                    Event.id,
                    Event.slug,
                    Event.event_type,
                    Event.article_count,
                    Event.first_seen_at,
                    Event.last_updated_at,
                    Event.archived_at,
                    Event.detected_countries,
                    Event.centroid_embedding,
                )
                if events_since is not None:
                    event_stmt = event_stmt.where(
                        or_(
                            Event.last_updated_at >= events_since,
                            Event.archived_at >= events_since,
                        )
                    )
                event_rows = (await session.execute(event_stmt)).all()
                insight_stmt = title_query()
                if titles_since is not None:
                    insight_stmt = insight_stmt.where(LLMInsight.generated_at >= titles_since)
                title_rows = (await session.execute(insight_stmt)).all()

            # event_entities is derived data in the primary database only (not in the cache)
            async with entity_session_factory() as session:
                entity_rows = await ExplorationRepository(session).load_entity_index(entities_since)

            if full:
                self.clear()
            self._apply_events(event_rows)
            self._apply_titles(title_rows)
            self._apply_entities(entity_rows)
            ceiling = started - DELTA_SAFETY_MARGIN
            self.events_since = _clamp_watermark(self.events_since, ceiling)
            self.titles_since = _clamp_watermark(self.titles_since, ceiling)
            self.entities_since = _clamp_watermark(self.entities_since, ceiling)
            if full:
                self.loaded_at = started
            self.refreshed_at = started
            stats = {
                "full": full,
                "events_loaded": len(event_rows),
                "titles_loaded": len(title_rows),
                "entity_rows_loaded": len(entity_rows),
            }
            logger.debug("event_vector_cache_refreshed", **stats)
            return stats

    def _apply_events(self, rows: Iterable[Any]) -> None:
        for row in rows:
            last_updated = _as_utc(row.last_updated_at)
            archived_at = _as_utc(row.archived_at)
            countries = frozenset(
                str(code).upper() for code in (row.detected_countries or []) if code
            )
            self.upsert_event(
                CachedEvent(
                    event_id=int(row.id),
                    slug=row.slug,
                    event_type=row.event_type,
                    article_count=int(row.article_count or 0),
                    first_seen_at=_as_utc(row.first_seen_at),
                    last_updated_at=last_updated,
                    archived=archived_at is not None,
                    countries=countries,
                ),
                row.centroid_embedding,
            )
            self.events_since = _max_time(self.events_since, last_updated, archived_at)

    def _apply_titles(self, rows: Sequence[Any]) -> None:
        for event_id, title in latest_titles(rows).items():
            self.set_title(event_id, title)
        for row in rows:
            self.titles_since = _max_time(self.titles_since, _as_utc(row[2]))

    def _apply_entities(self, rows: Sequence[EntityIndexRow]) -> None:
        grouped: dict[int, dict[str, EntityRef]] = {}
        for row in rows:
            grouped.setdefault(row.event_id, {})[row.entity_key] = EntityRef(
                kind=row.kind, name=row.name
            )
            self.entities_since = _max_time(self.entities_since, _as_utc(row.computed_at))
        for event_id, entities in grouped.items():
            self.set_entities(event_id, entities)


@dataclass(slots=True)
class RelationRefreshResult:
    """Outcome of a relation refresh."""

    events_processed: int = 0
    outgoing_rows: int = 0
    reverse_rows: int = 0
    deleted_rows: int = 0
    pruned_rows: int = 0
    missing: list[int] = field(default_factory=list)

    @property
    def rows_written(self) -> int:
        return self.outgoing_rows + self.reverse_rows

    def merge(self, other: RelationRefreshResult) -> None:
        self.events_processed += other.events_processed
        self.outgoing_rows += other.outgoing_rows
        self.reverse_rows += other.reverse_rows
        self.deleted_rows += other.deleted_rows
        self.pruned_rows += other.pruned_rows
        self.missing.extend(other.missing)


def _default_read_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.dual_write import get_read_session

    return get_read_session()


def _default_write_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.session import get_sessionmaker

    return get_sessionmaker()()


class RelatedEventsService:
    """Compute and persist ``event_relations`` rows (both directions)."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        cache: EventVectorCache | None = None,
        read_session_factory: SessionFactory | None = None,
        write_session_factory: SessionFactory | None = None,
        entity_session_factory: SessionFactory | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.cache = cache or EventVectorCache(dimension=self.settings.embedding_dimension)
        self._read = read_session_factory or _default_read_factory
        self._write = write_session_factory or _default_write_factory
        self._entity_read = entity_session_factory or self._write

    @property
    def params(self) -> RelationParams:
        return RelationParams.from_settings(self.settings)

    async def refresh_cache(self, *, full: bool = False) -> dict[str, Any]:
        return await self.cache.refresh(
            read_session_factory=self._read,
            entity_session_factory=self._entity_read,
            full=full,
        )

    def compute(self, event_id: int) -> list[PairScore]:
        return self.cache.top_related(event_id, self.params)

    async def refresh(
        self,
        event_ids: Sequence[int],
        *,
        refresh_cache: bool = True,
        correlation_id: str | None = None,
    ) -> RelationRefreshResult:
        """Recompute relations of ``event_ids`` and reconcile the reverse rows."""

        if refresh_cache:
            await self.refresh_cache()
        ids = list(dict.fromkeys(int(event_id) for event_id in event_ids))
        result = RelationRefreshResult()
        for start in range(0, len(ids), RELATION_BATCH_SIZE):
            batch = ids[start : start + RELATION_BATCH_SIZE]
            result.merge(await self._refresh_batch(batch))
        logger.info(
            "event_relations_refreshed",
            events=result.events_processed,
            outgoing_rows=result.outgoing_rows,
            reverse_rows=result.reverse_rows,
            deleted_rows=result.deleted_rows,
            pruned_rows=result.pruned_rows,
            correlation_id=correlation_id,
        )
        return result

    def _row(self, pair: PairScore, computed_at: datetime) -> dict[str, Any]:
        related = self.cache.events[pair.related_id]
        return {
            "event_id": pair.source_id,
            "related_event_id": pair.related_id,
            "score": round(pair.score, 4),
            "embedding_similarity": round(pair.cosine, 4),
            "entity_overlap": round(pair.entity_overlap, 4),
            "country_overlap": round(pair.country_overlap, 4),
            "reasons": self.cache.reasons(pair.source_id, pair.related_id, pair),
            "related_slug": related.slug[:_SLUG_MAX] if related.slug else None,
            "related_title": (related.title or "")[:_TITLE_MAX],
            "related_event_type": related.event_type,
            "related_article_count": related.article_count,
            "related_first_seen_at": related.first_seen_at,
            "related_last_updated_at": related.last_updated_at,
            "computed_at": computed_at,
        }

    async def _refresh_batch(self, batch: list[int]) -> RelationRefreshResult:
        params = self.params
        result = RelationRefreshResult(events_processed=len(batch))
        batch_set = set(batch)
        outgoing = {event_id: self.cache.top_related(event_id, params) for event_id in batch}
        computed_at = datetime.now(timezone.utc)

        async with self._write() as session:
            repo = ExplorationRepository(session)
            referenced = set(batch)
            for pairs in outgoing.values():
                referenced.update(pair.related_id for pair in pairs)
            incoming = await repo.load_incoming_pairs(batch, exclude_sources=batch_set)
            referenced.update(source for source, _ in incoming)
            existing = await repo.existing_event_ids(referenced)
            for missing_id in sorted(referenced - existing):
                self.cache.remove_event(missing_id)
            result.missing = sorted(batch_set - existing)

            sources = [event_id for event_id in batch if event_id in existing]
            rows = [
                self._row(pair, computed_at)
                for event_id in sources
                for pair in outgoing[event_id]
                if pair.related_id in existing
            ]
            result.outgoing_rows = await repo.replace_outgoing_relations(batch, rows)

            # Reverse rows B -> A for events outside the batch (inside the batch B computes its
            # own list), plus reconciliation of existing incoming rows X -> A.
            reverse_pairs = {
                (pair.related_id, event_id)
                for event_id in sources
                for pair in outgoing[event_id]
                if pair.related_id not in batch_set
            }
            reverse_pairs.update(incoming)
            upserts: list[dict[str, Any]] = []
            deletes: list[tuple[int, int]] = []
            for source, target in sorted(reverse_pairs):
                pair = None
                if source in existing and target in existing:
                    pair = self.cache.pair_score(source, target, params)
                if pair is None:
                    deletes.append((source, target))
                else:
                    upserts.append(self._row(pair, computed_at))
            result.reverse_rows = await repo.upsert_relations(upserts)
            result.deleted_rows = await repo.delete_relation_pairs(deletes)
            touched = {row["event_id"] for row in upserts}
            result.pruned_rows = await repo.prune_relations(touched, keep=params.top_k)
            await session.commit()
        return result


__all__ = [
    "CachedEvent",
    "EntityRef",
    "EventVectorCache",
    "PairScore",
    "RelatedEventsService",
    "RelationParams",
    "RelationRefreshResult",
]
