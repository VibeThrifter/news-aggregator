"""Waar speelt het nieuws? (Epic 14, Story 14.38): the places of a news item, without AI.

A place counts when the headline or the start of the Dutch articles names it: spaCy's GPE/LOC
mentions in the first ``LEAD_CHARS`` characters of the text, plus place names in the headline
(not every source starts its text with the headline). Names are looked up in the place list
(``nlp/gazetteer.py``, GeoNames); a name the list does not have is no place: rather no dot than a
wrong one. A name right next to another capitalised word is a person or a club (Jutta Leerdam,
PSV Eindhoven) unless the two together are a place.

A place stays when (``_keep``):
- at least ``MIN_ARTICLE_SHARE`` of the Dutch articles name it (one for one or two articles);
- a headline names it, or a text names it in its first ``EARLY_CHARS`` characters and somewhere
  after a preposition of place ("in", "te", "bij", "op": ``PLACE_PREPOSITIONS``);
- a country, a capital or Den Haag needs that preposition in any case: they also stand for their
  government ("Rusland valt aan", "politiek Den Haag", "afhankelijk van de VS");
- not only after "uit" (where someone comes from is not where the news is);
- the news item is no sports news (``SKIP_EVENT_TYPES``: clubs and national teams carry places);
- with more than ``MAX_PLACES_PER_EVENT`` candidates only those from a headline stay.
Measured blind (2026-11-16, two judges, Story 14.38): see the story for the numbers.

Choosing between places with the same name (``_choose``): a country first; then a foreign place in
a country the news item names; then a Dutch town of ``SMALL_PLACE_POPULATION`` or more, a
municipality or a province; then a foreign city, a foreign region, and last a small Dutch village,
and that only right after a preposition ("in Pieterburen"). "Nederland" is no place on the map.

``EventPlacesService`` stores the result in ``event_places`` (published to Supabase). It runs in
the exploration refresh, after the entities: after every analysis and in the daily refresh.
"""

from __future__ import annotations

import math
import re
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Article, Event, EventArticle, EventPlace
from backend.app.nlp.entity_keys import slugify
from backend.app.nlp.gazetteer import (
    CITY,
    COUNTRY,
    MUNICIPALITY,
    PLACE,
    REGION,
    Gazetteer,
    Place,
    get_gazetteer,
)
from backend.app.services.event_entity_service import latest_titles, title_query

logger = get_logger(__name__).bind(component="EventPlacesService")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# Only mentions that start in the first characters of the text count: the lead says where it happens
LEAD_CHARS = 400
# Characters after the lead that are read to complete a name ("Tel" + "Aviv")
LOOKAHEAD_CHARS = 60
# A place stays when this share of the Dutch articles names it early (one for one or two articles)
MIN_ARTICLE_SHARE = 0.5
# At most this many places per news item; with more candidates only those from a headline stay
MAX_PLACES_PER_EVENT = 3
# Dutch towns below this population count only after a preposition ("in Pieterburen")
SMALL_PLACE_POPULATION = 1000
# A province wins from a Dutch town below this population with its name (Zeeland, not the village)
REGION_OVER_PLACE_POPULATION = 10_000
# A foreign region wins from a city of fewer people with its name (Virginia, not Virginia in
# South Africa); bigger cities win (New York)
CITY_OVER_REGION_POPULATION = 500_000
# Without a headline, a text must name the place this early (and once after PLACE_PREPOSITIONS)
EARLY_CHARS = 120
# Places that also stand for a government (besides countries and capitals): Den Haag
SEATS_OF_GOVERNMENT = frozenset({"place:2747373", "place:2747372"})
# News whose places are mostly clubs, teams and where players come from
SKIP_EVENT_TYPES = frozenset({"sports"})
# Events written per batch
BATCH_SIZE = 50

