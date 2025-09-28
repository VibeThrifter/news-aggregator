"""HTML parsing helpers using Trafilatura for article normalization."""

from __future__ import annotations

import json
from dataclasses import dataclass
from textwrap import shorten
from typing import Optional

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


def _fallback_summary(text: str, max_chars: int = 320) -> str:
    clean = " ".join(text.split())
    if not clean:
        return ""
    return shorten(clean, width=max_chars, placeholder="…")


def parse_article_html(html: str, *, url: Optional[str] = None) -> ArticleParseResult:
    """Parse raw HTML into normalized text and summary using Trafilatura."""

    if not html or not html.strip():
        raise ArticleParseError("Empty HTML payload received")

    extraction = trafilatura.extract(
        html,
        include_comments=False,
        include_tables=False,
        include_images=False,
        favor_recall=True,
        output_format="json",
    )

    if not extraction:
        logger.warning("article_parse_failed", url=url, reason="empty_extraction")
        raise ArticleParseError("Trafilatura returned no content")

    try:
        data = json.loads(extraction)
    except json.JSONDecodeError as exc:
        logger.warning("article_parse_failed", url=url, reason="invalid_json", error=str(exc))
        raise ArticleParseError("Failed to decode trafilatura JSON output") from exc

    text = (data.get("text") or data.get("raw_text") or "").strip()
    if not text:
        logger.warning("article_parse_failed", url=url, reason="no_text")
        raise ArticleParseError("Article contains no readable text")

    summary = (data.get("summary") or data.get("title") or "").strip()
    if not summary:
        summary = _fallback_summary(text)

    return ArticleParseResult(text=text, summary=summary)
