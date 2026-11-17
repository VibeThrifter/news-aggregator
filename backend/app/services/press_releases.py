"""Citaat uit het persbericht (Stories 14.34 and 14.39): articles that quote a press release.

A quote in an article reads as something a person said to the reporter. Often it stands word for
word in the sender's own news release. Measured on 2026-11-16 with the comparison of "Zelfde
tekst" (Story 14.27): 13 of 59 releases of rijksoverheid.nl (2 to 21 October) came back word for
word in 21 articles. Running text taken over is rare (one article, De Telegraaf on Syria, 47 %); in
16 of the 21 articles it is a quote of eight or more words that stands in the release (the return
of art to Indonesia: two at NOS, De Telegraaf and Trouw each). A control with the articles of eight
days earlier found nothing. Story 14.39 added the senders of ``release_sites.SITES`` (OM, Politie,
Koninklijk Huis, Defensie, ProRail, Rechtspraak, CBS and others; the measurement is there).

The job reads the new releases of every sender (``release_sites``; the pages are public, those of
the Rijksoverheid CC0) and keeps their text (``press_releases``, local). For every release of the
last ``MATCH_DAYS`` days it compares the Dutch articles of two hours before to three days after it:

- **quotes**: a quote of at least ``QUOTE_MIN_WORDS`` words in the article that stands word for
  word in the release;
- **running text**: passages of 12+ words outside quotes in the same order (``copy_detection``),
  as a share of the article. The sender's boilerplate (word sequences in many of its releases, such
  as the Politie's "Wie meer weet, kan bellen met 0900-8844") does not count: an article that
  repeats the tip line has not taken over a release.

A release with a match goes into ``event_documents`` of the news item (source ``persbericht``) with
the articles and their quotes; the Tijdlijn shows it with "Letterlijk geciteerd door …" or "Tekst
overgenomen door …" and the sources list marks the article. It says what is there: the quote stands
in the release, not that the reporter did not speak to anyone. No LLM call.
"""

from __future__ import annotations

import asyncio
import math
import time
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import structlog
from sqlalchemy import and_, delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..core.config import get_settings
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
from .release_sites import (
    POLITIE_MAX_OFFSET,
    POLITIE_PAGE,
    SITES,
    ReleaseSite,
    newest_lastmod,
    parse_politie_page,
    parse_release,
    platform_sitemap_url,
    politie_days,
    politie_url,
    quiet_sites,
    sitemap_candidates,
    sitemap_news,
)

logger = structlog.get_logger(__name__)

SOURCE = "persbericht"
# Platform sitemaps of 100 addresses, about newest first; reading stops after this many in a row
# hold nothing as new as the window
SITEMAP_MAX = 80
SITEMAP_OLD_IN_A_ROW = 3
# Releases read per sender per run (a backfill with more days reads more runs)
READ_LIMIT = 40
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
# Boilerplate: a word sequence in at least BOILER_MIN of a sender's last BOILER_SAMPLE releases,
# and in at least BOILER_SHARE of them (a case the Politie reports three times shares sentences
# too); only with BOILER_MIN_RELEASES or more
BOILER_SAMPLE = 200
BOILER_MIN = 3
BOILER_SHARE = 0.03
BOILER_MIN_RELEASES = 6
BOILER_CACHE_SECONDS = 3600


# ---------------------------------------------------------------------------------------------
# Pure helpers


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


def article_quotes(content: str) -> list[tuple[str, str]]:
    """The quotes of an article of ``QUOTE_MIN_WORDS`` words or more: (their words, as written)."""

    found: list[tuple[str, str]] = []
    for match in QUOTES.finditer(content or ""):
        words = TOKEN.findall(match.group(0).lower())
        if len(words) < QUOTE_MIN_WORDS:
            continue
        quote = " ".join(match.group(0).strip("„“”\"‘’' ").split())
        if quote:
            found.append((f" {' '.join(words)} ", quote[:QUOTE_CHARS]))
    return found


