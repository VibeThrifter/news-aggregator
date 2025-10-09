#!/usr/bin/env python3
"""Generate insights for a specific event to test framing feature."""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.app.services.insight_service import InsightService
from backend.app.core.logging import get_logger

logger = get_logger(__name__)


async def main():
    # Allow event ID as command line argument
    event_id = int(sys.argv[1]) if len(sys.argv) > 1 else 182

    print(f"Generating insights for event {event_id}...")

    service = InsightService()
    result = await service.generate_for_event(event_id)

    print(f"\n✓ Insights generated successfully!")
    print(f"  - Created: {result.created}")
    print(f"  - Provider: {result.llm_result.provider}")
    print(f"  - Model: {result.llm_result.model}")

    # Show frames
    frames = result.payload.frames
    print(f"\n📊 Frames detected: {len(frames)}")
    for i, frame in enumerate(frames, 1):
        print(f"\n  {i}. {frame.frame_type}")
        print(f"     {frame.description[:100]}...")
        print(f"     Sources: {len(frame.sources)}")

    # Show other insights
    print(f"\n📈 Other insights:")
    print(f"  - Timeline events: {len(result.payload.timeline)}")
    print(f"  - Clusters: {len(result.payload.clusters)}")
    print(f"  - Fallacies: {len(result.payload.fallacies)}")
    print(f"  - Contradictions: {len(result.payload.contradictions)}")
    print(f"  - Coverage gaps: {len(result.payload.coverage_gaps)}")

    print(f"\n🌐 View in frontend:")
    print(f"  http://localhost:3001/event/{event_id}")


if __name__ == "__main__":
    asyncio.run(main())
