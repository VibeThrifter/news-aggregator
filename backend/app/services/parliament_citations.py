"""Kamervragen over het nieuws, en hoe de Kamer stemde (Story 14.33).

**Kamervragen that cite an article.** A Kamerlid who asks the government about a news report puts
the article's address in a footnote: "Bent u bekend met het bericht «UWV stopt met ICT-project …»?"
with nu.nl/tech/6413139/… below. Measured on 2026-11-16: of 273 sets of Kamervragen from 3 October
to 14 November, 31 % name a report in their title; 12 sets linked to exactly an article that is in
the news app (UWV, WFP in Gaza, Erkens and onverdoofd slachten, the BIJ1 subsidy, …).

The job reads every new set of Kamervragen (with or without answer) on officielebekendmakingen.nl
(KOOP's SRU, no key), keeps its links and who asked (``parliament_questions_read``, local) and
matches the links against the articles' URLs: exactly, or by the article code DPG Media keeps when
a slug changes. A match puts the set in ``event_documents`` of that news item (source
``kamervragen``) with the articles it cites and the askers; the Tijdlijn shows it after the news.

**Votes.** A motion or amendment in the Tijdlijn (found by the job "Achtergrondstukken") gets the
Kamer's vote from its open data: decision, and per fraction for or against with its seats
(``details.vote``). A motion is voted on a week or more after it is filed, so a motion without a
vote is checked again once a day while it is younger than ``VOTE_CHECK_DAYS``.

No LLM call; both sources are open data without a key.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import xml.etree.ElementTree as ET  # noqa: S405 - expat >= 2.4 resists entity expansion
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx
import structlog
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..db.models import EventDocument, ParliamentQuestionRead
from ..db.session import get_sessionmaker
from .background_sources import NS, OB_SRU_URL, _parse_date, _text, ob_identifier, ob_kind
from .copy_detection import DPG_ARTICLE_CODE

logger = structlog.get_logger(__name__)

SOURCE = "kamervragen"
QUESTION_PUBLICATIONS = ("Kamervragen zonder antwoord", "Kamervragen (Aanhangsel)")
# Records per SRU page
PAGE_SIZE = 100
# Sets read per run (the first run of a long window takes several runs)
READ_LIMIT = 60
# The list looks back at least this far: a set is formatted (and readable) days after it is filed
LIST_MIN_DAYS = 21
PAUSE_SECONDS = 0.5
# Links kept per set (an answer can list many sources)
MAX_LINKS = 40
# Hosts whose links are the publication's own furniture, never a news article
OWN_HOSTS = (
    "overheid.nl",
    "officielebekendmakingen.nl",
    "officiele-overheidspublicaties.nl",
    "w3.org",
)

TK_ZAAK_URL = "https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/Zaak"
VOTE_KINDS = ("Motie", "Amendement")
# A motion without a vote is checked again daily while it is younger than this
VOTE_CHECK_DAYS = 120
VOTE_RECHECK = timedelta(hours=20)
VOTES_PER_RUN = 20

_HREF = re.compile(r"""href=["'](https?://[^"'<>\s]+)["']""", re.IGNORECASE)
_TEXT_URL = re.compile(r"https?://[^\s\"'<>«»]+")
_TAGS = re.compile(r"<(script|style)\b.*?</\1>|<[^>]+>", re.IGNORECASE | re.DOTALL)
# "Vragen van het lid Ergin (DENK) aan de Minister …", "Vragen van de leden Dobbe (SP) en Van Baarle
# (DENK) aan …"; also "Mondelinge vragen van …" and "Vragen namens het lid …"
_ASKERS = re.compile(
    r"[Vv]ragen (?:van|namens) (?:het lid|de leden)\s+(.{3,400}?)\s+aan\s+"
    r"(?:de|het|staatssecretaris|minister)\b"
)
# kst-36180-237, kst-36800-IV-12
_KST = re.compile(r"^kst-(\d+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*?))?-(\d+)$", re.IGNORECASE)


# ---------------------------------------------------------------------------------------------
# Pure helpers


@dataclass(frozen=True, slots=True)
class QuestionRecord:
    """A set of Kamervragen in the SRU: the formatted version, with an HTML file to read."""

    identifier: str
    doc_type: str
    title: str
    url: str
    published_at: datetime | None
    read_url: str


def question_records(xml_text: str) -> list[QuestionRecord]:
    """The formatted sets in an SRU answer. A set first appears unformatted (kv-1279790, only a
    PDF) and days later formatted (kv-tk-2026Z25040, with HTML); only the second is read."""

    try:
        root = ET.fromstring(xml_text)  # noqa: S314 - expat >= 2.4 resists entity expansion
    except ET.ParseError as exc:
        raise ValueError(f"SRU answer is no XML: {exc}") from exc
    found: list[QuestionRecord] = []
    for record in root.iterfind(".//sru:record", NS):
        meta = record.find(".//ow:meta", NS)
        if meta is None:
            continue
        identifier = _text(meta, ".//dcterms:identifier")
        title = _text(meta, ".//ow:documenttitel") or _text(meta, ".//dcterms:title")
        files = {
            item.get("manifestation"): (item.text or "").strip()
            for item in record.iterfind(".//gzd:itemUrl", NS)
        }
        read_url = files.get("html") or files.get("xml")
        if not identifier or not title or not read_url:
            continue
        url = _text(record, ".//gzd:preferredUrl") or (
            f"https://zoek.officielebekendmakingen.nl/{identifier}.html"
        )
        found.append(
            QuestionRecord(
                identifier=identifier.lower(),
                doc_type=ob_kind(
                    _text(meta, ".//ow:publicatienaam"), _text(meta, ".//ow:subrubriek")
                ),
                title=" ".join(title.split())[:1000],
                url=url[:2048],
                published_at=_parse_date(
                    _text(meta, ".//dcterms:date")
                    or _text(meta, ".//dcterms:issued")
                    or _text(meta, ".//dcterms:available")
                ),
                read_url=read_url,
            )
        )
    return found


def questions_query(since: datetime) -> str:
    kinds = " OR ".join(f'w.publicatienaam=="{name}"' for name in QUESTION_PUBLICATIONS)
    return (
        f"c.product-area==officielepublicaties AND ({kinds}) "
        f"AND dt.date>={since.date().isoformat()} sortBy dt.date/sort.descending"
    )


def page_text(page: str) -> str:
    """The text of a page: tags gone, entities decoded, one space between words."""

    import html

    return " ".join(html.unescape(_TAGS.sub(" ", page)).split())


def page_links(page: str) -> list[str]:
    """The links in a publication (hrefs, and addresses written out in its footnotes), in order,
    without the publication's own furniture."""

    import html

    links: list[str] = []
    for raw in [*_HREF.findall(page), *_TEXT_URL.findall(page_text(page))]:
        link = html.unescape(raw).strip().rstrip(".,;:)]»’'\"")
        host = (urlsplit(link).hostname or "").lower()
        if not host or any(host == own or host.endswith("." + own) for own in OWN_HOSTS):
            continue
        if link not in links:
            links.append(link)
        if len(links) == MAX_LINKS:
            break
    return links


