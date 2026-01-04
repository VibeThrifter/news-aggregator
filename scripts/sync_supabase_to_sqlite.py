#!/usr/bin/env python3
"""Initial sync script: Copy data from Supabase to local SQLite cache.

This script performs a one-time sync of all data from Supabase (cloud) to
local SQLite cache. Run this on the production PC before enabling SQLite reads.

Story: INFRA-1 (Supabase Egress Optimization)

Usage:
    PYTHONPATH=. python scripts/sync_supabase_to_sqlite.py

Note: This will incur Supabase egress (one-time cost), but after this,
all backend reads can use local SQLite (zero egress).
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure project root is in path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import func, select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import (
    Article,
    ArticleBiasAnalysis,
    Base,
    Event,
    EventArticle,
    LLMInsight,
    LlmConfig,
    NewsSource,
)
from backend.app.db.sqlite_session import get_sqlite_engine, get_sqlite_sessionmaker

logger = get_logger(__name__)

# Tables to sync, in order (respecting foreign key dependencies)
SYNC_ORDER = [
    ("articles", Article),
    ("events", Event),
    ("event_articles", EventArticle),
    ("llm_insights", LLMInsight),
    ("news_sources", NewsSource),
    ("llm_config", LlmConfig),
    ("article_bias_analyses", ArticleBiasAnalysis),
]

# Batch size for fetching/inserting
BATCH_SIZE = 500


async def count_records(session, model) -> int:
    """Count records in a table."""
    result = await session.execute(select(func.count()).select_from(model))
    return result.scalar() or 0


async def fetch_all_records(session, model, batch_size: int = BATCH_SIZE):
    """Fetch all records from a table in batches (generator)."""
    offset = 0
    while True:
        stmt = select(model).offset(offset).limit(batch_size)
        result = await session.execute(stmt)
        records = result.scalars().all()
        if not records:
            break
        yield records
        offset += batch_size


def model_to_dict(record) -> dict:
    """Convert a SQLAlchemy model to a dictionary."""
    return {
        c.name: getattr(record, c.name)
        for c in record.__table__.columns
    }


async def sync_table(
    supabase_session,
    sqlite_session,
    table_name: str,
    model,
) -> tuple[int, int]:
    """Sync a single table from Supabase to SQLite.

    Returns:
        Tuple of (records_synced, records_skipped)
    """
    log = logger.bind(table=table_name)

    # Count source records
    source_count = await count_records(supabase_session, model)
    log.info("sync_table_start", source_count=source_count)

    if source_count == 0:
        log.info("sync_table_empty")
        return 0, 0

    synced = 0
    skipped = 0

    async for batch in fetch_all_records(supabase_session, model):
        for record in batch:
            record_dict = model_to_dict(record)

            # Use INSERT OR REPLACE for SQLite
            stmt = sqlite_insert(model).values(**record_dict)
            stmt = stmt.on_conflict_do_update(
                index_elements=["id"],
                set_=record_dict,
            )

            try:
                await sqlite_session.execute(stmt)
                synced += 1
            except Exception as e:
                log.warning(
                    "sync_record_failed",
                    record_id=record_dict.get("id"),
                    error=str(e),
                )
                skipped += 1

        # Commit after each batch
        await sqlite_session.commit()
        log.info("sync_batch_complete", synced=synced, total=source_count)

    log.info("sync_table_complete", synced=synced, skipped=skipped)
    return synced, skipped


async def verify_sync(supabase_session, sqlite_session) -> dict:
    """Verify that SQLite has the same record counts as Supabase."""
    verification = {}

    for table_name, model in SYNC_ORDER:
        supabase_count = await count_records(supabase_session, model)
        sqlite_count = await count_records(sqlite_session, model)
        match = supabase_count == sqlite_count

        verification[table_name] = {
            "supabase": supabase_count,
            "sqlite": sqlite_count,
            "match": match,
        }

        status = "OK" if match else "MISMATCH"
        logger.info(
            "verify_table",
            table=table_name,
            supabase=supabase_count,
            sqlite=sqlite_count,
            status=status,
        )

    return verification


async def main():
    """Run the sync process."""
    settings = get_settings()
    start_time = datetime.now(timezone.utc)

    print("=" * 60)
    print("Supabase -> SQLite Sync Script")
    print("=" * 60)
    print(f"Supabase URL: {settings.database_url[:50]}...")
    print(f"SQLite path: {settings.sqlite_cache_path}")
    print()

    # Initialize SQLite schema
    print("Initializing SQLite schema...")
    sqlite_engine = get_sqlite_engine()
    async with sqlite_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Schema created.")
    print()

    # Create a dedicated Supabase engine with minimal pool size for sync
    # This prevents hitting Supabase's max clients limit
    supabase_engine = create_async_engine(
        settings.database_url,
        echo=False,
        pool_size=1,
        max_overflow=0,
    )
    supabase_factory = async_sessionmaker(
        supabase_engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )
    sqlite_factory = get_sqlite_sessionmaker()

    total_synced = 0
    total_skipped = 0

    try:
        async with supabase_factory() as supabase_session:
            async with sqlite_factory() as sqlite_session:
                # Sync each table
                for table_name, model in SYNC_ORDER:
                    print(f"Syncing {table_name}...")
                    synced, skipped = await sync_table(
                        supabase_session,
                        sqlite_session,
                        table_name,
                        model,
                    )
                    total_synced += synced
                    total_skipped += skipped
                    print(f"  -> {synced} records synced, {skipped} skipped")

                print()
                print("Verifying sync...")
                verification = await verify_sync(supabase_session, sqlite_session)
    finally:
        await supabase_engine.dispose()

    # Summary
    end_time = datetime.now(timezone.utc)
    duration = (end_time - start_time).total_seconds()

    print()
    print("=" * 60)
    print("SYNC COMPLETE")
    print("=" * 60)
    print(f"Total synced: {total_synced}")
    print(f"Total skipped: {total_skipped}")
    print(f"Duration: {duration:.1f} seconds")
    print()

    # Check for mismatches
    mismatches = [t for t, v in verification.items() if not v["match"]]
    if mismatches:
        print("WARNING: Record count mismatches detected:")
        for table in mismatches:
            v = verification[table]
            print(f"  {table}: Supabase={v['supabase']}, SQLite={v['sqlite']}")
        print()
        print("You may want to investigate and re-run the sync.")
    else:
        print("All tables synced successfully!")
        print()
        print("Next steps:")
        print("1. Set BACKEND_READ_SOURCE=sqlite in your .env")
        print("2. Restart the backend")
        print("3. All reads will now use local SQLite (zero egress)")


if __name__ == "__main__":
    asyncio.run(main())
