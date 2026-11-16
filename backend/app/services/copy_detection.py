"""Zelfde tekst (Epic 14, Story 14.27): articles of one news item that are the same text.

Many news articles are agency copy: the ANP text, at most shortened or with a sentence of its own,
at several outlets within minutes. Titles of one publisher also share their own articles (AD and
Het Parool, de Volkskrant and Trouw). Such articles are one voice, not several.

Per pair of articles of different outlets in one news item: which part of each text the other has
word for word, in runs of at least ``MIN_RUN_WORDS`` words, outside quotes (outlets that write
their own text still quote the same statement) and without the outlets' own page furniture. The
share of the more covered text is the overlap, and ``copy_probability`` turns it into the chance
that the two are copies of one text. Articles linked with at least ``COPY_CLUSTER_MIN_PROBABILITY``
form a group. A group with outlets of different owners (the propaganda model's ``eigendom``) or
with a text that names ANP is agency copy; one with outlets of one owner is shared within that
publisher. The result is stored per link, in ``event_articles.scoring_breakdown.copy``, which the
website already reads.

Calibration (2026-10-16, Dutch articles of the eight main sources, 2025-10 to 2026-10-16: 1,478
pairs of different outlets in one news item). 81 % of the pairs share no passage of 12 words. The
curve is fitted on 93 pairs that two judges labelled blind, without score, outlet or time
(stratified over 1,631 pairs, weighted back): "mostly the same text" (verbatim, shortened or lightly
edited, against sharing a passage or rewriting the same facts) at overlap 0.2-0.3 4 of 7, 0.3-0.4 10
of 11, 0.4-0.5 all, above 0.5 29 of 30. ``copy_probability`` follows that: 0.19 at 0.20, 0.50 at
0.27, 0.87 at 0.36, 0.98 at 0.45. A group from 0.5 then has precision 97 % and recall 92 % on those
pairs. On 72 new pairs that two other judges labelled the same way (2026-10-19, weighted to 1,580
pairs) it has precision 100 % and recall 93 % (95 % interval 84-99); what it misses is edited copy
with few or no passages of 12 words.
"""

from __future__ import annotations

import json
import math
import re
import time
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..core.config import get_settings
from ..db.session import get_sessionmaker

logger = structlog.get_logger(__name__)

COPY_VERSION = 2
NGRAM = 6
# A shared passage counts from this many words in a row: names, titles and stock phrases ("de
# politie doet onderzoek naar de toedracht") stay below it, a sentence of the same text does not
MIN_RUN_WORDS = 12
# Too short to tell (outside quotes): a teaser behind a paywall, a video caption
MIN_WORDS = 40
# copy_probability: 0.5 at this overlap, steepness of the curve (calibration in the module text)
PROBABILITY_MIDPOINT = 0.27
PROBABILITY_SLOPE = 21.0

TOKEN = re.compile(r"[0-9a-zà-öø-ÿ]+")
# Quoted speech: „…” “…” "…" ‘…’. An apostrophe (zo’n, Gillis’) never opens with ‘
QUOTES = re.compile(
    r"„[^”“\"\n]{0,600}[”“\"]|“[^”\n]{0,600}”|\"[^\"\n]{0,600}\"|‘[^’\n]{0,600}’(?![a-zà-ÿ])"
)
# Page furniture that the text extraction keeps, in the text of several outlets
FURNITURE = re.compile(
    r"Maak RTL je Google-favoriet"
    r"|Lees ook\s+Geselecteerd door de redactie"
    r"|Omdat je cookies voor sociale media uitgeschakeld zijn, blijft deze inhoud verborgen\.?"
    r"|Je kan hier toestemming geven voor deze cookies\.?"
    r"|(?:De )?[Tt]ekst gaat verder onder (?:het|de) [\w-]+\.?"
    r"|Dit bericht op Instagram bekijken|Een bericht gedeeld door [^\n.]{1,80}"
    r"|(?:Luister|Kijk) ook naar (?:onze|deze) [^\n]{0,200}"
    r"|Bekijk hieronder (?:onze|de) [^\n]{0,200}"
    r"|Al onze podcasts vind je [^\n]{0,120}",
)
# A passage never runs across a quote or a piece of furniture
BREAKS = re.compile(f"(?:{QUOTES.pattern})|(?:{FURNITURE.pattern})")
# The text says it comes from ANP: a dateline "(ANP)", "ANP/AFP", or what someone told the ANP
ANP_MARKER = re.compile(
    r"\(ANP(?:/[A-Z]+)?\)|\bANP/(?:AFP|RTR|DPA|BELGA|AP|EFE)\b|\bBron:\s*ANP\b"
    r"|\b(?:tegen|aan|tegenover)\s+(?:het\s+)?(?:persbureau\s+)?ANP\b"
    r"|\b(?:meldt|meldde|schrijft|aldus|volgens)\s+(?:het\s+)?(?:persbureau\s+)?ANP\b"
    r"|\bverslaggevers?\s+van\s+(?:het\s+)?(?:persbureau\s+)?ANP\b"
)


