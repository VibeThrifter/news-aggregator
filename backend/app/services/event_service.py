"""Service for hybrid scoring and event assignment."""

from __future__ import annotations

from array import array
import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Mapping, Optional, TYPE_CHECKING

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
from backend.app.repositories import EventRepository, InsightRepository
from backend.app.services.insight_service import InsightService

if TYPE_CHECKING:
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
        vector_index: "VectorIndexService" | None = None,
        insight_service: InsightService | None = None,
        auto_generate_insights: bool = True,
        insight_refresh_ttl: timedelta | None = None,
    ) -> None:
        self.settings = get_settings()
        self.session_factory = session_factory or get_sessionmaker()
        if vector_index is None:
            from backend.app.services.vector_index import VectorIndexService as _VectorIndexService

            self.vector_index = _VectorIndexService()
        else:
            self.vector_index = vector_index
        self.log = logger.bind(component="EventService")
        self.auto_generate_insights = auto_generate_insights
        self.insight_service = insight_service or (InsightService() if auto_generate_insights else None)
        self.insight_refresh_ttl = insight_refresh_ttl or timedelta(minutes=30)
        self._pending_insight_events: set[int] = set()
        self._insight_tasks: dict[int, asyncio.Task[None]] = {}

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

            # Load articles for each candidate event to check location/date overlap
            from backend.app.db.models import EventArticle
            from sqlalchemy import select as sa_select

            event_ids = [e.id for e in existing_events]
            if event_ids:
                event_articles_stmt = (
                    sa_select(EventArticle.event_id, Article)
                    .join(Article, Article.id == EventArticle.article_id)
                    .where(EventArticle.event_id.in_(event_ids))
                )
                event_articles_result = await session.execute(event_articles_stmt)
                event_articles_map: Dict[int, List[Article]] = {}
                for event_id, event_article in event_articles_result.all():
                    if event_id not in event_articles_map:
                        event_articles_map[event_id] = []
                    event_articles_map[event_id].append(event_article)
            else:
                event_articles_map = {}

            best_event: Event | None = None
            best_breakdown: ScoreBreakdown | None = None
            best_boosted_score: float = 0.0

            for candidate in candidates:
                event = event_map.get(candidate.event_id)
                if event is None:
                    continue

                # EVENT TYPE CONSTRAINT: Only consider events of the same type
                if article.event_type and event.event_type and article.event_type != event.event_type:
                    correlation_log.debug(
                        "event_type_mismatch",
                        article_type=article.event_type,
                        event_type=event.event_type,
                        event_id=event.id,
                    )
                    continue

                breakdown = compute_hybrid_score(
                    features,
                    _event_to_features(event),
                    params,
                    now=now,
                )

                # Apply location/date boost if entities match
                location_boost = 0.0
                date_boost = 0.0
                event_articles_list = event_articles_map.get(event.id, [])

                if event_articles_list and (article.extracted_locations or article.extracted_dates):
                    # Check if any article in the event shares locations
                    article_locs = set(loc.lower() for loc in (article.extracted_locations or []))
                    if article_locs:
                        for event_art in event_articles_list:
                            event_art_locs = set(loc.lower() for loc in (event_art.extracted_locations or []))
                            if article_locs.intersection(event_art_locs):
                                location_boost = 0.10
                                break

                    # Check if any article in the event shares dates
                    article_dates = set(date.lower() for date in (article.extracted_dates or []))
                    if article_dates:
                        for event_art in event_articles_list:
                            event_art_dates = set(date.lower() for date in (event_art.extracted_dates or []))
                            if article_dates.intersection(event_art_dates):
                                date_boost = 0.05
                                break

                boosted_score = breakdown.final + location_boost + date_boost

                if location_boost > 0 or date_boost > 0:
                    correlation_log.debug(
                        "entity_overlap_boost",
                        event_id=event.id,
                        base_score=breakdown.final,
                        location_boost=location_boost,
                        date_boost=date_boost,
                        boosted_score=boosted_score,
                    )

                if best_breakdown is None or boosted_score > best_boosted_score:
                    best_event = event
                    best_breakdown = breakdown
                    best_boosted_score = boosted_score

            threshold = self.settings.event_score_threshold
            if best_event is not None and best_breakdown is not None and best_boosted_score >= threshold:
                # Calculate location/date boost for the best event
                location_boost_final = 0.0
                date_boost_final = 0.0
                best_event_articles = event_articles_map.get(best_event.id, [])

                if best_event_articles and (article.extracted_locations or article.extracted_dates):
                    article_locs = set(loc.lower() for loc in (article.extracted_locations or []))
                    if article_locs:
                        for event_art in best_event_articles:
                            event_art_locs = set(loc.lower() for loc in (event_art.extracted_locations or []))
                            if article_locs.intersection(event_art_locs):
                                location_boost_final = 0.10
                                break

                    article_dates = set(date.lower() for date in (article.extracted_dates or []))
                    if article_dates:
                        for event_art in best_event_articles:
                            event_art_dates = set(date.lower() for date in (event_art.extracted_dates or []))
                            if article_dates.intersection(event_art_dates):
                                date_boost_final = 0.05
                                break

                result = await self._append_to_existing_event(
                    session=session,
                    repo=repo,
                    event=best_event,
                    article=article,
                    features=features,
                    entity_payload=entity_payload,
                    breakdown=best_breakdown,
                    location_boost=location_boost_final,
                    date_boost=date_boost_final,
                    timestamp=now,
                    correlation_id=correlation_id,
                )
                correlation_log.info(
                    "event_assignment_linked",
                    event_id=result.event_id,
                    score=result.score,
                    location_boost=location_boost_final,
                    date_boost=date_boost_final,
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
                correlation_id=correlation_id,
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
        location_boost: float = 0.0,
        date_boost: float = 0.0,
        timestamp: datetime,
        correlation_id: str | None,
    ) -> EventAssignmentResult:
        boosted_score = breakdown.final + location_boost + date_boost
        scoring_dict = breakdown.as_dict()
        scoring_dict["location_boost"] = location_boost
        scoring_dict["date_boost"] = date_boost
        scoring_dict["boosted_final"] = boosted_score

        await repo.append_article_to_event(
            event=event,
            article=article,
            embedding=features.embedding,
            tfidf_vector=features.tfidf,
            entities=entity_payload,
            similarity_score=boosted_score,
            scoring_breakdown=scoring_dict,
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
        await self._maybe_schedule_insight_generation(event.id, event.last_updated_at, correlation_id)
        return EventAssignmentResult(
            article_id=article.id,
            event_id=event.id,
            created=False,
            score=boosted_score,
            threshold=self.settings.event_score_threshold,
            breakdown=scoring_dict,
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
        correlation_id: str | None,
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
        await self._maybe_schedule_insight_generation(event.id, event.last_updated_at, correlation_id)
        return EventAssignmentResult(
            article_id=article.id,
            event_id=event.id,
            created=True,
            score=seed_breakdown.final,
            threshold=self.settings.event_score_threshold,
            breakdown=scoring_payload,
        )

    async def _maybe_schedule_insight_generation(
        self,
        event_id: int,
        last_updated_at: datetime | None,
        correlation_id: str | None,
    ) -> None:
        if not self.auto_generate_insights or self.insight_service is None:
            return

        if event_id in self._pending_insight_events:
            return

        if not await self._insight_needs_refresh(event_id, last_updated_at):
            return

        self._pending_insight_events.add(event_id)

        async def _run() -> None:
            try:
                await self.insight_service.generate_for_event(event_id, correlation_id=correlation_id)
            except Exception as exc:  # pragma: no cover - defensive logging
                self.log.warning(
                    "insight_autogen_failed",
                    event_id=event_id,
                    error=str(exc),
                    correlation_id=correlation_id,
                )
            finally:
                self._pending_insight_events.discard(event_id)
                self._insight_tasks.pop(event_id, None)

        task = asyncio.create_task(_run(), name=f"generate-insights-{event_id}")
        self._insight_tasks[event_id] = task

    async def _insight_needs_refresh(
        self,
        event_id: int,
        last_updated_at: datetime | None,
    ) -> bool:
        async with self.session_factory() as session:
            repo = InsightRepository(session)
            insight = await repo.get_latest_insight(event_id)

        if insight is None:
            return True

        if insight.generated_at is None:
            return True

        if last_updated_at is None:
            return False

        latest_generated = insight.generated_at if insight.generated_at.tzinfo else insight.generated_at.replace(tzinfo=timezone.utc)
        refreshed_at = last_updated_at if last_updated_at.tzinfo else last_updated_at.replace(tzinfo=timezone.utc)

        if refreshed_at <= latest_generated:
            return False

        return (refreshed_at - latest_generated) >= self.insight_refresh_ttl


__all__ = ["EventService", "EventAssignmentResult"]
