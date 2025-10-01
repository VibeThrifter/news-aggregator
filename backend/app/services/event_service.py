"""Service for hybrid scoring and event assignment."""

from __future__ import annotations

from array import array
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Mapping, Optional

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Article, Event
from backend.app.db.session import get_sessionmaker
from backend.app.events.scoring import (
    ArticleFeatures,
    EventFeatures,
    ScoreBreakdown,
    ScoreParameters,
    compute_hybrid_score,
)
from backend.app.repositories import EventRepository
from backend.app.services.vector_index import VectorIndexService

logger = get_logger(__name__)


@dataclass(frozen=True)
class EventAssignmentResult:
    """Outcome of an event assignment decision."""

    article_id: int
    event_id: int
    created: bool
    score: float
    threshold: float
    breakdown: Dict[str, float]


def _deserialize_embedding(payload: bytes | memoryview | None) -> List[float]:
    if not payload:
        return []
    buffer = array("f")
    if isinstance(payload, memoryview):
        buffer.frombytes(payload.tobytes())
    else:
        buffer.frombytes(payload)
    return list(buffer)


def _sanitize_tfidf(raw: Mapping[str, float] | None) -> Dict[str, float]:
    if not raw:
        return {}
    return {str(token): float(value) for token, value in raw.items() if value != 0}


def _extract_entities(raw: Iterable[dict] | None) -> tuple[set[str], List[Dict[str, Optional[str]]]]:
    texts: set[str] = set()
    payload: List[Dict[str, Optional[str]]] = []
    for entity in raw or []:
        if not isinstance(entity, dict):
            continue
        text = str(entity.get("text") or entity.get("name") or "").strip()
        if not text:
            continue
        label_value = entity.get("label") or entity.get("type")
        label = str(label_value).strip() if label_value else None
        texts.add(text.lower())
        payload.append({"text": text, "label": label})
    return texts, payload


def _article_to_features(article: Article) -> tuple[ArticleFeatures, List[Dict[str, Optional[str]]]]:
    embedding = _deserialize_embedding(article.embedding)
    tfidf_vector = _sanitize_tfidf(article.tfidf_vector)
    entity_texts, entity_payload = _extract_entities(article.entities)
    reference_time = article.published_at or article.fetched_at
    return (
        ArticleFeatures(
            embedding=embedding,
            tfidf=tfidf_vector,
            entity_texts=entity_texts,
            published_at=reference_time,
        ),
        entity_payload,
    )


def _event_to_features(event: Event) -> EventFeatures:
    entity_texts, _ = _extract_entities(event.centroid_entities)
    return EventFeatures(
        centroid_embedding=event.centroid_embedding,
        centroid_tfidf=event.centroid_tfidf,
        entity_texts=entity_texts,
        last_updated_at=event.last_updated_at,
        first_seen_at=event.first_seen_at,
    )


def _default_seed_breakdown(has_entities: bool) -> ScoreBreakdown:
    entity_score = 1.0 if has_entities else 0.0
    return ScoreBreakdown(
        embedding=1.0,
        tfidf=1.0,
        entities=entity_score,
        time_decay=1.0,
        combined=1.0,
        final=1.0,
    )


