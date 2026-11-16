"""Achtergrondstukken buiten Bron (Story 14.31): Kamerstukken, and the documents articles link to.

Bron (Story 14.29) holds council documents, but no current national ones: Kamerbrieven,
Kamervragen, moties and amendments are not in it, and its Woo documents of the Rijk stop in 2025.
Two sources fill that gap, both without an LLM call:

- **Officiële bekendmakingen** (KOOP's SRU, ``repository.overheid.nl/sru``, no key). The search
  terms of the factual analysis are matched against the titles of Kamerstukken, Kamervragen,
  Handelingen and the Staatsblad of the last ``YEARS`` years, newest first. In the measurement of
  2026-11-15, 13 of 26 terms of October's news found documents about that news (Huize Soria: the
  Kamervragen of that week, warmtepompplicht: the motion to drop it). The Staatscourant is left
  out, because permits and archive transfers with the term in their title were all the noise.
  Notices of a delayed answer and "Beslisnota" attachments are left out as well.
- **The pages the articles link to** (Story 14.30), when a public body published them.
  - An officielebekendmakingen.nl identifier is looked up in the same SRU.
  - A Tweede Kamer document number is looked up in the Kamer's open data (``gegevensmagazijn``).
  - Any other page of a listed body gives its own title and date (DCTERMS, Open Graph).

  These documents are about the news for sure (an article rests on them), so no title filter
  applies.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET  # noqa: S405 - expat >= 2.4 resists entity expansion
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import structlog

logger = structlog.get_logger(__name__)

YEARS = 3

OB_SRU_URL = "https://repository.overheid.nl/sru"
OB_SOURCE = "officielebekendmakingen"
# Records the SRU returns per term; the title filter and the deduplication keep fewer
OB_SEARCH_LIMIT = 20
# National parliament and law; local publications are in Bron (obk), the Staatscourant was noise
OB_PUBLICATIONS = (
    "Kamerstuk",
    "Kamervragen (Aanhangsel)",
    "Kamervragen zonder antwoord",
    "Handelingen",
    "Staatsblad",
    "Niet-dossierstuk",
)
# "Uitstel beantwoording vragen …" (subrubriek Mededeling) and "Beslisnota bij …" (an attachment
# of a letter that is found itself) say nothing of their own
OB_SKIP_SUBSECTIONS = {"Mededeling"}
OB_SKIP_TITLE = re.compile(r"^\s*(?:Beslisnota|Uitstel beantwoording)", re.IGNORECASE)
# kst-36835-10, ah-tk-20252026-1948, kv-tk-2026Z06769, h-tk-20252026-12-5, blg-1223258, stb-2026-12
OB_IDENTIFIER = re.compile(
    r"/((?:kst|ah-tk|ah-ek|h-tk|h-ek|kv-tk|kv-ek|blg|stb|stcrt|trb|gmb|prb|wsb|bgr|nds-tk)"
    r"-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*?)(?:\.(?:html|pdf|xml|odt))?/?$",
    re.IGNORECASE,
)

TK_ODATA_URL = "https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/Document"
SOURCE_LINK = "link"
# 2026D57700: the number of a document of the Tweede Kamer (?did=…, /downloads/document?id=…)
TK_DOCUMENT_NUMBER = re.compile(r"^\d{4}D\d{3,6}$")

# Linked documents kept per news item: the ones more outlets link to first
MAX_LINKED = 6
# Characters read of a linked page: its head holds the title and the date
PAGE_READ_LIMIT = 400_000

NS = {
    "sru": "http://docs.oasis-open.org/ns/search-ws/sruResponse",
    "gzd": "http://standaarden.overheid.nl/sru",
    "dcterms": "http://purl.org/dc/terms/",
    "ow": "http://standaarden.overheid.nl/wetgeving/",
}

# Public bodies whose pages count as a document; the most specific host wins
PUBLIC_SITES: dict[str, str] = {
    "rijksoverheid.nl": "Rijksoverheid",
    "government.nl": "Rijksoverheid",
    "tweedekamer.nl": "Tweede Kamer",
    "eerstekamer.nl": "Eerste Kamer",
    "officielebekendmakingen.nl": "Officiële bekendmakingen",
    "wetten.overheid.nl": "Wetten.nl",
    "open.overheid.nl": "Open overheid",
    "raadvanstate.nl": "Raad van State",
    "rechtspraak.nl": "Rechtspraak",
    "om.nl": "Openbaar Ministerie",
    "politie.nl": "Politie",
    "cbs.nl": "CBS",
    "cpb.nl": "CPB",
    "pbl.nl": "PBL",
    "scp.nl": "SCP",
    "rivm.nl": "RIVM",
    "knmi.nl": "KNMI",
    "wodc.nl": "WODC",
    "rekenkamer.nl": "Algemene Rekenkamer",
    "nationaleombudsman.nl": "Nationale ombudsman",
    "onderzoeksraad.nl": "Onderzoeksraad voor Veiligheid",
    "autoriteitpersoonsgegevens.nl": "Autoriteit Persoonsgegevens",
    "acm.nl": "ACM",
    "afm.nl": "AFM",
    "dnb.nl": "DNB",
    "nctv.nl": "NCTV",
    "kiesraad.nl": "Kiesraad",
    "ec.europa.eu": "Europese Commissie",
    "europarl.europa.eu": "Europees Parlement",
    "consilium.europa.eu": "Raad van de EU",
    "eur-lex.europa.eu": "EUR-Lex",
    "europa.eu": "Europese Unie",
}


@dataclass(frozen=True)
class FoundDocument:
    term: str
    source: str
    doc_type: str | None
    title: str
    url: str
    published_at: datetime | None
    location: str | None
    # The same document under another URL (an officielebekendmakingen.nl .pdf and .html)
    key: str = ""

    @property
    def same_as(self) -> str:
        return self.key or self.url


# "2026-11-12T00:00:00+01:00", "start=2025-06-26;" (Rijksoverheid's DCTERMS.available)
ISO_DATE = re.compile(
    r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?"
)


def _parse_date(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    match = ISO_DATE.search(value)
    if not match:
        return None
    try:
        parsed = datetime.fromisoformat(match.group(0).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _words(value: str) -> str:
    """Lower case words only: "Handhaving- en Toezichtlocatie" → "handhaving en toezichtlocatie"."""
    return " ".join(re.sub(r"[^\w]+", " ", value.lower()).split())


def host_of(url: str) -> str:
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return ""
    return host.lower().removeprefix("www.")


def public_body(url: str) -> str | None:
    """The public body that published this page (PUBLIC_SITES), or None for any other site."""

    host = host_of(url)
    for site in sorted(PUBLIC_SITES, key=len, reverse=True):
        if host == site or host.endswith("." + site):
            return PUBLIC_SITES[site]
    return None


# ---------------------------------------------------------------------------------------------
# Officiële bekendmakingen (SRU)


def ob_search_query(term: str, since: date) -> str:
    kinds = " OR ".join(f'w.publicatienaam=="{name}"' for name in OB_PUBLICATIONS)
    return (
        f'c.product-area==officielepublicaties AND dt.title="{term}" '
        f"AND dt.date>={since.isoformat()} AND ({kinds}) sortBy dt.date/sort.descending"
    )


def ob_identifier(url: str) -> str | None:
    """The identifier in a link to officielebekendmakingen.nl (kst-32043-628), or None."""

    if not host_of(url).endswith("officielebekendmakingen.nl"):
        return None
    match = OB_IDENTIFIER.search(urlsplit(url).path)
    return match.group(1).lower() if match else None


def ob_kind(publication: str | None, subsection: str | None) -> str:
    """What a reader calls the document: Motie, Kamerbrief, Kamervragen, Antwoord op Kamervragen."""

    if publication == "Kamervragen (Aanhangsel)":
        return "Antwoord op Kamervragen" if subsection == "Antwoord" else "Kamervragen"
    if publication == "Kamervragen zonder antwoord":
        return "Kamervragen"
    if publication == "Handelingen":
        return "Kamerdebat"
    if publication in ("Staatsblad", "Staatscourant", "Gemeenteblad", "Provinciaal blad"):
        return publication
    if subsection in ("Motie", "Amendement", "Wetsvoorstel", "Verslag"):
        return subsection
    if subsection and subsection.startswith("Brief"):
        return "Kamerbrief"
    return "Kamerstuk"


def _short_creator(value: str | None) -> str | None:
    if not value:
        return None
    return value.replace(" der Staten-Generaal", "").strip()[:255] or None


def _text(element: ET.Element, path: str) -> str | None:
    found = element.find(path, NS)
    return found.text.strip() if found is not None and found.text and found.text.strip() else None


def ob_records(xml_text: str, term: str = "") -> list[FoundDocument]:
    """The records of an SRU response.

    With a term (a search) only the ones with the term in their title, and no notice of a delayed
    answer or attachment; without (a document an article links to) every record."""

    try:
        root = ET.fromstring(xml_text)  # noqa: S314 - see the import
    except ET.ParseError as exc:
        raise ValueError(f"SRU answer is no XML: {exc}") from exc
    needle = _words(term)
    found: list[FoundDocument] = []
    for record in root.iterfind(".//sru:record", NS):
        meta = record.find(".//ow:meta", NS)
        if meta is None:
            continue
        identifier = _text(meta, ".//dcterms:identifier")
        full_title = _text(meta, ".//dcterms:title") or ""
        title = _text(meta, ".//ow:documenttitel") or full_title
        subsection = _text(meta, ".//ow:subrubriek")
        if not identifier or not title:
            continue
        if needle and (
            needle not in _words(full_title)
            or subsection in OB_SKIP_SUBSECTIONS
            or OB_SKIP_TITLE.match(title)
        ):
            continue
        url = _text(record, ".//gzd:preferredUrl") or (
            f"https://zoek.officielebekendmakingen.nl/{identifier}.html"
        )
        found.append(
            FoundDocument(
                term=term,
                source=OB_SOURCE,
                doc_type=ob_kind(_text(meta, ".//ow:publicatienaam"), subsection),
                title=" ".join(title.split())[:1000],
                url=url[:2048],
                published_at=_parse_date(
                    _text(meta, ".//dcterms:date")
                    or _text(meta, ".//dcterms:issued")
                    or _text(meta, ".//dcterms:available")
                ),
                location=_short_creator(_text(meta, ".//dcterms:creator")),
                key=identifier.lower(),
            )
        )
    return found


async def search_ob(client: httpx.AsyncClient, term: str, now: datetime) -> list[FoundDocument]:
    """Kamerstukken, Kamervragen, Handelingen and Staatsblad with the term in their title."""

    since = date(now.year - YEARS, now.month, min(now.day, 28))
    response = await client.get(
        OB_SRU_URL,
        params={
            "query": ob_search_query(term, since),
            "maximumRecords": str(OB_SEARCH_LIMIT),
        },
    )
    response.raise_for_status()
    return ob_records(response.text, term)


async def lookup_ob(client: httpx.AsyncClient, identifiers: Sequence[str]) -> list[FoundDocument]:
    """The documents of these officielebekendmakingen.nl identifiers."""

    if not identifiers:
        return []
    ids = " OR ".join(f"dt.identifier=={identifier}" for identifier in identifiers)
    response = await client.get(
        OB_SRU_URL,
        params={
            "query": f"c.product-area==officielepublicaties AND ({ids})",
            "maximumRecords": str(len(identifiers)),
        },
    )
    response.raise_for_status()
    return ob_records(response.text)


# ---------------------------------------------------------------------------------------------
# Tweede Kamer (open data)


def tk_document_number(url: str) -> str | None:
    """The Kamer document number in a tweedekamer.nl link (?did=2026D57700), or None."""

    if not host_of(url).endswith("tweedekamer.nl"):
        return None
    query = parse_qs(urlsplit(url).query)
    for key in ("did", "id"):
        for value in query.get(key, []):
            if TK_DOCUMENT_NUMBER.match(value.strip()):
                return value.strip().upper()
    return None


def tk_documents(payload: Any, urls: dict[str, str]) -> list[FoundDocument]:
    """OData documents as found documents, each at the URL the article linked."""

    found: list[FoundDocument] = []
    for doc in (payload or {}).get("value") or []:
        number = str(doc.get("DocumentNummer") or "").upper()
        title = " ".join(str(doc.get("Onderwerp") or doc.get("Titel") or "").split())
        if number not in urls or not title:
            continue
        found.append(
            FoundDocument(
                term="",
                source=SOURCE_LINK,
                doc_type=(str(doc["Soort"])[:80] if doc.get("Soort") else None),
                title=title[:1000],
                url=urls[number],
                published_at=_parse_date(doc.get("Datum")),
                location="Tweede Kamer",
                key=number,
            )
        )
    return found


async def lookup_tk(client: httpx.AsyncClient, urls: dict[str, str]) -> list[FoundDocument]:
    """The Kamer documents of these numbers (number → the linked URL)."""

    if not urls:
        return []
    numbers = " or ".join(f"DocumentNummer eq '{number}'" for number in urls)
    response = await client.get(
        TK_ODATA_URL,
        params={"$filter": numbers, "$select": "DocumentNummer,Soort,Onderwerp,Titel,Datum"},
    )
    response.raise_for_status()
    return tk_documents(response.json(), urls)


# ---------------------------------------------------------------------------------------------
# Pages of other public bodies

# Meta names that hold the date a page was published, best first (never "modified": a law's
# consolidation or a page's last edit is not when the document came out)
DATE_META = (
    "dcterms.issued",
    "dcterms:issued",
    "dcterms.available",
    "dcterms.created",
    "dcterms.date",
    "dc.date",
    "article:published_time",
    "citation_publication_date",
    "date",
)
TITLE_META = ("og:title", "dcterms.title", "dcterms:title", "dc.title")
# /actueel/nieuws/2026/11/14/…, …-2026-10-28_en
URL_DATE = re.compile(r"(?:/|-)(20\d{2})[/-](\d{2})[/-](\d{2})(?:/|_|-|$)")


class _HeadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "meta":
            values = {key.lower(): (value or "") for key, value in attrs}
            name = (values.get("name") or values.get("property") or "").lower()
            if name and values.get("content") and name not in self.meta:
                self.meta[name] = values["content"].strip()
        elif tag == "title" and not self.title:
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def _clean_page_title(value: str) -> str:
    title = " ".join(value.split())
    # "Kabinet … | Rijksoverheid.nl": the site's name after the last bar
    if " | " in title:
        title = title.rsplit(" | ", 1)[0]
    return title.strip()


def page_document(html: str, url: str, final_url: str | None = None) -> FoundDocument | None:
    """Title and date of a public body's page; None when it has no title of its own."""

    if final_url and urlsplit(final_url).path in ("", "/"):
        return None  # the page moved and the site sent us to its home page
    parser = _HeadParser()
    try:
        parser.feed(html[:PAGE_READ_LIMIT])
    except Exception:  # pragma: no cover - a broken page has no title for us
        return None
    title = next((parser.meta[name] for name in TITLE_META if parser.meta.get(name)), parser.title)
    title = _clean_page_title(title)
    if not title:
        return None
    published = next(
        (parsed for name in DATE_META if (parsed := _parse_date(parser.meta.get(name)))), None
    )
    if published is None and (match := URL_DATE.search(urlsplit(url).path)):
        published = _parse_date("-".join(match.groups()))
    return FoundDocument(
        term="",
        source=SOURCE_LINK,
        doc_type=None,
        title=title[:1000],
        url=url[:2048],
        published_at=published,
        location=public_body(url),
    )


