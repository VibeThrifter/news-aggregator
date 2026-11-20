#!/usr/bin/env python3
"""Fetch again the text of articles that were stored with only their RSS summary.

When a page cannot be fetched, the poll stores the RSS summary as the text (ingest_service). On
2026-10-19/20 the Chromium of Playwright was missing for 27 hours: 140 articles of AD, NU.nl, De
Telegraaf, NieuwRechts and NineForNews came in that way. This script fetches their pages again,
stores the text, enriches the articles again (entities, embedding, tf-idf; their type stays) and
prints the news items they are in, so their analyses can be made again (--reanalyse).

    PYTHONPATH=. .venv/bin/python scripts/refetch_article_text.py \
        --since 2026-10-19T12:00Z --until 2026-10-20T18:00Z --dry-run

--wrong-text takes instead all NU.nl articles of the period and stores the text of the page when
it differs from the stored one (2026-11-19): the stored text was the block "Stel een vraag" that
stood in the article (38 of 228 in a week), or its paragraphs were joined by a written-out
backslash-n (half of them since October). The parser now takes NU.nl's text from the page's own
data. Only the news items of an article whose stored text did not hold the article are analysed
again; the analysis could read the other kind.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx  # noqa: E402
from sqlalchemy import select, update  # noqa: E402

from backend.app.db.models import Article, EventArticle  # noqa: E402
from backend.app.db.session import get_sessionmaker  # noqa: E402
from backend.app.ingestion import (  # noqa: E402  # noqa: E402
    ArticleFetchError,
    ArticleParseError,
    fetch_article_html,
    parse_article_html,
)
from backend.app.ingestion.playwright_fetch import close_browser_pool  # noqa: E402
from backend.app.ingestion.profiles import load_source_profiles  # noqa: E402

# Outlet -> reader of source_profiles.yaml. RTL Nieuws is left out: its video items have only a
# summary on any day
READERS = {
    "AD": "ad_rss",
    "NU.nl": "nunl_rss",
    "De Telegraaf": "telegraaf_rss",
    "NieuwRechts": "nieuwrechts_rss",
    "NineForNews": "ninefornews_rss",
}


async def _summary_only(since: datetime, until: datetime) -> list[tuple[int, str, str, str]]:
    async with get_sessionmaker()() as session:
        rows = await session.execute(
            select(Article.id, Article.source_name, Article.url, Article.content)
            .where(Article.fetched_at.between(since, until))
            .where(Article.source_name.in_(READERS))
            .where(Article.content == Article.summary)
            .order_by(Article.id)
        )
        return [tuple(row) for row in rows.all()]


WRITTEN_BREAK = "\\n"


def _holds_article(stored: str, text: str) -> bool:
    """Whether the stored text had the article: the start of its first paragraph after the
    headline stands in it."""
    lines = text.split("\n")
    start = (lines[1] if len(lines) > 1 else lines[0])[:80]
    return start in stored.replace(WRITTEN_BREAK, "\n")


async def _nunl(since: datetime, until: datetime) -> list[tuple[int, str, str, str]]:
    async with get_sessionmaker()() as session:
        rows = await session.execute(
            select(Article.id, Article.source_name, Article.url, Article.content)
            .where(Article.fetched_at.between(since, until))
            .where(Article.source_name == "NU.nl")
            .order_by(Article.id)
        )
        return [tuple(row) for row in rows.all()]


async def _event_ids(article_ids: list[int]) -> list[int]:
    async with get_sessionmaker()() as session:
        rows = await session.execute(
            select(EventArticle.event_id).where(EventArticle.article_id.in_(article_ids)).distinct()
        )
        return sorted(rows.scalars().all())


async def _enrich(article_ids: list[int]) -> dict:
    """Enrich again, keeping the type each article has (no classification call)."""

    import backend.app.nlp.classify as classify
    from backend.app.services.enrich_service import ArticleEnrichmentService

    async with get_sessionmaker()() as session:
        rows = await session.execute(
            select(Article.title, Article.event_type).where(Article.id.in_(article_ids))
        )
        types = {title: event_type for title, event_type in rows.all()}

    async def keep_type(title, content, client):  # noqa: ARG001
        return types.get(title)

    classify.classify_event_type_llm = keep_type
    return await ArticleEnrichmentService(llm_client=object()).enrich_by_ids(article_ids)


async def main(args: argparse.Namespace) -> None:
    since = datetime.fromisoformat(args.since.replace("Z", "+00:00"))
    until = datetime.fromisoformat(args.until.replace("Z", "+00:00"))
    if args.wrong_text:
        articles = await _nunl(since, until)
        print(f"{len(articles)} NU.nl articles")
    else:
        articles = await _summary_only(since, until)
        print(f"{len(articles)} articles with only their summary")
    if args.dry_run:
        for article_id, source, url, _ in articles:
            print(f"  {article_id} {source} {url}")
        return

    profiles = load_source_profiles()
    fixed: list[int] = []
    # Articles whose analysis read something else than the article
    unread: list[int] = []
    failed = 0
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            for article_id, source, url, summary in articles:
                profile = profiles.get(READERS[source])
                try:
                    html = await fetch_article_html(url, profile=profile, client=client)
                    text = parse_article_html(
                        html, url=url, page_data=bool(profile and profile.parser == "page_data")
                    ).text
                except (ArticleFetchError, ArticleParseError) as exc:
                    print(f"  failed {article_id} {source}: {exc}")
                    failed += 1
                    continue
                if args.wrong_text:
                    if text == summary:
                        continue
                elif len(text.strip()) <= len(summary.strip()):
                    print(f"  no longer text {article_id} {source} ({len(text)} chars)")
                    failed += 1
                    continue
                async with get_sessionmaker()() as session:
                    await session.execute(
                        update(Article).where(Article.id == article_id).values(content=text)
                    )
                    await session.commit()
                fixed.append(article_id)
                held = args.wrong_text and _holds_article(summary, text)
                if not held:
                    unread.append(article_id)
                note = "" if held or not args.wrong_text else " (was not the article)"
                print(f"  {article_id} {source}: {len(summary)} -> {len(text)} chars{note}")
    finally:
        await close_browser_pool()

    print(f"text fetched: {len(fixed)}, failed: {failed}")
    if not fixed:
        return
    print("enriched:", await _enrich(fixed))
    event_ids = await _event_ids(unread) if unread else []
    print(f"{len(event_ids)} news items to analyse again:", " ".join(map(str, event_ids)))
    if args.reanalyse:
        async with httpx.AsyncClient(timeout=900.0) as client:
            for event_id in event_ids:
                response = await client.post(
                    f"{args.backend}/admin/trigger/generate-insights/{event_id}"
                )
                print(f"  analysis {event_id}: {response.status_code}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--since", required=True, help="fetched_at from, ISO (e.g. 2026-10-19T12:00Z)"
    )
    parser.add_argument("--until", required=True, help="fetched_at until, ISO")
    parser.add_argument("--dry-run", action="store_true", help="only list the articles")
    parser.add_argument(
        "--wrong-text",
        action="store_true",
        help="all NU.nl articles of the period: store the page's text when it differs",
    )
    parser.add_argument(
        "--reanalyse", action="store_true", help="make the analyses of their news items again"
    )
    parser.add_argument("--backend", default="http://127.0.0.1:8000")
    asyncio.run(main(parser.parse_args()))
