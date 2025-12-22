#!/usr/bin/env python3
"""
Script to clean up duplicate AD.nl articles that were created due to LIVE article updates.

AD.nl LIVE articles change their URL slug when updated, but keep the same article ID
(e.g., ~a5f2f6c34). This script identifies duplicates by extracting the article ID
and removes the older versions, keeping only the most recent one.
"""

import asyncio
import re
import sys
from collections import defaultdict
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import get_sessionmaker
from backend.app.db.models import Article, EventArticle

# Regex to extract AD article ID from URL
AD_ARTICLE_ID_PATTERN = re.compile(r"~([a-f0-9]+)/?$")


def extract_article_id(url: str) -> str | None:
    """Extract the canonical article ID from an AD URL."""
    match = AD_ARTICLE_ID_PATTERN.search(url)
    return match.group(1) if match else None


async def find_ad_duplicates(session: AsyncSession) -> dict[str, list[Article]]:
    """Find all AD articles grouped by their canonical article ID."""
    stmt = select(Article).where(Article.source_name == "AD")
    result = await session.execute(stmt)
    articles = result.scalars().all()

    # Group by article ID
    by_article_id: dict[str, list[Article]] = defaultdict(list)
    for article in articles:
        article_id = extract_article_id(article.url)
        if article_id:
            by_article_id[article_id].append(article)

    # Filter to only groups with duplicates
    duplicates = {
        aid: articles
        for aid, articles in by_article_id.items()
        if len(articles) > 1
    }

    return duplicates


async def cleanup_duplicates(dry_run: bool = True) -> dict:
    """Remove duplicate AD articles, keeping the most recent one."""
    session_maker = get_sessionmaker()

    stats = {
        "total_duplicate_groups": 0,
        "articles_to_remove": 0,
        "event_links_to_remove": 0,
        "removed": [],
    }

    async with session_maker() as session:
        duplicates = await find_ad_duplicates(session)
        stats["total_duplicate_groups"] = len(duplicates)

        for article_id, articles in duplicates.items():
            # Sort by published_at descending (keep the most recent)
            articles.sort(key=lambda a: a.published_at or a.fetched_at, reverse=True)

            # Keep the first (most recent), remove the rest
            to_keep = articles[0]
            to_remove = articles[1:]

            print(f"\nArticle ID: {article_id}")
            print(f"  Keeping: [{to_keep.id}] {to_keep.title[:60]}...")
            print(f"           URL: {to_keep.url}")

            for article in to_remove:
                stats["articles_to_remove"] += 1
                stats["removed"].append({
                    "id": article.id,
                    "title": article.title,
                    "url": article.url,
                })
                print(f"  Removing: [{article.id}] {article.title[:60]}...")

                if not dry_run:
                    # First, reassign event links from duplicate to the kept article
                    # Find events linked to the duplicate
                    event_links_stmt = select(EventArticle).where(
                        EventArticle.article_id == article.id
                    )
                    event_links_result = await session.execute(event_links_stmt)
                    event_links = event_links_result.scalars().all()

                    for link in event_links:
                        # Check if kept article is already linked to this event
                        existing_stmt = select(EventArticle).where(
                            EventArticle.event_id == link.event_id,
                            EventArticle.article_id == to_keep.id,
                        )
                        existing_result = await session.execute(existing_stmt)
                        existing = existing_result.scalar_one_or_none()

                        if not existing:
                            # Reassign the link to the kept article
                            link.article_id = to_keep.id
                            print(f"    Reassigned event link {link.event_id} to article {to_keep.id}")
                        else:
                            # Delete the duplicate link
                            await session.delete(link)
                            stats["event_links_to_remove"] += 1
                            print(f"    Removed duplicate event link {link.event_id}")

                    # Delete the duplicate article
                    await session.delete(article)

        if not dry_run:
            await session.commit()
            print("\n✓ Changes committed to database")
        else:
            print("\n[DRY RUN] No changes made. Run with --execute to apply changes.")

    return stats


async def main():
    dry_run = "--execute" not in sys.argv

    print("=" * 60)
    print("AD.nl Duplicate Article Cleanup")
    print("=" * 60)

    if dry_run:
        print("\n[DRY RUN MODE] - No changes will be made")
        print("Run with --execute to apply changes\n")
    else:
        print("\n[EXECUTE MODE] - Changes will be applied!\n")

    stats = await cleanup_duplicates(dry_run=dry_run)

    print("\n" + "=" * 60)
    print("Summary:")
    print(f"  Duplicate groups found: {stats['total_duplicate_groups']}")
    print(f"  Articles to remove: {stats['articles_to_remove']}")
    print(f"  Event links to remove: {stats['event_links_to_remove']}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