async def fetch_page_document(client: httpx.AsyncClient, url: str) -> FoundDocument | None:
    """A linked page of a public body; None when it cannot be read (a site down is no failure)."""

    try:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.debug("background_page_failed", url=url, error=str(exc)[:200])
        return None
    if "html" not in response.headers.get("content-type", ""):
        return None  # a pdf: no title or date to read
    return page_document(response.text, url, str(response.url))


# ---------------------------------------------------------------------------------------------
# A news item's links


def public_links(rows: Iterable[tuple[str | None, Sequence[str]]]) -> list[str]:
    """The links of a news item's articles to public bodies, the most outlets first.

    ``rows``: per article its outlet and its links (``source_metadata.links``)."""

    outlets: dict[str, set[str]] = {}
    for outlet, links in rows:
        for link in links:
            if isinstance(link, str) and public_body(link):
                outlets.setdefault(link, set()).add(outlet or "")
    # Stable: equal counts keep the order of appearance
    return sorted(outlets, key=lambda link: len(outlets[link]), reverse=True)


async def linked_documents(
    client: httpx.AsyncClient, links: Sequence[str], limit: int = MAX_LINKED
) -> list[FoundDocument]:
    """The documents behind a news item's public links, at most ``limit``, in the links' order.

    An SRU or OData failure raises (the next run tries again); a page that cannot be read is
    skipped."""

    chosen: list[str] = []
    keys: set[str] = set()
    for link in links:
        key = ob_identifier(link) or tk_document_number(link) or link
        if key not in keys:
            keys.add(key)
            chosen.append(link)
        if len(chosen) == limit:
            break

    ob_ids = {link: ident for link in chosen if (ident := ob_identifier(link))}
    tk_numbers = {number: link for link in chosen if (number := tk_document_number(link))}
    by_key: dict[str, FoundDocument] = {}
    for doc in await lookup_ob(client, sorted(set(ob_ids.values()))):
        by_key[doc.key] = doc
    for doc in await lookup_tk(client, tk_numbers):
        by_key[doc.key] = doc

    found: list[FoundDocument] = []
    for link in chosen:
        if link in ob_ids:
            doc = by_key.get(ob_ids[link])
            # At the URL the article linked: the event page shows which outlets link to it
            found.extend([replace(doc, url=link[:2048])] if doc else [])
        elif (number := tk_document_number(link)) is not None:
            found.extend([by_key[number]] if number in by_key else [])
        else:
            doc = await fetch_page_document(client, link)
            found.extend([doc] if doc else [])
    return found