# The titles of DPG Media (AD, Het Parool, de Volkskrant, Trouw) publish one article under one code
# with a letter per title: ad.nl/…~a43d58b6/ and parool.nl/…~b43d58b6/ are the same article
DPG_ARTICLE_CODE = re.compile(r"~[a-z]([0-9a-f]{7})/?(?:[?#].*)?$")


def article_code(url: str | None) -> str | None:
    """The code under which a publisher's titles share one article, or None."""

    match = DPG_ARTICLE_CODE.search(url or "")
    return match.group(1) if match else None


@dataclass(slots=True)
class TextPrint:
    """A text outside quotes: per stretch between quotes, the sequence of NGRAM words that starts
    at each word; all those sequences; the number of words."""

    segments: list[list[str]]
    grams: set[str]
    words: int
    _index: dict[str, list[int]] | None = None

    def index(self) -> dict[str, list[int]]:
        """Where each sequence starts, counted over the stretches with a gap between them (a
        passage never runs from one stretch into the next)."""

        if self._index is None:
            index: dict[str, list[int]] = {}
            position = 0
            for segment in self.segments:
                for gram in segment:
                    index.setdefault(gram, []).append(position)
                    position += 1
                position += 1
            self._index = index
        return self._index


def text_print(value: str | None) -> TextPrint:
    """What the comparison uses of one article text."""

    segments: list[list[str]] = []
    words = 0
    for part in BREAKS.split(value or ""):
        tokens = TOKEN.findall(part.lower())
        words += len(tokens)
        if len(tokens) >= NGRAM:
            starts = range(len(tokens) - NGRAM + 1)
            segments.append([" ".join(tokens[i : i + NGRAM]) for i in starts])
    grams = {gram for segment in segments for gram in segment}
    return TextPrint(segments=segments, grams=grams, words=words)


Masks = list[list[bool]]

# A passage of MIN_RUN_WORDS words is this many sequences in a row
MIN_RUN_GRAMS = MIN_RUN_WORDS - NGRAM + 1


def cover(a: TextPrint, b: TextPrint, masks: Masks | None = None) -> Masks:
    """Mark the words of ``a`` that stand, in passages of at least MIN_RUN_WORDS words, in the same
    order in ``b``: the sequences of a passage follow each other in both texts (sequences that
    only occur somewhere in ``b`` do not make a passage). ``masks`` adds to an earlier marking."""

    index = b.index()
    if masks is None:
        masks = [[False] * (len(segment) + NGRAM - 1) for segment in a.segments]

    def mark(mask: list[bool], start: int, grams: int) -> None:
        for j in range(start, start + grams + NGRAM - 1):
            mask[j] = True

    for s, segment in enumerate(a.segments):
        runs: dict[int, int] = {}  # position in b where a passage now ends -> its sequences
        for i, gram in enumerate(segment):
            nxt = {p: runs.get(p - 1, 0) + 1 for p in index.get(gram, ())}
            for p, n in runs.items():
                if p + 1 not in nxt and n >= MIN_RUN_GRAMS:
                    mark(masks[s], i - n, n)
            runs = nxt
        for n in runs.values():
            if n >= MIN_RUN_GRAMS:
                mark(masks[s], len(segment) - n, n)
    return masks


