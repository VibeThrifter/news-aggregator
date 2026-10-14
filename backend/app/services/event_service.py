"""Service for hybrid scoring and event assignment."""

from __future__ import annotations

from array import array
import asyncio
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Mapping, Optional, TYPE_CHECKING

from sqlalchemy import exists, func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Article, Event, EventArticle
from backend.app.db.session import get_sessionmaker
from backend.app.db.supabase import get_frontend_sessionmaker
from backend.app.events.scoring import (
    ArticleFeatures,
    EventFeatures,
    ScoreBreakdown,
    ScoreParameters,
    compute_hybrid_score,
)
from backend.app.repositories import EventRepository, InsightRepository
from backend.app.services.insight_service import INSIGHT_REFRESH_TTL, InsightService
from backend.app.llm.client import BaseLLMClient, LLMResponse
from backend.app.llm.providers import NEWS_PIPELINE_PRIORITY, StepLLMClient

if TYPE_CHECKING:
    from backend.app.services.vector_index import VectorIndexService

logger = get_logger(__name__)

# The LLM judges every candidate that may be the same news, not only those with a high score.
# Measured on 2026-10-08 (230 pairs of articles of different outlets in different events, 30 hours):
# the hybrid score of articles on the same news ranged from 0.14 to 0.78, mostly under the 0.55 at
# which the LLM was asked, because outlets name different people and places (the entity penalty).
# Shared words (tf-idf) separate them best: the same news shares at least about 0.2, short texts
# that merely look alike (teasers, cartoons, columns) less than 0.15
LLM_ASK_MIN_EMBEDDING = 0.70
LLM_ASK_MIN_TFIDF = 0.20
# ... or the same people and places with some shared words (an article with a short text)
LLM_ASK_ENTITY_EMBEDDING = 0.60
LLM_ASK_MIN_ENTITIES = 0.20
LLM_ASK_ENTITY_TFIDF = 0.10
# ... or titles that share two distinctive words ("BAM koopt bouwbedrijf ..." and "Bouwbedrijf BAM
# koopt ..."): of the pairs above, those with two shared title words were the same news but for one,
# also where outlets' boilerplate ("Luister ook naar onze podcast", a cookie notice) kept the
# shared words of the text low
LLM_ASK_TITLE_EMBEDDING = 0.55
LLM_ASK_MIN_TITLE_WORDS = 2
TITLE_STOPWORDS = frozenset(
    """voor naar door over zijn deze niet meer weer toch maar want omdat zoals tegen onder tussen
    tijdens sinds zonder bijna veel heel alle alles iets niets moet moeten kunnen wordt worden werd
    werden heeft hebben hadden gaat gaan komt komen zegt zeggen eerste nieuwe nieuw grote groot hier
    daar waar wanneer waarom welke zich zelf onze jouw""".split()
)
# Without the LLM's verdict an article waits for the next round instead of starting an event of
# its own, but only while its news is younger than this. The catch-up only looks at news of the
# last 24 hours (ingest_service.CURRENT_NEWS_HOURS), so it decides on scores in the hours between,
# instead of leaving the article without an event for good
DEFER_MAX_AGE = timedelta(hours=20)


@dataclass(frozen=True)
class LLMEventDecision:
    """What the LLM said about an article: an existing event, a new event, or nothing usable."""

    event_id: int | None = None
    new_event: bool = False

    @property
    def decided(self) -> bool:
        return self.event_id is not None or self.new_event


@dataclass(frozen=True)
class _Scored:
    """A candidate event with the article's scores against it."""

    event: Event
    breakdown: ScoreBreakdown
    score: float  # The final score plus the location, date and source affinity boosts
    requires_llm: bool  # Entity overlap so low that only the LLM may join them
    affinity: float  # Source affinity boost (Een Blik op de NOS)
    location_boost: float
    date_boost: float
    type_mismatch: bool
    # Most distinctive words the article's title shares with the title of the event or one of its articles
    shared_title_words: int = 0


@dataclass(frozen=True)
class _Decision:
    """Where an article goes: an existing event, a new one, or later (``defer``)."""

    event: Event | None = None
    breakdown: ScoreBreakdown | None = None
    score: float = 0.0
    location_boost: float = 0.0
    date_boost: float = 0.0
    by_llm: bool = False
    defer: bool = False
    threshold: float = 0.0

    @classmethod
    def join(cls, candidate: _Scored, *, threshold: float, by_llm: bool) -> "_Decision":
        return cls(
            event=candidate.event,
            breakdown=candidate.breakdown,
            score=candidate.score,
            location_boost=candidate.location_boost,
            date_boost=candidate.date_boost,
            by_llm=by_llm,
            threshold=threshold,
        )


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


# Sport-specific keywords for distinguishing different sports
# Each tuple contains keywords that belong to the SAME sport category
SPORT_CATEGORIES = {
    "voetbal": {"voetbal", "wk voetbal", "ek voetbal", "eredivisie", "champions league",
                "elftal", "oranje", "ajax", "feyenoord", "psv", "goal", "penalty",
                "fifa", "uefa", "trainer", "opstelling"},
    "schaatsen": {"schaatsen", "schaats", "ijs", "ijsbaan", "world cup", "heerenveen",
                  "thialf", "500 meter", "1000 meter", "1500 meter", "5000 meter",
                  "10000 meter", "sprint", "allround", "knsb", "isu"},
    "wielrennen": {"wielrennen", "fiets", "etappe", "peloton", "tour", "giro", "vuelta",
                   "klassieker", "sprint", "bergrit", "tijdrit"},
    "tennis": {"tennis", "wimbledon", "roland garros", "us open", "australian open",
               "atp", "wta", "set", "game", "tiebreak"},
    "formule 1": {"formule 1", "f1", "grand prix", "verstappen", "red bull", "pit stop",
                  "pole position", "circuit", "race"},
    "zwemmen": {"zwemmen", "zwem", "baantjes", "crawl", "schoolslag", "vlinder",
                "estafette", "medley"},
    "atletiek": {"atletiek", "marathon", "sprint", "hoogspringen", "verspringen",
                 "kogelstoten", "speerwerpen"},
    "hockey": {"hockey", "stick", "shootout", "drag", "strafcorner"},
    "volleybal": {"volleybal", "smash", "block", "service", "set"},
    "basketbal": {"basketbal", "nba", "dunk", "rebound", "three-pointer"},
    "darts": {"darts", "pdc", "bdo", "checkout", "dubbel", "triple"},
    "snooker": {"snooker", "biljart", "pot", "cue", "century"},
    "golf": {"golf", "hole", "birdie", "par", "bogey", "putt"},
}


