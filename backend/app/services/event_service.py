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
from backend.app.llm.client import MistralClient, LLMResponse

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


def _extract_entities(raw: Iterable[dict] | None) -> tuple[set[str], set[str], set[str], List[Dict[str, Optional[str]]]]:
    """
    Extract entities with type-specific separation.

    Returns:
        - all_texts: set of all entity texts (lowercase)
        - person_texts: set of PERSON entity texts (lowercase)
        - location_texts: set of GPE/LOC entity texts (lowercase)
        - payload: list of entity dicts with text and label
    """
    all_texts: set[str] = set()
    person_texts: set[str] = set()
    location_texts: set[str] = set()
    payload: List[Dict[str, Optional[str]]] = []

    for entity in raw or []:
        if not isinstance(entity, dict):
            continue
        text = str(entity.get("text") or entity.get("name") or "").strip()
        if not text:
            continue
        label_value = entity.get("label") or entity.get("type")
        label = str(label_value).strip().upper() if label_value else None

        text_lower = text.lower()
        all_texts.add(text_lower)

        # Categorize by entity type
        if label == "PERSON":
            person_texts.add(text_lower)
        elif label in ("GPE", "LOC"):  # Geo-political entity or location
            location_texts.add(text_lower)

        payload.append({"text": text, "label": label})

    return all_texts, person_texts, location_texts, payload


def _article_to_features(article: Article) -> tuple[ArticleFeatures, List[Dict[str, Optional[str]]]]:
    embedding = _deserialize_embedding(article.embedding)
    tfidf_vector = _sanitize_tfidf(article.tfidf_vector)
    entity_texts, person_texts, location_texts, entity_payload = _extract_entities(article.entities)
    reference_time = article.published_at or article.fetched_at
    return (
        ArticleFeatures(
            embedding=embedding,
            tfidf=tfidf_vector,
            entity_texts=entity_texts,
            published_at=reference_time,
            person_entities=person_texts if person_texts else None,
            location_entities=location_texts if location_texts else None,
        ),
        entity_payload,
    )