PREPOSITIONS = frozenset(
    {"in", "bij", "uit", "te", "op", "naar", "rond", "rondom", "nabij", "vanuit", "richting"}
)
# Prepositions that say the news happens there ("uit", "naar" say where someone comes from or goes)
PLACE_PREPOSITIONS = frozenset({"in", "te", "bij", "op", "nabij", "rond", "rondom"})
# Capitalised words before a name that do not make it a person's name (sentence starts)
_NOT_A_NAME = frozenset(
    {
        "de", "het", "een", "en", "of", "maar", "ook", "dat", "die", "van", "tot", "voor", "na",
        "naast", "tussen", "met", "door", "over", "zonder", "volgens", "vanaf", "sinds",
        "tijdens", "onder", "boven", "achter", "langs", "aan", "om",
    }
)  # fmt: skip
# Lowercase words allowed inside a multi-word place name ("Alphen aan den Rijn", "Bergen op Zoom")
NAME_CONNECTORS = frozenset(
    {"aan", "den", "de", "op", "van", "der", "am", "upon", "sur", "en", "la"}
)
_WORD = re.compile(r"[\w'’][\w'’.-]*", re.UNICODE)
_NEXT_WORD = re.compile(r"\s+([\w'’][\w'’-]*)")
_PREV_WORD = re.compile(r"([\w'’][\w'’-]*)\s+$")
# The word right before or after a name on the same line, one space apart ("Jutta Leerdam")
_ADJACENT_BEFORE = re.compile(r"(?:^|[\s(\"“'‘])([\w'’-]+) $")
_ADJACENT_AFTER = re.compile(r"^ ([\w'’-]+)")
# A surname with a particle: "Michael van Gerwen", "Sem van der Horst", "Bert van Leeuwen"
_PARTICLE_NAME = re.compile(
    r"(?:^|\s)[A-ZÀ-Ý][\w'’-]+ (?:van|van der|van den|van de|de|der|den|ter|ten|op den) $"
)
_VAN_NAME = re.compile(r"\s+van\s+[A-ZÀ-Ý]")
_SURFACE_STRIP = '"“”„«»()[]{},;:.!?'

_TITLE_MAX = 512
_SLUG_MAX = 255
_NAME_MAX = 255


# --------------------------------------------------------------------------------------
# The rule (pure)
# --------------------------------------------------------------------------------------


@dataclass(slots=True)
class ArticlePlaceInput:
    """What the rule reads of one Dutch article."""

    title: str | None
    lead: str | None  # the start of the text (the entities' offsets are positions in the text)
    entities: Sequence[Mapping[str, Any]] | None
    source_name: str | None = None
    article_id: int | None = None


@dataclass(slots=True)
class Mention:
    slug: str
    preposition: str  # the lowercase preposition right before the name, "" when there is none
    in_title: bool
    words: int = 1
    start: int | None = None  # position in the text (None for a headline)


@dataclass(slots=True)
class FoundPlace:
    """A place of a news item."""

    place: Place
    article_count: int
    in_title: bool


def _is_capitalised(word: str) -> bool:
    word = word.lstrip("'’")
    if word[:2].lower() == "s-":  # 's-Hertogenbosch, 's-Gravenhage
        word = word[2:]
    return bool(word) and word[0].isupper()


def _clean(surface: Any) -> str:
    if not isinstance(surface, str):
        return ""
    return " ".join(surface.split()).strip(_SURFACE_STRIP).strip()