def quotes_from(quotes: Iterable[tuple[str, str]], release_flat: str) -> list[str]:
    """The quotes that stand word for word in the release, each once."""

    found: list[str] = []
    for words, quote in quotes:
        if words in release_flat and quote not in found:
            found.append(quote)
            if len(found) == MAX_QUOTES:
                break
    return found


def quotes_in(content: str, release_flat: str) -> list[str]:
    return quotes_from(article_quotes(content), release_flat)


def compare(
    article_print: TextPrint,
    content: str,
    release: ReleaseText,
    quotes: list[tuple[str, str]] | None = None,
) -> tuple[list[str], float]:
    """(quotes from the release, share of the text outside quotes that is the release's).
    ``quotes`` are the article's own (``article_quotes``), when they are known already."""

    share = 0.0
    if (
        article_print.words >= MIN_ARTICLE_WORDS
        and len(article_print.grams & release.print.grams) >= MIN_RUN_GRAMS
    ):
        share = covered_words(cover(article_print, release.print)) / article_print.words
    return quotes_from(article_quotes(content) if quotes is None else quotes, release.flat), share


def boilerplate_grams(texts: list[str]) -> set[str]:
    """The word sequences a sender repeats in many releases (``BOILER_*``)."""

    if len(texts) < BOILER_MIN_RELEASES:
        return set()
    counts: Counter[str] = Counter()
    for value in texts:
        counts.update(text_print(value).grams)
    least = max(BOILER_MIN, math.ceil(BOILER_SHARE * len(texts)))
    return {gram for gram, n in counts.items() if n >= least}


def strip_boilerplate(release_print: TextPrint, boiler: set[str]) -> TextPrint:
    """The release without its sender's boilerplate: those sequences match nothing, so a passage
    does not run through them."""

    if not boiler:
        return release_print
    segments = [
        [gram if gram not in boiler else f"\x00{s}.{i}" for i, gram in enumerate(segment)]
        for s, segment in enumerate(release_print.segments)
    ]
    grams = {gram for segment in segments for gram in segment if not gram.startswith("\x00")}
    return TextPrint(segments=segments, grams=grams, words=release_print.words)


