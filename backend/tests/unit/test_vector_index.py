from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Base, Event
from backend.app.services.vector_index import VectorCandidate, VectorIndexService


@pytest.fixture
def db_session(event_loop: asyncio.AbstractEventLoop, request: pytest.FixtureRequest) -> AsyncSession:
    """Provide an isolated in-memory SQLite session for vector index tests."""

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _initialise() -> AsyncSession:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        return session_factory()

    session = event_loop.run_until_complete(_initialise())

    async def _teardown() -> None:
        await session.close()
        await engine.dispose()

    request.addfinalizer(lambda: event_loop.run_until_complete(_teardown()))
    return session


async def _seed_events(session: AsyncSession, *, dimension: int) -> list[Event]:
    now = datetime.now(timezone.utc)
    def _basis_vector(position: int, scale: float = 1.0) -> list[float]:
        vec = [0.0] * dimension
        if position < dimension:
            vec[position] = scale
        return vec

    events = [
        Event(
            slug="event-young",
            title="Recent protest",
            centroid_embedding=_basis_vector(0, 1.0),
            first_seen_at=now - timedelta(hours=2),
            last_updated_at=now - timedelta(hours=1),
            article_count=2,
        ),
        Event(
            slug="event-mid",
            title="Another article",
            centroid_embedding=_basis_vector(1, 1.0),
            first_seen_at=now - timedelta(days=2),
            last_updated_at=now - timedelta(days=2),
            article_count=3,
        ),
        Event(
            slug="event-old",
            title="Stale news",
            centroid_embedding=_basis_vector(2, 1.0),
            first_seen_at=now - timedelta(days=30),
            last_updated_at=now - timedelta(days=30),
            article_count=1,
        ),
    ]
    session.add_all(events)
    await session.commit()
    for event in events:
        await session.refresh(event)
    return events


@pytest.mark.asyncio
async def test_rebuild_and_query_returns_recent_candidates(tmp_path: Path, db_session: AsyncSession) -> None:
    dimension = 4
    events = await _seed_events(db_session, dimension=dimension)

    service = VectorIndexService(
        dimension=dimension,
        index_path=tmp_path / "vector.bin",
        metadata_path=tmp_path / "vector.meta.json",
    )

    await service.ensure_ready(db_session)

    embedding = [0.0] * dimension
    embedding[0] = 1.0
    candidates = await service.query_candidates(embedding, top_k=5)

    assert candidates, "Expected at least one candidate"
    assert isinstance(candidates[0], VectorCandidate)
    assert candidates[0].event_id == events[0].id
    assert candidates[0].similarity > 0.9
    # Old events fall outside 7-day window
    assert all(candidate.event_id != events[2].id for candidate in candidates)


@pytest.mark.asyncio
async def test_persist_and_reload_index(tmp_path: Path, db_session: AsyncSession) -> None:
    dimension = 4
    await _seed_events(db_session, dimension=dimension)

    index_path = tmp_path / "vector.bin"
    metadata_path = tmp_path / "vector.meta.json"

    service = VectorIndexService(
        dimension=dimension,
        index_path=index_path,
        metadata_path=metadata_path,
    )
    await service.ensure_ready(db_session)

    # Create a new instance to ensure persistence works
    reloaded_service = VectorIndexService(
        dimension=dimension,
        index_path=index_path,
        metadata_path=metadata_path,
    )
    await reloaded_service.ensure_ready(db_session)

    candidates = await reloaded_service.query_candidates([0.2] * dimension, top_k=3)
    assert candidates, "Reloaded index should return candidates"


@pytest.mark.asyncio
async def test_upsert_updates_existing_vector(tmp_path: Path, db_session: AsyncSession) -> None:
    dimension = 4
    events = await _seed_events(db_session, dimension=dimension)
    event = events[1]

    service = VectorIndexService(
        dimension=dimension,
        index_path=tmp_path / "vector.bin",
        metadata_path=tmp_path / "vector.meta.json",
    )
    await service.ensure_ready(db_session)

    updated_vector = [0.0] * dimension
    updated_vector[1] = 0.4
    await service.upsert(
        event.id,
        updated_vector,
        datetime.now(timezone.utc),
    )

    candidates = await service.query_candidates(updated_vector, top_k=1)
    assert candidates and candidates[0].event_id == event.id


@pytest.mark.asyncio
async def test_remove_marks_event_as_deleted(tmp_path: Path, db_session: AsyncSession) -> None:
    dimension = 4
    events = await _seed_events(db_session, dimension=dimension)

    service = VectorIndexService(
        dimension=dimension,
        index_path=tmp_path / "vector.bin",
        metadata_path=tmp_path / "vector.meta.json",
    )
    await service.ensure_ready(db_session)

    await service.remove(events[0].id)

    candidates = await service.query_candidates([0.1] * dimension, top_k=5)
    assert all(candidate.event_id != events[0].id for candidate in candidates)
