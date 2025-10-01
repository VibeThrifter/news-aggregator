#!/usr/bin/env python3
"""Quick RSS probe for validating feed connectivity during development.

Run with:
    python scripts/test_rss_feeds.py --limit 3 --reader nos_rss
    python scripts/test_rss_feeds.py --reader nos_rss --limit 1 --show-content --content-limit 0

Environment variables (see `.env.example`) control which feeds are registered.
This script only fetches and prints feed items; it does **not** persist to the DB.
Use `--show-content` to fetch and display extracted article text (via Trafilatura).
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime
import sys
from pathlib import Path
from typing import Iterable, Sequence, Optional

import httpx
import structlog

# Ensure repository root is on import path when executed directly.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.services.ingest_service import IngestService
from backend.app.feeds.base import FeedReader, FeedReaderError, FeedItem
from backend.app.core.logging import configure_logging
from backend.app.ingestion import (
    ArticleFetchError,
    ArticleParseError,
    fetch_article_html,
    parse_article_html,
)
from backend.app.ingestion import SourceProfile, load_source_profiles

LOGGER = structlog.get_logger(__name__)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fetch RSS feeds via configured readers")
    parser.add_argument(
        "--reader",
        dest="readers",
        action="append",
        default=None,
        help="Limit run to one or more reader IDs (e.g. nos_rss). Can be repeated.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=3,
        help="Number of items to display per feed (default: 3)",
    )
    parser.add_argument(
        "--show-summary",
        action="store_true",
        help="Print the summary/description if available",
    )
    parser.add_argument(
        "--show-content",
        action="store_true",
        help="Fetch and display extracted article content (may take longer)",
    )
    parser.add_argument(
        "--content-limit",
        type=int,
        default=800,
        help="Max characters of article content to show with --show-content (default 800, 0 = unlimited)",
    )
    parser.add_argument(
        "--no-logs",
        action="store_true",
        help="Disable structlog configuration (falls back to service defaults)",
    )
    return parser


async def _fetch_reader(reader_id: str, reader: FeedReader) -> list[FeedItem]:
    LOGGER.debug("fetching_reader", reader_id=reader_id, feed_url=reader.feed_url)
    async with reader:
        items = await reader.fetch()
    LOGGER.info("reader_ok", reader_id=reader_id, item_count=len(items))
    return items


async def _get_article_content(
    item: FeedItem,
    client: httpx.AsyncClient,
    *,
    limit: int,
    profile: Optional[SourceProfile],
) -> str | None:
    try:
        html = await fetch_article_html(
            item.url,
            client=client,
            profile=profile,
            logger=LOGGER.bind(article_url=item.url),
        )
    except ArticleFetchError as exc:
        LOGGER.warning("article_content_fetch_failed", url=item.url, error=str(exc))
        return f"[content fetch failed: {exc}]"

    try:
        parsed = parse_article_html(html, url=item.url)
    except ArticleParseError as exc:
        LOGGER.warning("article_content_parse_failed", url=item.url, error=str(exc))
        return f"[content parse failed: {exc}]"

    text = parsed.text
    if limit and limit > 0 and len(text) > limit:
        return text[:limit].rstrip() + "…"
    return text


def _format_item(item: FeedItem, *, show_summary: bool, content: str | None = None) -> str:
    published = item.published_at.isoformat() if isinstance(item.published_at, datetime) else "?"
    line = f"- {item.title} | {published}\n  {item.url}"
    if show_summary and item.summary:
        summary = item.summary.replace("\n", " ")
        line += f"\n    {summary}"
    if content:
        body = content.strip().replace("\r", "")
        if body:
            indented = "\n".join(f"    {row}" for row in body.splitlines())
            line += f"\n    --- article content ---\n{indented}"
    return line


async def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if not args.no_logs:
        configure_logging(json_format=False)

    service = IngestService()
    profiles = load_source_profiles()
    selected: Iterable[str] | None = args.readers

    tasks: list[tuple[str, asyncio.Task[list[FeedItem]]]] = []
    for reader_id, reader in service.readers.items():
        if selected and reader_id not in selected:
            continue
        tasks.append((reader_id, asyncio.create_task(_fetch_reader(reader_id, reader))))

    if not tasks:
        available = ", ".join(service.readers.keys()) or "<none>"
        LOGGER.error("no_matching_readers", requested=selected, available=available)
        return 1

    content_client: httpx.AsyncClient | None = None
    if args.show_content:
        content_client = httpx.AsyncClient(
            timeout=20.0,
            headers={"User-Agent": "News360Ingest/1.0"},
            follow_redirects=True,
        )

    success = True
    for reader_id, task in tasks:
        try:
            items = await task
        except FeedReaderError as exc:
            LOGGER.error("reader_failed", reader_id=reader_id, error=str(exc))
            success = False
            continue
        except Exception as exc:  # pragma: no cover - defensive
            LOGGER.exception("unexpected_reader_error", reader_id=reader_id, error=str(exc))
            success = False
            continue

        print(f"\n=== {reader_id} ({service.readers[reader_id].feed_url}) ===")
        for item in items[: args.limit]:
            content: str | None = None
            profile = profiles.get(reader_id)
            if content_client is not None:
                content = await _get_article_content(
                    item,
                    content_client,
                    limit=args.content_limit,
                    profile=profile,
                )
            print(
                _format_item(
                    item,
                    show_summary=args.show_summary,
                    content=content,
                )
            )

        if len(items) > args.limit:
            print(f"  … {len(items) - args.limit} more items (increase --limit to view)")

    if content_client is not None:
        await content_client.aclose()

    return 0 if success else 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