def _detect_sport_category(text: str) -> set[str]:
    """Detect which sport categories are present in text."""
    text_lower = text.lower()
    detected = set()
    for sport, keywords in SPORT_CATEGORIES.items():
        for keyword in keywords:
            if keyword in text_lower:
                detected.add(sport)
                break  # Found this sport, move to next
    return detected


def _are_different_sports(article: Article, event_articles: List[Article]) -> bool:
    """
    Check if article and event articles are about different sports.

    Returns True if we can definitively determine they are different sports,
    False otherwise (including when we can't determine).
    """
    if not event_articles:
        return False

    # Extract text from article
    article_text = f"{article.title or ''} {article.content or ''}"
    article_sports = _detect_sport_category(article_text)

    if not article_sports:
        return False  # Can't determine sport for article

    # Extract text from all event articles
    event_sports: set[str] = set()
    for event_article in event_articles:
        event_text = f"{event_article.title or ''} {event_article.content or ''}"
        event_sports.update(_detect_sport_category(event_text))

    if not event_sports:
        return False  # Can't determine sport for event

    # If there's no overlap in detected sports, they're different
    if not article_sports.intersection(event_sports):
        return True

    return False


def _title_words(title: str | None) -> set[str]:
    """The distinctive words of a title: four letters or more, no common words."""

    words = re.findall(r"[0-9a-zà-ÿ][0-9a-zà-ÿ'-]+", (title or "").lower())
    return {word for word in words if len(word) >= 4 and word not in TITLE_STOPWORDS}


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


