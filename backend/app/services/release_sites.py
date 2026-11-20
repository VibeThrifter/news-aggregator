"""Persberichten van meer afzenders (Story 14.39): where the press releases come from.

Story 14.34 read the news releases of rijksoverheid.nl. Measured on 2026-11-16 (releases of 6 to 18
October, 733 releases of 44 organisations against 8,118 articles, a control window ten days earlier
with one hit): besides the Rijksoverheid (25 % of its releases came back word for word) the
Koninklijk Huis (22 %), the OM (15 %), Defensie (12 %), ProRail (10 %) and the Politie (7 %) did;
the Rechtspraak and the CBS a little; companies, the ANP press portal, NGOs, universities and
parties hardly. These are the sites that can be read without a page reader of their own:

- **platform**: the sites of the Rijksoverheid's own system (rijksoverheid.nl, om.nl,
  koninklijkhuis.nl, nvwa.nl, rekenkamer.nl, nctv.nl, igj.nl). Numbered sitemaps of 100 addresses,
  newest first; a release has its day in the address and ``DCTERMS.issued`` on the page.
- **sitemap**: one sitemap (or a news sitemap of the last days) with ``lastmod``; the release's
  time comes from the page (``datePublished``, else the date trafilatura reads).
- **politie**: politie.nl refuses plain HTTP clients (Akamai, also robots.txt); its open data API
  (``api.politie.nl/v4/nieuws``) answers a browser, so the backend's Playwright pool reads it. The
  API gives the whole text, so no page is fetched.

Pure helpers here; reading, storing and matching are in ``press_releases``.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Literal
from zoneinfo import ZoneInfo

AMSTERDAM = ZoneInfo("Europe/Amsterdam")

Kind = Literal["platform", "sitemap", "politie"]


@dataclass(frozen=True, slots=True)
class ReleaseSite:
    """One sender of press releases."""

    # press_releases.publisher (at most 40 characters)
    key: str
    # The organisation the Tijdlijn names ("Persbericht · Openbaar Ministerie")
    name: str
    kind: Kind
    base: str
    # sitemap kind: the sitemaps to read
    sitemaps: tuple[str, ...] = ()
    # sitemap kind: an address of a news release matches this
    news: str = ""
    # Read at most this often (big sitemaps hourly, news sitemaps and the platform every run)
    every_minutes: int = 15
    # The quiet check reports a site whose newest release is older than this
    quiet_days: int = 3
    # The page names the organisation (rijksoverheid.nl: the ministry). On om.nl and
    # koninklijkhuis.nl ``DCTERMS.creator`` is the ministry above it, so those keep their own name
    use_creator: bool = False
    # Story 14.40: also put the release in news it is about when no outlet quotes it. Off for a
    # club's match pages (Ajax): about the same match, rarely the news (6 of 8 pairs "verwant")
    about: bool = True


SITES: tuple[ReleaseSite, ...] = (
    ReleaseSite(
        "rijksoverheid",
        "Rijksoverheid",
        "platform",
        "https://www.rijksoverheid.nl",
        quiet_days=2,
        use_creator=True,
    ),
    ReleaseSite("om", "Openbaar Ministerie", "platform", "https://www.om.nl", quiet_days=2),
    ReleaseSite(
        "koninklijkhuis",
        "Koninklijk Huis",
        "platform",
        "https://www.koninklijkhuis.nl",
        quiet_days=10,
    ),
    ReleaseSite("nvwa", "NVWA", "platform", "https://www.nvwa.nl", quiet_days=4),
    ReleaseSite(
        "rekenkamer", "Algemene Rekenkamer", "platform", "https://www.rekenkamer.nl", quiet_days=30
    ),
    ReleaseSite("nctv", "NCTV", "platform", "https://www.nctv.nl", quiet_days=30),
    ReleaseSite(
        "igj", "Inspectie Gezondheidszorg en Jeugd", "platform", "https://www.igj.nl", quiet_days=14
    ),
    ReleaseSite(
        "politie", "Politie", "politie", "https://www.politie.nl", every_minutes=30, quiet_days=1
    ),
    ReleaseSite(
        "defensie",
        "Defensie",
        "sitemap",
        "https://www.defensie.nl",
        sitemaps=("https://www.defensie.nl/sitemap.xml",),
        news=r"^https://www\.defensie\.nl/nieuws/\d{8}-",
        every_minutes=60,
        quiet_days=5,
    ),
    ReleaseSite(
        "prorail",
        "ProRail",
        "sitemap",
        "https://www.prorail.nl",
        sitemaps=("https://www.prorail.nl/nieuws-Sitemap.xml",),
        news=r"^https://www\.prorail\.nl/nieuws/[^/]+$",
        every_minutes=60,
        quiet_days=4,
    ),
    ReleaseSite(
        "rechtspraak",
        "Rechtspraak",
        "sitemap",
        "https://www.rechtspraak.nl",
        sitemaps=("https://www.rechtspraak.nl/sitemap-news.xml",),
        news=r"/nieuws/\d{4}/\d{2}/",
        quiet_days=3,
    ),
    ReleaseSite(
        "cbs",
        "CBS",
        "sitemap",
        "https://www.cbs.nl",
        sitemaps=("https://www.cbs.nl/nl-nl/sitemaps/newssitemap",),
        news=r"^https://www\.cbs\.nl/nl-nl/nieuws/\d{4}/\d{2}/",
        quiet_days=4,
    ),
    ReleaseSite(
        "raadvanstate",
        "Raad van State",
        "sitemap",
        "https://www.raadvanstate.nl",
        sitemaps=("https://www.raadvanstate.nl/sitemap.xml",),
        news=r"^https://www\.raadvanstate\.nl/actueel/nieuws/[^/]+/[^/]+/?$",
        every_minutes=60,
        quiet_days=21,
    ),
    ReleaseSite(
        "ombudsman",
        "Nationale ombudsman",
        "sitemap",
        "https://www.nationaleombudsman.nl",
        sitemaps=("https://www.nationaleombudsman.nl/sitemap.xml?page=1",),
        news=r"^https://www\.nationaleombudsman\.nl/nieuws/(?!column/)[^?]+/[^/?]+$",
        every_minutes=60,
        quiet_days=30,
    ),
    ReleaseSite(
        "tweedekamer",
        "Tweede Kamer",
        "sitemap",
        "https://www.tweedekamer.nl",
        sitemaps=("https://www.tweedekamer.nl/sitemap.xml?page=1",),
        news=r"^https://www\.tweedekamer\.nl/nieuws/kamernieuws/[^/]+$",
        every_minutes=60,
        quiet_days=14,
    ),
    ReleaseSite(
        "rijkswaterstaat",
        "Rijkswaterstaat",
        "sitemap",
        "https://www.rijkswaterstaat.nl",
        sitemaps=("https://www.rijkswaterstaat.nl/sitemap.xml",),
        news=r"^https://www\.rijkswaterstaat\.nl/nieuws/archief/\d{4}/\d{2}/",
        every_minutes=60,
        quiet_days=5,
    ),
    ReleaseSite(
        "ajax",
        "Ajax",
        "sitemap",
        "https://www.ajax.nl",
        sitemaps=("https://www.ajax.nl/sitemap",),
        news=r"^https://www\.ajax\.nl/artikelen/[^/]+/?$",
        every_minutes=60,
        quiet_days=5,
        about=False,
    ),
)
SITE_BY_KEY = {site.key: site for site in SITES}


@lru_cache(maxsize=64)
def _compiled(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern)


# ---------------------------------------------------------------------------------------------
# Times


def parse_when(value: str | None) -> datetime | None:
    """An ISO date or time as an aware UTC time; a date alone is midnight UTC (the Tijdlijn shows
    no clock for it)."""

    value = (value or "").strip()
    if not value:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        try:
            return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    # "2026-11-16T15:20:08.8000000Z" (seven decimals) and "2026-10-26T12:03+01:00"
    value = re.sub(r"(\.\d{6})\d+", r"\1", value.replace("Z", "+00:00"))
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=AMSTERDAM)).astimezone(timezone.utc)


_URL_DAY = re.compile(r"/(\d{4})/(\d{2})/(\d{2})/|/(\d{4})(\d{2})(\d{2})-")


def url_day(url: str) -> datetime | None:
    """The day an address carries (/2026/10/30/… or /20261030-…), midnight UTC."""

    match = _URL_DAY.search(url)
    if not match:
        return None
    parts = [int(part) for part in match.groups() if part]
    try:
        return datetime(parts[0], parts[1], parts[2], tzinfo=timezone.utc)
    except ValueError:
        return None


# ---------------------------------------------------------------------------------------------
# Sitemaps

_PLATFORM_NEWS = r"/actueel/nieuws/(\d{{4}})/(\d{{2}})/(\d{{2}})/[^<\s]+"
_URL_ENTRY = re.compile(r"<url>(.*?)</url>", re.S)
_LOC = re.compile(r"<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)")
_LASTMOD = re.compile(r"<lastmod>\s*([^<\s]+)\s*</lastmod>")
_NEWS_DATE = re.compile(r"<news:publication_date>\s*([^<\s]+)\s*</news:publication_date>")
# An undated address counts only in a small sitemap (a news sitemap of the last days)
UNDATED_SITEMAP_MAX = 200


def platform_sitemap_url(site: ReleaseSite, n: int) -> str:
    return f"{site.base}/sitemap/{n}.xml"


def sitemap_news(
    xml: str, base: str = "https://www.rijksoverheid.nl"
) -> list[tuple[str, datetime]]:
    """The news releases in one sitemap of the platform: (address, the day in the address)."""

    pattern = _compiled(r"<loc>\s*(" + re.escape(base) + _PLATFORM_NEWS.format() + r")\s*</loc>")
    found = []
    for match in pattern.finditer(xml):
        year, month, day = (int(part) for part in match.group(2, 3, 4))
        try:
            found.append((match.group(1), datetime(year, month, day, tzinfo=timezone.utc)))
        except ValueError:
            continue
    return found


def newest_lastmod(xml: str) -> str | None:
    values = _LASTMOD.findall(xml)
    return max(values) if values else None


def sitemap_candidates(
    xml: str, site: ReleaseSite, since: datetime
) -> list[tuple[str, datetime | None]]:
    """The news releases of a sitemap changed since ``since``: (address, its time in the sitemap).
    A news sitemap gives ``news:publication_date``, others ``lastmod``."""

    entries = _URL_ENTRY.findall(xml)
    news = _compiled(site.news)
    found: list[tuple[str, datetime | None]] = []
    for entry in entries:
        loc = _LOC.search(entry)
        if not loc or not news.search(loc.group(1)):
            continue
        stamp = _NEWS_DATE.search(entry) or _LASTMOD.search(entry)
        moment = parse_when(stamp.group(1)) if stamp else None
        if moment is None:
            moment = url_day(loc.group(1))
            if moment is None and len(entries) > UNDATED_SITEMAP_MAX:
                continue
        if moment is None or moment >= since:
            found.append((html.unescape(loc.group(1)), moment))
    return found


# ---------------------------------------------------------------------------------------------
# Pages

_META = re.compile(
    r"""<meta\s+(?:name|property|itemprop)=["']([^"']+)["']\s+content=["']([^"']*)["']""",
    re.IGNORECASE,
)
_DATE_PUBLISHED = re.compile(r'"datePublished"\s*:\s*"([^"]+)"')
# " | Rijksoverheid.nl" after a title
_SITE_SUFFIX = re.compile(r"\s*\|\s*[\w.-]+\.nl\s*$", re.IGNORECASE)
MIN_RELEASE_WORDS = 20


def release_meta(page: str) -> dict[str, str]:
    """The meta tags of a page by name, also lower case (``dcterms.title`` on tweedekamer.nl)."""

    meta: dict[str, str] = {}
    for name, value in _META.findall(page):
        meta.setdefault(name, html.unescape(value))
        meta.setdefault(name.lower(), html.unescape(value))
    return meta


def clean_title(title: str, names: tuple[str | None, ...] = ()) -> str:
    """A title without the site after it ("… | Rijksoverheid.nl", "… | Openbaar Ministerie"); a
    pipe inside a title stays ("Highlights Ajax - AZ | Belangrijke driepunter")."""

    title = _SITE_SUFFIX.sub("", title).strip()
    head, sep, tail = title.rpartition(" | ")
    if sep and head and tail.strip().lower() in {name.strip().lower() for name in names if name}:
        return head.strip()
    return title


def release_published(
    page: str, meta: dict[str, str], extracted_date: str | None
) -> datetime | None:
    """When a release appeared: ``DCTERMS.issued``, ``article:published_time`` or the
    ``datePublished`` of its structured data; else the date trafilatura reads on the page."""

    for value in (
        meta.get("dcterms.issued"),
        meta.get("article:published_time"),
        *_DATE_PUBLISHED.findall(page)[:1],
        extracted_date,
    ):
        moment = parse_when(value)
        if moment is not None:
            return moment
    return None


def parse_release(
    url: str,
    day: datetime | None,
    page: str,
    *,
    organisation: str | None = None,
    use_creator: bool = True,
) -> dict[str, Any] | None:
    """Title, organisation, time and text of a release page; None without text. ``day`` is the
    time the address or the sitemap gives, for a page that says nothing itself."""

    import trafilatura

    # Not ``with_metadata``: in trafilatura 1.9 that drops a page without a date or title; the
    # metadata (also the date) is read anyway
    extracted = trafilatura.bare_extraction(
        page, url=url, include_comments=False, include_tables=False
    )
    if extracted is not None and not isinstance(extracted, dict):
        extracted = extracted.as_dict() if hasattr(extracted, "as_dict") else vars(extracted)
    body = (extracted or {}).get("text") or ""
    if len(body.split()) < MIN_RELEASE_WORDS:
        return None
    meta = release_meta(page)
    title = (
        meta.get("dcterms.title") or meta.get("og:title") or (extracted or {}).get("title") or ""
    )
    title = clean_title(title, (organisation, meta.get("og:site_name")))
    published = release_published(page, meta, (extracted or {}).get("date")) or day or url_day(url)
    if published is None:
        return None
    creator = meta.get("dcterms.creator") if use_creator else None
    return {
        "url": url,
        "title": title or url.rstrip("/").rsplit("/", 1)[-1].replace("-", " "),
        "organisation": (creator or organisation or None),
        "published_at": published,
        "text": body,
    }


# ---------------------------------------------------------------------------------------------
# Politie (open data API)

POLITIE_API = "https://api.politie.nl/v4/nieuws"
POLITIE_PAGE = 25
# The API answers a day at most this far (200 items per query)
POLITIE_MAX_OFFSET = 200
_TAG = re.compile(r"<[^>]+>")


def _clean(value: str | None) -> str:
    # The API escapes its HTML twice ("&lt;p&gt;")
    text = html.unescape(html.unescape(value or ""))
    return re.sub(r"\s+", " ", _TAG.sub(" ", text)).strip()


def politie_url(day: datetime, offset: int) -> str:
    stamp = day.strftime("%Y%m%d")
    return (
        f"{POLITIE_API}?language=nl&fromdate={stamp}&todate={stamp}"
        f"&maxnumberofitems={POLITIE_PAGE}&offset={offset}"
    )


def politie_release(item: dict[str, Any]) -> dict[str, Any] | None:
    """A news item of the Politie API as a release; None without an address, time or text."""

    url = (item.get("url") or "").strip()
    stamp = (item.get("publicatiedatum") or "").strip()
    paragraphs = [
        _clean(paragraph.get("opgemaaktetekst")) for paragraph in item.get("alineas") or []
    ]
    body = " ".join(part for part in [_clean(item.get("introductie")), *paragraphs] if part)
    if not url or not stamp or len(body.split()) < MIN_RELEASE_WORDS:
        return None
    try:
        local = datetime.strptime(stamp[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return {
        "url": url,
        "title": _clean(item.get("titel")) or url.rsplit("/", 1)[-1],
        "organisation": "Politie",
        "published_at": local.replace(tzinfo=AMSTERDAM).astimezone(timezone.utc),
        "text": body,
    }


def politie_days(now: datetime, days: int) -> list[datetime]:
    """The days to ask the API for, today first (in Dutch time)."""

    today = now.astimezone(AMSTERDAM).date()
    return [
        datetime(today.year, today.month, today.day) - timedelta(days=n) for n in range(days + 1)
    ]


def parse_politie_page(payload: str | dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """The releases of one API answer and whether it was the last page."""

    data = json.loads(payload) if isinstance(payload, str) else payload
    items = data.get("nieuwsberichten") or []
    releases = [release for release in (politie_release(item) for item in items) if release]
    last = bool((data.get("iterator") or {}).get("last")) or not items
    return releases, last


# ---------------------------------------------------------------------------------------------
# Quiet check


def quiet_sites(
    newest: dict[str, datetime | None], now: datetime, sites: tuple[ReleaseSite, ...] = SITES
) -> list[str]:
    """The sites whose newest stored release is older than their ``quiet_days`` (or that have
    none): a reader that stopped working (a site changed its pages) says nothing by itself."""

    quiet = []
    for site in sites:
        last = newest.get(site.key)
        if last is None or now - last > timedelta(days=site.quiet_days):
            quiet.append(site.key)
    return quiet