def release_text(release: Any, boiler: set[str]) -> ReleaseText:
    return ReleaseText(
        url=release.url,
        published_at=release.published_at,
        print=strip_boilerplate(text_print(release.text), boiler),
        flat=flat_words(release.text),
    )


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
    """Reads the new releases of every sender and marks the articles that quote them."""

    def __init__(self, *, session_factory: async_sessionmaker[AsyncSession] | None = None) -> None:
        self._session_factory = session_factory
        # When each sender was read last (monotonic seconds); big sitemaps are read hourly
        self._last_read: dict[str, float] = {}
        # Pages that gave no release (a video, a page without text): not fetched again
        self._no_release: set[str] = set()
        self._boiler: dict[str, tuple[float, set[str]]] = {}

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory or get_sessionmaker()

    # --- reading --------------------------------------------------------------------------------

    def _due(self, site: ReleaseSite, now: float, backfill: bool) -> bool:
        if site.kind == "politie" and not get_settings().press_releases_politie_enabled:
            return False
        last = self._last_read.get(site.key)
        return backfill or last is None or now - last >= site.every_minutes * 60 - 30

    async def read_new(
        self,
        client: httpx.AsyncClient,
        *,
        days: int,
        limit: int = READ_LIMIT,
        backfill: bool = False,
    ) -> dict[str, Any]:
        """Read the releases of the last ``days`` days that were not read yet, of every sender
        that is due. A sender that fails does not stop the others."""

        since = datetime.now(timezone.utc) - timedelta(days=days)
        async with self._sessions()() as session:
            known = set((await session.execute(select(PressRelease.url))).scalars())
        stats: dict[str, Any] = {"read": 0, "failed": 0, "sites": {}}
        now = time.monotonic()
        for site in SITES:
            if not self._due(site, now, backfill):
                continue
            try:
                if site.kind == "politie":
                    releases = await self._politie(since, days, known)
                    site_stats = await self._store_releases(site, releases)
                else:
                    todo = await self._candidates(client, site, since, known, limit)
                    site_stats = await self._fetch(client, site, todo)
            except Exception as exc:  # noqa: BLE001 - one sender down must not stop the others
                stats["sites"][site.key] = {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}
                logger.warning("press_release_site_failed", site=site.key, error=str(exc)[:200])
                continue
            self._last_read[site.key] = time.monotonic()
            known.update(site_stats.pop("urls", ()))
            stats["sites"][site.key] = site_stats
            stats["read"] += site_stats.get("read", 0)
            stats["failed"] += site_stats.get("failed", 0)
        return stats

    async def _candidates(
        self,
        client: httpx.AsyncClient,
        site: ReleaseSite,
        since: datetime,
        known: set[str],
        limit: int,
    ) -> list[tuple[str, datetime | None]]:
        todo: dict[str, datetime | None] = {}
        if site.kind == "platform":
            old_in_a_row = 0
            for n in range(1, SITEMAP_MAX + 1):
                response = await client.get(platform_sitemap_url(site, n))
                if response.status_code == 404:
                    break
                response.raise_for_status()
                for url, day in sitemap_news(response.text, site.base):
                    if day >= since - timedelta(days=1) and url not in known:
                        todo[url] = day
                newest = newest_lastmod(response.text)
                old_in_a_row = old_in_a_row + 1 if newest and newest < since.isoformat() else 0
                if old_in_a_row >= SITEMAP_OLD_IN_A_ROW or len(todo) >= limit:
                    break
        else:
            for sitemap in site.sitemaps:
                response = await client.get(sitemap)
                response.raise_for_status()
                for url, moment in sitemap_candidates(
                    response.text, site, since - timedelta(days=1)
                ):
                    if url not in known:
                        todo[url] = moment
        fresh = [(url, day) for url, day in todo.items() if url not in self._no_release]
        far_past = datetime(1970, 1, 1, tzinfo=timezone.utc)
        return sorted(fresh, key=lambda item: item[1] or far_past, reverse=True)[:limit]

    async def _fetch(
        self, client: httpx.AsyncClient, site: ReleaseSite, todo: list[tuple[str, datetime | None]]
    ) -> dict[str, Any]:
        releases = []
        failed = 0
        for i, (url, day) in enumerate(todo):
            if i:
                await asyncio.sleep(PAUSE_SECONDS)
            try:
                response = await client.get(url)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                failed += 1
                logger.warning(
                    "press_release_read_failed", site=site.key, url=url, error=str(exc)[:200]
                )
                continue
            release = parse_release(
                url, day, response.text, organisation=site.name, use_creator=site.use_creator
            )
            if release is None:
                self._no_release.add(url)
                continue
            releases.append(release)
        result = await self._store_releases(site, releases)
        result["failed"] = failed
        return result

    async def _politie(self, since: datetime, days: int, known: set[str]) -> list[dict[str, Any]]:
        """The Politie's news of the window from its open data API, through a browser."""

        from ..ingestion.playwright_fetch import get_browser_pool

        found: list[dict[str, Any]] = []
        # The browser's own user agent: the API refuses the pool's fixed one (403)
        async with get_browser_pool().get_context(own_user_agent=True) as context:
            page = await context.new_page()
            for day in politie_days(datetime.now(timezone.utc), days):
                offset = 0
                while offset <= POLITIE_MAX_OFFSET:
                    response = await page.request.get(politie_url(day, offset), timeout=30000)
                    if response.status != 200:
                        raise RuntimeError(f"Politie API answered {response.status}")
                    releases, last = parse_politie_page(await response.text())
                    found.extend(
                        r for r in releases if r["url"] not in known and r["published_at"] >= since
                    )
                    if last:
                        break
                    offset += POLITIE_PAGE
                    await asyncio.sleep(PAUSE_SECONDS)
        unique = {release["url"]: release for release in found}
        return list(unique.values())

    async def _store_releases(
        self, site: ReleaseSite, releases: list[dict[str, Any]]
    ) -> dict[str, Any]:
        # An old page whose lastmod changed (Ajax 2022, Rijkswaterstaat 2023) is kept too, with its
        # own date: it is then known and never fetched again, matching takes recent ones only
        if not releases:
            return {"read": 0, "urls": []}
        read_at = datetime.now(timezone.utc)
        async with self._sessions()() as session:
            for release in releases:
                await session.execute(
                    insert(PressRelease)
                    .values(publisher=site.key, read_at=read_at, **release)
                    .on_conflict_do_nothing(index_elements=[PressRelease.url])
                )
            await session.commit()
        return {"read": len(releases), "urls": [release["url"] for release in releases]}

    async def quiet(self) -> list[str]:
        """The senders whose newest release is older than their ``quiet_days``."""

        async with self._sessions()() as session:
            rows = (
                await session.execute(
                    select(PressRelease.publisher, func.max(PressRelease.published_at)).group_by(
                        PressRelease.publisher
                    )
                )
            ).all()
        newest = {publisher: last for publisher, last in rows}
        enabled = tuple(
            site
            for site in SITES
            if site.kind != "politie" or get_settings().press_releases_politie_enabled
        )
        return quiet_sites(newest, datetime.now(timezone.utc), enabled)

    # --- matching -------------------------------------------------------------------------------

    async def _boilerplate(self, session: AsyncSession, publisher: str) -> set[str]:
        cached = self._boiler.get(publisher)
        if cached and time.monotonic() - cached[0] < BOILER_CACHE_SECONDS:
            return cached[1]
        texts = list(
            (
                await session.execute(
                    select(PressRelease.text)
                    .where(PressRelease.publisher == publisher)
                    .order_by(PressRelease.published_at.desc())
                    .limit(BOILER_SAMPLE)
                )
            ).scalars()
        )
        boiler = boilerplate_grams(texts)
        self._boiler[publisher] = (time.monotonic(), boiler)
        return boiler

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
            boiler = {
                publisher: await self._boilerplate(session, publisher)
                for publisher in {release.publisher for release in releases}
            }
            start = min(release.published_at for release in releases) - BEFORE
            end = max(release.published_at for release in releases) + AFTER
            articles = (
                await session.execute(text(ARTICLES_SQL), {"start": start, "end": end})
            ).all()
        articles = sorted(articles, key=lambda row: row.published_at)
        prints: dict[int, TextPrint] = {}
        quotes: dict[int, list[tuple[str, str]]] = {}
        stats["releases"] = len(releases)
        for release in releases:
            target = release_text(release, boiler.get(release.publisher, set()))
            per_event: dict[int, dict[int, Quoted]] = defaultdict(dict)
            for row in articles:
                if row.published_at < release.published_at - BEFORE:
                    continue
                if row.published_at >= release.published_at + AFTER:
                    break
                if row.id not in prints:
                    prints[row.id] = text_print(row.content)
                    quotes[row.id] = article_quotes(row.content)
                found, share = compare(prints[row.id], row.content, target, quotes[row.id])
                if found or share > 0:
                    per_event[row.event_id][row.id] = Quoted(row.id, row.source_name, found, share)
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
        self,
        client: httpx.AsyncClient,
        *,
        days: int,
        limit: int = READ_LIMIT,
        backfill: bool = False,
    ) -> dict[str, Any]:
        started = time.monotonic()
        result: dict[str, Any] = {
            "read": await self.read_new(client, days=days, limit=limit, backfill=backfill)
        }
        result["match"] = await self.match(days=max(MATCH_DAYS, min(days, 60)))
        quiet = await self.quiet()
        if quiet:
            logger.warning("press_release_sites_quiet", sites=quiet)
        result["quiet"] = quiet
        result["seconds"] = round(time.monotonic() - started, 2)
        return result