def covered_words(masks: Masks) -> int:
    return sum(sum(mask) for mask in masks)


def coverage(a: TextPrint, *others: TextPrint) -> float:
    """Share of the words of ``a`` (outside quotes) that one of ``others`` has word for word."""

    if not a.words:
        return 0.0
    masks: Masks | None = None
    for other in others:
        masks = cover(a, other, masks)
    return covered_words(masks) / a.words if masks else 0.0


def overlap(a: TextPrint, b: TextPrint) -> float:
    """How much two texts are the same: the share of the more covered one (a shortened copy is
    fully in its source)."""

    if a.words < MIN_WORDS or b.words < MIN_WORDS:
        return 0.0
    if len(a.grams & b.grams) < MIN_RUN_GRAMS:
        return 0.0
    return max(coverage(a, b), coverage(b, a))


def copy_probability(value: float) -> float:
    """The chance that two articles with this overlap are copies of one text (calibrated)."""

    if value <= 0:
        return 0.0
    return 1.0 / (1.0 + math.exp(-PROBABILITY_SLOPE * (value - PROBABILITY_MIDPOINT)))


@dataclass(slots=True)
class CopyArticle:
    """One article of the news item, as the comparison needs it."""

    id: int
    outlet: str
    published_at: datetime | None
    text: TextPrint
    # The owner the outlet belongs to (propaganda model), or None when unknown
    publisher: str | None = None
    names_anp: bool = False
    # The publisher's own code of the article (``article_code``)
    code: str | None = None


@dataclass(slots=True)
class CopyMember:
    article_id: int
    share: float
    match: int
    probability: float


@dataclass(slots=True)
class CopyGroup:
    """Articles of different outlets that are (largely) one text."""

    key: int
    members: list[CopyMember]
    # "persbureau" (agency copy), "uitgever" (shared within one publisher) or None (unknown)
    source: str | None
    agency: str | None = None
    likely_agency: str | None = None
    publisher: str | None = None
    outlets: list[str] = field(default_factory=list)

    @property
    def probability(self) -> float:
        return min(member.probability for member in self.members)


def _publisher_key(article: CopyArticle) -> str:
    # An outlet without a known owner is its own publisher
    return article.publisher or f"outlet:{article.outlet}"


def _source(members: Sequence[CopyArticle], know_publishers: bool) -> tuple[str | None, str | None]:
    """Where the one text of a group comes from: ("persbureau", None) when a text names ANP or the
    outlets have different owners (competitors do not copy each other); ("uitgever", owner) when
    every article is one article of the publisher's own system (``article_code``); else (None,
    owner): titles of one owner, which all take ANP copy too."""

    if any(a.names_anp for a in members):
        return "persbureau", None
    if not know_publishers:
        return None, None
    if len({_publisher_key(a) for a in members}) > 1:
        return "persbureau", None
    codes = [a.code for a in members]
    if all(code and codes.count(code) > 1 for code in codes):
        return "uitgever", members[0].publisher
    return None, members[0].publisher


