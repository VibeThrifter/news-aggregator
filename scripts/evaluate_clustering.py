#!/usr/bin/env python3
"""Evaluate clustering quality with metrics and known test cases."""

import asyncio
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.app.core.logging import get_logger
from backend.app.db.models import Article, Event
from backend.app.db.session import get_sessionmaker
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

logger = get_logger(__name__)


# Known good clusters (should stay together)
EXPECTED_GOOD_CLUSTERS = [
    {"keywords": ["Verstappen", "Norris", "F1", "Singapore"], "min_size": 5, "name": "F1 Championship"},
    {"keywords": ["synagoge", "Manchester", "terrorisme"], "min_size": 3, "name": "UK Synagogue Attack"},
    {"keywords": ["Trump", "Hamas", "Gaza", "vredesplan"], "min_size": 3, "name": "Trump Gaza Peace"},
]

# Known false positives (should NOT be together)
EXPECTED_SEPARATED = [
    {
        "name": "Different Femicides",
        "articles": [
            ("Hardenberg", "femicide"),
            ("Purmerend", "steekpartij"),
            ("Terneuzen", "moeder en kind"),
        ],
    },
    {
        "name": "Different Storms",
        "articles": [
            ("Humberto", "orkaan"),
            ("Amy", "storm"),
        ],
    },
]


async def get_clustering_stats(session):
    """Get basic clustering statistics."""

    # Count events by size
    result = await session.execute(
        select(
            func.count(func.distinct(Article.id)).label("article_count"),
            func.count(Event.id).label("event_count"),
        )
        .select_from(Event)
        .outerjoin(Event.articles)
        .group_by(Event.id)
    )

    # Get event size distribution
    size_dist = await session.execute(
        select(
            func.count(func.distinct(Article.id)).label("size"),
            func.count(Event.id).label("count"),
        )
        .select_from(Event)
        .outerjoin(Event.articles)
        .group_by(Event.id)
        .subquery()
    )

    # Simpler query: just count events by article count
    events_with_counts = await session.execute(
        select(Event.id, func.count(Article.id).label("article_count"))
        .select_from(Event)
        .join(Event.articles)
        .group_by(Event.id)
    )

    size_distribution = {}
    total_events = 0
    for event_id, count in events_with_counts:
        total_events += 1
        size_distribution[count] = size_distribution.get(count, 0) + 1

    return {
        "total_events": total_events,
        "size_distribution": size_distribution,
    }


async def check_good_clusters(session):
    """Verify expected good clusters exist."""
    results = []

    for expected in EXPECTED_GOOD_CLUSTERS:
        keywords = expected["keywords"]
        min_size = expected["min_size"]
        name = expected["name"]

        # Find events matching keywords
        events = await session.execute(
            select(Event)
            .options(selectinload(Event.articles))
            .where(
                Event.title.ilike(f"%{keywords[0]}%")
                | Event.description.ilike(f"%{keywords[0]}%")
            )
        )
        events = events.scalars().all()

        found = False
        for event in events:
            article_count = len(event.articles)
            if article_count >= min_size:
                # Check if other keywords present
                titles = " ".join(a.title for a in event.articles)
                if all(kw.lower() in titles.lower() for kw in keywords[:2]):
                    found = True
                    results.append({
                        "name": name,
                        "status": "✓ FOUND",
                        "event_id": event.id,
                        "size": article_count,
                        "title": event.title[:60],
                    })
                    break

        if not found:
            results.append({
                "name": name,
                "status": "✗ MISSING",
                "event_id": None,
                "size": 0,
                "title": "Not found in clusters",
            })

    return results


async def check_false_positives(session):
    """Check for articles that should NOT be clustered together."""
    results = []

    for case in EXPECTED_SEPARATED:
        name = case["name"]
        article_pairs = case["articles"]

        # Find articles matching each pattern
        found_articles = []
        for kw1, kw2 in article_pairs:
            result = await session.execute(
                select(Article)
                .where(Article.title.ilike(f"%{kw1}%") & Article.title.ilike(f"%{kw2}%"))
                .limit(1)
            )
            article = result.scalar_one_or_none()
            if article:
                found_articles.append(article)

        if len(found_articles) < 2:
            results.append({
                "name": name,
                "status": "⚠ INCOMPLETE",
                "details": f"Found {len(found_articles)}/{len(article_pairs)} articles",
            })
            continue

        # Check if they're in same event
        article_ids = {a.id for a in found_articles}

        events_query = await session.execute(
            select(Event)
            .options(selectinload(Event.articles))
            .where(Event.articles.any(Article.id.in_(article_ids)))
        )
        events = events_query.scalars().all()

        # Check if multiple articles from our set are in same event
        same_cluster = False
        for event in events:
            event_article_ids = {a.id for a in event.articles}
            overlap = event_article_ids.intersection(article_ids)
            if len(overlap) >= 2:
                same_cluster = True
                results.append({
                    "name": name,
                    "status": "✗ FALSE POSITIVE",
                    "details": f"Event {event.id} contains {len(overlap)} articles that should be separate",
                })
                break

        if not same_cluster:
            results.append({
                "name": name,
                "status": "✓ SEPARATED",
                "details": "Articles correctly in different events",
            })

    return results


async def main():
    """Run clustering evaluation."""
    session_factory = get_sessionmaker()

    print("\n" + "="*60)
    print("CLUSTERING QUALITY EVALUATION")
    print("="*60 + "\n")

    async with session_factory() as session:
        # 1. Basic statistics
        stats = await get_clustering_stats(session)
        print("📊 CLUSTERING STATISTICS")
        print(f"   Total events: {stats['total_events']}")
        print(f"   Size distribution:")
        for size in sorted(stats['size_distribution'].keys(), reverse=True):
            count = stats['size_distribution'][size]
            bar = "█" * min(count // 2, 40)
            print(f"     {size:2d} articles: {count:3d} events {bar}")

        # 2. Check good clusters
        print(f"\n✓ EXPECTED GOOD CLUSTERS")
        good_results = await check_good_clusters(session)
        for result in good_results:
            print(f"   {result['status']:12s} {result['name']:25s} (size={result['size']}, id={result['event_id']})")

        # 3. Check false positives
        print(f"\n✗ FALSE POSITIVE CHECK")
        fp_results = await check_false_positives(session)
        for result in fp_results:
            print(f"   {result['status']:20s} {result['name']:25s}")
            print(f"      → {result['details']}")

        # 4. Summary score
        print(f"\n{'='*60}")
        good_found = sum(1 for r in good_results if "FOUND" in r['status'])
        separated = sum(1 for r in fp_results if "SEPARATED" in r['status'])

        print(f"📈 QUALITY SCORE")
        print(f"   Good clusters found: {good_found}/{len(EXPECTED_GOOD_CLUSTERS)}")
        print(f"   False positives avoided: {separated}/{len(EXPECTED_SEPARATED)}")

        single_article_pct = (
            stats['size_distribution'].get(1, 0) / stats['total_events'] * 100
            if stats['total_events'] > 0 else 0
        )
        print(f"   Single-article events: {single_article_pct:.1f}%")
        print("="*60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