def _mentions_in_lead(
    article: ArticlePlaceInput, gazetteer: Gazetteer, lead_chars: int = LEAD_CHARS
) -> list[Mention]:
    text = article.lead or ""
    found: list[Mention] = []
    for entity in article.entities or []:
        if not isinstance(entity, Mapping) or entity.get("label") not in ("GPE", "LOC"):
            continue
        try:
            start, end = int(entity.get("start", 0)), int(entity.get("end", 0))
        except (TypeError, ValueError):
            continue
        if start >= lead_chars:
            continue
        surface = _clean(entity.get("text"))
        if not surface or not _is_capitalised(surface):
            continue
        after = text[end : end + LOOKAHEAD_CHARS] if text else ""
        before = text[max(0, start - LOOKAHEAD_CHARS) : start] if text else ""
        completed = _complete_name(surface, before, after, gazetteer)
        if completed is None:
            continue
        slug, used_before, used_after = completed
        if used_before:  # "Tel" + "Aviv": the preposition is before "Tel"
            previous = _PREV_WORD.search(before)
            before = before[: previous.start()] if previous else before
        if not used_before and not used_after and _beside_a_name(before, after):
            continue
        found.append(
            Mention(slug=slug, preposition=_preposition(before), in_title=False, start=start)
        )
    return found


def _preposition(before: str) -> str:
    previous = _PREV_WORD.search(before)
    word = previous.group(1).lower() if previous else ""
    return word if word in PREPOSITIONS else ""


def _beside_a_name(before: str, after: str) -> bool:
    """A capitalised word next to the name: "Jutta Leerdam", "PSV Eindhoven", "Sydney Sweeney",
    or a first name and a particle before it ("Michael van Gerwen")."""

    if _PARTICLE_NAME.search(before):
        return True
    previous = _ADJACENT_BEFORE.search(before)
    if previous:
        word = previous.group(1)
        if _is_capitalised(word) and word.lower() not in PREPOSITIONS | _NOT_A_NAME:
            return True
    following = _ADJACENT_AFTER.match(after)
    return bool(following and _is_capitalised(following.group(1)))


def _complete_name(
    surface: str, before: str, after: str, gazetteer: Gazetteer
) -> tuple[str, bool, bool] | None:
    """The longest place name around a mention ("Aviv" -> "Tel Aviv") as (slug, used the word
    before, used words after); None when it is no place."""

    following: list[str] = []
    rest = after
    for _ in range(2):
        match = _NEXT_WORD.match(rest)
        if not match or not _is_capitalised(match.group(1)):
            break
        following.append(match.group(1))
        rest = rest[match.end() :]
    for count in range(len(following), 0, -1):
        slug = slugify(" ".join([surface, *following[:count]]))
        if slug in gazetteer:
            return slug, False, True
    base = slugify(surface)
    previous = _PREV_WORD.search(before)
    if previous and _is_capitalised(previous.group(1)):
        slug = slugify(f"{previous.group(1)} {surface}")
        if slug != base and slug in gazetteer:  # "De Hoorn" is still "hoorn"
            return slug, True, False
    # "Hoorn van Afrika", "Hof van Twente": part of a longer name
    if _VAN_NAME.match(after):
        return None
    return (base, False, False) if base in gazetteer else None


def _mentions_in_title(title: str | None, gazetteer: Gazetteer) -> list[Mention]:
    if not title:
        return []
    words = [match.group(0).rstrip(".") for match in _WORD.finditer(title)]
    found: list[Mention] = []
    index = 0
    longest = min(gazetteer.max_words, 5)
    while index < len(words):
        matched = 0
        for size in range(min(longest, len(words) - index), 0, -1):
            window = words[index : index + size]
            if not (_is_capitalised(window[0]) and _is_capitalised(window[-1])):
                continue
            if any(not _is_capitalised(w) and w.lower() not in NAME_CONNECTORS for w in window):
                continue
            slug = slugify(" ".join(window))
            places = gazetteer.lookup(slug)
            if not places:
                continue
            # The first word of a headline is always a capital: one word there only counts for a
            # country or a place that is no small Dutch village
            if (
                index == 0
                and size == 1
                and not any(
                    p.kind == COUNTRY
                    or not p.is_dutch
                    or p.population >= SMALL_PLACE_POPULATION * 10
                    for p in places
                )
            ):
                continue
            previous = words[index - 1] if index > 0 else ""
            following = words[index + size] if index + size < len(words) else ""
            if (following and _is_capitalised(following)) or (
                size == 1
                and (
                    (
                        previous
                        and _is_capitalised(previous)
                        and previous.lower() not in PREPOSITIONS | _NOT_A_NAME
                    )
                    or _PARTICLE_NAME.search(" ".join(words[max(0, index - 3) : index]) + " ")
                )
            ):
                matched = size  # "Jutta Leerdam", "Heracles Almelo": a name, not the place
                break
            preposition = previous.lower() if previous.lower() in PREPOSITIONS else ""
            found.append(Mention(slug=slug, preposition=preposition, in_title=True, words=size))
            matched = size
            break
        index += matched or 1
    return found


