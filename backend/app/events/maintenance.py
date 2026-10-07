"""Event maintenance utilities for centroid refresh and lifecycle management."""

from __future__ import annotations

from array import array
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Mapping, Optional, Sequence

from sqlalchemy import null, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Article, ArticleBiasAnalysis, Event, EventArticle, LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.repositories import EventMaintenanceBundle, EventRepository
from backend.app.repositories.event_repo import round_centroid
from backend.app.services.vector_index import VectorIndexService

log = get_logger(__name__)


@dataclass(frozen=True)
class VectorUpdate:
    """Payload describing a centroid update for the vector index."""

    event_id: int
    embedding: List[float]
    last_updated_at: datetime


@dataclass(frozen=True)
class MaintenanceStats:
    """Outcome summary for a maintenance run."""

    events_processed: int
    events_recomputed: int
    events_archived: int
    vector_upserts: int
    vector_removals: int
    index_rebuilt: bool
    article_vectors_pruned: int = 0
    article_tokens_pruned: int = 0
    raw_responses_pruned: int = 0

    def as_dict(self) -> Dict[str, object]:
        return {
            "events_processed": self.events_processed,
            "events_recomputed": self.events_recomputed,
            "events_archived": self.events_archived,
            "vector_upserts": self.vector_upserts,
            "vector_removals": self.vector_removals,
            "index_rebuilt": self.index_rebuilt,
            "article_vectors_pruned": self.article_vectors_pruned,
            "article_tokens_pruned": self.article_tokens_pruned,
            "raw_responses_pruned": self.raw_responses_pruned,
        }


def _decode_embedding(payload: bytes | memoryview | None) -> List[float]:
    if not payload:
        return []
    buffer = array("f")
    if isinstance(payload, memoryview):
        buffer.frombytes(payload.tobytes())
    else:
        buffer.frombytes(payload)
    return list(buffer)


def _vectors_pruned(article: Article) -> bool:
    """Enrichment always stores the embedding, so an enriched article without one was pruned."""

    return article.embedding is None and article.normalized_text is not None


def _average_dense(vectors: Sequence[Sequence[float]]) -> List[float] | None:
    clean_vectors = [list(vector) for vector in vectors if vector]
    if not clean_vectors:
        return None
    dimension = max(len(vector) for vector in clean_vectors)
    totals = [0.0] * dimension
    count = 0
    for vector in clean_vectors:
        padded = list(vector) + [0.0] * (dimension - len(vector))
        for index, value in enumerate(padded):
            totals[index] += value
        count += 1
    if count == 0:
        return None
    return [value / count for value in totals]


def _average_tfidf(vectors: Iterable[Mapping[str, float]]) -> Dict[str, float] | None:
    accumulator: Dict[str, float] = {}
    count = 0
    for vector in vectors:
        if not vector:
            continue
        count += 1
        for token, value in vector.items():
            accumulator[token] = accumulator.get(token, 0.0) + float(value)
    if count == 0:
        return None
    averaged: Dict[str, float] = {}
    for token, value in accumulator.items():
        mean_value = value / count
        if abs(mean_value) > 1e-9:
            averaged[token] = mean_value
    return averaged or None


def _merge_entities(entities_iterable: Iterable[Iterable[Mapping[str, object]]]) -> List[Dict[str, Optional[str]]]:
    merged: Dict[tuple[str, str | None], Dict[str, Optional[str]]] = {}
    for collection in entities_iterable:
        if not collection:
            continue
        for entity in collection:
            if not isinstance(entity, Mapping):
                continue
            text_raw = str(entity.get("text") or entity.get("name") or "").strip()
            if not text_raw:
                continue
            label_value = entity.get("label") or entity.get("type")
            label = str(label_value).strip() if label_value else None
            key = (text_raw.lower(), label.lower() if label else None)
            merged[key] = {"text": text_raw, "label": label}
    ordered = sorted(merged.values(), key=lambda entry: entry["text"].lower())
    return ordered


def _max_timestamp(values: Iterable[datetime | None], fallback: datetime) -> datetime:
    best = fallback if fallback.tzinfo else fallback.replace(tzinfo=timezone.utc)
    for value in values:
        if value is None:
            continue
        candidate = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if candidate > best:
            best = candidate
    return best


