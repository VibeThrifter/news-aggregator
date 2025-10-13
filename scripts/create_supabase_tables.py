"""Create database tables in Supabase PostgreSQL."""

import asyncio
from backend.app.db.models import Base
from backend.app.db.session import get_engine


async def create_tables():
    """Create all tables defined in SQLAlchemy models."""
    engine = get_engine()

    print("Creating tables in Supabase PostgreSQL...")

    async with engine.begin() as conn:
        # Drop all tables first (be careful in production!)
        await conn.run_sync(Base.metadata.drop_all)
        print("Dropped existing tables")

        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
        print("Created all tables successfully!")

    await engine.dispose()
    print("\nTables created:")
    for table in Base.metadata.sorted_tables:
        print(f"  - {table.name}")


if __name__ == "__main__":
    asyncio.run(create_tables())
