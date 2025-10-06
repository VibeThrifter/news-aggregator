#!/usr/bin/env python3
"""Test script to manually trigger insight generation for an event."""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.app.core.logging import get_logger
from backend.app.services.insight_service import InsightService

logger = get_logger(__name__)


async def main():
    """Generate insights for event 47 (or first available event)."""

    # Use event 47 as shown in the database
    event_id = 47

    logger.info(f"Triggering insight generation for event {event_id}...")

    service = InsightService()
    result = await service.generate_for_event(event_id, correlation_id="manual-test")

    logger.info(
        "Insight generation complete",
        event_id=event_id,
        created=result.created,
        has_summary=bool(result.payload.summary),
        summary_length=len(result.payload.summary) if result.payload.summary else 0,
        provider=result.llm_result.provider,
        model=result.llm_result.model,
    )

    if result.payload.summary:
        print(f"\n{'='*80}")
        print("GENERATED SUMMARY:")
        print(f"{'='*80}")
        print(result.payload.summary)
        print(f"{'='*80}\n")
        print(f"Summary length: {len(result.payload.summary)} characters")
        print(f"Timeline items: {len(result.payload.timeline)}")
        print(f"Clusters: {len(result.payload.clusters)}")
        print(f"Contradictions: {len(result.payload.contradictions)}")
        print(f"Fallacies: {len(result.payload.fallacies)}")
    else:
        print("WARNING: No summary was generated!")


if __name__ == "__main__":
    asyncio.run(main())
