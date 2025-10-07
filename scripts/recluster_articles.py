#!/usr/bin/env python3
"""Re-cluster all enriched articles with current event detection threshold."""

import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.app.core.logging import get_logger
from backend.app.db.models import Article
from backend.app.db.session import get_sessionmaker
from backend.app.services.event_service import EventService
from sqlalchemy import select

logger = get_logger(__name__)


async def main():
    """Re-cluster all enriched articles."""
    session_factory = get_sessionmaker()
    event_service = EventService(session_factory=session_factory, auto_generate_insights=False)

    async with session_factory() as session:
        # Get all enriched articles (those with embeddings)
        result = await session.execute(
            select(Article)
            .where(Article.embedding.isnot(None))
            .order_by(Article.published_at, Article.fetched_at)
        )
        articles = result.scalars().all()

        logger.info(f"Found {len(articles)} enriched articles to re-cluster")
        print(f"\n🔄 Re-clustering {len(articles)} articles with new threshold...\n")

        for idx, article in enumerate(articles, 1):
            correlation_id = f"recluster-{article.id}"
            result = await event_service.assign_article(
                article.id,
                correlation_id=correlation_id,
            )

            if result:
                action = "created new event" if result.created else f"linked to event {result.event_id}"
                print(f"[{idx}/{len(articles)}] Article {article.id}: {action} (score={result.score:.3f})")
            else:
                print(f"[{idx}/{len(articles)}] Article {article.id}: FAILED to assign")

        print(f"\n✅ Re-clustering complete!\n")


if __name__ == "__main__":
    asyncio.run(main())