def _rank(place: Place, preposition: bool, context: set[str]) -> int | None:
    if place.kind == COUNTRY:
        return 0
    if not place.is_dutch and place.iso_code in context:
        return 1
    if place.is_dutch and (
        place.kind in (REGION, MUNICIPALITY) or place.population >= SMALL_PLACE_POPULATION
    ):
        return 2
    if place.kind == CITY:
        return 3
    if place.kind == REGION:
        return 4
    if place.is_dutch:
        return 5 if preposition else None
    return 6


def _choose(
    places: Sequence[Place], slug: str, preposition: bool, context: set[str], gazetteer: Gazetteer
) -> Place | None:
    """The place a name means here (see the module text), None when none fits."""

    if slug in gazetteer.needs_preposition and not preposition:
        places = [place for place in places if not place.is_dutch]
    best = _best(places, preposition, context)
    # "Virginia": a state wins from a smaller city elsewhere with its name
    if best is not None and best.kind == CITY and not best.capital and best.iso_code not in context:
        region = next(
            (
                p
                for p in places
                if p.kind == REGION
                and not p.is_dutch
                and best.population < CITY_OVER_REGION_POPULATION
            ),
            None,
        )
        if region is not None:
            return region
    if (
        best is not None
        and best.is_dutch
        and best.kind == PLACE
        and best.population < REGION_OVER_PLACE_POPULATION
    ):
        region = next((p for p in places if p.is_dutch and p.kind == REGION), None)
        if region is not None:
            return region
    return best


def _best(places: Sequence[Place], preposition: bool, context: set[str]) -> Place | None:
    best: tuple[tuple[Any, ...], Place] | None = None
    for place in places:
        rank = _rank(place, preposition, context)
        if rank is None:
            continue
        order = (
            rank,
            0 if place.kind in (PLACE, CITY, COUNTRY) else 1,  # the town before its municipality
            0 if place.capital else 1,
            -place.population,
            place.key,
        )
        if best is None or order < best[0]:
            best = (order, place)
    return best[1] if best else None


@dataclass(slots=True)
class _Evidence:
    """What the Dutch articles of a news item say about one place."""

    place: Place
    articles: int = 0
    in_title: bool = False
    place_preposition: bool = False  # once after "in", "te", "bij", "op" ...
    early: bool = False  # once in the first EARLY_CHARS characters of a text
    mentions: int = 0
    origin_mentions: int = 0  # after "uit"

    def convincing(self) -> bool:
        if self.mentions and self.origin_mentions >= self.mentions:
            return False  # only where someone comes from
        if self.stands_for_government and not self.place_preposition:
            return False
        return self.in_title or (self.place_preposition and self.early)

    @property
    def stands_for_government(self) -> bool:
        place = self.place
        return place.kind == COUNTRY or place.capital or place.key in SEATS_OF_GOVERNMENT