class EventService:
    """Coordinate candidate scoring and event persistence."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        vector_index: VectorIndexService | None = None,
    ) -> None:
        self.settings = get_settings()
        self.session_factory = session_factory or get_sessionmaker()
        self.vector_index = vector_index or VectorIndexService()
        self.log = logger.bind(component="EventService")

    async def assign_article(
        self,
        article_id: int,
        *,
        correlation_id: str | None = None,
    ) -> EventAssignmentResult | None:
        """Assign an enriched article to an existing event or create a new one."""

        correlation_log = self.log.bind(correlation_id=correlation_id, article_id=article_id)
        async with self.session_factory() as session:
            article = await session.get(Article, article_id)
            if article is None:
                correlation_log.warning("event_assignment_article_missing")
                return None

            features, entity_payload = _article_to_features(article)
            if not features.embedding:
                correlation_log.warning("event_assignment_missing_embedding")
                return None

            await self.vector_index.ensure_ready(session)

            repo = EventRepository(session)
            params = ScoreParameters(
                weight_embedding=self.settings.event_score_weight_embedding,
                weight_tfidf=self.settings.event_score_weight_tfidf,
                weight_entities=self.settings.event_score_weight_entities,
                time_decay_half_life_hours=self.settings.event_score_time_decay_half_life_hours,
                time_decay_floor=self.settings.event_score_time_decay_floor,
            )

            now = datetime.now(timezone.utc)
            candidates = await self.vector_index.query_candidates(features.embedding)
            existing_events = await repo.get_events_by_ids([candidate.event_id for candidate in candidates])
            event_map = {event.id: event for event in existing_events}

            best_event: Event | None = None
            best_breakdown: ScoreBreakdown | None = None

            for candidate in candidates:
                event = event_map.get(candidate.event_id)
                if event is None:
                    continue
                breakdown = compute_hybrid_score(
                    features,
                    _event_to_features(event),
                    params,
                    now=now,
                )
                if best_breakdown is None or breakdown.final > best_breakdown.final:
                    best_event = event
                    best_breakdown = breakdown

            threshold = self.settings.event_score_threshold
            if best_event is not None and best_breakdown is not None and best_breakdown.final >= threshold:
                result = await self._append_to_existing_event(
                    session=session,
                    repo=repo,
                    event=best_event,
                    article=article,
                    features=features,
                    entity_payload=entity_payload,
                    breakdown=best_breakdown,
                    timestamp=now,
                )
                correlation_log.info(
                    "event_assignment_linked",
                    event_id=result.event_id,
                    score=result.score,
                    threshold=threshold,
                )
                return result

            result = await self._seed_new_event(
                session=session,
                repo=repo,
                article=article,
                features=features,
                entity_payload=entity_payload,
                timestamp=now,
            )
            correlation_log.info(
                "event_assignment_created",
                event_id=result.event_id,
                score=result.score,
                threshold=threshold,
            )
            return result

    async def _append_to_existing_event(
        self,
        *,
        session: AsyncSession,
        repo: EventRepository,
        event: Event,
        article: Article,
        features: ArticleFeatures,
        entity_payload: List[Dict[str, Optional[str]]],
        breakdown: ScoreBreakdown,
        timestamp: datetime,
    ) -> EventAssignmentResult:
        await repo.append_article_to_event(
            event=event,
            article=article,
            embedding=features.embedding,
            tfidf_vector=features.tfidf,
            entities=entity_payload,
            similarity_score=breakdown.final,
            scoring_breakdown=breakdown.as_dict(),
            timestamp=timestamp,
        )
        await session.commit()
        if event.centroid_embedding:
            await self.vector_index.upsert(
                event.id,
                event.centroid_embedding,
                event.last_updated_at,
                session=session,
            )
        return EventAssignmentResult(
            article_id=article.id,
            event_id=event.id,
            created=False,
            score=breakdown.final,
            threshold=self.settings.event_score_threshold,
            breakdown=breakdown.as_dict(),
        )

    async def _seed_new_event(
        self,
        *,
        session: AsyncSession,
        repo: EventRepository,
        article: Article,
        features: ArticleFeatures,
        entity_payload: List[Dict[str, Optional[str]]],
        timestamp: datetime,
    ) -> EventAssignmentResult:
        event = await repo.create_event_skeleton(
            article=article,
            centroid_embedding=features.embedding,
            centroid_tfidf=features.tfidf,
            centroid_entities=entity_payload,
            timestamp=timestamp,
        )
        seed_breakdown = _default_seed_breakdown(bool(features.entity_texts))
        scoring_payload = seed_breakdown.as_dict()
        scoring_payload["decision"] = "seed"
        await repo.append_article_to_event(
            event=event,
            article=article,
            embedding=features.embedding,
            tfidf_vector=features.tfidf,
            entities=entity_payload,
            similarity_score=seed_breakdown.final,
            scoring_breakdown=scoring_payload,
            timestamp=timestamp,
        )
        await session.commit()
        if event.centroid_embedding:
            await self.vector_index.upsert(
                event.id,
                event.centroid_embedding,
                event.last_updated_at,
                session=session,
            )
        return EventAssignmentResult(
            article_id=article.id,
            event_id=event.id,
            created=True,
            score=seed_breakdown.final,
            threshold=self.settings.event_score_threshold,
            breakdown=scoring_payload,
        )


__all__ = ["EventService", "EventAssignmentResult"]