# Maximum concurrent insight generation tasks to prevent pool exhaustion
MAX_CONCURRENT_INSIGHT_TASKS = 3


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
        llm_client: BaseLLMClient | None = None,
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
        self.insight_refresh_ttl = insight_refresh_ttl or INSIGHT_REFRESH_TTL
        self._pending_insight_events: set[int] = set()
        self._insight_tasks: dict[int, asyncio.Task[None]] = {}
        self._insight_semaphore = asyncio.Semaphore(MAX_CONCURRENT_INSIGHT_TASKS)
        self._assignment_lock = asyncio.Lock()
        # The provider comes from llm_config (provider_event_assignment, else that of the factual analysis)
        self.llm_client = llm_client or (
            StepLLMClient(
                "provider_event_assignment",
                fallback_keys=("provider_factual",),
                settings=self.settings,
                priority=NEWS_PIPELINE_PRIORITY,
            )
            if self.settings.event_llm_enabled
            else None
        )

    async def assign_orphaned_articles(
        self,
        *,
        limit: int | None = 100,
        max_age_hours: float | None = None,
        correlation_id: str | None = None,
    ) -> Dict[str, int]:
        """Assign enriched Dutch articles that are in no event yet.

        They are left behind when a poll cycle times out between enrichment and assignment, or
        when a provider fails; re-polls see them as duplicates and never retry them. Foreign
        articles are skipped: international enrichment attaches those to an event itself.
        ``max_age_hours`` counts from publication (only the current news).
        """

        stmt = (
            select(Article.id)
            .where(Article.enriched_at.is_not(None))
            .where(Article.is_international.is_(False))
            .where(~exists().where(EventArticle.article_id == Article.id))
            .order_by(Article.published_at.asc().nulls_last(), Article.id.asc())
        )
        if max_age_hours is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
            stmt = stmt.where(func.coalesce(Article.published_at, Article.fetched_at) >= cutoff)
        if limit is not None:
            stmt = stmt.limit(limit)
        async with self.session_factory() as session:
            article_ids = list((await session.execute(stmt)).scalars().all())

        stats = {"orphans": len(article_ids), "events_created": 0, "events_linked": 0, "events_skipped": 0, "failed": 0}
        for article_id in article_ids:
            try:
                result = await self.assign_article(article_id, correlation_id=correlation_id)
            except Exception as exc:  # one bad article must not stop the rest
                stats["failed"] += 1
                self.log.warning("orphan_assignment_failed", article_id=article_id, error=str(exc))
                continue
            if result is None:
                stats["events_skipped"] += 1
            elif result.created:
                stats["events_created"] += 1
            else:
                stats["events_linked"] += 1
        self.log.info("orphan_assignment_done", correlation_id=correlation_id, **stats)
        return stats

    async def assign_article(
        self,
        article_id: int,
        *,
        correlation_id: str | None = None,
    ) -> EventAssignmentResult | None:
        """Assign an enriched article to an existing event or create a new one.

        Returns None when the article cannot be assigned now: it is missing, has no embedding, or
        the LLM had to judge it and could not (it is tried again later, as an orphan). Articles are
        assigned one at a time: the feed readers run side by side, and two outlets' articles on the
        same news, decided at the same moment, did not see each other's new event.
        """

        async with self._assignment_lock:
            return await self._assign_article(article_id, correlation_id=correlation_id)

    async def _assign_article(
        self,
        article_id: int,
        *,
        correlation_id: str | None,
    ) -> EventAssignmentResult | None:
        correlation_log = self.log.bind(correlation_id=correlation_id, article_id=article_id)
        async with self.session_factory() as session:
            article = await session.get(Article, article_id)
            if article is None:
                correlation_log.warning("event_assignment_article_missing")
                return None

            # A catch-up and a poll can hold the same article (an admin catch-up runs beside the
            # polls): the second one leaves it where the first one put it
            assigned = await session.scalar(
                select(EventArticle.event_id).where(EventArticle.article_id == article_id).limit(1)
            )
            if assigned is not None:
                correlation_log.info("event_assignment_already_assigned", event_id=assigned)
                return None

            features, entity_payload = _article_to_features(article)
            if not features.embedding:
                correlation_log.warning("event_assignment_missing_embedding")
                return None

            await self.vector_index.ensure_ready(session)

            repo = EventRepository(session)
            now = datetime.now(timezone.utc)
            decision = await self._decide(
                session=session,
                article=article,
                features=features,
                now=now,
                correlation_log=correlation_log,
                correlation_id=correlation_id,
            )

            if decision.event is not None and decision.breakdown is not None:
                result = await self._append_to_existing_event(
                    session=session,
                    repo=repo,
                    event=decision.event,
                    article=article,
                    features=features,
                    entity_payload=entity_payload,
                    breakdown=decision.breakdown,
                    location_boost=decision.location_boost,
                    date_boost=decision.date_boost,
                    timestamp=now,
                    correlation_id=correlation_id,
                )
                correlation_log.info(
                    "event_assignment_linked",
                    event_id=result.event_id,
                    score=result.score,
                    location_boost=decision.location_boost,
                    date_boost=decision.date_boost,
                    threshold=decision.threshold,
                    by_llm=decision.by_llm,
                )
                return result

            if decision.defer:
                correlation_log.info("event_assignment_deferred", reason="llm_unavailable")
                return None

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
                threshold=decision.threshold,
            )
            return result

    async def _decide(
        self,
        *,
        session: AsyncSession,
        article: Article,
        features: ArticleFeatures,
        now: datetime,
        correlation_log,
        correlation_id: str | None,
        exclude_event_ids: frozenset[int] = frozenset(),
        llm_only: bool = False,
    ) -> _Decision:
        """Decide which event the article belongs to (none: a new one), without writing anything.

        exclude_event_ids: events that are no candidate (the article's own, when it is decided
        again).
        llm_only: join an event only on the LLM's verdict, never on the scores alone.
        """

        repo = EventRepository(session)
        params = ScoreParameters(
            weight_embedding=self.settings.event_score_weight_embedding,
            weight_tfidf=self.settings.event_score_weight_tfidf,
            weight_entities=self.settings.event_score_weight_entities,
            time_decay_half_life_hours=self.settings.event_score_time_decay_half_life_hours,
            time_decay_floor=self.settings.event_score_time_decay_floor,
        )

        candidates = await self.vector_index.query_candidates(features.embedding)

        # ENTITY-BASED CANDIDATE EXPANSION for @eenblikopdenos media commentary
        # Add NOS events that share entities with the tweet (may not appear in embedding candidates)
        from sqlalchemy import select as sa_select

        if article.source_name == "Een Blik op de NOS" and article.entities:
            # ENTITY CANDIDATE EXPANSION: Find NOS events sharing distinctive entities
            # Distinctive entities are:
            # - PERSON names (full names ≥10 chars)
            # - WORK_OF_ART, FAC (facility), EVENT - inherently distinctive
            # Note: spaCy labels can be inconsistent between articles, so we:
            # 1. Collect tweet entities with distinctive labels
            # 2. Also collect ALL tweet entity texts (for cross-matching with NOS PERSON entities)
            MIN_PERSON_NAME_LENGTH = 10
            DISTINCTIVE_LABELS = {"WORK_OF_ART", "FAC", "EVENT"}

            # Get distinctive entities from tweet
            article_distinctive = set()
            article_all_texts = set()  # All entity texts for cross-matching
            for ent in article.entities:
                text = ent.get("text", "")
                label = ent.get("label")
                if text and len(text) >= 4:  # Minimum length for any entity
                    article_all_texts.add(text.lower())
                    if (label == "PERSON" and len(text) >= MIN_PERSON_NAME_LENGTH) or label in DISTINCTIVE_LABELS:
                        article_distinctive.add(text.lower())

            if article_distinctive:
                # Find NOS events WITH MATCHING TITLE ENTITIES
                # Query all NOS articles with their event IDs, titles, and entities
                nos_articles_stmt = (
                    sa_select(EventArticle.event_id, Article.title, Article.entities)
                    .join(Article, Article.id == EventArticle.article_id)
                    .where(Article.source_name == "NOS")
                    .where(Article.entities.isnot(None))
                )
                nos_articles_result = await session.execute(nos_articles_stmt)

                # Find events where NOS article TITLES share entities with the tweet
                candidate_event_ids = {c.event_id for c in candidates}
                matching_event_ids = set()

                for event_id, nos_title, nos_entities in nos_articles_result.fetchall():
                    if event_id in candidate_event_ids or event_id in matching_event_ids:
                        continue

                    # Extract entities that appear in NOS article TITLE only
                    # This prevents matching on entities mentioned in passing in body
                    nos_title_entities = set()
                    title_lower = (nos_title or "").lower()
                    if nos_entities and title_lower:
                        for ent in nos_entities:
                            text = ent.get("text", "")
                            # Only include entities that appear in the TITLE
                            if text and len(text) >= 4 and text.lower() in title_lower:
                                nos_title_entities.add(text.lower())

                    # Match: tweet distinctive entity must appear in NOS TITLE
                    shared = article_distinctive.intersection(nos_title_entities)

                    if shared:
                        matching_event_ids.add(event_id)
                        correlation_log.debug(
                            "entity_match_found",
                            event_id=event_id,
                            shared_entities=list(shared)[:3],
                        )

                # Add matching events as candidates
                # For @eenblikopdenos: include ARCHIVED events too (commentary on older news)
                # These will be unarchived if selected
                from backend.app.services.vector_index import VectorCandidate
                if matching_event_ids:
                    # Include all matching events (including archived for media commentary)
                    all_events_stmt = (
                        sa_select(Event.id, Event.archived_at)
                        .where(Event.id.in_(matching_event_ids))
                    )
                    all_events_result = await session.execute(all_events_stmt)
                    all_matching = [(row[0], row[1] is not None) for row in all_events_result.fetchall()]

                    archived_candidate_ids = set()
                    for event_id, is_archived in all_matching[:10]:  # Limit to 10
                        candidates.append(VectorCandidate(
                            event_id=event_id,
                            similarity=0.15,  # Low base, will be boosted by source affinity
                            distance=0.85,
                            last_updated_at=now,
                        ))
                        if is_archived:
                            archived_candidate_ids.add(event_id)

                    correlation_log.info(
                        "entity_candidate_expansion",
                        total_matches=len(matching_event_ids),
                        added_candidates=len(all_matching[:10]),
                        archived_candidates=len(archived_candidate_ids),
                        article_distinctive=list(article_distinctive)[:5],
                        matching_events=[m[0] for m in all_matching[:5]],
                    )

        # For @eenblikopdenos: include archived events (commentary on older news)
        include_archived = article.source_name == "Een Blik op de NOS"
        existing_events = await repo.get_events_by_ids(
            [candidate.event_id for candidate in candidates if candidate.event_id not in exclude_event_ids],
            include_archived=include_archived,
        )
        event_map = {event.id: event for event in existing_events}

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

        scored: List[_Scored] = []
        article_title_words = _title_words(article.title)

        for candidate in candidates:
            event = event_map.get(candidate.event_id)
            if event is None:
                continue

            # For @eenblikopdenos: only consider events that have NOS articles
            # (don't match to empty events or tweet-only events)
            event_articles_list_early = event_articles_map.get(event.id, [])
            if article.source_name == "Een Blik op de NOS":
                has_nos = any(ea.source_name == "NOS" for ea in event_articles_list_early)
                if not has_nos:
                    correlation_log.debug(
                        "eenblikopdenos_skip_non_nos_event",
                        article_id=article.id,
                        event_id=event.id,
                        event_article_count=len(event_articles_list_early),
                    )
                    continue

            # Different types: the LLM sees both and may still join them, the scores alone only
            # above 0.70 (see _join_on_scores). An unknown type (a failed classification) differs
            # from nothing
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

            # SPORTS HARD CONSTRAINT: Different sports = different events
            # Check for sport-specific keywords regardless of event_type classification
            # (classification may fail or be inconsistent)
            event_articles_list = event_articles_map.get(event.id, [])
            is_different_sport = _are_different_sports(article, event_articles_list)
            if is_different_sport:
                correlation_log.debug(
                    "sports_type_mismatch",
                    article_id=article.id,
                    event_id=event.id,
                    note="Different sports detected, skipping candidate",
                )
                continue

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
            source_affinity_boost = 0.0
            event_articles_list = event_articles_map.get(event.id, [])

            # SOURCE AFFINITY: Boost @eenblikopdenos tweets to cluster with NOS events
            # ONLY if they share PERSON entities (specific people = specific story match)
            # Without entity match, tweets create separate events (general commentary)
            if article.source_name == "Een Blik op de NOS":
                # Check if candidate event has NOS articles
                nos_articles = [ea for ea in event_articles_list if ea.source_name == "NOS"]
                if nos_articles:
                    # ENTITY MATCHING: Cluster if tweet shares distinctive entities with NOS articles
                    # Distinctive entities are:
                    # - PERSON names (full names ≥10 chars)
                    # - WORK_OF_ART, FAC (facility), EVENT - inherently distinctive
                    # Cross-matching: entity matches if distinctive in EITHER source
                    # This handles spaCy labeling inconsistencies
                    MIN_PERSON_NAME_LENGTH = 10
                    DISTINCTIVE_LABELS = {"WORK_OF_ART", "FAC", "EVENT"}

                    article_distinctive = set()
                    article_all_texts = set()
                    if article.entities:
                        for ent in article.entities:
                            text = ent.get("text", "")
                            label = ent.get("label")
                            if text and len(text) >= 4:
                                article_all_texts.add(text.lower())
                                if (label == "PERSON" and len(text) >= MIN_PERSON_NAME_LENGTH) or label in DISTINCTIVE_LABELS:
                                    article_distinctive.add(text.lower())

                    # Get entities from NOS article TITLES only (not body)
                    # This prevents matching on entities mentioned in passing
                    # e.g., "Pim Fortuyn" mentioned as example in Lale Gül article
                    nos_title_entities = set()
                    for nos_art in nos_articles:
                        title_lower = (nos_art.title or "").lower()
                        if nos_art.entities and title_lower:
                            for ent in nos_art.entities:
                                text = ent.get("text", "")
                                label = ent.get("label")
                                # Only include entities that appear in the TITLE
                                if text and len(text) >= 4 and text.lower() in title_lower:
                                    nos_title_entities.add(text.lower())

                    # Match: tweet distinctive entity must appear in NOS TITLE
                    # This ensures we only cluster when the tweet's main subject
                    # matches what the NOS article is actually about
                    shared_entities = article_distinctive.intersection(nos_title_entities)
                    if shared_entities:
                        # Strong boost when PERSON entities match (same specific story)
                        source_affinity_boost = 0.20 + min(0.30, len(shared_entities) * 0.10)
                        correlation_log.debug(
                            "source_affinity_entity_match",
                            article_id=article.id,
                            event_id=event.id,
                            shared_entities=list(shared_entities)[:5],
                            boost=source_affinity_boost,
                        )
                    else:
                        # No title entity match = no boost = won't cluster
                        correlation_log.debug(
                            "source_affinity_no_title_match",
                            article_id=article.id,
                            event_id=event.id,
                            tweet_distinctive=list(article_distinctive)[:5],
                            nos_title_entities=list(nos_title_entities)[:5],
                        )

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

            boosted_score = breakdown.final + location_boost + date_boost + source_affinity_boost

            if location_boost > 0 or date_boost > 0 or source_affinity_boost > 0:
                correlation_log.debug(
                    "score_boost_applied",
                    event_id=event.id,
                    base_score=breakdown.final,
                    location_boost=location_boost,
                    date_boost=date_boost,
                    source_affinity_boost=source_affinity_boost,
                    boosted_score=boosted_score,
                )

            # Entity overlap check: very low overlap suggests different topics
            # Mark candidates with low entity overlap for special handling
            requires_llm_verification = breakdown.entities < self.settings.event_low_entity_llm_threshold

            event_titles = [event.title] + [event_art.title for event_art in event_articles_list]
            shared_title_words = max(
                (len(article_title_words & _title_words(title)) for title in event_titles),
                default=0,
            )

            scored.append(
                _Scored(
                    event=event,
                    breakdown=breakdown,
                    score=boosted_score,
                    requires_llm=requires_llm_verification,
                    affinity=source_affinity_boost,
                    location_boost=location_boost,
                    date_boost=date_boost,
                    type_mismatch=has_type_mismatch,
                    shared_title_words=shared_title_words,
                )
            )

        # Sort candidates by boosted score (highest first)
        scored.sort(key=lambda candidate: candidate.score, reverse=True)
        threshold = self.settings.event_score_threshold

        # The LLM judges every candidate that may be the same news, and its verdict decides
        llm_candidates = [c for c in scored if self._worth_asking(c)][: self.settings.event_llm_top_n]
        decision = LLMEventDecision()
        if self.llm_client is not None and llm_candidates:
            correlation_log.debug("using_llm_for_decision", candidates_count=len(llm_candidates))
            decision = await self._llm_select_best_event(
                article=article,
                candidates=[(c.event, c.score) for c in llm_candidates],
                correlation_id=correlation_id,
                event_articles_map=event_articles_map,
            )

            if decision.event_id is not None:
                chosen = next((c for c in llm_candidates if c.event.id == decision.event_id), None)
                if chosen is not None:
                    correlation_log.info(
                        "llm_selected_event",
                        event_id=chosen.event.id,
                        score=chosen.score,
                    )
                    return _Decision.join(chosen, threshold=threshold, by_llm=True)
            elif decision.new_event:
                # LLM was called and decided NEW_EVENT - respect this decision
                correlation_log.info(
                    "llm_decided_new_event",
                    article_id=article.id,
                    candidates_count=len(llm_candidates),
                )
                return _Decision(threshold=threshold)
            else:
                # The call failed or the answer was unclear: that is no verdict, so the
                # scores decide (a provider outage must not split every story)
                correlation_log.info(
                    "llm_decision_unavailable_using_scores",
                    article_id=article.id,
                    candidates_count=len(llm_candidates),
                )

        llm_failed = self.llm_client is not None and bool(llm_candidates) and not decision.decided
        if llm_only:
            return _Decision(threshold=threshold, defer=llm_failed)

        chosen = self._join_on_scores(article, scored, correlation_log)
        if chosen is not None:
            # Use lower threshold for entity-matched source affinity candidates
            chosen_threshold = 0.35 if chosen.affinity > 0.25 else threshold
            if chosen.score >= chosen_threshold:
                return _Decision.join(chosen, threshold=chosen_threshold, by_llm=False)

        # The LLM had to judge this article and could not: rather wait for the next round than
        # start an event of its own (on 2026-10-07 the session limit split 285 stories that way)
        news_time = article.published_at or article.fetched_at
        if news_time is not None and news_time.tzinfo is None:
            news_time = news_time.replace(tzinfo=timezone.utc)
        young = news_time is None or now - news_time <= DEFER_MAX_AGE
        return _Decision(threshold=threshold, defer=llm_failed and young)

    def _worth_asking(self, candidate: _Scored) -> bool:
        """Whether the LLM should judge if the article belongs to this candidate (see LLM_ASK_*)."""

        if candidate.affinity > 0.25:  # Entity-confirmed affinity (Een Blik op de NOS)
            return True
        if candidate.score >= self.settings.event_llm_min_score:
            return True
        breakdown = candidate.breakdown
        if breakdown.embedding >= LLM_ASK_MIN_EMBEDDING and breakdown.tfidf >= LLM_ASK_MIN_TFIDF:
            return True
        if (
            breakdown.embedding >= LLM_ASK_ENTITY_EMBEDDING
            and breakdown.entities >= LLM_ASK_MIN_ENTITIES
            and breakdown.tfidf >= LLM_ASK_ENTITY_TFIDF
        ):
            return True
        return (
            breakdown.embedding >= LLM_ASK_TITLE_EMBEDDING
            and candidate.shared_title_words >= LLM_ASK_MIN_TITLE_WORDS
        )

    def _join_on_scores(
        self,
        article: Article,
        scored: List[_Scored],
        correlation_log,
    ) -> _Scored | None:
        """The candidate to join without an LLM verdict, or None (the caller checks the
        threshold)."""

        # Type-based filtering: if types differ, only a very high score (> 0.70) joins on scores
        # alone. EXCEPTION: source affinity bypasses type mismatch for media commentary sources
        pool: List[_Scored] = []
        for candidate in scored:
            if candidate.type_mismatch:
                # Confirm affinity if:
                # 1. Entity match added extra boost (> 0.20 base), OR
                # 2. Embedding similarity is strong (> 0.45) indicating semantic relevance
                embedding_match = candidate.breakdown.embedding >= 0.45
                entity_match_confirmed = candidate.affinity > 0.25 or (
                    candidate.affinity > 0 and embedding_match
                )
                affinity_threshold = (
                    0.35 if entity_match_confirmed else self.settings.event_score_threshold
                )
                if candidate.affinity > 0 and candidate.score >= affinity_threshold:
                    correlation_log.debug(
                        "source_affinity_type_bypass",
                        event_id=candidate.event.id,
                        score=candidate.score,
                        source_affinity_boost=candidate.affinity,
                        note="Media commentary bypasses type mismatch",
                    )
                elif candidate.score < 0.70:
                    correlation_log.debug(
                        "low_confidence_cross_type_skip",
                        event_id=candidate.event.id,
                        score=candidate.score,
                    )
                    continue
            pool.append(candidate)

        if not pool:
            return None

        # PRIORITY 1: Source affinity candidates with confirmed relevance (media commentary)
        # Confirmed if: entity boost added (a > 0.25) OR embedding similarity strong (>= 0.45)
        affinity_candidates = [
            c
            for c in pool
            if c.affinity > 0.25 or (c.affinity > 0 and c.breakdown.embedding >= 0.45)
        ]
        if affinity_candidates:
            best = max(affinity_candidates, key=lambda c: c.score)
            correlation_log.info(
                "using_affinity_based_decision",
                event_id=best.event.id,
                score=best.score,
                source_affinity=best.affinity,
            )
            return best

        # For @eenblikopdenos tweets: if no entity-matched NOS events found,
        # don't fall back to regular clustering - create separate event instead
        # This prevents false positives where meta-commentary clusters with unrelated NOS content
        if article.source_name == "Een Blik op de NOS":
            correlation_log.info(
                "eenblikopdenos_no_entity_match",
                article_id=article.id,
                note="No entity-matched NOS events found, creating separate event",
            )
            return None

        # PRIORITY 2: Regular score-based selection (for non-eenblikopdenos sources)
        top = pool[0]

        # If top candidate has very low entity overlap (<0.05), skip automatic assignment
        # This protects against clustering unrelated articles from same source
        if top.breakdown.entities < self.settings.event_min_entity_overlap:
            correlation_log.info(
                "skipping_low_entity_overlap_candidate",
                event_id=top.event.id,
                score=top.score,
                entity_overlap=top.breakdown.entities,
                min_required=self.settings.event_min_entity_overlap,
            )
            return None
        if top.requires_llm and self.settings.event_llm_enabled:
            # LLM was supposed to verify but said NEW_EVENT or failed
            correlation_log.debug(
                "llm_rejected_low_entity_candidate",
                event_id=top.event.id,
                score=top.score,
                entity_overlap=top.breakdown.entities,
            )
            return None
        correlation_log.debug(
            "using_score_based_decision",
            event_id=top.event.id,
            score=top.score,
        )
        return top

    async def merge_split_events(
        self,
        *,
        hours: float = 72,
        older_than_hours: float = 0,
        limit: int = 100,
        dry_run: bool = True,
        correlation_id: str | None = None,
    ) -> Dict[str, object]:
        """Merge news items of one Dutch article into the item that has the same news.

        Until 2026-10-08 an article only reached the LLM above a score that most articles on the
        same news never got, a verdict below the threshold was overruled, a failed classification
        kept articles apart, and while the LLM could not judge (the Claude Code session limit)
        every article started an item of its own. Each item of one Dutch article published in the
        last ``hours`` is decided again, without itself; when the LLM puts the article with another
        item, the article moves there and the empty item is archived. Newest first, so an article
        joins the item that was there before it. ``older_than_hours`` leaves out the newest items
        (decided by an earlier run). ``dry_run`` only reports the moves.
        """

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=hours)
        single = (
            select(EventArticle.event_id)
            .group_by(EventArticle.event_id)
            .having(func.count(EventArticle.article_id) == 1)
            .subquery()
        )
        published = func.coalesce(Article.published_at, Article.fetched_at)
        stmt = (
            select(Event.id, Article.id)
            .join(single, single.c.event_id == Event.id)
            .join(EventArticle, EventArticle.event_id == Event.id)
            .join(Article, Article.id == EventArticle.article_id)
            .where(Event.archived_at.is_(None))
            .where(Article.is_international.is_(False))
            .where(published >= cutoff)
            .where(published <= now - timedelta(hours=older_than_hours))
            .order_by(published.desc())
            .limit(limit)
        )
        async with self.session_factory() as session:
            rows = (await session.execute(stmt)).all()

        stats: Dict[str, object] = {
            "checked": 0,
            "merged": 0,
            "kept": 0,
            "skipped": 0,
            "dry_run": dry_run,
        }
        moves: List[Dict[str, object]] = []
        # Items a move already involves are not decided again (in a dry run nothing moved yet)
        involved: set[int] = set()
        for event_id, article_id in rows:
            if event_id in involved:
                stats["skipped"] = int(stats["skipped"]) + 1
                continue
            async with self._assignment_lock:
                outcome, move = await self._merge_split_event(
                    event_id, article_id, dry_run=dry_run, correlation_id=correlation_id
                )
            if outcome == "llm_unavailable":
                stats["stopped"] = "llm_unavailable"
                break
            stats["checked"] = int(stats["checked"]) + 1
            stats[outcome] = int(stats[outcome]) + 1
            if move is not None:
                moves.append(move)
                involved.update({event_id, int(move["to_event"])})
        stats["moves"] = moves
        self.log.info(
            "split_events_merge_done",
            correlation_id=correlation_id,
            **{key: value for key, value in stats.items() if key != "moves"},
        )
        return stats

    async def _merge_split_event(
        self,
        event_id: int,
        article_id: int,
        *,
        dry_run: bool,
        correlation_id: str | None,
    ) -> tuple[str, Dict[str, object] | None]:
        correlation_log = self.log.bind(
            correlation_id=correlation_id, article_id=article_id, event_id=event_id
        )
        if await self._has_reader_content(event_id):
            return "skipped", None

        async with self.session_factory() as session:
            event = await session.get(Event, event_id)
            article = await session.get(Article, article_id)
            if event is None or article is None or event.archived_at is not None:
                return "skipped", None
            links = (
                await session.execute(select(EventArticle).where(EventArticle.event_id == event_id))
            ).scalars().all()
            if len(links) != 1 or links[0].article_id != article_id:
                return "skipped", None
            features, entity_payload = _article_to_features(article)
            if not features.embedding:
                return "skipped", None

            await self.vector_index.ensure_ready(session)
            now = datetime.now(timezone.utc)
            decision = await self._decide(
                session=session,
                article=article,
                features=features,
                now=now,
                correlation_log=correlation_log,
                correlation_id=correlation_id,
                exclude_event_ids=frozenset({event_id}),
                llm_only=True,
            )
            if decision.defer:
                return "llm_unavailable", None
            if decision.event is None or decision.breakdown is None:
                return "kept", None

            target = decision.event
            move: Dict[str, object] = {
                "article_id": article_id,
                "source": article.source_name,
                "title": article.title,
                "from_event": event_id,
                "to_event": target.id,
                "to_title": target.title,
            }
            if dry_run:
                return "merged", move

            await session.delete(links[0])
            await session.flush()
            await self._append_to_existing_event(
                session=session,
                repo=EventRepository(session),
                event=target,
                article=article,
                features=features,
                entity_payload=entity_payload,
                breakdown=decision.breakdown,
                location_boost=decision.location_boost,
                date_boost=decision.date_boost,
                timestamp=now,
                correlation_id=correlation_id,
                # The insight backfill redoes the analysis when a Dutch outlet joined: one at a
                # time, instead of all merged items at once
                schedule_insights=False,
            )
            event.archived_at = now
            event.article_count = 0
            await session.commit()
            await self.vector_index.remove(event_id)
            correlation_log.info("split_event_merged", to_event=target.id)
            return "merged", move

    async def _has_reader_content(self, event_id: int) -> bool:
        """Whether readers searched or shared something on this event (then it is never merged)."""

        statement = text(
            "SELECT 1 FROM voice_searches WHERE event_id = :event_id "
            "UNION ALL SELECT 1 FROM shared_entries WHERE event_id = :event_id LIMIT 1"
        )
        # The website writes these tables where it reads (Supabase, Story INFRA-2)
        sessions = get_frontend_sessionmaker() if get_settings().supabase_database_url else self.session_factory
        try:
            async with sessions() as session:
                result = await session.execute(statement, {"event_id": event_id})
                return result.first() is not None
        except SQLAlchemyError:  # Tables of migrations 009/012 missing (tests): no reader content
            return False

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
        schedule_insights: bool = True,
    ) -> EventAssignmentResult:
        # Unarchive event if it was archived (for @eenblikopdenos linking to older NOS events)
        if event.archived_at is not None:
            self.log.info(
                "unarchiving_event_for_new_article",
                event_id=event.id,
                article_source=article.source_name,
                was_archived_at=event.archived_at.isoformat(),
            )
            event.archived_at = None

        boosted_score = breakdown.final + location_boost + date_boost
        scoring_dict = breakdown.as_dict()
        scoring_dict["location_boost"] = location_boost
        scoring_dict["date_boost"] = date_boost
        scoring_dict["boosted_final"] = boosted_score

        event_article_link = await repo.append_article_to_event(
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
        if schedule_insights:
            await self._maybe_schedule_insight_generation(
                event.id, event.last_updated_at, correlation_id
            )
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
        event_article_link = await repo.append_article_to_event(
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
            # Use semaphore to limit concurrent insight generations
            # This prevents database connection pool exhaustion
            async with self._insight_semaphore:
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
        event_articles_map: dict[int, List[Article]] | None = None,
    ) -> "LLMEventDecision":
        """Ask the LLM which candidate the article belongs to, or whether it is a new event.

        A failed call or an unclear answer is no decision (``decided`` is False): the caller then
        falls back to the scores instead of creating a new event.
        """
        if not self.llm_client or not candidates:
            return LLMEventDecision()

        event_articles_map = event_articles_map or {}

        # Build prompt with article and candidate events
        article_text = f"{article.title}\n\n{article.content[:1200] if article.content else ''}"
        article_locations = ", ".join(article.extracted_locations or ['unknown'])
        article_date = article.published_at.strftime('%Y-%m-%d') if article.published_at else 'unknown'

        candidates_text = []
        for idx, (event, score) in enumerate(candidates, 1):
            event_desc = f"EVENT {idx} (score={score:.2f}):\n"
            event_desc += f"  Title: {event.title}\n"
            if event.description:
                event_desc += f"  Summary: {event.description[:200]}\n"
            event_desc += f"  Type: {event.event_type or 'unknown'}\n"

            # Include sample article titles AND content snippets for better context
            event_articles = event_articles_map.get(event.id, [])
            if event_articles:
                sample_articles = []
                for a in event_articles[:3]:
                    if a.title:
                        # Include first 150 chars of content to help distinguish similar topics
                        snippet = ""
                        if a.content:
                            snippet = a.content[:150].replace('\n', ' ').strip()
                            if len(a.content) > 150:
                                snippet += "..."
                        sample_articles.append(f"'{a.title}'" + (f" ({snippet})" if snippet else ""))
                if sample_articles:
                    event_desc += f"  Sample articles:\n"
                    for sample in sample_articles:
                        event_desc += f"    - {sample}\n"

            event_desc += f"  Last updated: {event.last_updated_at.strftime('%Y-%m-%d') if event.last_updated_at else 'unknown'}\n"
            candidates_text.append(event_desc)

        # Use specialized prompt for Een Blik op de NOS (media commentary: its videos, before 2026-10
        # its tweets)
        if article.source_name == "Een Blik op de NOS":
            prompt = f"""Je beoordeelt of een bericht van Een Blik op de NOS (kritiek op de NOS) hoort bij een NOS nieuwsbericht.

BERICHT VAN EEN BLIK OP DE NOS:
{article_text}

KANDIDAAT NOS ARTIKELEN:
{chr(10).join(candidates_text)}

BESLISREGELS:

CLUSTER (kies EVENT_X) ALLEEN als:
• Het bericht SPECIFIEK commentaar geeft op het NOS artikel
• Het bericht het NOS artikel bekritiseert, aanvult of becommentarieert
• De HOOFDPERSOON of het HOOFDONDERWERP van het bericht overeenkomt met het NOS artikel

NIEUW EVENT (NEW_EVENT) als:
• Het bericht over een ANDER onderwerp gaat dan het NOS artikel
• Het bericht alleen toevallig dezelfde persoon noemt in een andere context
• Het bericht algemene mediakritiek is zonder specifieke link naar dit NOS artikel
• De hoofdpersoon in het bericht (bijv. "Pim van Galen") verschilt van de hoofdpersoon in het NOS artikel (bijv. "Lale Gül")

VOORBEELD:
• Bericht over "NOS berichtgeving over Wilders" + NOS artikel "Wilders hervat campagne" → EVENT_X (zelfde onderwerp)
• Bericht over "Pim van Galen gedrag" + NOS artikel "Lale Gül beveiliging" → NEW_EVENT (andere hoofdpersoon!)
• Bericht met algemene NOS kritiek + willekeurig NOS artikel → NEW_EVENT (geen specifieke link)

Antwoord met ALLEEN: "EVENT_1" of "EVENT_2" of "EVENT_3" of "NEW_EVENT"

Antwoord:"""
        else:
            prompt = f"""You cluster Dutch news articles into events. Decide: does this article belong to an existing event, or is it NEW_EVENT?

NEW ARTICLE:
Type: {article.event_type or 'unknown'}
Location: {article_locations}
Date: {article_date}
Text: {article_text}

CANDIDATE EVENTS:
{chr(10).join(candidates_text)}

DECISION RULES:

SAME EVENT = exact same real-world incident:
• Same specific people, victims, or organizations
• Same location AND same incident type
• Direct continuation of the same story

DIFFERENT EVENT (= NEW_EVENT):
• Different people/victims (even if same crime type)
• Different cities (even if same topic)
• Different sport (voetbal ≠ schaatsen ≠ wielrennen ≠ F1 ≠ tennis)
• Different competition (WK voetbal ≠ World Cup schaatsen)
• Same topic but separate incidents

EXAMPLES:
• "WK voetbal loting" vs "World Cup schaatsen Heerenveen" → NEW_EVENT (different sports!)
• "Ajax wint van PSV" vs "Feyenoord verliest" → NEW_EVENT (different matches)
• "Steekpartij Amsterdam" vs "Steekpartij Rotterdam" → NEW_EVENT (different cities)
• "Kabinet valt" vs "Formatie update" → SAME EVENT (same political crisis)

WARNING: "World Cup" / "WK" appears in MANY different sports. Always check WHICH sport by reading the article content snippets!

IMPORTANT: Read the sample article content snippets carefully - they reveal the actual topic (e.g., "schaatsen", "voetbal", "wielrennen").

Respond with ONLY: "EVENT_1" or "EVENT_2" or "EVENT_3" or "NEW_EVENT"

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
                decision=decision[:80],
                candidates_count=len(candidates),
                correlation_id=correlation_id,
            )

            # Parse LLM decision: the first verdict in the answer. The model may explain itself
            # after it, and that explanation names the other candidates ("EVENT 1 is about ...")
            verdict = re.search(r"NEW[_ ]EVENT|EVENT[_ ](\d+)", decision)
            if verdict is not None and verdict.group(1) is None:
                return LLMEventDecision(new_event=True)
            if verdict is not None and 1 <= int(verdict.group(1)) <= len(candidates):
                return LLMEventDecision(event_id=candidates[int(verdict.group(1)) - 1][0].id)

            # Default to None if unclear
            self.log.warning(
                "llm_decision_unclear",
                article_id=article.id,
                decision=decision,
                correlation_id=correlation_id,
            )
            return LLMEventDecision()

        except Exception as exc:
            self.log.warning(
                "llm_decision_failed",
                article_id=article.id,
                error=str(exc),
                correlation_id=correlation_id,
            )
            return LLMEventDecision()

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
