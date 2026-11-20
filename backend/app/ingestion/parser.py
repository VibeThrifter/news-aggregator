"""HTML parsing helpers using Trafilatura for article normalization."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from textwrap import shorten
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import trafilatura

from backend.app.core.logging import get_logger

logger = get_logger(__name__)


class ArticleParseError(Exception):
    """Raised when article parsing fails."""


@dataclass
class ArticleParseResult:
    """Normalized article content returned by the parser."""

    text: str
    summary: str
    # Pages of other sites the article text links to (not the menu or footer): the documents,
    # reports and statements it rests on. Outlets that link to the same page share that source.
    links: list[str] = field(default_factory=list)


def _fallback_summary(text: str, max_chars: int = 320) -> str:
    clean = " ".join(text.split())
    if not clean:
        return ""
    return shorten(clean, width=max_chars, placeholder="…")


# Text that is page code rather than an article (a paywall widget as JSON, De Telegraaf): quotes,
# braces and backslashes make up a large share of it, which they never do in sentences.
_CODE_CHARS = frozenset('{}[]"\\')
_CODE_SHARE = 0.08


def looks_like_code(text: str) -> bool:
    """True when extracted text is mostly code, such as the JSON of a paywall."""
    sample = text[:2000]
    if not sample:
        return False
    return sum(1 for char in sample if char in _CODE_CHARS) / len(sample) > _CODE_SHARE


# Blocks inside an article that are no article text, and that the extraction returned instead of
# the article: NU.nl's "Stel een vraag" (log in to ask a question). With that block on the page
# the stored text of 38 of 228 NU.nl articles in a week was the block (2026-11-19).
_FURNITURE_XPATH = '//*[contains(@class, "qa-block-login-wall")]'


def _line_breaks(text: str) -> str:
    """Give a text its line breaks back when they come written out as backslash-n.

    The extraction takes the text of some pages from the page's data (JSON-LD ``articleBody``)
    without decoding it: half of the NU.nl texts since October 2026 had a written-out
    backslash-n between their paragraphs and no line break at all, so the end of one paragraph
    and the start of the next came out as one name ("blokkade\\nDe", "eindigen.\\nMaandag").
    """

    if "\\n" in text and "\n" not in text:
        return text.replace("\\n", "\n")
    return text


_LD_JSON = re.compile(
    r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)
# A text the page's data gives is the article from this length on (a teaser is shorter)
PAGE_DATA_MIN_CHARS = 200


def page_data_text(html: str) -> Optional[str]:
    """The article text as the page's own data gives it (JSON-LD ``articleBody``), or None.

    The publisher writes it for search engines: the whole article, without the blocks around
    and inside it.
    """

    def bodies(node: object):
        if isinstance(node, dict):
            body = node.get("articleBody")
            if isinstance(body, str):
                yield body
            for value in node.values():
                yield from bodies(value)
        elif isinstance(node, list):
            for value in node:
                yield from bodies(value)

    best = ""
    for block in _LD_JSON.findall(html):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        for body in bodies(data):
            lines = [" ".join(line.split()) for line in body.splitlines()]
            body = "\n".join(line for line in lines if line)
            if len(body) > len(best):
                best = body
    return best if len(best) >= PAGE_DATA_MIN_CHARS else None


def parse_article_html(
    html: str, *, url: Optional[str] = None, page_data: bool = False
) -> ArticleParseResult:
    """Parse raw HTML into normalized text and summary using Trafilatura.

    ``page_data``: take the text from the page's own data when it has it (a source whose profile
    says ``parser: page_data``). On NU.nl the extraction finds the article only through that
    data, and returned a block of the page instead whenever one held enough text: "Stel een
    vraag", or the readers' comments that come under an article later (2026-11-19).
    """

    if not html or not html.strip():
        raise ArticleParseError("Empty HTML payload received")

    own_text = page_data_text(html) if page_data else None
    extraction = trafilatura.extract(
        html,
        include_comments=False,
        include_tables=False,
        include_images=False,
        favor_recall=True,
        output_format="json",
        prune_xpath=_FURNITURE_XPATH,
    )

    if not extraction and own_text is None:
        logger.warning("article_parse_failed", url=url, reason="empty_extraction")
        raise ArticleParseError("Trafilatura returned no content")

    try:
        data = json.loads(extraction) if extraction else {}
    except json.JSONDecodeError as exc:
        logger.warning("article_parse_failed", url=url, reason="invalid_json", error=str(exc))
        raise ArticleParseError("Failed to decode trafilatura JSON output") from exc

    text = own_text or _line_breaks((data.get("text") or data.get("raw_text") or "").strip())
    if not text:
        logger.warning("article_parse_failed", url=url, reason="no_text")
        raise ArticleParseError("Article contains no readable text")
    if looks_like_code(text):
        logger.warning("article_parse_failed", url=url, reason="looks_like_code")
        raise ArticleParseError("Extracted text is page code (paywall?), not an article")

    summary = (data.get("summary") or data.get("title") or "").strip()
    if not summary:
        summary = _fallback_summary(text)

    return ArticleParseResult(text=text, summary=summary, links=extract_links(html, url=url))


# At most this many links per article; a live blog can hold hundreds
LINK_LIMIT = 20
# Sharing buttons and "volg ons" links inside the text are no source
_SHARE_LINK = re.compile(
    r"^https?://(?:[\w-]+\.)*(?:"
    r"facebook\.com/(?:sharer|share|dialog)|(?:twitter|x)\.com/(?:intent|share)|wa\.me/|api\.whatsapp\.com/"
    r"|(?:www\.)?linkedin\.com/(?:share|sharing|shareArticle)|t\.me/share|reddit\.com/submit"
    r"|pinterest\.\w+/pin/create|news\.google\.com/publications|whatsapp\.com/channel"
    r"|google\.\w+/preferences/source"
    r")",
    re.IGNORECASE,
)
# Tracking parameters: the same page with another campaign tag is the same page
_TRACKING_PARAM = re.compile(
    r"^(?:utm_\w+|fbclid|gclid|mc_cid|mc_eid|at_\w+|xtor|ref_src)$", re.IGNORECASE
)
_REF_TARGET = re.compile(r'<ref target="([^"]+)"')
# Two-letter country domains with a second level (bbc.co.uk, abc.net.au)
_SECOND_LEVEL = {"co", "com", "net", "org", "gov", "ac", "edu"}


def site_of(host: str) -> str:
    """The registrable part of a host name: nos.nl for www.nos.nl, bbc.co.uk for www.bbc.co.uk."""
    labels = host.lower().rstrip(".").split(".")
    if labels and labels[0] == "www":
        labels = labels[1:]
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def clean_link(link: str) -> Optional[str]:
    """The link without fragment and tracking parameters; None when it is no web page."""
    try:
        parts = urlsplit(link.strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    # A post on X is the same post whoever shared it (?s=20, ?t=...)
    if site_of(parts.hostname) in ("x.com", "twitter.com"):
        return urlunsplit(("https", "x.com", parts.path, "", ""))
    params = parse_qsl(parts.query, keep_blank_values=True)
    query = urlencode([(key, value) for key, value in params if not _TRACKING_PARAM.match(key)])
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path or "/", query, ""))


def extract_links(html: str, *, url: Optional[str] = None) -> list[str]:
    """Links in the article text to pages of other sites, in order of appearance.

    Only the text Trafilatura takes as the article counts, so menus, footers and "lees ook"
    blocks around it stay out. Links to the outlet's own site and sharing buttons are left out.
    """
    try:
        extraction = trafilatura.extract(
            html,
            url=url,
            include_comments=False,
            include_tables=False,
            include_images=False,
            include_links=True,
            favor_recall=True,
            output_format="xml",
        )
    except Exception as exc:  # pragma: no cover - the text is what matters, links are extra
        logger.warning("article_links_failed", url=url, error=str(exc))
        return []
    if not extraction:
        return []

    own_site = site_of(urlsplit(url).hostname or "") if url else ""
    links: list[str] = []
    for target in _REF_TARGET.findall(extraction):
        link = clean_link(target.replace("&amp;", "&"))
        if not link or _SHARE_LINK.match(link):
            continue
        if own_site and site_of(urlsplit(link).hostname or "") == own_site:
            continue
        if link not in links:
            links.append(link)
        if len(links) >= LINK_LIMIT:
            break
    return links


class _HTMLStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []

    def handle_data(self, data: str) -> None:  # pragma: no cover - simple extractor
        if data:
            self._chunks.append(data)

    def get_text(self) -> str:
        return " ".join(chunk.strip() for chunk in self._chunks if chunk.strip())


def naive_extract_text(html: str) -> str:
    """Simplistic fallback extractor for sources where Trafilatura fails."""

    stripper = _HTMLStripper()
    try:
        stripper.feed(html)
    except Exception:  # pragma: no cover - defensive fallback
        return ""
    return stripper.get_text()
