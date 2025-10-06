from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Base, Event, LLMInsight
from backend.app.services.event_service import EventService


class StubInsightService:
    def __init__(self) -> None:
        self.calls: list[tuple[int, str | None]] = []

    async def generate_for_event(self, event_id: int, *, correlation_id: str | None = None):
        await asyncio.sleep(0)  # allow context switch
        self.calls.append((event_id, correlation_id))


class DummyVectorIndex:
    async def ensure_ready(self, session: AsyncSession):  # pragma: no cover - not exercised
        return None

    async def query_candidates(self, embedding):  # pragma: no cover - not exercised
        return []

    async def upsert(self, event_id: int, embedding, timestamp, session: AsyncSession):  # pragma: no cover - not exercised
        return None

    async def remove(self, event_id: int):  # pragma: no cover - not exercised
        return None


@pytest.mark.asyncio
async def test_event_service_triggers_insight_generation_when_missing() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        event = Event(
            slug="autogen-event",
            title="Auto",
            first_seen_at=now,
            last_updated_at=now,
            article_count=1,
        )
        session.add(event)
        await session.commit()
        await session.refresh(event)
        event_id = event.id

    stub = StubInsightService()
    service = EventService(
        session_factory=session_factory,
        vector_index=DummyVectorIndex(),
        insight_service=stub,
        auto_generate_insights=True,
        insight_refresh_ttl=timedelta(minutes=5),
    )

    await service._maybe_schedule_insight_generation(event_id, now, correlation_id="auto-test")
    task = service._insight_tasks.get(event_id)
    assert task is not None
    await task

    assert stub.calls == [(event_id, "auto-test")]

    await engine.dispose()


@pytest.mark.asyncio
async def test_event_service_skips_recent_insights() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        event = Event(
            slug="fresh-event",
            title="Fresh",
            first_seen_at=now,
            last_updated_at=now,
            article_count=2,
        )
        session.add(event)
        await session.flush()

        insight = LLMInsight(
            event_id=event.id,
            provider="mistral",
            model="mistral-small-latest",
            prompt_metadata={},
            timeline=[],
            clusters=[],
            contradictions=[],
            fallacies=[],
            raw_response="{}",
            generated_at=now,
        )
        session.add(insight)
        await session.commit()
        event_id = event.id

    stub = StubInsightService()
    service = EventService(
        session_factory=session_factory,
        vector_index=DummyVectorIndex(),
        insight_service=stub,
        auto_generate_insights=True,
        insight_refresh_ttl=timedelta(minutes=30),
    )

    await service._maybe_schedule_insight_generation(event_id, now, correlation_id=None)

    assert stub.calls == []
    assert service._insight_tasks.get(event_id) is None

    await engine.dispose()
