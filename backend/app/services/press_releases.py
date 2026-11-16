"""Citaat uit het persbericht (Story 14.34): articles that quote a Rijksoverheid news release.

A quote in an article reads as something a person said to the reporter. Often it stands word for
word in the government's own news release. Measured on 2026-11-16 with the comparison of "Zelfde
tekst" (Story 14.27): 13 of 59 releases of rijksoverheid.nl (2 to 21 October) came back word for
word in 21 articles. Running text taken over is rare (one article, De Telegraaf on Syria, 47 %); in
16 of the 21 articles it is a quote of eight or more words that stands in the release (the return
of art to Indonesia: two at NOS, De Telegraaf and Trouw each). A control with the articles of eight
days earlier found nothing.

The job reads the new releases from the sitemaps of rijksoverheid.nl (the open data API answers 404
since 2026; the pages are CC0) and keeps their text (``press_releases``, local). For every release
of the last ``MATCH_DAYS`` days it compares the Dutch articles of two hours before to three days
after it:

- **quotes**: a quote of at least ``QUOTE_MIN_WORDS`` words in the article that stands word for
  word in the release;
- **running text**: passages of 12+ words outside quotes in the same order (``copy_detection``),
  as a share of the article.

A release with a match goes into ``event_documents`` of the news item (source ``persbericht``) with
the articles and their quotes; the Tijdlijn shows it with "Geciteerd door …" and the sources list
marks the article. It says what is there: the quote stands in the release, not that the reporter
did not speak to anyone. No LLM call.
"""

from __future__ import annotations

import asyncio
import html
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import structlog
from sqlalchemy import and_, delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..db.models import EventDocument, PressRelease
from ..db.session import get_sessionmaker
from .copy_detection import (
    MIN_RUN_GRAMS,
    QUOTES,
    TOKEN,
    TextPrint,
    cover,
    covered_words,
    text_print,
)

logger = structlog.get_logger(__name__)

SOURCE = "persbericht"
PUBLISHER = "rijksoverheid"
SITEMAP_URL = "https://www.rijksoverheid.nl/sitemap/{n}.xml"
# Sitemaps of 100 addresses, about newest first; reading stops after this many in a row hold
# nothing as new as the window
SITEMAP_MAX = 80
SITEMAP_OLD_IN_A_ROW = 3
# Releases read per run
READ_LIMIT = 60
PAUSE_SECONDS = 0.5
# Releases compared with the articles: published in the last N days
MATCH_DAYS = 4
# Articles from this long before a release (an embargo lifts before the page is up) …
BEFORE = timedelta(hours=2)
# … to this long after it
AFTER = timedelta(days=3)
QUOTE_MIN_WORDS = 8
MAX_QUOTES = 3
QUOTE_CHARS = 240
# An article text shorter than this has no passages to compare (copy_detection.MIN_WORDS)
MIN_ARTICLE_WORDS = 40

_NEWS_URL = re.compile(
    r"<loc>\s*(https://www\.rijksoverheid\.nl/actueel/nieuws/(\d{4})/(\d{2})/(\d{2})/[^<\s]+)\s*</loc>"
)
_LASTMOD = re.compile(r"<lastmod>\s*([^<\s]+)\s*</lastmod>")
_META = re.compile(
    r"""<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']*)["']""", re.IGNORECASE
)
_SITE_SUFFIX = re.compile(r"\s*\|\s*Rijksoverheid\.nl\s*$", re.IGNORECASE)


# ---------------------------------------------------------------------------------------------
# Pure helpers


def sitemap_news(xml: str) -> list[tuple[str, datetime]]:
    """The news releases in one sitemap: (address, the day in the address)."""

    found = []
    for match in _NEWS_URL.finditer(xml):
        year, month, day = (int(part) for part in match.group(2, 3, 4))
        try:
            found.append((match.group(1), datetime(year, month, day, tzinfo=timezone.utc)))
        except ValueError:
            continue
    return found


def newest_lastmod(xml: str) -> str | None:
    values = _LASTMOD.findall(xml)
    return max(values) if values else None


def release_meta(page: str) -> dict[str, str]:
    return {name: html.unescape(value) for name, value in _META.findall(page)}


