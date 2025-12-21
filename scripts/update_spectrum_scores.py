#!/usr/bin/env python3
"""
One-time script to update all existing articles with the current spectrum scores
from the feed reader configurations.

This ensures database values stay in sync with the source code definitions.
The spectrum score is stored in source_metadata->spectrum as JSON.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))
os.chdir(project_root)

from sqlalchemy import text
from backend.app.db.session import get_engine

# Import all feed readers to get their current spectrum scores
from backend.app.feeds.nos import NosRssReader
from backend.app.feeds.nunl import NuRssReader
from backend.app.feeds.ad import AdRssReader
from backend.app.feeds.rtl import RtlRssReader
from backend.app.feeds.telegraaf import TelegraafRssReader
from backend.app.feeds.volkskrant import VolkskrantRssReader
from backend.app.feeds.parool import ParoolRssReader
from backend.app.feeds.anderekrant import AndereKrantRssReader
from backend.app.feeds.trouw import TrouwRssReader
from backend.app.feeds.geenstijl import GeenStijlAtomReader
from backend.app.feeds.ninefornews import NineForNewsRssReader
from backend.app.feeds.nieuwrechts import NieuwRechtsRssReader


def get_spectrum_mapping() -> dict[str, str | int | float]:
    """
    Build spectrum mapping from feed reader source metadata.

    Returns dict of source_name -> spectrum value.
    """
    # Instantiate readers with dummy URLs just to get metadata
    readers = [
        NosRssReader(""),
        NuRssReader(""),
        AdRssReader(""),
        RtlRssReader(""),
        TelegraafRssReader(""),
        VolkskrantRssReader(""),
        ParoolRssReader(""),
        AndereKrantRssReader(""),
        TrouwRssReader(""),
        GeenStijlAtomReader(""),
        NineForNewsRssReader(""),
        NieuwRechtsRssReader(""),
    ]

    mapping = {}
    for reader in readers:
        metadata = reader.source_metadata
        source_name = metadata["name"]
        spectrum = metadata["spectrum"]
        mapping[source_name] = spectrum

    return mapping


async def update_spectrum_scores():
    """Update all articles with current spectrum scores from feed readers."""

    # Get mapping from feed reader definitions
    spectrum_mapping = get_spectrum_mapping()

    print("Current spectrum mapping from feed readers:")
    print("-" * 60)
    for source, spectrum in sorted(spectrum_mapping.items(), key=lambda x: (str(x[1]) == "alternative", float(x[1]) if str(x[1]) != "alternative" else 99)):
        print(f"  {source}: {spectrum}")
    print("-" * 60)

    engine = get_engine()
    async with engine.connect() as conn:
        # First, let's see the current distribution in DB
        result = await conn.execute(
            text("""
                SELECT source_name, source_metadata->>'spectrum' as spectrum, COUNT(*) as count
                FROM articles
                GROUP BY source_name, source_metadata->>'spectrum'
                ORDER BY source_name
            """)
        )
        rows = result.fetchall()

        print("\nCurrent distribution in database:")
        print("-" * 60)
        for row in rows:
            print(f"  {row[0]}: spectrum={row[1]}, count={row[2]}")
        print("-" * 60)

        # Update each source - use raw SQL with proper escaping
        total_updated = 0
        for source_name, new_spectrum in spectrum_mapping.items():
            # Build the JSON object to merge
            spectrum_json = json.dumps({"spectrum": new_spectrum})

            # Use format string for the cast since :: doesn't work with params
            sql = text(f"""
                UPDATE articles
                SET source_metadata = (
                    COALESCE(source_metadata, '{{}}'::json)::jsonb || '{spectrum_json}'::jsonb
                )::json
                WHERE source_name = :source
            """)
            result = await conn.execute(sql, {"source": source_name})
            count = result.rowcount
            total_updated += count
            if count > 0:
                print(f"Updated {count} articles for {source_name} -> spectrum={new_spectrum}")

        await conn.commit()

        print("-" * 60)
        print(f"Total updated: {total_updated} articles")

        # Verify the update
        print("\nNew distribution in database:")
        print("-" * 60)
        result = await conn.execute(
            text("""
                SELECT source_name, source_metadata->>'spectrum' as spectrum, COUNT(*) as count
                FROM articles
                GROUP BY source_name, source_metadata->>'spectrum'
                ORDER BY source_name
            """)
        )
        rows = result.fetchall()
        for row in rows:
            print(f"  {row[0]}: spectrum={row[1]}, count={row[2]}")


if __name__ == "__main__":
    asyncio.run(update_spectrum_scores())
