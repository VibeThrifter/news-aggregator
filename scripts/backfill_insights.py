#!/usr/bin/env python3
"""Backfill insights for events that don't have them yet."""

import asyncio
import sys
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.app.db.models import Event, LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.services.insight_service import InsightService


async def main():
    """Generate insights for all events that don't have them."""
    session_factory = get_sessionmaker()
    insight_service = InsightService(session_factory=session_factory)

    # Find events without insights
    async with session_factory() as session:
        stmt = (
            select(Event)
            .outerjoin(LLMInsight, Event.id == LLMInsight.event_id)
            .where(
                Event.archived_at.is_(None),
                Event.article_count > 0,
                LLMInsight.id.is_(None),
            )
            .order_by(Event.last_updated_at.desc())
        )
        result = await session.execute(stmt)
        events = list(result.scalars().all())

    if not events:
        print("✓ All events already have insights!")
        return 0

    print(f"Found {len(events)} events without insights")
    print(f"Generating insights...")

    success_count = 0
    error_count = 0

    for idx, event in enumerate(events, 1):
        try:
            print(f"  [{idx}/{len(events)}] Event {event.id}: {event.title[:60]}...")
            result = await insight_service.generate_for_event(
                event.id,
                correlation_id=f"backfill-{event.id}"
            )
            print(f"    ✓ Generated ({result.created=})")
            success_count += 1
        except Exception as e:
            print(f"    ✗ Failed: {type(e).__name__}: {e}")
            error_count += 1

    print(f"\n{'='*60}")
    print(f"✓ Successfully generated: {success_count}")
    if error_count > 0:
        print(f"✗ Failed: {error_count}")
    print(f"{'='*60}")

    return 0 if error_count == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
