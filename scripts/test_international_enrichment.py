#!/usr/bin/env python3
"""Test script for International Enrichment Service (Story 9.3)."""

import asyncio
import sys

from backend.app.services.international_enrichment import (
    InternationalEnrichmentService,
    get_international_enrichment_service,
)


async def test_enrichment(event_id: int):
    """Test the international enrichment service for a specific event."""
    print(f"\n{'='*60}")
    print(f"Testing International Enrichment for Event {event_id}")
    print(f"{'='*60}\n")

    service = get_international_enrichment_service()

    print("Starting enrichment...")
    result = await service.enrich_event(event_id)

    print(f"\n{'='*60}")
    print("ENRICHMENT RESULT")
    print(f"{'='*60}")
    print(f"Event ID:            {result.event_id}")
    print(f"Countries Detected:  {result.countries_detected}")
    print(f"Countries Fetched:   {result.countries_fetched}")
    print(f"Countries Excluded:  {result.countries_excluded}")
    print(f"Articles Found:      {result.articles_found}")
    print(f"Articles Added:      {result.articles_added}")
    print(f"Articles Duplicate:  {result.articles_duplicate}")

    if result.errors:
        print(f"\nErrors:")
        for error in result.errors:
            print(f"  - {error}")

    if result.articles_added > 0:
        print(f"\n✅ SUCCESS: Added {result.articles_added} international articles!")
    elif result.countries_fetched:
        print(f"\n⚠️  Fetched from {len(result.countries_fetched)} countries but no relevant articles found")
    else:
        print(f"\n⚠️  No countries to fetch (all excluded or unsupported)")

    return result


if __name__ == "__main__":
    event_id = int(sys.argv[1]) if len(sys.argv) > 1 else 2977
    asyncio.run(test_enrichment(event_id))
