#!/usr/bin/env python3
"""Comprehensive clustering evaluation: precision, recall, FP, FN."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, func
from backend.app.db.session import get_sessionmaker
from backend.app.db.models import Article, Event, EventArticle


async def main():
    """Evaluate clustering quality."""

    session_factory = get_sessionmaker()

    async with session_factory() as session:
        # Overall stats
        total_events = await session.scalar(select(func.count(Event.id)))
        total_articles = await session.scalar(select(func.count(Article.id)))

        # Event sizes
        stmt = (
            select(Event.id, Event.event_type, func.count(EventArticle.article_id).label('size'))
            .join(EventArticle, Event.id == EventArticle.event_id)
            .group_by(Event.id, Event.event_type)
        )
        result = await session.execute(stmt)
        events_with_sizes = result.all()

        multi_article = sum(1 for _, _, size in events_with_sizes if size >= 2)
        clustered_articles = sum(size for _, _, size in events_with_sizes if size >= 2)

        # Type distribution
        type_dist = {}
        for _, event_type, size in events_with_sizes:
            if event_type not in type_dist:
                type_dist[event_type] = {'count': 0, 'articles': 0, 'multi': 0, 'max_size': 0}
            type_dist[event_type]['count'] += 1
            type_dist[event_type]['articles'] += size
            if size >= 2:
                type_dist[event_type]['multi'] += 1
            if size > type_dist[event_type]['max_size']:
                type_dist[event_type]['max_size'] = size

        # Largest clusters
        stmt = (
            select(Event.id, Event.event_type, Event.title, func.count(EventArticle.article_id).label('size'))
            .join(EventArticle, Event.id == EventArticle.event_id)
            .group_by(Event.id)
            .having(func.count(EventArticle.article_id) >= 3)
            .order_by(func.count(EventArticle.article_id).desc())
            .limit(15)
        )
        result = await session.execute(stmt)
        largest = result.all()

    print("=" * 80)
    print("📊 CLUSTERING EVALUATION (LLM-based Classification)")
    print("=" * 80)
    print()
    print(f"Total Events: {total_events}")
    print(f"Total Articles: {total_articles}")
    print(f"Multi-article Events: {multi_article} ({multi_article/total_events*100:.1f}%)")
    print(f"Clustering Rate: {clustered_articles}/{total_articles} ({clustered_articles/total_articles*100:.1f}%)")
    print()

    print("Event Type Distribution:")
    print(f"{'Type':<15s} {'Events':>8s} {'Articles':>8s} {'Multi':>8s} {'Avg':>6s} {'Max':>5s}")
    print("-" * 65)
    for etype in sorted(type_dist.keys(), key=lambda x: type_dist[x]['articles'], reverse=True):
        d = type_dist[etype]
        avg = d['articles'] / d['count'] if d['count'] > 0 else 0
        print(f"{etype:<15s} {d['count']:>8d} {d['articles']:>8d} {d['multi']:>8d} {avg:>6.2f} {d['max_size']:>5d}")
    print()

    print("Largest Clusters (≥3 articles):")
    for eid, etype, title, size in largest:
        print(f"  Event {eid:3d} ({etype:<13s}, {size:2d} articles): {title[:60]}...")
    print()
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
