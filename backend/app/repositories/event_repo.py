"""Repository helpers for event persistence and centroids."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterable, List, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import Article, Event, EventArticle

logger = get_logger(__name__)


@dataclass
class EventCentroidSnapshot:
    """Lightweight representation of an event centroid for indexing."""

    event_id: int
    centroid_embedding: Sequence[float]
    last_updated_at: datetime
    first_seen_at: datetime
    archived_at: datetime | None


@dataclass
class EventMaintenanceBundle:
    """Container grouping an event with its associated articles."""

    event: Event
    articles: List[Article]


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "event"


def _merge_entities(
    existing: List[Dict[str, Any]] | None,
    new_entities: List[Dict[str, Any]] | None,
) -> List[Dict[str, Any]]:
    merged: Dict[tuple[str, str], Dict[str, Any]] = {}
    for source in (existing or []) + (new_entities or []):
        if not source:
            continue
        text_raw = str(source.get("text") or source.get("name") or "").strip()
        if not text_raw:
            continue
        label_raw = str(source.get("label") or source.get("type") or "").strip()
        key = (text_raw.lower(), label_raw.lower())
        merged[key] = {
            "text": text_raw,
            "label": label_raw or None,
        }
    ordered = sorted(merged.values(), key=lambda item: item["text"].lower())
    return ordered


def _average_embedding(
    existing: Sequence[float] | None,
    new_vector: Sequence[float],
    *,
    count: int,
) -> List[float]:
    if not new_vector:
        return list(existing or [])
    if not existing or count <= 0:
        return list(new_vector)

    length = max(len(existing), len(new_vector))
    padded_existing = list(existing) + [0.0] * (length - len(existing))
    padded_new = list(new_vector) + [0.0] * (length - len(new_vector))

    return [((padded_existing[i] * count) + padded_new[i]) / (count + 1) for i in range(length)]


def _average_tfidf(
    existing: Mapping[str, float] | None,
    new_vector: Mapping[str, float],
    *,
    count: int,
) -> Dict[str, float]:
    if not new_vector:
        return dict(existing or {})
    if not existing or count <= 0:
        return dict(new_vector)

    union = set(existing.keys()).union(new_vector.keys())
    averaged: Dict[str, float] = {}
    for token in union:
        current = new_vector.get(token, 0.0)
        prior = existing.get(token, 0.0)
        value = ((prior * count) + current) / (count + 1)
        if abs(value) > 1e-9:
            averaged[token] = value
    return averaged


class EventRepository:
    """Encapsulate event read/write operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.log = logger.bind(component="EventRepository")

    async def fetch_index_snapshots(self) -> List[EventCentroidSnapshot]:
        """Return active events that have centroid embeddings for vector indexing."""

        stmt = select(Event).where(Event.centroid_embedding.isnot(None))
        stmt = stmt.where(Event.archived_at.is_(None))
        result = await self.session.execute(stmt)
        events: Iterable[Event] = result.scalars().all()

        snapshots: List[EventCentroidSnapshot] = []
        for event in events:
            if not isinstance(event.centroid_embedding, list):
                self.log.warning(
                    "event_centroid_missing",
                    event_id=event.id,
                    reason="centroid_embedding not list",
                )
                continue
            snapshots.append(
                EventCentroidSnapshot(
                    event_id=event.id,
                    centroid_embedding=event.centroid_embedding,
                    last_updated_at=event.last_updated_at,
                    first_seen_at=event.first_seen_at,
                    archived_at=event.archived_at,
                )
            )

        self.log.info("event_snapshots_loaded", count=len(snapshots))
        return snapshots

    async def load_active_events_with_articles(self) -> List[EventMaintenanceBundle]:
        """Return active events and their linked articles for maintenance tasks."""

        stmt = select(Event).where(Event.archived_at.is_(None))
        result = await self.session.execute(stmt)
        events: List[Event] = list(result.scalars().all())
        if not events:
            return []

        event_ids = [event.id for event in events]
        article_stmt = (
            select(EventArticle.event_id, Article)
            .join(Article, Article.id == EventArticle.article_id)
            .where(EventArticle.event_id.in_(event_ids))
        )
        article_rows = await self.session.execute(article_stmt)
        grouped: Dict[int, List[Article]] = defaultdict(list)
        for event_id, article in article_rows.all():
            grouped[int(event_id)].append(article)

        bundles = [
            EventMaintenanceBundle(event=event, articles=grouped.get(event.id, []))
            for event in events
        ]
        self.log.info("event_bundles_loaded", count=len(bundles))
        return bundles

    async def update_last_updated(self, event_id: int, timestamp: datetime) -> None:
        """Update the last_updated_at field (utility for future stories)."""

        event = await self.session.get(Event, event_id)
        if event is None:
            raise ValueError(f"Event {event_id} not found")
        event.last_updated_at = timestamp
        await self.session.flush()

    async def get_events_by_ids(self, event_ids: Sequence[int]) -> List[Event]:
        """Fetch non-archived events for the given identifiers."""

        if not event_ids:
            return []
        stmt = select(Event).where(Event.id.in_(event_ids)).where(Event.archived_at.is_(None))
        result = await self.session.execute(stmt)
        events = result.scalars().all()
        return list(events)

    async def create_event_skeleton(
        self,
        *,
        article: Article,
        centroid_embedding: Sequence[float],
        centroid_tfidf: Mapping[str, float],
        centroid_entities: List[Dict[str, Any]],
        timestamp: datetime,
    ) -> Event:
        """Create a new event row seeded from the first article."""

        base_slug = _slugify(article.title or article.url or "event")
        slug = await self._allocate_unique_slug(base_slug)
        event = Event(
            slug=slug,
            title=article.title,
            description=article.summary,
            centroid_embedding=list(centroid_embedding),
            centroid_tfidf=dict(centroid_tfidf),
            centroid_entities=centroid_entities,
            event_type=article.event_type,  # Inherit event type from seed article
            first_seen_at=timestamp,
            last_updated_at=timestamp,
            article_count=0,
        )
        self.session.add(event)
        await self.session.flush()
        self.log.info("event_created", event_id=event.id, slug=event.slug)
        return event

    async def append_article_to_event(
        self,
        *,
        event: Event,
        article: Article,
        embedding: Sequence[float],
        tfidf_vector: Mapping[str, float],
        entities: List[Dict[str, Any]],
        similarity_score: float,
        scoring_breakdown: Mapping[str, float],
        timestamp: datetime,
    ) -> EventArticle:
        """Link an article to an event and update centroid statistics."""

        current_count = event.article_count or 0
        event.centroid_embedding = _average_embedding(event.centroid_embedding, embedding, count=current_count)
        event.centroid_tfidf = _average_tfidf(event.centroid_tfidf, tfidf_vector, count=current_count)
        event.centroid_entities = _merge_entities(event.centroid_entities, entities)
        event.article_count = current_count + 1
        event.last_updated_at = timestamp

        link = EventArticle(
            event_id=event.id,
            article_id=article.id,
            similarity_score=similarity_score,
            scoring_breakdown=dict(scoring_breakdown),
            linked_at=timestamp,
        )
        self.session.add(link)
        await self.session.flush()
        self.log.info(
            "event_linked_article",
            event_id=event.id,
            article_id=article.id,
            similarity=similarity_score,
        )
        return link

    async def _allocate_unique_slug(self, base_slug: str) -> str:
        """Ensure slugs remain unique by appending a numeric suffix if needed."""

        candidate = base_slug
        suffix = 1
        while True:
            stmt = select(Event).where(Event.slug == candidate)
            result = await self.session.execute(stmt)
            existing = result.scalar_one_or_none()
            if existing is None:
                return candidate
            candidate = f"{base_slug}-{suffix}"
            suffix += 1

    async def archive_events(self, event_ids: Sequence[int], timestamp: datetime) -> int:
        """Mark the specified events as archived."""

        if not event_ids:
            return 0

        stmt = select(Event).where(Event.id.in_(event_ids))
        result = await self.session.execute(stmt)
        events = result.scalars().all()

        archived = 0
        for event in events:
            if event.archived_at is None:
                event.archived_at = timestamp
                archived += 1

        if archived:
            await self.session.flush()
            self.log.info("event_archived", count=archived)
        return archived


__all__ = [
    "EventCentroidSnapshot",
    "EventMaintenanceBundle",
    "EventRepository",
]
