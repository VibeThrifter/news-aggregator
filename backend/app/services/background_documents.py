"""Achtergrondstukken (Epic 14, Story 14.29): government and party documents about a news item.

The factual analysis gives at most two search terms that a government document about the news would
use ("draagmoederschap", "Silja", "spreidingswet"; ``llm_insights.prompt_metadata.zoektermen``). It
leaves them out for foreign news, sport and entertainment. This job searches them in Bron of Open
State (``api.bron.live``, no key): council documents (Open Raadsinformatie), Woo documents, news of
local party branches (PoliFLW), local regulations and announcements. No extra LLM call.

The search term decides everything (measurement 2026-10-20, twelve Dutch news items): words or names
taken from the news found nothing useful (0 of 12), a well chosen term 6 of 11. A document with the
term in its title was about the subject; one with the term only in its text mostly was not. So
only documents with the term in their title stay: rather nothing than something off topic. The same
title once (Bron lists a document at every meeting it was on), at most ``MAX_DOCUMENTS`` per news
item, newest first, from the last ``YEARS`` years.

Story 14.31 adds two sources (``background_sources``): the same terms in the titles of
Kamerstukken, Kamervragen and Handelingen (officielebekendmakingen.nl, which Bron lacks), and the
documents of public bodies the articles link to in their text. Per news item at most
``MAX_DOCUMENTS`` of Bron, ``MAX_DOCUMENTS`` of officielebekendmakingen.nl and ``MAX_LINKED``
linked ones; a linked document is not shown again as a find.

A news item is searched again only when its newest analysis gives other terms or its articles link
to other documents (``event_document_searches``, local only). The documents are published to
Supabase; the Tijdlijn shows them at their date.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import structlog
from sqlalchemy import and_, delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..core.config import get_settings
from ..db.models import EventDocument, EventDocumentSearch
from ..db.session import get_sessionmaker
from .background_sources import (
    MAX_LINKED,
    FoundDocument,
    linked_documents,
    public_links,
    search_ob,
)

logger = structlog.get_logger(__name__)

BRON_SEARCH_URL = "https://api.bron.live/documents/search"
USER_AGENT = "News360/0.1 (achtergrondstukken bij nieuws)"
# Documents Bron returns per term; the title filter and the deduplication keep fewer
SEARCH_LIMIT = 20
MAX_DOCUMENTS = 5
YEARS = 3
MAX_TERMS = 2
# Bron publishes no rate limit: one call at a time, with a pause
PAUSE_SECONDS = 1.0
# Sources of rows that the job "Official Sources" writes (Stories 14.33/14.34): never replaced here
OTHER_JOB_SOURCES = ("kamervragen", "persbericht")

# "[24bb002195] Programma Werkbezoek Silja": Rotterdam's registration number before the title
TITLE_PREFIX = re.compile(r"^\s*\[[^\]]{1,40}\]\s*")
# "351.1 Opinie bewonersavond Floradorp", "6. Brief …": the item number on the agenda (never a year)
AGENDA_NUMBER = re.compile(r"^\d{1,3}(?:\.\d{1,3})*\.?\s+(?=[^\W\d])")
# "Behoud van het traditionele vreugdevuur in Floradorp.pdf": the file name of a council document
FILE_EXTENSION = re.compile(r"(?:\.(?:pdf|docx?|odt|xlsx?|pptx?))+$", re.IGNORECASE)
# Characters with a meaning in Elasticsearch's query_string
QUERY_SPECIAL = re.compile(r'[\\"+\-=&|><!(){}\[\]^~*?:/]')

# The newest analysis of each news item that is not archived and has search terms
TERMS_SQL = """
SELECT DISTINCT ON (i.event_id) i.event_id, i.prompt_metadata AS meta
FROM llm_insights i
JOIN events e ON e.id = i.event_id
WHERE e.archived_at IS NULL
ORDER BY i.event_id, i.generated_at DESC
"""

# The links in the text of the articles of every news item that is not archived (Story 14.30)
LINKS_SQL = """
SELECT ea.event_id, a.source_name, a.source_metadata -> 'links' AS links
FROM event_articles ea
JOIN articles a ON a.id = ea.article_id
JOIN events e ON e.id = ea.event_id
WHERE e.archived_at IS NULL AND a.source_metadata -> 'links' IS NOT NULL
ORDER BY ea.event_id, a.published_at, a.id
"""


def clean_terms(value: Any) -> list[str]:
    """At most ``MAX_TERMS`` distinct terms of 3 to 60 characters, in the analysis's order."""

    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    terms: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        term = " ".join(QUERY_SPECIAL.sub(" ", item).split())
        if 3 <= len(term) <= 60 and term.lower() not in {t.lower() for t in terms}:
            terms.append(term)
    return terms[:MAX_TERMS]


