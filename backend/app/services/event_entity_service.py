"""Canonical entities per event (Epic 11 "Onderzoeksmodus", Story 11.8).

``aggregate`` is a pure function turning the spaCy mentions of an event's (non-international)
articles into canonical entities with counts. ``EventEntityService`` loads the inputs, applies
``aggregate`` and replaces the ``event_entities`` rows of the event. It never writes to
``events`` (``events.last_updated_at`` has ``onupdate`` and drives feed ordering/archiving).
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import cache
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Article, Event, EventArticle, LLMInsight
from backend.app.llm.title import extract_title_from_summary
from backend.app.nlp.entity_keys import (
    OUTLET_SLUGS,
    CountryIndex,
    entity_key,
    get_country_index,
    kind_for_label,
    slugify,
)
from backend.app.repositories.exploration_repo import ExplorationRepository

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.app.services.country_detector import CountryMapping

logger = get_logger(__name__).bind(component="EventEntityService")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# Only the first characters of a summary are needed to extract the LLM title.
TITLE_PREFIX_CHARS = 240
# Events processed per load/aggregate/write batch.
ENTITY_BATCH_SIZE = 50
# event_entities.article_ids keeps at most this many (the newest) article ids per entity.
MAX_ARTICLE_IDS = 200

_KEY_MAX = 160
_NAME_MAX = 255
_TITLE_MAX = 512
_SLUG_MAX = 255

# Stopwords that may be skipped (or contribute their first letter) when matching acronyms.
_ACRONYM_STOPWORDS: frozenset[str] = frozenset(
    {"de", "het", "van", "voor", "en", "of", "the", "and", "for"}
)
_ACRONYM_SURFACE = re.compile(r"[A-Z]{2,6}")
# Dutch demonym adjectives labelled NORP ("Amerikaanse", "Russische", "Europees").
_DEMONYM_ADJECTIVE = re.compile(r"[a-z]+(se|sche|ees)")
_SURFACE_STRIP = '"“”„«»()[]{},;:'
# Tie-break order when the same slug is labelled with different kinds.
_KIND_PRIORITY: dict[str, int] = {"person": 0, "org": 1, "place": 2, "group": 3}
# Leading titles stripped from PERSON mentions ("President Trump" -> "Trump").
_PERSON_TITLES: frozenset[str] = frozenset(
    {
        "president",
        "premier",
        "minister",
        "minister-president",
        "kanselier",
        "koning",
        "koningin",
        "prins",
        "prinses",
        "paus",
        "burgemeester",
        "staatssecretaris",
        "senator",
        "generaal",
        "sjeik",
        "ayatollah",
        "dr",
        "mr",
        "prof",
        "sir",
        "mevrouw",
        "meneer",
    }
)


@dataclass(slots=True)
class ArticleEntities:
    """The inputs ``aggregate`` needs from one article."""

    source_name: str | None
    entities: Sequence[Mapping[str, Any]] | None
    article_id: int | None = None


@dataclass(slots=True)
class AggregatedEntity:
    """A canonical entity of one event with its counts."""

    entity_key: str
    name: str
    kind: str
    iso_code: str | None
    aliases: list[str]
    mention_count: int
    article_count: int
    outlet_counts: dict[str, int]
    salience: float
    # Ids of the articles mentioning the entity (ascending, at most MAX_ARTICLE_IDS)
    article_ids: list[int] = field(default_factory=list)


@dataclass(slots=True)
class _Form:
    """All mentions sharing one (kind, slug) - or (country, iso) - identity."""

    kind: str
    value: str  # slug, or lowercase ISO code for countries
    iso_code: str | None = None
    country_name: str | None = None
    mentions: int = 0
    articles: set[int] = field(default_factory=set)  # positions in the article list
    article_ids: set[int] = field(default_factory=set)  # database ids (when known)
    outlets: Counter[str] = field(default_factory=Counter)
    surfaces: Counter[str] = field(default_factory=Counter)

    @property
    def key(self) -> tuple[str, str]:
        return (self.kind, self.value)

    @property
    def tokens(self) -> list[str]:
        return self.value.split("-")

    def absorb(self, other: _Form) -> None:
        self.mentions += other.mentions
        self.articles |= other.articles
        self.article_ids |= other.article_ids
        self.outlets.update(other.outlets)
        self.surfaces.update(other.surfaces)


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[tuple[str, str], tuple[str, str]] = {}

    def find(self, key: tuple[str, str]) -> tuple[str, str]:
        root = key
        while self.parent.get(root, root) != root:
            root = self.parent[root]
        while self.parent.get(key, key) != root:  # path compression
            self.parent[key], key = root, self.parent[key]
        return root

    def union(self, child: tuple[str, str], root: tuple[str, str]) -> None:
        child_root, target_root = self.find(child), self.find(root)
        if child_root != target_root:
            self.parent[child_root] = target_root


def _clean_surface(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    return " ".join(text.split()).strip(_SURFACE_STRIP).strip()


def _strip_person_title(surface: str) -> str:
    words = surface.split()
    while len(words) > 1 and slugify(words[0]) in _PERSON_TITLES:
        words = words[1:]
    return " ".join(words)


def _is_valid_slug(slug: str) -> bool:
    if len(slug) < 2 or len(slug) > _KEY_MAX - len("country:"):
        return False
    return not slug.replace("-", "").isdigit()


def _is_acronym_form(form: _Form) -> bool:
    if form.kind != "org" or "-" in form.value or not form.surfaces:
        return False
    surface = form.surfaces.most_common(1)[0][0]
    return bool(_ACRONYM_SURFACE.fullmatch(surface))


def acronym_matches(acronym: str, tokens: Sequence[str]) -> bool:
    """Return True when ``acronym`` (lowercase) abbreviates the slug ``tokens``.

    Every content token supplies its first letter; stopwords may be skipped or supply their
    first letter ("PVV" = Partij Voor de Vrijheid). With two or more content tokens a token may
    also supply one inner letter for compound words ("RIVM" = RIjksinstituut voor ...).
    """

    acronym = acronym.lower()
    tokens = tuple(token for token in tokens if token)
    content = [token for token in tokens if token not in _ACRONYM_STOPWORDS]
    if not acronym or not content:
        return False
    allow_inner = len(content) >= 2

    @cache
    def match(position: int, index: int) -> bool:
        if index == len(tokens):
            return position == len(acronym)
        token = tokens[index]
        if token in _ACRONYM_STOPWORDS:
            if match(position, index + 1):
                return True
            return (
                position < len(acronym)
                and acronym[position] == token[0]
                and match(position + 1, index + 1)
            )
        if position >= len(acronym) or acronym[position] != token[0]:
            return False
        if match(position + 1, index + 1):
            return True
        return (
            allow_inner
            and position + 1 < len(acronym)
            and acronym[position + 1] in token[1:]
            and match(position + 2, index + 1)
        )

    return match(0, 0)


def _collect_forms(
    articles: Sequence[ArticleEntities], country_index: CountryIndex
) -> dict[tuple[str, str], _Form]:
    source_slugs = {slugify(article.source_name) for article in articles if article.source_name}
    forms: dict[tuple[str, str], _Form] = {}
    for index, article in enumerate(articles):
        outlet = (article.source_name or "").strip() or "onbekend"
        for mention in article.entities or []:
            if not isinstance(mention, Mapping):
                continue
            kind = kind_for_label(mention.get("label"))
            if kind is None:
                continue
            surface = _clean_surface(mention.get("text"))
            if kind == "person":
                surface = _strip_person_title(surface)
            slug = slugify(surface)
            if not _is_valid_slug(slug) or slug in OUTLET_SLUGS or slug in source_slugs:
                continue
            if kind == "group" and "-" not in slug and _DEMONYM_ADJECTIVE.fullmatch(slug):
                continue
            value, iso_code, country_name = slug, None, None
            if kind == "place":
                country = country_index.lookup(slug)
                if country is not None:
                    kind, iso_code, country_name = "country", country.iso_code, country.name
                    value = country.iso_code.lower()
            form = forms.get((kind, value))
            if form is None:
                form = _Form(kind=kind, value=value, iso_code=iso_code, country_name=country_name)
                forms[form.key] = form
            form.mentions += 1
            form.articles.add(index)
            if article.article_id is not None:
                form.article_ids.add(int(article.article_id))
            form.outlets[outlet] += 1
            form.surfaces[surface] += 1
    return forms


def _unify_kinds(forms: dict[tuple[str, str], _Form], uf: _UnionFind) -> None:
    """Merge forms with the same slug but a different (non-country) kind into the majority."""

    by_slug: dict[str, list[_Form]] = {}
    for form in forms.values():
        if form.kind != "country":
            by_slug.setdefault(form.value, []).append(form)
    for group in by_slug.values():
        if len(group) < 2:
            continue
        winner = min(group, key=lambda f: (-f.mentions, _KIND_PRIORITY.get(f.kind, 9)))
        for form in group:
            if form is not winner:
                uf.union(form.key, winner.key)


def _genitive_base(form: _Form) -> str | None:
    """Base of a Dutch genitive single-token name ("Trumps" -> "trump")."""

    if len(form.tokens) == 1 and len(form.value) > 3 and form.value.endswith("s"):
        return form.value[:-1]
    return None


def _merge_person_suffixes(forms: dict[tuple[str, str], _Form], uf: _UnionFind) -> None:
    """Merge "Trump" into the unique longer person name ending with it ("Donald Trump").

    Genitive forms ("Trumps") merge into their base form, or are treated like it.
    """

    persons = [f for f in forms.values() if f.kind == "person" and uf.find(f.key) == f.key]
    for form in persons:
        base = _genitive_base(form)
        if base and ("person", base) in forms:
            uf.union(form.key, ("person", base))

    persons = [f for f in persons if uf.find(f.key) == f.key]
    for form in sorted(persons, key=lambda f: -len(f.tokens)):
        base = _genitive_base(form)
        for tokens in (form.tokens, [base] if base else None):
            if not tokens:
                continue
            size = len(tokens)
            roots = {
                uf.find(other.key)
                for other in persons
                if len(other.tokens) > size and other.tokens[-size:] == tokens
            }
            roots.discard(uf.find(form.key))
            if roots:
                if len(roots) == 1:
                    uf.union(form.key, roots.pop())
                break


def _merge_acronyms(forms: dict[tuple[str, str], _Form], uf: _UnionFind) -> None:
    """Merge an ORG acronym ("RIVM") into the unique ORG whose initials match it."""

    orgs = [f for f in forms.values() if f.kind == "org" and uf.find(f.key) == f.key]
    for form in orgs:
        if not _is_acronym_form(form):
            continue
        roots = {
            uf.find(other.key)
            for other in orgs
            if other is not form
            and len(other.tokens) > 1
            and acronym_matches(form.value, other.tokens)
        }
        roots.discard(uf.find(form.key))
        if len(roots) == 1:
            uf.union(form.key, roots.pop())


def _display_name(surfaces: Counter[str]) -> str:
    """Most frequent among the longest (most words) surface forms."""

    return min(
        surfaces.items(),
        key=lambda item: (-len(item[0].split()), -item[1], -len(item[0]), item[0]),
    )[0]


def _build_entity(root: _Form, members: list[_Form]) -> AggregatedEntity:
    merged = _Form(kind=root.kind, value=root.value, iso_code=root.iso_code)
    for member in members:
        merged.absorb(member)
    name = _display_name(merged.surfaces)[:_NAME_MAX]
    aliases = {slugify(surface) for surface in merged.surfaces}
    aliases.update(member.value for member in members if member.kind != "country")
    if root.kind == "country":
        key = entity_key("country", root.value)
        aliases.add(root.value)
        if root.country_name:
            aliases.add(slugify(root.country_name))
        aliases.add(slugify(name))
    else:
        key = entity_key(root.kind, root.value)
        aliases.add(root.value)
        if root.kind == "person" and len(root.tokens) > 1:
            aliases.add(root.tokens[-1])
    return AggregatedEntity(
        entity_key=key[:_KEY_MAX],
        name=name,
        kind=root.kind,
        iso_code=root.iso_code,
        aliases=sorted(alias[:_KEY_MAX] for alias in aliases if alias),
        mention_count=merged.mentions,
        article_count=len(merged.articles),
        outlet_counts=dict(sorted(merged.outlets.items())),
        salience=0.0,
        article_ids=sorted(merged.article_ids)[-MAX_ARTICLE_IDS:],
    )


def aggregate(
    articles: Sequence[ArticleEntities],
    *,
    max_entities: int = 40,
    country_mapping: CountryMapping | CountryIndex | None = None,
) -> list[AggregatedEntity]:
    """Aggregate spaCy mentions of an event's articles into canonical entities.

    - PERSON -> person, ORG -> org, GPE/LOC -> place (-> country when it maps to an ISO code),
      NORP -> group (demonym adjectives dropped); all other labels are dropped.
    - Media outlets (stoplist + the event's own source names) are dropped.
    - "Trump" merges into "Donald Trump"; "RIVM" merges into its unique spelled-out ORG.
    - Noise gate: keep when mentioned twice, in two articles, or when the event has <= 2
      articles. Salience = mentions / total kept mentions. Sorted by salience, capped.
    - ``article_ids``: ids of the articles mentioning the entity (``ArticleEntities.article_id``),
      ascending; above ``MAX_ARTICLE_IDS`` only the newest (highest) ids are kept.
    """

    country_index = get_country_index(country_mapping)
    forms = _collect_forms(articles, country_index)
    if not forms:
        return []

    uf = _UnionFind()
    _unify_kinds(forms, uf)
    _merge_person_suffixes(forms, uf)
    _merge_acronyms(forms, uf)

    groups: dict[tuple[str, str], list[_Form]] = {}
    for form in forms.values():
        groups.setdefault(uf.find(form.key), []).append(form)
    entities = [_build_entity(forms[root], members) for root, members in groups.items()]

    small_event = len(articles) <= 2
    kept = [
        entity
        for entity in entities
        if small_event or entity.mention_count >= 2 or entity.article_count >= 2
    ]
    total_mentions = sum(entity.mention_count for entity in kept)
    for entity in kept:
        entity.salience = round(entity.mention_count / total_mentions, 6) if total_mentions else 0.0
    kept.sort(key=lambda e: (-e.salience, -e.article_count, e.entity_key))
    return kept[: max(0, max_entities)]


# --------------------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------------------


@dataclass(slots=True)
class EventEntityInput:
    """Everything needed to (re)compute the entities of one event."""

    event_id: int
    slug: str | None
    event_type: str | None
    last_updated_at: datetime | None
    title: str | None
    articles: list[ArticleEntities] = field(default_factory=list)


@dataclass(slots=True)
class EntityRefreshResult:
    """Outcome of an entity refresh for one or more events."""

    requested: int = 0
    events_written: list[int] = field(default_factory=list)
    rows_written: int = 0
    skipped_no_title: list[int] = field(default_factory=list)
    missing: list[int] = field(default_factory=list)
    # event_id -> [(entity_key, kind, name)] as written (lets callers update caches in-process)
    entities_by_event: dict[int, list[tuple[str, str, str]]] = field(default_factory=dict)

    def merge(self, other: EntityRefreshResult) -> None:
        self.requested += other.requested
        self.events_written.extend(other.events_written)
        self.rows_written += other.rows_written
        self.skipped_no_title.extend(other.skipped_no_title)
        self.missing.extend(other.missing)
        self.entities_by_event.update(other.entities_by_event)


def _default_read_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.dual_write import get_read_session

    return get_read_session()


def _default_write_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.session import get_sessionmaker

    return get_sessionmaker()()


def latest_titles(rows: Iterable[Any]) -> dict[int, str | None]:
    """Reduce (event_id, summary_prefix, generated_at) rows to the latest LLM title per event."""

    latest: dict[int, tuple[datetime | None, str | None]] = {}
    for event_id, summary, generated_at in rows:
        current = latest.get(int(event_id))
        stamp = _as_utc(generated_at)
        if current is None or (stamp is not None and (current[0] is None or stamp > current[0])):
            latest[int(event_id)] = (stamp, summary)
    return {
        event_id: extract_title_from_summary(summary) for event_id, (_, summary) in latest.items()
    }


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def title_query(event_ids: Sequence[int] | None = None) -> Any:
    """Select (event_id, summary prefix, generated_at) without transferring whole summaries."""

    stmt = select(
        LLMInsight.event_id,
        func.substr(LLMInsight.summary, 1, TITLE_PREFIX_CHARS),
        LLMInsight.generated_at,
    )
    if event_ids is not None:
        stmt = stmt.where(LLMInsight.event_id.in_(list(event_ids)))
    return stmt


class EventEntityService:
    """Compute and persist ``event_entities`` rows."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        read_session_factory: SessionFactory | None = None,
        write_session_factory: SessionFactory | None = None,
        country_mapping: CountryMapping | CountryIndex | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._read = read_session_factory or _default_read_factory
        self._write = write_session_factory or _default_write_factory
        self._country_mapping = country_mapping
        self._country_index: CountryIndex | None = None

    @property
    def country_index(self) -> CountryIndex:
        if self._country_index is None:
            self._country_index = get_country_index(self._country_mapping)
        return self._country_index

    async def load_inputs(
        self,
        event_ids: Sequence[int],
        *,
        summaries: Mapping[int, str | None] | None = None,
    ) -> dict[int, EventEntityInput]:
        """Load event display fields, LLM titles and article entities (read session)."""

        ids = sorted(set(event_ids))
        if not ids:
            return {}
        inputs: dict[int, EventEntityInput] = {}
        async with self._read() as session:
            events = await session.execute(
                select(Event.id, Event.slug, Event.event_type, Event.last_updated_at).where(
                    Event.id.in_(ids)
                )
            )
            for row in events.all():
                inputs[int(row.id)] = EventEntityInput(
                    event_id=int(row.id),
                    slug=row.slug,
                    event_type=row.event_type,
                    last_updated_at=_as_utc(row.last_updated_at),
                    title=None,
                )
            if not inputs:
                return {}
            titles = latest_titles((await session.execute(title_query(list(inputs)))).all())
            for event_id, title in titles.items():
                if event_id in inputs:
                    inputs[event_id].title = title
            articles = await session.execute(
                select(EventArticle.event_id, Article.id, Article.source_name, Article.entities)
                .join(Article, Article.id == EventArticle.article_id)
                .where(
                    EventArticle.event_id.in_(list(inputs)),
                    or_(Article.is_international.is_(False), Article.is_international.is_(None)),
                )
                .order_by(EventArticle.event_id, Article.id)
            )
            for event_id, article_id, source_name, entities in articles.all():
                inputs[int(event_id)].articles.append(
                    ArticleEntities(
                        source_name=source_name, entities=entities, article_id=int(article_id)
                    )
                )
        for event_id, summary in (summaries or {}).items():
            title = extract_title_from_summary(summary)
            if event_id in inputs and title:
                inputs[event_id].title = title
        return inputs

    def build_rows(
        self, source: EventEntityInput, *, computed_at: datetime
    ) -> list[dict[str, Any]]:
        """Aggregate one event and convert the entities into ``event_entities`` rows."""

        if not source.title:
            return []
        entities = aggregate(
            source.articles,
            max_entities=self.settings.exploration_entities_max_per_event,
            country_mapping=self.country_index,
        )
        return [
            {
                "event_id": source.event_id,
                "entity_key": entity.entity_key,
                "name": entity.name,
                "kind": entity.kind,
                "iso_code": entity.iso_code,
                "aliases": entity.aliases,
                "mention_count": entity.mention_count,
                "article_count": entity.article_count,
                "outlet_counts": entity.outlet_counts,
                "article_ids": entity.article_ids,
                "salience": entity.salience,
                "event_slug": source.slug[:_SLUG_MAX] if source.slug else None,
                "event_title": source.title[:_TITLE_MAX],
                "event_type": source.event_type,
                "event_last_updated_at": source.last_updated_at,
                "computed_at": computed_at,
            }
            for entity in entities
        ]

    async def refresh_events(
        self,
        event_ids: Sequence[int],
        *,
        summaries: Mapping[int, str | None] | None = None,
        correlation_id: str | None = None,
    ) -> EntityRefreshResult:
        """Recompute and replace the entities of ``event_ids`` (in batches)."""

        ids = list(dict.fromkeys(int(event_id) for event_id in event_ids))
        result = EntityRefreshResult()
        for start in range(0, len(ids), ENTITY_BATCH_SIZE):
            batch = ids[start : start + ENTITY_BATCH_SIZE]
            result.merge(await self._refresh_batch(batch, summaries, correlation_id))
        return result

    async def _refresh_batch(
        self,
        event_ids: list[int],
        summaries: Mapping[int, str | None] | None,
        correlation_id: str | None,
    ) -> EntityRefreshResult:
        result = EntityRefreshResult(requested=len(event_ids))
        inputs = await self.load_inputs(event_ids, summaries=summaries)
        result.missing = [event_id for event_id in event_ids if event_id not in inputs]
        computed_at = datetime.now(timezone.utc)
        rows_by_event: dict[int, list[dict[str, Any]]] = {}
        for event_id in event_ids:
            source = inputs.get(event_id)
            if source is None:
                continue
            if not source.title:
                result.skipped_no_title.append(event_id)
                continue
            rows_by_event[event_id] = self.build_rows(source, computed_at=computed_at)

        if rows_by_event:
            async with self._write() as session:
                repo = ExplorationRepository(session)
                existing = await repo.existing_event_ids(rows_by_event)
                result.missing.extend(sorted(set(rows_by_event) - existing))
                target_ids = [event_id for event_id in rows_by_event if event_id in existing]
                rows = [row for event_id in target_ids for row in rows_by_event[event_id]]
                result.rows_written = await repo.replace_event_entities(target_ids, rows)
                await session.commit()
            result.events_written = target_ids
            result.entities_by_event = {
                event_id: [
                    (row["entity_key"], row["kind"], row["name"]) for row in rows_by_event[event_id]
                ]
                for event_id in target_ids
            }

        logger.info(
            "event_entities_refreshed",
            requested=result.requested,
            events_written=len(result.events_written),
            rows_written=result.rows_written,
            skipped_no_title=len(result.skipped_no_title),
            missing=len(result.missing),
            correlation_id=correlation_id,
        )
        return result


__all__ = [
    "MAX_ARTICLE_IDS",
    "AggregatedEntity",
    "ArticleEntities",
    "EntityRefreshResult",
    "EventEntityInput",
    "EventEntityService",
    "acronym_matches",
    "aggregate",
    "latest_titles",
    "title_query",
]