def _min_timestamp(values: Iterable[datetime | None], fallback: datetime) -> datetime:
    best = fallback if fallback.tzinfo else fallback.replace(tzinfo=timezone.utc)
    for value in values:
        if value is None:
            continue
        candidate = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if candidate < best:
            best = candidate
    return best


class EventMaintenanceService:
    """Service coordinating centroid refresh, archiving, and index maintenance."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        vector_index: VectorIndexService | None = None,
    ) -> None:
        self.settings = get_settings()
        self.session_factory = session_factory or get_sessionmaker()
        self.vector_index = vector_index or VectorIndexService()
        self.log = log.bind(component="EventMaintenanceService")

    async def run(self, *, correlation_id: str | None = None) -> MaintenanceStats:
        """Execute the full maintenance workflow."""

        correlation_log = self.log.bind(correlation_id=correlation_id)
        async with self.session_factory() as session:
            await self.vector_index.ensure_ready(session)
            repo = EventRepository(session)
            bundles = await repo.load_active_events_with_articles()
            now = datetime.now(timezone.utc)
            recompute_result = self._recompute_centroids(bundles)
            archived_ids = await self._archive_stale_events(
                repo=repo,
                bundles=bundles,
                cutoff=now - timedelta(days=self.settings.event_retention_days),
            )
            await session.commit()

            vector_upserts = 0
            for update in recompute_result["vector_updates"]:
                await self.vector_index.upsert(
                    update.event_id,
                    update.embedding,
                    update.last_updated_at,
                    session=session,
                )
                vector_upserts += 1

            total_vector_removals = 0
            removals = set(recompute_result["vector_removals"]) | set(archived_ids)
            for event_id in removals:
                await self.vector_index.remove(event_id)
                total_vector_removals += 1

            drift = await self._detect_index_drift(session)
            index_rebuilt = False
            if drift and self.settings.event_index_rebuild_on_drift:
                await self.vector_index.rebuild(session)
                index_rebuilt = True

        pruned: Dict[str, int] = {}
        if self.settings.storage_prune_enabled:
            try:
                async with self.session_factory() as session:
                    pruned = await self._prune_working_data(session, now=datetime.now(timezone.utc))
            except Exception as exc:  # noqa: BLE001 - a failed cleanup must not fail maintenance
                correlation_log.warning("storage_prune_failed", error=str(exc))

        stats = MaintenanceStats(
            events_processed=len(bundles),
            events_recomputed=recompute_result["events_recomputed"],
            events_archived=len(archived_ids),
            vector_upserts=vector_upserts,
            vector_removals=total_vector_removals,
            index_rebuilt=index_rebuilt,
            **pruned,
        )
        correlation_log.info("event_maintenance_completed", **stats.as_dict())
        return stats

    def _recompute_centroids(self, bundles: Sequence[EventMaintenanceBundle]) -> Dict[str, object]:
        events_recomputed = 0
        vector_updates: List[VectorUpdate] = []
        vector_removals: List[int] = []

        for bundle in bundles:
            event = bundle.event
            articles = bundle.articles
            if not articles:
                continue

            embeddings = [_decode_embedding(article.embedding) for article in articles]
            tfidf_vectors = [article.tfidf_vector or {} for article in articles]
            entity_groups = [article.entities or [] for article in articles]

            if any(_vectors_pruned(article) for article in articles):
                # An archived event that came back: the vectors of its old articles were pruned,
                # but its stored centroid already holds them (plus the new article), so keep it.
                centroid_embedding = event.centroid_embedding
                centroid_tfidf = event.centroid_tfidf
            else:
                centroid_embedding = round_centroid(_average_dense(embeddings))
                centroid_tfidf = _average_tfidf(tfidf_vectors)
            centroid_entities = _merge_entities(entity_groups)
            last_candidates = [article.published_at or article.fetched_at for article in articles]
            first_candidates = [article.published_at or article.fetched_at for article in articles]

            event.centroid_embedding = centroid_embedding
            event.centroid_tfidf = centroid_tfidf
            event.centroid_entities = centroid_entities
            event.article_count = len(articles)
            event.last_updated_at = _max_timestamp(last_candidates, event.last_updated_at)
            event.first_seen_at = _min_timestamp(first_candidates, event.first_seen_at)

            if centroid_embedding:
                vector_updates.append(
                    VectorUpdate(
                        event_id=event.id,
                        embedding=centroid_embedding,
                        last_updated_at=event.last_updated_at,
                    )
                )
            else:
                vector_removals.append(event.id)
            events_recomputed += 1

        return {
            "events_recomputed": events_recomputed,
            "vector_updates": vector_updates,
            "vector_removals": vector_removals,
        }

    async def _archive_stale_events(
        self,
        *,
        repo: EventRepository,
        bundles: Sequence[EventMaintenanceBundle],
        cutoff: datetime,
    ) -> List[int]:
        candidates: List[int] = []
        for bundle in bundles:
            event = bundle.event
            if event.archived_at is not None:
                continue
            if event.last_updated_at <= cutoff:
                candidates.append(event.id)
        if not candidates:
            return []
        timestamp = datetime.now(timezone.utc)
        await repo.archive_events(candidates, timestamp)
        return candidates

    async def _prune_working_data(self, session: AsyncSession, *, now: datetime) -> Dict[str, int]:
        """Clear working data the app never reads (storage rule 2026-10-07, see CLAUDE.md).

        Accuracy stays the same: new articles are matched against event centroids (kept), the
        recompute above only reads articles of active events, unlinked articles keep their vectors
        (they can still join an event), and the full text and normalized_text stay.
        """

        linked = (
            select(EventArticle.article_id).where(EventArticle.article_id == Article.id).exists()
        )
        in_active_event = (
            select(EventArticle.article_id)
            .join(Event, Event.id == EventArticle.event_id)
            .where(EventArticle.article_id == Article.id, Event.archived_at.is_(None))
            .exists()
        )
        vectors = await session.execute(
            update(Article)
            .where(linked, ~in_active_event)
            .where(or_(Article.embedding.is_not(None), Article.tfidf_vector.is_not(None)))
            .values(embedding=None, tfidf_vector=null())
            .execution_options(synchronize_session=False)
        )
        tokens = await session.execute(
            update(Article)
            .where(Article.normalized_tokens.is_not(None))
            .values(normalized_tokens=null())
            .execution_options(synchronize_session=False)
        )
        cutoff = now - timedelta(days=self.settings.raw_llm_response_retention_days)
        raw_responses = 0
        for model, created in (
            (LLMInsight, LLMInsight.generated_at),
            (ArticleBiasAnalysis, ArticleBiasAnalysis.analyzed_at),
        ):
            result = await session.execute(
                update(model)
                .where(model.raw_response.is_not(None), created < cutoff)
                .values(raw_response=None)
                .execution_options(synchronize_session=False)
            )
            raw_responses += result.rowcount or 0
        await session.commit()
        return {
            "article_vectors_pruned": vectors.rowcount or 0,
            "article_tokens_pruned": tokens.rowcount or 0,
            "raw_responses_pruned": raw_responses,
        }

    async def _detect_index_drift(self, session: AsyncSession) -> bool:
        repo = EventRepository(session)
        snapshots = await repo.fetch_index_snapshots()
        active_ids = {snapshot.event_id for snapshot in snapshots}
        indexed_ids = self.vector_index.get_indexed_event_ids()
        missing = active_ids - indexed_ids
        stale = indexed_ids - active_ids
        if missing or stale:
            self.log.warning(
                "vector_index_drift_detected",
                missing=len(missing),
                stale=len(stale),
            )
            return True
        return False


_event_maintenance_service: EventMaintenanceService | None = None


def get_event_maintenance_service() -> EventMaintenanceService:
    """Singleton accessor for the maintenance service."""

    global _event_maintenance_service
    if _event_maintenance_service is None:
        _event_maintenance_service = EventMaintenanceService()
    return _event_maintenance_service


__all__ = [
    "EventMaintenanceService",
    "MaintenanceStats",
    "VectorUpdate",
    "get_event_maintenance_service",
]