def _event_to_features(event: Event) -> EventFeatures:
    entity_texts, person_texts, location_texts, _ = _extract_entities(event.centroid_entities)
    return EventFeatures(
        centroid_embedding=event.centroid_embedding,
        centroid_tfidf=event.centroid_tfidf,
        entity_texts=entity_texts,
        last_updated_at=event.last_updated_at,
        first_seen_at=event.first_seen_at,
        person_entities=person_texts if person_texts else None,
        location_entities=location_texts if location_texts else None,
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
        llm_client: MistralClient | None = None,
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
        self.llm_client = llm_client or (MistralClient() if self.settings.event_llm_enabled else None)

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

            # Collect all scored candidates
            scored_candidates: List[tuple[Event, ScoreBreakdown, float]] = []

            for candidate in candidates:
                event = event_map.get(candidate.event_id)
                if event is None:
                    continue

                # Track if types differ (will allow high-confidence cross-type matches for LLM)
                has_type_mismatch = bool(
                    article.event_type and event.event_type and article.event_type != event.event_type
                )

                if has_type_mismatch:
                    correlation_log.debug(
                        "event_type_mismatch_flagged",
                        article_type=article.event_type,
                        event_type=event.event_type,
                        event_id=event.id,
                        note="Will evaluate score before deciding",
                    )

                # CRIME/ACCIDENT HARD CONSTRAINTS: Different locations or dates = different events
                if article.event_type in ('crime',) and event.event_type in ('crime',):
                    event_articles_list = event_articles_map.get(event.id, [])
                    if event_articles_list:
                        # Check location constraint: crime at different cities = different events
                        article_locs = set(loc.lower() for loc in (article.extracted_locations or []))

                        # Get all locations from event articles
                        event_locs = set()
                        for event_art in event_articles_list:
                            event_locs.update(loc.lower() for loc in (event_art.extracted_locations or []))

                        # If both have locations but no overlap, skip this candidate
                        if article_locs and event_locs and not article_locs.intersection(event_locs):
                            correlation_log.debug(
                                "crime_location_mismatch",
                                article_id=article.id,
                                event_id=event.id,
                                article_locations=list(article_locs),
                                event_locations=list(event_locs),
                            )
                            continue

                        # If one side has no locations, be very cautious
                        # Require higher entity overlap (0.3+) to cluster
                        if not article_locs or not event_locs:
                            # Calculate entity overlap for this check
                            # Extract entity texts from article
                            article_entity_texts = set()
                            if article.entities:
                                article_entity_texts = {
                                    ent.get("text", "").lower()
                                    for ent in article.entities
                                    if ent.get("text")
                                }

                            # Extract entity texts from event articles
                            event_entity_set = set()
                            for event_art in event_articles_list:
                                if event_art.entities:
                                    event_entity_set.update(
                                        ent.get("text", "").lower()
                                        for ent in event_art.entities
                                        if ent.get("text")
                                    )

                            if article_entity_texts and event_entity_set:
                                entity_overlap = len(article_entity_texts.intersection(event_entity_set)) / len(article_entity_texts.union(event_entity_set))
                                if entity_overlap < 0.5:
                                    correlation_log.debug(
                                        "crime_missing_location_low_entity_overlap",
                                        article_id=article.id,
                                        event_id=event.id,
                                        entity_overlap=entity_overlap,
                                        has_article_locs=bool(article_locs),
                                        has_event_locs=bool(event_locs),
                                    )
                                    continue

                        # Check time constraint: crimes more than 2 days apart = likely different events
                        if article.published_at and event.last_updated_at:
                            days_diff = abs((article.published_at - event.last_updated_at).days)
                            if days_diff > 2:
                                correlation_log.debug(
                                    "crime_time_mismatch",
                                    article_id=article.id,
                                    event_id=event.id,
                                    days_diff=days_diff,
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

                # Type-based filtering:
                # - If types match: accept if score meets threshold
                # - If types differ: only accept if score > 0.70 (very high confidence)
                #   This allows LLM to decide on cases like Trump National Guard (legal/crime/international mix)
                if has_type_mismatch:
                    if boosted_score >= 0.70:
                        correlation_log.debug(
                            "high_confidence_cross_type_match",
                            article_type=article.event_type,
                            event_type=event.event_type,
                            event_id=event.id,
                            score=boosted_score,
                            note="Allowing LLM to decide despite type mismatch",
                        )
                        scored_candidates.append((event, breakdown, boosted_score))
                    else:
                        correlation_log.debug(
                            "low_confidence_cross_type_skip",
                            article_type=article.event_type,
                            event_type=event.event_type,
                            event_id=event.id,
                            score=boosted_score,
                        )
                else:
                    # Types match or one is None - use normal threshold
                    scored_candidates.append((event, breakdown, boosted_score))

            # Sort candidates by boosted score (highest first)
            scored_candidates.sort(key=lambda x: x[2], reverse=True)

            # Decide on best event: use LLM if enabled, otherwise take highest score
            best_event: Event | None = None
            best_breakdown: ScoreBreakdown | None = None
            best_boosted_score: float = 0.0

            # Filter candidates by minimum LLM threshold
            llm_candidates = [
                (event, score)
                for event, breakdown, score in scored_candidates
                if score >= self.settings.event_llm_min_score
            ][:self.settings.event_llm_top_n]

            # Use LLM for final decision if enabled and we have candidates
            if self.settings.event_llm_enabled and self.llm_client and llm_candidates:
                correlation_log.debug(
                    "using_llm_for_decision",
                    candidates_count=len(llm_candidates),
                )
                selected_event_id = await self._llm_select_best_event(
                    article=article,
                    candidates=llm_candidates,
                    correlation_id=correlation_id,
                )

                # Find the selected event in our candidates
                if selected_event_id:
                    for event, breakdown, boosted_score in scored_candidates:
                        if event.id == selected_event_id:
                            best_event = event
                            best_breakdown = breakdown
                            best_boosted_score = boosted_score
                            correlation_log.info(
                                "llm_selected_event",
                                event_id=selected_event_id,
                                score=boosted_score,
                            )
                            break

            # Fallback to highest scoring candidate if LLM didn't select or is disabled
            if best_event is None and scored_candidates:
                best_event, best_breakdown, best_boosted_score = scored_candidates[0]
                correlation_log.debug(
                    "using_score_based_decision",
                    event_id=best_event.id,
                    score=best_boosted_score,
                )

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

    async def _llm_select_best_event(
        self,
        article: Article,
        candidates: List[tuple[Event, float]],
        correlation_id: str | None = None,
    ) -> int | None:
        """Use LLM to select the best matching event from candidates, or None for new event."""
        if not self.llm_client or not candidates:
            return None

        # Build prompt with article and candidate events
        article_text = f"{article.title}\n\n{article.content[:1200]}"
        article_locations = ", ".join(article.extracted_locations or ['unknown'])
        article_date = article.published_at.strftime('%Y-%m-%d') if article.published_at else 'unknown'

        candidates_text = []
        for idx, (event, score) in enumerate(candidates, 1):
            event_desc = f"EVENT {idx} (score={score:.2f}):\n"
            event_desc += f"  Title: {event.title}\n"
            if event.description:
                event_desc += f"  Summary: {event.description[:200]}\n"
            event_desc += f"  Type: {event.event_type or 'unknown'}\n"
            event_desc += f"  Articles: {event.article_count}\n"
            event_desc += f"  Last updated: {event.last_updated_at.strftime('%Y-%m-%d') if event.last_updated_at else 'unknown'}\n"
            candidates_text.append(event_desc)

        prompt = f"""You are clustering news articles. Decide if this NEW article belongs to an existing event or should create a NEW_EVENT.

NEW ARTICLE:
Type: {article.event_type or 'unknown'}
Location: {article_locations}
Date: {article_date}
Text: {article_text}

CANDIDATE EVENTS:
{chr(10).join(candidates_text)}

MATCHING CRITERIA:
✓ SAME EVENT if:
  • Exact same incident (same victim, same accident, same political decision)
  • Same specific people/organizations involved
  • Same specific location (for local events like crimes, accidents)
  • Continuation/update of the SAME story
  • Within 1-2 days for breaking news

✗ DIFFERENT EVENT if:
  • Different victims or suspects (even if similar crime type)
  • Different locations for local events (crimes, accidents, local news)
  • Same general topic but distinct incidents (e.g., two separate robberies)
  • Different specific entities/names involved
  • More than 2 days apart for breaking news

CRITICAL FOR CRIMES: Different victim names OR different cities = ALWAYS different events.

Respond with ONLY:
"EVENT_1" or "EVENT_2" or "EVENT_3" or "NEW_EVENT"

Response:"""

        try:
            response: LLMResponse = await self.llm_client.generate_text(
                prompt=prompt,
                temperature=0.1,
                max_tokens=50,
            )

            decision = response.content.strip().upper()
            self.log.info(
                "llm_event_decision",
                article_id=article.id,
                decision=decision,
                candidates_count=len(candidates),
                correlation_id=correlation_id,
            )

            # Parse LLM decision
            if "NEW_EVENT" in decision or "NEW EVENT" in decision:
                return None

            for idx, (event, _) in enumerate(candidates, 1):
                if f"EVENT_{idx}" in decision or f"EVENT {idx}" in decision:
                    return event.id

            # Default to None if unclear
            self.log.warning(
                "llm_decision_unclear",
                article_id=article.id,
                decision=decision,
                correlation_id=correlation_id,
            )
            return None

        except Exception as exc:
            self.log.warning(
                "llm_decision_failed",
                article_id=article.id,
                error=str(exc),
                correlation_id=correlation_id,
            )
            return None

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