def places_for_event(
    articles: Sequence[ArticlePlaceInput],
    *,
    event_type: str | None = None,
    gazetteer: Gazetteer | None = None,
    lead_chars: int = LEAD_CHARS,
    min_share: float = MIN_ARTICLE_SHARE,
    max_places: int = MAX_PLACES_PER_EVENT,
) -> list[FoundPlace]:
    """The places of one news item from its Dutch articles (pure; see the module text)."""

    if event_type in SKIP_EVENT_TYPES:
        return []
    gazetteer = gazetteer or get_gazetteer()
    in_leads = [_mentions_in_lead(article, gazetteer, lead_chars) for article in articles]
    # One capitalised word in a headline is mostly a person ("Van Dijk", "Janet Jackson"): it
    # counts after a preposition ("Brand in Hoorn") or when spaCy sees it as a place in a text
    lead_slugs = {mention.slug for mentions in in_leads for mention in mentions}
    per_article: list[list[Mention]] = [
        [
            mention
            for mention in _mentions_in_title(article.title, gazetteer)
            if mention.words > 1 or mention.preposition or mention.slug in lead_slugs
        ]
        + lead
        for article, lead in zip(articles, in_leads, strict=True)
    ]
    counted = [
        mentions
        for mentions, article in zip(per_article, articles, strict=True)
        if article.title or article.lead
    ]
    if not counted:
        return []

    # Countries the news item names: a foreign city there wins from a namesake elsewhere
    context = {
        place.iso_code
        for mentions in per_article
        for mention in mentions
        for place in gazetteer.lookup(mention.slug)
        if place.kind == COUNTRY
    }

    evidence: dict[str, _Evidence] = {}
    for mentions in counted:
        keys: set[str] = set()
        for mention in mentions:
            place = _choose(
                gazetteer.lookup(mention.slug),
                mention.slug,
                bool(mention.preposition),
                context,
                gazetteer,
            )
            if place is None or place.lat is None:
                continue
            item = evidence.setdefault(place.key, _Evidence(place=place))
            keys.add(place.key)
            item.mentions += 1
            item.in_title = item.in_title or mention.in_title
            item.place_preposition = (
                item.place_preposition or mention.preposition in PLACE_PREPOSITIONS
            )
            item.early = item.early or (mention.start is not None and mention.start < EARLY_CHARS)
            item.origin_mentions += mention.preposition == "uit"
        for key in keys:
            evidence[key].articles += 1

    need = 1 if len(counted) <= 2 else math.ceil(len(counted) * min_share)
    kept = [item for key, item in evidence.items() if item.articles >= need and key != "country:nl"]
    # A country goes when a place in it stays (the place says more)
    place_countries = {item.place.iso_code for item in kept if item.place.kind != COUNTRY}
    kept = [
        item
        for item in kept
        if not (item.place.kind == COUNTRY and item.place.iso_code in place_countries)
    ]
    # A story with many places (a travel piece, a round-up) is about none of them, unless a
    # headline says which
    if len(kept) > max_places:
        kept = [item for item in kept if item.in_title]
    kept = [item for item in kept if item.convincing()]
    kept.sort(key=lambda item: (-item.articles, not item.in_title, item.place.name))
    return [
        FoundPlace(place=item.place, article_count=item.articles, in_title=item.in_title)
        for item in kept[:max_places]
    ]


# --------------------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------------------


@dataclass(slots=True)
class EventPlacesInput:
    event_id: int
    slug: str | None
    event_type: str | None
    first_seen_at: datetime | None
    title: str | None = None
    articles: list[ArticlePlaceInput] = field(default_factory=list)


@dataclass(slots=True)
class PlacesRefreshResult:
    requested: int = 0
    events_with_places: int = 0
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_deleted: int = 0
    skipped_no_title: int = 0

    def merge(self, other: PlacesRefreshResult) -> None:
        self.requested += other.requested
        self.events_with_places += other.events_with_places
        self.rows_inserted += other.rows_inserted
        self.rows_updated += other.rows_updated
        self.rows_deleted += other.rows_deleted
        self.skipped_no_title += other.skipped_no_title

    def as_dict(self) -> dict[str, int]:
        return {
            "requested": self.requested,
            "events_with_places": self.events_with_places,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_deleted": self.rows_deleted,
            "skipped_no_title": self.skipped_no_title,
        }


