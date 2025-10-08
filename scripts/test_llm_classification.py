#!/usr/bin/env python3
"""Test LLM classification on problematic articles."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from backend.app.db.session import get_sessionmaker
from backend.app.db.models import Article
from backend.app.nlp.classify import classify_event_type_llm
from backend.app.llm.client import MistralClient


async def main():
    """Test LLM classification on known misclassified articles."""

    # Problematic article IDs from false negative analysis
    test_ids = [81, 140, 166, 184, 192, 214, 231, 282]

    session_factory = get_sessionmaker()
    llm_client = MistralClient()

    async with session_factory() as session:
        stmt = select(Article).where(Article.id.in_(test_ids)).order_by(Article.id)
        result = await session.execute(stmt)
        articles = list(result.scalars().all())

    print("🧪 Testing LLM Classification on Problematic Articles\n")
    print("=" * 80)

    for article in articles:
        old_type = article.event_type

        # Get LLM classification
        try:
            new_type = await classify_event_type_llm(
                article.title,
                article.content,
                llm_client
            )
        except Exception as e:
            print(f"\n❌ Article {article.id}: ERROR - {e}")
            continue

        status = "✅ FIXED" if new_type != old_type else "⚠️  SAME"
        if old_type == new_type:
            status = "✅ CORRECT" if _is_correct(article.id, new_type) else "❌ STILL WRONG"

        print(f"\n{status} Article {article.id}")
        print(f"  Title: {article.title[:70]}...")
        print(f"  Old (keyword): {old_type:15s} → New (LLM): {new_type:15s}")

    print("\n" + "=" * 80)


def _is_correct(article_id, event_type):
    """Check if classification is correct based on known ground truth."""
    expected = {
        81: "sports",        # Verstappen F1
        140: "international", # Trump National Guard
        166: "international", # Trump National Guard
        184: "entertainment", # De Librije restaurant
        192: "international", # Trump National Guard
        214: "entertainment", # De Librije restaurant
        231: "international", # Trump National Guard
        282: "international", # Trump National Guard
    }
    return event_type == expected.get(article_id, event_type)


if __name__ == "__main__":
    asyncio.run(main())