def parse_release(url: str, day: datetime, page: str) -> dict[str, Any] | None:
    """Title, organisation, time and text of a release page; None without text."""

    import trafilatura

    body = trafilatura.extract(page, include_comments=False, include_tables=False) or ""
    if len(body.split()) < 20:
        return None
    meta = release_meta(page)
    title = _SITE_SUFFIX.sub("", meta.get("DCTERMS.title") or meta.get("og:title") or "").strip()
    published = None
    issued = meta.get("DCTERMS.issued")
    if issued:
        try:
            published = datetime.fromisoformat(issued.replace("Z", "+00:00"))
        except ValueError:
            published = None
    return {
        "url": url,
        "title": title or url.rsplit("/", 1)[-1].replace("-", " "),
        "organisation": (meta.get("DCTERMS.creator") or None),
        "published_at": published or day,
        "text": body,
    }


def flat_words(value: str) -> str:
    return " " + " ".join(TOKEN.findall(value.lower())) + " "


@dataclass(slots=True)
class ReleaseText:
    url: str
    published_at: datetime
    print: TextPrint
    flat: str


@dataclass(slots=True)
class Quoted:
    article_id: int
    outlet: str | None
    quotes: list[str] = field(default_factory=list)
    share: float = 0.0

    def payload(self) -> dict[str, Any]:
        return {
            "article_id": self.article_id,
            "outlet": self.outlet,
            "quotes": self.quotes,
            "share": round(self.share, 3),
        }


def quotes_in(content: str, release_flat: str) -> list[str]:
    """The quotes of an article (``QUOTE_MIN_WORDS`` words or more) that stand word for word in
    the release, each once."""

    found: list[str] = []
    for match in QUOTES.finditer(content or ""):
        words = TOKEN.findall(match.group(0).lower())
        if len(words) < QUOTE_MIN_WORDS:
            continue
        if f" {' '.join(words)} " not in release_flat:
            continue
        quote = " ".join(match.group(0).strip("„“”\"‘’' ").split())
        if quote and quote not in found:
            found.append(quote[:QUOTE_CHARS])
        if len(found) == MAX_QUOTES:
            break
    return found


def compare(
    article_print: TextPrint, content: str, release: ReleaseText
) -> tuple[list[str], float]:
    """(quotes from the release, share of the text outside quotes that is the release's)."""

    share = 0.0
    if (
        article_print.words >= MIN_ARTICLE_WORDS
        and len(article_print.grams & release.print.grams) >= MIN_RUN_GRAMS
    ):
        share = covered_words(cover(article_print, release.print)) / article_print.words
    return quotes_in(content, release.flat), share


# ---------------------------------------------------------------------------------------------
# Database

ARTICLES_SQL = """
SELECT a.id, a.source_name, a.content, a.published_at, ea.event_id
FROM articles a
JOIN event_articles ea ON ea.article_id = a.id
WHERE NOT a.is_international AND a.published_at >= :start AND a.published_at < :end
  AND length(a.content) > 200
"""