def _default_session_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.session import get_sessionmaker

    return get_sessionmaker()()


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# Columns compared to decide whether a stored row changed
_COMPARED = (
    "kind",
    "name",
    "iso_code",
    "region",
    "lat",
    "lon",
    "article_count",
    "in_title",
    "outlets",
    "event_slug",
    "event_title",
    "event_type",
    "event_first_seen_at",
)


class EventPlacesService:
    """Compute and store ``event_places`` rows."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        session_factory: SessionFactory | None = None,
        gazetteer: Gazetteer | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._session = session_factory or _default_session_factory
        self._gazetteer = gazetteer
        self.last_run: dict[str, Any] | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.settings.event_places_enabled)

    @property
    def gazetteer(self) -> Gazetteer:
        if self._gazetteer is None:
            self._gazetteer = get_gazetteer()
        return self._gazetteer

    async def load_inputs(self, event_ids: Sequence[int]) -> dict[int, EventPlacesInput]:
        ids = sorted(set(int(i) for i in event_ids))
        if not ids:
            return {}
        inputs: dict[int, EventPlacesInput] = {}
        async with self._session() as session:
            rows = await session.execute(
                select(Event.id, Event.slug, Event.event_type, Event.first_seen_at).where(
                    Event.id.in_(ids)
                )
            )
            for row in rows.all():
                inputs[int(row.id)] = EventPlacesInput(
                    event_id=int(row.id),
                    slug=row.slug,
                    event_type=row.event_type,
                    first_seen_at=_as_utc(row.first_seen_at),
                )
            if not inputs:
                return {}
            titles = latest_titles((await session.execute(title_query(list(inputs)))).all())
            for event_id, title in titles.items():
                if event_id in inputs:
                    inputs[event_id].title = title
            articles = await session.execute(
                select(
                    EventArticle.event_id,
                    Article.id,
                    Article.source_name,
                    Article.title,
                    func.substr(Article.content, 1, LEAD_CHARS + LOOKAHEAD_CHARS),
                    Article.entities,
                )
                .join(Article, Article.id == EventArticle.article_id)
                .where(
                    EventArticle.event_id.in_(list(inputs)),
                    or_(Article.is_international.is_(False), Article.is_international.is_(None)),
                )
                .order_by(EventArticle.event_id, Article.id)
            )
            for event_id, article_id, source, title, lead, entities in articles.all():
                inputs[int(event_id)].articles.append(
                    ArticlePlaceInput(
                        title=title,
                        lead=lead,
                        entities=entities if isinstance(entities, list) else None,
                        source_name=source,
                        article_id=int(article_id),
                    )
                )
        return inputs

    def build_rows(self, source: EventPlacesInput) -> list[dict[str, Any]]:
        """``event_places`` rows of one news item (none without an analysis title)."""

        if not source.title:
            return []
        outlets = sorted({a.source_name for a in source.articles if a.source_name})
        return [
            {
                "event_id": source.event_id,
                "place_key": found.place.key,
                "kind": found.place.kind,
                "name": found.place.name[:_NAME_MAX],
                "iso_code": found.place.iso_code,
                "region": found.place.region,
                "lat": found.place.lat,
                "lon": found.place.lon,
                "article_count": found.article_count,
                "in_title": found.in_title,
                "outlets": outlets,
                "event_slug": source.slug[:_SLUG_MAX] if source.slug else None,
                "event_title": source.title[:_TITLE_MAX],
                "event_type": source.event_type,
                "event_first_seen_at": source.first_seen_at,
            }
            for found in places_for_event(
                source.articles, event_type=source.event_type, gazetteer=self.gazetteer
            )
        ]

    async def refresh_events(
        self, event_ids: Iterable[int], *, dry_run: bool = False
    ) -> PlacesRefreshResult:
        """Recompute the places of ``event_ids``: changed rows are updated, gone rows deleted."""

        ids = list(dict.fromkeys(int(event_id) for event_id in event_ids))
        result = PlacesRefreshResult()
        for start in range(0, len(ids), BATCH_SIZE):
            result.merge(await self._refresh_batch(ids[start : start + BATCH_SIZE], dry_run))
        return result

    async def _refresh_batch(self, ids: list[int], dry_run: bool) -> PlacesRefreshResult:
        result = PlacesRefreshResult(requested=len(ids))
        inputs = await self.load_inputs(ids)
        wanted: dict[int, dict[str, dict[str, Any]]] = {}
        for event_id in ids:
            source = inputs.get(event_id)
            if source is None:
                continue
            if not source.title:
                result.skipped_no_title += 1
            rows = self.build_rows(source)
            wanted[event_id] = {row["place_key"]: row for row in rows}
            if rows:
                result.events_with_places += 1
        async with self._session() as session:
            stored = (
                (await session.execute(select(EventPlace).where(EventPlace.event_id.in_(ids))))
                .scalars()
                .all()
            )
            existing: dict[tuple[int, str], EventPlace] = {
                (row.event_id, row.place_key): row for row in stored
            }
            for event_id, key in existing:
                if key not in wanted.get(event_id, {}):
                    result.rows_deleted += 1
                    if not dry_run:
                        await session.execute(
                            delete(EventPlace).where(
                                EventPlace.event_id == event_id, EventPlace.place_key == key
                            )
                        )
            for event_id, rows in wanted.items():
                for key, values in rows.items():
                    current = existing.get((event_id, key))
                    if current is None:
                        result.rows_inserted += 1
                        if not dry_run:
                            session.add(EventPlace(**values))
                    elif any(
                        _differs(getattr(current, column), values[column]) for column in _COMPARED
                    ):
                        result.rows_updated += 1
                        if not dry_run:
                            for column in _COMPARED:
                                setattr(current, column, values[column])
            if not dry_run:
                await session.commit()
        return result

    async def refresh_recent(self, days: int = 45, *, dry_run: bool = False) -> dict[str, Any]:
        """Backfill: every news item that started in the last ``days`` days."""

        started, started_at = time.monotonic(), datetime.now(timezone.utc)
        since = started_at - timedelta(days=days)
        async with self._session() as session:
            ids = [
                int(i)
                for i in (
                    await session.execute(
                        select(Event.id).where(Event.first_seen_at >= since).order_by(Event.id)
                    )
                ).scalars()
            ]
        result = await self.refresh_events(ids, dry_run=dry_run)
        outcome = {
            "days": days,
            "dry_run": dry_run,
            "duration_seconds": round(time.monotonic() - started, 2),
            **result.as_dict(),
        }
        self.last_run = {"started_at": started_at.isoformat(), **outcome}
        logger.info("event_places_refreshed", **outcome)
        return outcome


def _differs(stored: Any, new: Any) -> bool:
    if isinstance(stored, datetime) or isinstance(new, datetime):
        return _as_utc(stored) != _as_utc(new)
    if isinstance(stored, float) or isinstance(new, float):
        if stored is None or new is None:
            return stored is not new
        # lat/lon are REAL (float4): a stored value differs from the written one in the 5th digit
        return abs(float(stored) - float(new)) > 1e-3
    return stored != new


_service: EventPlacesService | None = None


def get_event_places_service() -> EventPlacesService:
    global _service
    if _service is None:
        _service = EventPlacesService()
    return _service


__all__ = [
    "LEAD_CHARS",
    "MAX_PLACES_PER_EVENT",
    "MIN_ARTICLE_SHARE",
    "ArticlePlaceInput",
    "EventPlacesService",
    "FoundPlace",
    "get_event_places_service",
    "places_for_event",
]
