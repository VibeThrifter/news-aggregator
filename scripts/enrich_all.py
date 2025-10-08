#!/usr/bin/env python3
"""Enrich all unenriched articles."""

import asyncio
import sys
from pathlib import Path

# Add project root to Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.app.services.enrich_service import ArticleEnrichmentService
from backend.app.core.logging import get_logger

logger = get_logger(__name__)


async def main():
    """Enrich all pending articles."""
    service = ArticleEnrichmentService()

    print("🔄 Starting article enrichment...")
    batch_size = 50
    total_processed = 0

    while True:
        stats = await service.enrich_pending(limit=batch_size)
        processed = stats.get("processed", 0)
        skipped = stats.get("skipped", 0)

        total_processed += processed
        print(f"Batch: {processed} processed, {skipped} skipped (total: {total_processed})")

        if processed == 0:
            break

    print(f"\n✅ Enrichment complete! Total articles processed: {total_processed}")


if __name__ == "__main__":
    asyncio.run(main())