def terms_of(meta: Any) -> list[str]:
    """The search terms in an analysis's prompt_metadata (a dict, or JSON text from a raw query)."""

    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            return []
    return clean_terms(meta.get("zoektermen")) if isinstance(meta, dict) else []


def clean_title(value: str | None) -> str:
    title = " ".join(TITLE_PREFIX.sub("", value or "").split())
    return FILE_EXTENSION.sub("", AGENDA_NUMBER.sub("", title))


def _parse_date(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def links_of(value: Any) -> list[str]:
    """``source_metadata.links`` (a list, or JSON text from a raw query)."""

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return [link for link in value if isinstance(link, str)] if isinstance(value, list) else []


def documents_from_hits(term: str, hits: Iterable[dict[str, Any]]) -> list[FoundDocument]:
    """The hits of one term that have it in their title (case-insensitive)."""

    needle = term.lower()
    found: list[FoundDocument] = []
    for hit in hits:
        doc = hit.get("_source") or {}
        title = clean_title(doc.get("title"))
        url = doc.get("url") or doc.get("identifier")
        if not title or not isinstance(url, str) or not url.startswith("http"):
            continue
        if needle not in title.lower():
            continue
        found.append(
            FoundDocument(
                term=term,
                source=str(doc.get("source") or "")[:40],
                doc_type=(str(doc["type"])[:80] if doc.get("type") else None),
                title=title,
                url=url[:2048],
                published_at=_parse_date(doc.get("published")),
                location=(str(doc["location_name"])[:255] if doc.get("location_name") else None),
            )
        )
    return found


def select_documents(
    documents: Sequence[FoundDocument], limit: int = MAX_DOCUMENTS
) -> list[FoundDocument]:
    """Each title and URL once, newest first, at most ``limit``."""

    epoch = datetime.min.replace(tzinfo=timezone.utc)
    ordered = sorted(documents, key=lambda doc: doc.published_at or epoch, reverse=True)
    titles: set[str] = set()
    urls: set[str] = set()
    chosen: list[FoundDocument] = []
    for doc in ordered:
        key = doc.title.lower()
        if key in titles or doc.url in urls:
            continue
        titles.add(key)
        urls.add(doc.url)
        chosen.append(doc)
        if len(chosen) == limit:
            break
    return chosen


def combine_documents(*groups: Sequence[FoundDocument]) -> list[FoundDocument]:
    """The groups in order, each document once: a linked document is not found again by a search."""

    seen: set[str] = set()
    combined: list[FoundDocument] = []
    for group in groups:
        for doc in group:
            if doc.same_as in seen or doc.url in seen:
                continue
            seen.update((doc.same_as, doc.url))
            combined.append(doc)
    return combined


def search_params(term: str, now: datetime) -> dict[str, str]:
    since = (now - timedelta(days=365 * YEARS)).date().isoformat()
    return {
        "query": f'title:"{term}"',
        "filter": f"published_from:{since}",
        "sort": "_score:desc",
        "limit": str(SEARCH_LIMIT),
        "excludes": "description,data",
    }


class BackgroundDocumentsService:
    """Searches the analysis's terms in Bron and officielebekendmakingen.nl, reads the documents the
    articles link to, and stores what is about the news."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._client = client
        self.last_run: dict[str, Any] | None = None

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory or get_sessionmaker()

    async def _search(self, client: httpx.AsyncClient, term: str) -> list[FoundDocument]:
        response = await client.get(
            BRON_SEARCH_URL, params=search_params(term, datetime.now(timezone.utc))
        )
        response.raise_for_status()
        hits = ((response.json() or {}).get("hits") or {}).get("hits") or []
        return documents_from_hits(term, hits)

    async def _targets(self) -> dict[int, tuple[list[str], list[str]]]:
        """Per news item that is not archived: its search terms and its links to public bodies."""

        async with self._sessions()() as session:
            term_rows = (await session.execute(text(TERMS_SQL))).all()
            link_rows = (await session.execute(text(LINKS_SQL))).all()
        articles: dict[int, list[tuple[str | None, list[str]]]] = defaultdict(list)
        for row in link_rows:
            articles[row.event_id].append((row.source_name, links_of(row.links)))
        targets = {event_id: (terms_of(meta), []) for event_id, meta in term_rows}
        for event_id, rows in articles.items():
            targets[event_id] = (targets.get(event_id, ([], []))[0], public_links(rows))
        return {event_id: target for event_id, target in targets.items() if any(target)}

    async def pending(self, limit: int) -> list[tuple[int, list[str], list[str]]]:
        """News items with terms or links that were not searched yet, newest first.

        A news item searched before Story 14.31 (``links`` empty) is searched once more, for the
        Kamerstukken."""

        targets = await self._targets()
        async with self._sessions()() as session:
            searched = {
                row.event_id: (row.terms, row.links)
                for row in (
                    await session.execute(
                        select(
                            EventDocumentSearch.event_id,
                            EventDocumentSearch.terms,
                            EventDocumentSearch.links,
                        )
                    )
                ).all()
            }
        todo: list[tuple[int, list[str], list[str]]] = []
        for event_id in sorted(targets, reverse=True):
            terms, links = targets[event_id]
            if searched.get(event_id) != (terms, links):
                todo.append((event_id, terms, links))
        return todo[:limit]

    async def refresh_event(
        self,
        client: httpx.AsyncClient,
        event_id: int,
        terms: list[str],
        links: Sequence[str] = (),
    ) -> int:
        """Search the terms of one news item, read its linked documents and replace its
        documents. Returns how many it has."""

        now = datetime.now(timezone.utc)
        found: list[FoundDocument] = []
        found_ob: list[FoundDocument] = []
        for i, term in enumerate(terms):
            if i:
                await asyncio.sleep(PAUSE_SECONDS)
            found.extend(await self._search(client, term))
            found_ob.extend(await search_ob(client, term, now))
        linked = await linked_documents(client, links, MAX_LINKED) if links else []
        chosen = combine_documents(linked, select_documents(found_ob), select_documents(found))
        async with self._sessions()() as session:
            # The rows of the job "Official Sources" (Kamervragen that cite the news, press
            # releases) are not this job's; the votes on a motion it found stay with the motion
            own = and_(
                EventDocument.event_id == event_id, EventDocument.source.notin_(OTHER_JOB_SOURCES)
            )
            kept = {
                row.url: row.details
                for row in (
                    await session.execute(
                        select(EventDocument.url, EventDocument.details).where(
                            own, EventDocument.details.is_not(None)
                        )
                    )
                ).all()
            }
            await session.execute(delete(EventDocument).where(own))
            if chosen:
                await session.execute(
                    insert(EventDocument)
                    .values(
                        [
                            {
                                "event_id": event_id,
                                "term": doc.term,
                                "source": doc.source,
                                "doc_type": doc.doc_type,
                                "title": doc.title,
                                "url": doc.url,
                                "published_at": doc.published_at,
                                "location": doc.location,
                                "details": kept.get(doc.url),
                            }
                            for doc in chosen
                        ]
                    )
                    .on_conflict_do_nothing(constraint="uq_event_documents_event_url")
                )
            await session.execute(
                insert(EventDocumentSearch)
                .values(
                    event_id=event_id,
                    terms=terms,
                    links=list(links),
                    found=len(chosen),
                    searched_at=datetime.now(timezone.utc),
                )
                .on_conflict_do_update(
                    index_elements=[EventDocumentSearch.event_id],
                    set_={
                        "terms": terms,
                        "links": list(links),
                        "found": len(chosen),
                        "searched_at": datetime.now(timezone.utc),
                    },
                )
            )
            await session.commit()
        return len(chosen)

    async def run(
        self, *, limit: int | None = None, event_ids: Sequence[int] | None = None
    ) -> dict[str, Any]:
        """Search the news items with new terms or links (``event_ids``: these, also when
        searched)."""

        started = time.monotonic()
        batch = limit or get_settings().background_documents_batch_size
        if event_ids:
            targets = await self._targets()
            todo = [(event_id, *targets[event_id]) for event_id in event_ids if event_id in targets]
        else:
            todo = await self.pending(batch)
        stats: dict[str, Any] = {"events": 0, "documents": 0, "failed": 0}
        client = self._client or httpx.AsyncClient(timeout=20.0, headers={"User-Agent": USER_AGENT})
        try:
            for i, (event_id, terms, links) in enumerate(todo):
                if i:
                    await asyncio.sleep(PAUSE_SECONDS)
                try:
                    stats["documents"] += await self.refresh_event(client, event_id, terms, links)
                    stats["events"] += 1
                except (httpx.HTTPError, ValueError) as exc:
                    # Bron, the SRU or the Kamer is down or slow: the next run tries again
                    # (nothing was stored)
                    stats["failed"] += 1
                    logger.warning(
                        "background_documents_search_failed",
                        event_id=event_id,
                        error=str(exc)[:200],
                    )
                    break
        finally:
            if self._client is None:
                await client.aclose()
        stats["seconds"] = round(time.monotonic() - started, 2)
        self.last_run = {"at": datetime.now(timezone.utc).isoformat(), **stats}
        if stats["events"] or stats["failed"]:
            logger.info("background_documents_run", **stats)
        return stats


_service: BackgroundDocumentsService | None = None


def get_background_documents_service() -> BackgroundDocumentsService:
    global _service
    if _service is None:
        _service = BackgroundDocumentsService()
    return _service
