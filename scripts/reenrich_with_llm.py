#!/usr/bin/env python3
"""Re-enrich all articles with LLM-based classification."""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, update
from backend.app.db.session import get_sessionmaker
from backend.app.db.models import Article
from backend.app.services.enrich_service import ArticleEnrichmentService
from backend.app.core.logging import get_logger

logger = get_logger(__name__)


async def main():
    """Re-enrich all articles to update event_type with LLM classification."""

    print("🔄 Re-enriching all articles with LLM-based classification...")
    print("⚠️  This will make ~349 LLM API calls (Mistral)")
    print("⏱️  Estimated time: 5-10 minutes\n")

    session_factory = get_sessionmaker()

    # Get all enriched articles
    async with session_factory() as session:
        stmt = select(Article).where(Article.normalized_text.is_not(None))
        result = await session.execute(stmt)
        articles = list(result.scalars().all())

    print(f"📊 Found {len(articles)} enriched articles\n")

    # Clear enriched_at to force re-enrichment
    async with session_factory() as session:
        stmt = update(Article).where(Article.normalized_text.is_not(None)).values(enriched_at=None)
        await session.execute(stmt)
        await session.commit()

    print("✅ Cleared enrichment timestamps\n")

    # Re-enrich in batches
    service = ArticleEnrichmentService()
    batch_size = 10
    total = len(articles)

    for i in range(0, total, batch_size):
        batch_ids = [a.id for a in articles[i:i+batch_size]]
        batch_num = (i // batch_size) + 1
        total_batches = (total + batch_size - 1) // batch_size

        print(f"🔄 Batch {batch_num}/{total_batches} (articles {i+1}-{min(i+batch_size, total)}/{total})")

        try:
            stats = await service.enrich_by_ids(batch_ids)
            print(f"   ✅ Processed: {stats['processed']}, Skipped: {stats['skipped']}")
        except Exception as e:
            print(f"   ❌ Error: {e}")
            continue

    print("\n🎉 Re-enrichment complete!")

    # Show new classification distribution
    async with session_factory() as session:
        stmt = select(Article.event_type,
                     sqlalchemy.func.count(Article.id).label('count')
                     ).where(Article.normalized_text.is_not(None)
                     ).group_by(Article.event_type
                     ).order_by(sqlalchemy.text('count DESC'))

        result = await session.execute(stmt)
        rows = result.all()

        print("\n📊 New Event Type Distribution (LLM-classified):")
        for event_type, count in rows:
            print(f"   {event_type:15s}: {count:3d} articles")


if __name__ == "__main__":
    import sqlalchemy
    asyncio.run(main())
