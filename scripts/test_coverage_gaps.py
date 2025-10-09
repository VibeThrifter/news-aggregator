"""Test script to verify coverage_gaps functionality."""

import asyncio
import json
from backend.app.services.insight_service import InsightService
from backend.app.core.logging import get_logger

logger = get_logger(__name__)


async def main():
    """Generate insight for an event and verify coverage_gaps are captured."""

    # Use an event with multiple articles
    event_id = 78  # Trump's Hamas statement - 6 articles

    logger.info("test_start", event_id=event_id)

    service = InsightService()

    try:
        result = await service.generate_for_event(event_id)

        logger.info(
            "insight_generated",
            event_id=event_id,
            provider=result.llm_result.provider,
            model=result.llm_result.model,
            created=result.created,
        )

        # Check if coverage_gaps are present
        coverage_gaps = result.payload.coverage_gaps
        logger.info("coverage_gaps_count", count=len(coverage_gaps))

        if coverage_gaps:
            print("\n=== Coverage Gaps Identified ===")
            for i, gap in enumerate(coverage_gaps, 1):
                print(f"\n{i}. {gap.perspective}")
                print(f"   Beschrijving: {gap.description}")
                print(f"   Relevantie: {gap.relevance}")
                if gap.potential_sources:
                    print(f"   Mogelijke bronnen: {', '.join(gap.potential_sources)}")
        else:
            print("\n⚠️  No coverage gaps identified by LLM")

        # Verify database persistence
        if result.insight.coverage_gaps:
            print(f"\n✓ Coverage gaps successfully persisted to database")
            print(f"  Database record has {len(result.insight.coverage_gaps)} gaps")
        else:
            print("\n⚠️  No coverage gaps in database record")

        print("\n✓ Test completed successfully")

    except Exception as e:
        logger.error("test_failed", error=str(e), exc_info=True)
        raise


if __name__ == "__main__":
    asyncio.run(main())