def find_copy_groups(
    articles: Sequence[CopyArticle], *, min_probability: float, know_publishers: bool = True
) -> list[CopyGroup]:
    """Groups of articles of one news item that are (largely) the same text.

    ``know_publishers`` False: the owners of the outlets are unknown (no propaganda model), so a
    group is agency copy only when its text names ANP.
    """

    usable = [a for a in articles if a.text.words >= MIN_WORDS]
    pair: dict[tuple[int, int], float] = {}
    parent = {a.id: a.id for a in usable}

    def root(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, a in enumerate(usable):
        for b in usable[i + 1 :]:
            if a.outlet == b.outlet:
                continue
            p = copy_probability(overlap(a.text, b.text))
            if p < min_probability:
                continue
            pair[(a.id, b.id)] = pair[(b.id, a.id)] = p
            parent[root(a.id)] = root(b.id)

    linked = {key[0] for key in pair}
    by_root: dict[int, list[CopyArticle]] = {}
    for a in usable:
        if a.id in linked:
            by_root.setdefault(root(a.id), []).append(a)

    groups: list[CopyGroup] = []
    for members in by_root.values():
        outlets = sorted({a.outlet for a in members})
        if len(outlets) < 2:
            continue
        members.sort(key=lambda a: (a.published_at is None, a.published_at or datetime.min, a.id))
        result: list[CopyMember] = []
        for a in members:
            others = [b for b in members if b.id != a.id and b.outlet != a.outlet]
            best = max(others, key=lambda b: pair.get((a.id, b.id), 0.0))
            result.append(
                CopyMember(
                    article_id=a.id,
                    share=round(coverage(a.text, *(b.text for b in others)), 3),
                    match=best.id,
                    probability=round(pair.get((a.id, best.id), 0.0), 3),
                )
            )
        source, publisher = _source(members, know_publishers)
        names_anp = any(a.names_anp for a in members)
        groups.append(
            CopyGroup(
                key=members[0].id,
                members=result,
                source=source,
                agency="ANP" if names_anp else None,
                # ANP is the only Dutch news agency (since it took over Novum in 2015): Dutch agency
                # copy of different owners is the ANP's, also when the text does not say so
                likely_agency="ANP" if source == "persbureau" and not names_anp else None,
                publisher=publisher,
                outlets=outlets,
            )
        )
    groups.sort(key=lambda g: (-len(g.members), g.key))
    return groups


def copy_payload(group: CopyGroup, member: CopyMember) -> dict[str, Any]:
    """What one link stores: its group, how much of its text the others have, and the group."""

    return {
        "v": COPY_VERSION,
        "group": group.key,
        "share": member.share,
        "match": member.match,
        "probability": member.probability,
        "group_probability": round(group.probability, 3),
        "source": group.source,
        "agency": group.agency,
        "likely_agency": group.likely_agency,
        "publisher": group.publisher,
    }


def payloads_for(groups: Iterable[CopyGroup]) -> dict[int, dict[str, Any]]:
    """The copy payload per article id."""

    return {
        member.article_id: copy_payload(group, member)
        for group in groups
        for member in group.members
    }


# --- Database ---------------------------------------------------------------------------------


# The media group an outlet belongs to: the nearest owner of type mediaorganisatie along the
# propaganda model's current eigendom relations (AD -> DPG Media, De Telegraaf -> Mediahuis
# Nederland -> Mediahuis); an outlet without one has no publisher
PUBLISHERS_SQL = """
with recursive outlets as (
    select distinct on (lower(a.alias)) lower(a.alias) as name, a.entity_id
    from pm_aliases a
    where lower(a.alias) = any(:names)
    union
    select lower(e.name), e.id from pm_entities e where lower(e.name) = any(:names)
),
up as (
    select o.name, r.source_id as owner, 1 as depth, array[o.entity_id, r.source_id] as path
    from outlets o
    join pm_relations r on r.target_id = o.entity_id and r.relation_type = 'eigendom'
    where coalesce(r.active_until, '') = '' or r.active_until > to_char(now(), 'YYYY-MM-DD')
    union all
    select u.name, r.source_id, u.depth + 1, u.path || r.source_id
    from up u
    join pm_relations r on r.target_id = u.owner and r.relation_type = 'eigendom'
    where u.depth < 4 and not r.source_id = any(u.path)
      and (coalesce(r.active_until, '') = '' or r.active_until > to_char(now(), 'YYYY-MM-DD'))
)
select distinct on (u.name) u.name, e.name as publisher
from up u join pm_entities e on e.id = u.owner
where e.type = 'mediaorganisatie'
order by u.name, u.depth, e.id
"""

SIGNATURES_SQL = """
select ea.event_id, count(*) as links, max(ea.linked_at) as last_linked, sum(ea.article_id) as ids
from event_articles ea
join events e on e.id = ea.event_id
where ea.event_id in (
    select event_id from event_articles where linked_at >= now() - make_interval(hours => :hours)
)
  and (:archived or e.archived_at is null)
group by ea.event_id
"""

LINKS_SQL = """
select ea.id as link_id, ea.event_id, ea.article_id, ea.scoring_breakdown,
       a.source_name, a.published_at, a.url, a.content,
       coalesce(a.is_international, false) as international
from event_articles ea
join articles a on a.id = ea.article_id
where ea.event_id = any(:event_ids)
"""

SET_COPY_SQL = """
update event_articles
set scoring_breakdown = (coalesce(scoring_breakdown::jsonb, '{}'::jsonb)
                         || jsonb_build_object('copy', cast(:copy as jsonb)))::json
where id = :link_id
"""

DROP_COPY_SQL = """
update event_articles
set scoring_breakdown = (scoring_breakdown::jsonb - 'copy')::json
where id = :link_id and scoring_breakdown::jsonb ? 'copy'
"""

GROUP_KEYS = ("group", "group_probability", "source", "agency", "likely_agency", "publisher")

STORED_SQL = """
select ea.article_id, a.source_name, a.title, ea.scoring_breakdown->'copy' as copy
from event_articles ea
join articles a on a.id = ea.article_id
where ea.event_id = :event_id and (ea.scoring_breakdown::jsonb) ? 'copy'
order by a.published_at nulls last, ea.article_id
"""

PUBLISHER_CACHE_SECONDS = 3600


@dataclass(slots=True)
class _Link:
    link_id: int
    event_id: int
    article_id: int
    current: dict[str, Any] | None
    article: CopyArticle | None


class CopyDetectionService:
    """Finds the articles of a news item that are the same text and stores that per link."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        min_probability: float | None = None,
    ) -> None:
        settings = get_settings()
        self._session_factory = session_factory
        self.min_probability = (
            settings.copy_cluster_min_probability if min_probability is None else min_probability
        )
        # Per event: (links, last linked, sum of article ids) when it was last compared
        self._signatures: dict[int, tuple[Any, ...]] = {}
        self._publishers: dict[str, str] = {}
        self._publishers_at = float("-inf")
        self._know_publishers = False
        self.last_run: dict[str, Any] | None = None

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory or get_sessionmaker()

    async def _load_publishers(self, session: AsyncSession, names: Iterable[str]) -> None:
        if time.monotonic() - self._publishers_at > PUBLISHER_CACHE_SECONDS:
            self._publishers = {}
            self._publishers_at = time.monotonic()
        wanted = sorted({name.lower() for name in names if name} - set(self._publishers))
        if not wanted:
            return
        try:
            rows = (await session.execute(text(PUBLISHERS_SQL), {"names": wanted})).mappings().all()
        except Exception as exc:  # no propaganda model tables (yet): owners unknown
            await session.rollback()
            logger.warning("copy_detection_publishers_unavailable", error=str(exc)[:200])
            return
        for row in rows:
            self._publishers[row["name"]] = row["publisher"]
        # An outlet without an owner ("") is looked up again when the cache expires
        for name in wanted:
            self._publishers.setdefault(name, "")
        self._know_publishers = any(self._publishers.values())

    async def refresh_recent(
        self,
        *,
        hours: int | None = None,
        force: bool = False,
        include_archived: bool = False,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Compare the news items that got an article in the last ``hours`` and changed since the
        last comparison (``force``: all of them; ``include_archived``: archived ones as well;
        ``dry_run``: count what would change, write nothing)."""

        started = time.monotonic()
        window = hours or get_settings().copy_detection_window_hours
        async with self._sessions()() as session:
            rows = (
                await session.execute(
                    text(SIGNATURES_SQL), {"hours": window, "archived": include_archived}
                )
            ).all()
        signatures = {row.event_id: (row.links, row.last_linked, row.ids) for row in rows}
        changed = [
            event_id
            for event_id, signature in signatures.items()
            if force or self._signatures.get(event_id) != signature
        ]
        stats = await self.refresh_events(changed, dry_run=dry_run)
        if not dry_run:
            for event_id in changed:
                self._signatures[event_id] = signatures[event_id]
        result = {
            "window_hours": window,
            "events_in_window": len(rows),
            **stats,
            "seconds": round(time.monotonic() - started, 2),
        }
        if dry_run:
            return {**result, "dry_run": True}
        self.last_run = {"at": datetime.now(timezone.utc).isoformat(), **result}
        if stats["updated_links"]:
            logger.info("copy_detection_run", **result)
        return result

    async def refresh_events(
        self, event_ids: Sequence[int], *, batch: int = 50, dry_run: bool = False
    ) -> dict[str, int]:
        """Compare the articles of these news items and store the groups on their links
        (``dry_run``: only count the links that would change)."""

        stats = {"events": 0, "groups": 0, "updated_links": 0}
        ids = list(dict.fromkeys(int(i) for i in event_ids))
        for start in range(0, len(ids), batch):
            chunk = ids[start : start + batch]
            async with self._sessions()() as session:
                rows = (
                    (await session.execute(text(LINKS_SQL), {"event_ids": chunk})).mappings().all()
                )
                await self._load_publishers(
                    session, (row["source_name"] for row in rows if not row["international"])
                )
                links: dict[int, list[_Link]] = {}
                for row in rows:
                    links.setdefault(row["event_id"], []).append(self._link(row))
                updates: list[tuple[int, dict[str, Any] | None]] = []
                for event_links in links.values():
                    groups = find_copy_groups(
                        [link.article for link in event_links if link.article],
                        min_probability=self.min_probability,
                        know_publishers=self._know_publishers,
                    )
                    stats["groups"] += len(groups)
                    payloads = payloads_for(groups)
                    for link in event_links:
                        wanted = payloads.get(link.article_id)
                        if wanted != link.current:
                            updates.append((link.link_id, wanted))
                for link_id, payload in [] if dry_run else updates:
                    if payload is None:
                        await session.execute(text(DROP_COPY_SQL), {"link_id": link_id})
                    else:
                        await session.execute(
                            text(SET_COPY_SQL), {"link_id": link_id, "copy": _json(payload)}
                        )
                await session.commit()
            stats["events"] += len(links)
            stats["updated_links"] += len(updates)
        return stats

    async def stored_groups(self, event_id: int) -> list[dict[str, Any]]:
        """The groups of one news item as stored on its links (for the admin)."""

        async with self._sessions()() as session:
            rows = (
                (await session.execute(text(STORED_SQL), {"event_id": event_id})).mappings().all()
            )
        groups: dict[int, dict[str, Any]] = {}
        for row in rows:
            copy = row["copy"] if isinstance(row["copy"], dict) else json.loads(row["copy"])
            group = groups.setdefault(
                copy["group"],
                {key: copy.get(key) for key in GROUP_KEYS} | {"articles": []},
            )
            group["articles"].append(
                {
                    "article_id": row["article_id"],
                    "outlet": row["source_name"],
                    "title": row["title"],
                    "share": copy.get("share"),
                    "match": copy.get("match"),
                    "probability": copy.get("probability"),
                }
            )
        return list(groups.values())

    def _link(self, row: Mapping[str, Any]) -> _Link:
        breakdown = row["scoring_breakdown"]
        if isinstance(breakdown, str):
            breakdown = json.loads(breakdown)
        current = breakdown.get("copy") if isinstance(breakdown, dict) else None
        article = None
        if not row["international"] and row["content"]:
            outlet = row["source_name"] or ""
            article = CopyArticle(
                id=row["article_id"],
                outlet=outlet,
                published_at=row["published_at"],
                text=text_print(row["content"]),
                publisher=self._publishers.get(outlet.lower()) or None,
                names_anp=bool(ANP_MARKER.search(row["content"])),
                code=article_code(row["url"]),
            )
        return _Link(
            link_id=row["link_id"],
            event_id=row["event_id"],
            article_id=row["article_id"],
            current=current,
            article=article,
        )


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


_service: CopyDetectionService | None = None


def get_copy_detection_service() -> CopyDetectionService:
    global _service
    if _service is None:
        _service = CopyDetectionService()
    return _service