def askers_of(page: str) -> str | None:
    """Who asked: "Ergin (DENK)", "Dobbe (SP) en Van Baarle (DENK)"."""

    match = _ASKERS.search(page_text(page))
    return match.group(1).strip()[:500] if match else None


def url_key(url: str) -> str:
    """An address without scheme, www, query, fragment and trailing slash: how two links to one
    article compare."""

    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return ""
    host = (parts.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    return host + parts.path.rstrip("/") if host else ""


def dpg_code(url: str) -> str | None:
    """ "~a43d58b6": the code of a DPG Media article, which stays when its slug changes."""

    match = DPG_ARTICLE_CODE.search(url.split("?")[0])
    return match.group(0).split("/")[0].split("?")[0] if match else None


def vote_target(url: str) -> tuple[int, str | None, int] | None:
    """(dossier, toevoeging, volgnummer) of a Kamerstuk link (kst-36800-IV-12), or None."""

    identifier = ob_identifier(url)
    match = _KST.match(identifier or "")
    if not match:
        return None
    return (
        int(match.group(1)),
        (match.group(2).upper() if match.group(2) else None),
        int(match.group(3)),
    )


def vote_filter(dossier: int, addition: str | None, number: int) -> str:
    extra = f"k/Toevoeging eq '{addition}'" if addition else "k/Toevoeging eq null"
    kinds = " or ".join(f"Soort eq '{kind}'" for kind in VOTE_KINDS)
    return (
        f"({kinds}) and Verwijderd eq false and Volgnummer eq {number} "
        f"and Kamerstukdossier/any(k: k/Nummer eq {dossier} and {extra})"
    )


def vote_of(payload: Any) -> dict[str, Any] | None:
    """The Kamer's vote on a motion or amendment: the decision with votes per fraction (seats for a
    show of hands, members for a roll call), or None when it was not voted on (yet)."""

    decisions = []
    for zaak in (payload or {}).get("value") or []:
        for besluit in zaak.get("Besluit") or []:
            if besluit.get("Verwijderd") or not besluit.get("Stemming"):
                continue
            decisions.append(besluit)
    if not decisions:
        return None
    decisions.sort(key=lambda besluit: str(besluit.get("GewijzigdOp") or ""))
    besluit = decisions[-1]
    seats: dict[str, dict[str, int]] = {"Voor": defaultdict(int), "Tegen": defaultdict(int)}
    roll_call = (besluit.get("StemmingsSoort") or "").lower().startswith("hoofdelijk")
    for stemming in besluit.get("Stemming") or []:
        side = stemming.get("Soort")
        party = stemming.get("ActorFractie") or stemming.get("ActorNaam")
        if side not in seats or not party or stemming.get("Verwijderd"):
            continue
        seats[side][party] += 1 if roll_call else int(stemming.get("FractieGrootte") or 0)
    result = " ".join(str(besluit.get("BesluitTekst") or "").split()).rstrip(".")

    def order(side: str) -> list[tuple[str, int]]:
        return sorted(seats[side].items(), key=lambda item: (-item[1], item[0]))

    return {
        "result": result[:120],
        "kind": besluit.get("StemmingsSoort"),
        "for": [[party, n] for party, n in order("Voor")],
        "against": [[party, n] for party, n in order("Tegen")],
        "seats_for": sum(seats["Voor"].values()),
        "seats_against": sum(seats["Tegen"].values()),
    }


def merge_cites(existing: Any, new: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    cites = [cite for cite in (existing or []) if isinstance(cite, dict)]
    known = {cite.get("article_id") for cite in cites}
    for cite in new:
        if cite["article_id"] not in known:
            cites.append(cite)
            known.add(cite["article_id"])
    return cites


# ---------------------------------------------------------------------------------------------
# Database

# Articles whose address, compared without scheme, www, query and trailing slash, is one of these
MATCH_SQL = """
SELECT a.id, a.source_name, ea.event_id,
       rtrim(regexp_replace(lower(split_part(split_part(a.url, '?', 1), '#', 1)),
                            '^https?://(www\\.|m\\.)?', ''), '/') AS key
FROM articles a
JOIN event_articles ea ON ea.article_id = a.id
WHERE rtrim(regexp_replace(lower(split_part(split_part(a.url, '?', 1), '#', 1)),
                           '^https?://(www\\.|m\\.)?', ''), '/') = ANY(:keys)
"""
CODE_SQL = """
SELECT a.id, a.source_name, ea.event_id, a.url
FROM articles a
JOIN event_articles ea ON ea.article_id = a.id
WHERE a.url LIKE ANY(:patterns)
"""
VOTE_TARGETS_SQL = """
SELECT id, url, details
FROM event_documents
WHERE doc_type = ANY(:kinds)
  AND url LIKE '%officielebekendmakingen.nl/kst-%'
  AND (published_at IS NULL OR published_at > now() - make_interval(days => :days))
  AND (details IS NULL OR details -> 'vote' IS NULL)
ORDER BY published_at DESC NULLS LAST
"""


class ParliamentCitationsService:
    """Reads new Kamervragen, puts the ones that cite an article in its news item, and adds the
    Kamer's votes to the motions in the Tijdlijn."""

    def __init__(self, *, session_factory: async_sessionmaker[AsyncSession] | None = None) -> None:
        self._session_factory = session_factory

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory or get_sessionmaker()

    async def _list_questions(
        self, client: httpx.AsyncClient, since: datetime, known: set[str], limit: int
    ) -> list[QuestionRecord]:
        """The formatted sets dated since ``since`` that were not read yet, newest first."""

        todo: list[QuestionRecord] = []
        start = 1
        while len(todo) < limit:
            response = await client.get(
                OB_SRU_URL,
                params={
                    "query": questions_query(since),
                    "maximumRecords": str(PAGE_SIZE),
                    "startRecord": str(start),
                },
            )
            response.raise_for_status()
            page = response.text
            records = question_records(page)
            for doc in records:
                if doc.identifier not in known and doc.identifier not in {
                    d.identifier for d in todo
                }:
                    todo.append(doc)
            if page.count("<sru:record>") < PAGE_SIZE or start > 5000:
                break
            start += PAGE_SIZE
        return todo[:limit]

    async def _match(self, session: AsyncSession, links: Iterable[str]) -> list[Any]:
        """The articles (with their news items) these links point to."""

        keys = sorted({key for key in (url_key(link) for link in links) if key})
        codes = sorted({code for code in (dpg_code(link) for link in links) if code})
        rows: list[Any] = []
        if keys:
            rows.extend((await session.execute(text(MATCH_SQL), {"keys": keys})).all())
        if codes:
            rows.extend(
                (
                    await session.execute(
                        text(CODE_SQL), {"patterns": [f"%{code}%" for code in codes]}
                    )
                ).all()
            )
        return rows

    async def _attach(
        self, session: AsyncSession, question: ParliamentQuestionRead, matches: Sequence[Any]
    ) -> int:
        """Put the set in the news items of the articles it cites. Returns the news items."""

        cites: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in matches:
            if all(cite["article_id"] != row.id for cite in cites[row.event_id]):
                cites[row.event_id].append({"article_id": row.id, "outlet": row.source_name})
        for event_id, cited in cites.items():
            existing = (
                await session.execute(
                    select(EventDocument).where(
                        EventDocument.event_id == event_id, EventDocument.url == question.url
                    )
                )
            ).scalar_one_or_none()
            details = {"cites": cited, "askers": question.askers}
            if existing is not None:
                old = existing.details or {}
                existing.details = {
                    **old,
                    "cites": merge_cites(old.get("cites"), cited),
                    "askers": question.askers,
                }
                # A set the background search found by its title becomes this job's (it stays)
                existing.source = SOURCE
                continue
            await session.execute(
                insert(EventDocument)
                .values(
                    event_id=event_id,
                    term="",
                    source=SOURCE,
                    doc_type=question.doc_type,
                    title=question.title[:1000],
                    url=question.url,
                    published_at=question.published_at,
                    location="Tweede Kamer",
                    details=details,
                )
                .on_conflict_do_nothing(constraint="uq_event_documents_event_url")
            )
        return len(cites)

    async def read_questions(
        self, client: httpx.AsyncClient, *, days: int, limit: int = READ_LIMIT
    ) -> dict[str, int]:
        """Read the sets of the last ``days`` days that were not read yet."""

        stats = {"read": 0, "citing": 0, "events": 0, "failed": 0}
        async with self._sessions()() as session:
            known = set(
                (await session.execute(select(ParliamentQuestionRead.identifier))).scalars()
            )
        # A set is formatted days after it is filed and keeps its date: look back further
        since = datetime.now(timezone.utc) - timedelta(days=max(days, LIST_MIN_DAYS))
        todo = await self._list_questions(client, since, known, limit)
        for i, doc in enumerate(todo):
            if i:
                await asyncio.sleep(PAUSE_SECONDS)
            try:
                response = await client.get(doc.read_url)
                response.raise_for_status()
                page = response.text
            except httpx.HTTPError as exc:
                stats["failed"] += 1
                logger.warning("kamervragen_read_failed", url=doc.read_url, error=str(exc)[:200])
                continue
            question = ParliamentQuestionRead(
                identifier=doc.identifier,
                doc_type=doc.doc_type or "Kamervragen",
                title=doc.title,
                url=doc.url,
                published_at=doc.published_at,
                askers=askers_of(page),
                links=page_links(page),
                read_at=datetime.now(timezone.utc),
            )
            async with self._sessions()() as session:
                session.add(question)
                matches = await self._match(session, question.links)
                events = await self._attach(session, question, matches) if matches else 0
                await session.commit()
            stats["read"] += 1
            if events:
                stats["citing"] += 1
                stats["events"] += events
        return stats

    async def rematch(self, *, days: int) -> dict[str, int]:
        """Match the links of the sets read in the last ``days`` days again (articles that came in
        after the set was read)."""

        stats = {"sets": 0, "events": 0}
        since = datetime.now(timezone.utc) - timedelta(days=days)
        async with self._sessions()() as session:
            questions = (
                (
                    await session.execute(
                        select(ParliamentQuestionRead).where(
                            ParliamentQuestionRead.read_at >= since
                        )
                    )
                )
                .scalars()
                .all()
            )
            for question in questions:
                matches = await self._match(session, question.links or [])
                if matches:
                    stats["sets"] += 1
                    stats["events"] += await self._attach(session, question, matches)
            await session.commit()
        return stats

    async def check_votes(
        self, client: httpx.AsyncClient, *, limit: int = VOTES_PER_RUN
    ) -> dict[str, int]:
        """Add the Kamer's vote to motions and amendments in the Tijdlijn that have none yet."""

        stats = {"checked": 0, "voted": 0, "failed": 0}
        now = datetime.now(timezone.utc)
        async with self._sessions()() as session:
            rows = (
                await session.execute(
                    text(VOTE_TARGETS_SQL), {"kinds": list(VOTE_KINDS), "days": VOTE_CHECK_DAYS}
                )
            ).all()
        todo = []
        for row in rows:
            details = (
                row.details if isinstance(row.details, dict) else json.loads(row.details or "{}")
            )
            checked = details.get("vote_checked_at")
            if checked and now - datetime.fromisoformat(checked) < VOTE_RECHECK:
                continue
            target = vote_target(row.url)
            if target:
                todo.append((row.id, target))
            if len(todo) == limit:
                break
        votes: dict[tuple[int, str | None, int], dict[str, Any] | None] = {}
        for doc_id, target in todo:
            if target not in votes:
                try:
                    response = await client.get(
                        TK_ZAAK_URL,
                        params={
                            "$filter": vote_filter(*target),
                            "$select": "Nummer,Soort,Volgnummer",
                            "$expand": "Besluit($select=BesluitTekst,StemmingsSoort,Status,"
                            "GewijzigdOp,Verwijderd;$expand=Stemming($select=Soort,ActorFractie,"
                            "ActorNaam,FractieGrootte,Verwijderd))",
                        },
                    )
                    response.raise_for_status()
                    votes[target] = vote_of(response.json())
                except (httpx.HTTPError, ValueError) as exc:
                    stats["failed"] += 1
                    logger.warning("kamer_vote_failed", target=target, error=str(exc)[:200])
                    break
                await asyncio.sleep(PAUSE_SECONDS)
            vote = votes[target]
            async with self._sessions()() as session:
                document = await session.get(EventDocument, doc_id)
                if document is None:
                    continue
                details = dict(document.details or {})
                details["vote_checked_at"] = now.isoformat()
                if vote:
                    details["vote"] = vote
                    stats["voted"] += 1
                document.details = details
                await session.commit()
            stats["checked"] += 1
        return stats

    async def run(
        self, client: httpx.AsyncClient, *, days: int, limit: int = READ_LIMIT
    ) -> dict[str, Any]:
        started = time.monotonic()
        result: dict[str, Any] = {}
        result["questions"] = await self.read_questions(client, days=days, limit=limit)
        result["votes"] = await self.check_votes(client)
        result["seconds"] = round(time.monotonic() - started, 2)
        return result