class PressReleasesService:
    """Reads the new releases of the Rijksoverheid and marks the articles that quote them."""

    def __init__(self, *, session_factory: async_sessionmaker[AsyncSession] | None = None) -> None:
        self._session_factory = session_factory

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory or get_sessionmaker()

    async def read_new(
        self, client: httpx.AsyncClient, *, days: int, limit: int = READ_LIMIT
    ) -> dict[str, int]:
        """Read the releases of the last ``days`` days that were not read yet."""

        stats = {"sitemaps": 0, "read": 0, "failed": 0}
        since = datetime.now(timezone.utc) - timedelta(days=days)
        async with self._sessions()() as session:
            known = set((await session.execute(select(PressRelease.url))).scalars())
        todo: dict[str, datetime] = {}
        old_in_a_row = 0
        for n in range(1, SITEMAP_MAX + 1):
            response = await client.get(SITEMAP_URL.format(n=n))
            if response.status_code == 404:
                break
            response.raise_for_status()
            stats["sitemaps"] += 1
            for url, day in sitemap_news(response.text):
                if day >= since - timedelta(days=1) and url not in known:
                    todo[url] = day
            newest = newest_lastmod(response.text)
            old_in_a_row = old_in_a_row + 1 if newest and newest < since.isoformat() else 0
            if old_in_a_row >= SITEMAP_OLD_IN_A_ROW or len(todo) >= limit:
                break
        for i, (url, day) in enumerate(
            sorted(todo.items(), key=lambda item: item[1], reverse=True)[:limit]
        ):
            if i:
                await asyncio.sleep(PAUSE_SECONDS)
            try:
                response = await client.get(url)
                response.raise_for_status()
                release = parse_release(url, day, response.text)
            except httpx.HTTPError as exc:
                stats["failed"] += 1
                logger.warning("press_release_read_failed", url=url, error=str(exc)[:200])
                continue
            if release is None:
                continue
            async with self._sessions()() as session:
                await session.execute(
                    insert(PressRelease)
                    .values(publisher=PUBLISHER, read_at=datetime.now(timezone.utc), **release)
                    .on_conflict_do_nothing(index_elements=[PressRelease.url])
                )
                await session.commit()
            stats["read"] += 1
        return stats

    async def match(self, *, days: int = MATCH_DAYS) -> dict[str, int]:
        """Compare the releases of the last ``days`` days with the articles around them and put
        the ones that are quoted in their news items."""

        stats = {"releases": 0, "quoted": 0, "articles": 0, "events": 0}
        since = datetime.now(timezone.utc) - timedelta(days=days)
        async with self._sessions()() as session:
            releases = (
                (
                    await session.execute(
                        select(PressRelease).where(PressRelease.published_at >= since)
                    )
                )
                .scalars()
                .all()
            )
            if not releases:
                return stats
            start = min(release.published_at for release in releases) - BEFORE
            end = max(release.published_at for release in releases) + AFTER
            articles = (
                await session.execute(text(ARTICLES_SQL), {"start": start, "end": end})
            ).all()
        prints: dict[int, TextPrint] = {}
        stats["releases"] = len(releases)
        for release in releases:
            target = ReleaseText(
                url=release.url,
                published_at=release.published_at,
                print=text_print(release.text),
                flat=flat_words(release.text),
            )
            per_event: dict[int, dict[int, Quoted]] = defaultdict(dict)
            for row in articles:
                if not (
                    release.published_at - BEFORE <= row.published_at < release.published_at + AFTER
                ):
                    continue
                if row.id not in prints:
                    prints[row.id] = text_print(row.content)
                quotes, share = compare(prints[row.id], row.content, target)
                if quotes or share > 0:
                    per_event[row.event_id][row.id] = Quoted(row.id, row.source_name, quotes, share)
            async with self._sessions()() as session:
                await self._store(session, release, per_event)
                await session.commit()
            if per_event:
                stats["quoted"] += 1
                stats["events"] += len(per_event)
                stats["articles"] += len({a for quoted in per_event.values() for a in quoted})
        return stats

    async def _store(
        self, session: AsyncSession, release: PressRelease, per_event: dict[int, dict[int, Quoted]]
    ) -> None:
        """The release in each news item whose articles quote it; gone where none does any more."""

        stale = and_(EventDocument.url == release.url, EventDocument.source == SOURCE)
        if per_event:
            stale = and_(stale, EventDocument.event_id.notin_(list(per_event)))
        await session.execute(delete(EventDocument).where(stale))
        for event_id, quoted in per_event.items():
            ordered = sorted(
                quoted.values(), key=lambda q: (-len(q.quotes), -q.share, q.article_id)
            )
            details = {"quoted_by": [q.payload() for q in ordered]}
            await session.execute(
                insert(EventDocument)
                .values(
                    event_id=event_id,
                    term="",
                    source=SOURCE,
                    doc_type="Persbericht",
                    title=release.title[:1000],
                    url=release.url,
                    published_at=release.published_at,
                    location=release.organisation,
                    details=details,
                )
                .on_conflict_do_update(
                    constraint="uq_event_documents_event_url",
                    set_={"source": SOURCE, "doc_type": "Persbericht", "details": details},
                )
            )

    async def run(
        self, client: httpx.AsyncClient, *, days: int, limit: int = READ_LIMIT
    ) -> dict[str, Any]:
        started = time.monotonic()
        result: dict[str, Any] = {"read": await self.read_new(client, days=days, limit=limit)}
        result["match"] = await self.match(days=max(MATCH_DAYS, min(days, 60)))
        result["seconds"] = round(time.monotonic() - started, 2)
        return result
