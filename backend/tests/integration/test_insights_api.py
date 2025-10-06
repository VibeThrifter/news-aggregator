from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Event, EventArticle, LLMInsight, Base
from backend.app.routers.insights import get_event_insights


@pytest.mark.asyncio
async def test_get_event_insights_accepts_slug(tmp_path: Path) -> None:
    db_path = tmp_path / "events_insights.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    now = datetime.now(timezone.utc)
    slug = "publieke-omroepen-nog-niet-eens-over-nieuw-te-vormen-omroephuizen"

    try:
        async with session_factory() as session:
            event = Event(
                slug=slug,
                title="Publieke omroepen",
                description="Test event description",
                first_seen_at=now,
                last_updated_at=now,
                article_count=1,
            )
            session.add(event)
            await session.flush()

            article = Article(
                guid="article-guid-1",
                url="https://example.com/article",
                title="Example article",
                summary="Summary",
                content="Content",
                source_name="Example Source",
                published_at=now,
            )
            session.add(article)
            await session.flush()

            session.add(EventArticle(event_id=event.id, article_id=article.id))

            session.add(
                LLMInsight(
                    event_id=event.id,
                    provider="mistral",
                    model="mistral-small-latest",
                    timeline=[],
                    clusters=[],
                    contradictions=[],
                    fallacies=[],
                    raw_response="{}",
                    generated_at=now,
                )
            )

            await session.commit()

        async with session_factory() as session:
            payload = await get_event_insights(slug, session=session)

        assert payload["meta"]["event_id"]
        assert payload["data"]["query"] == "Publieke omroepen"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_get_event_insights_missing_insight_returns_404(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = tmp_path / "events_insights_missing.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    now = datetime.now(timezone.utc)
    slug = "slug-no-insights"

    try:
        async with session_factory() as session:
            event = Event(
                slug=slug,
                title="Missing insight event",
                description="Test event description",
                first_seen_at=now,
                last_updated_at=now,
                article_count=0,
            )
            session.add(event)
            await session.commit()

        from backend.app.routers import insights as insights_router

        triggered: dict[str, int] = {"count": 0}

        def fake_schedule(event_id: int) -> None:
            triggered["count"] += 1

        insights_router._pending_generations.clear()
        monkeypatch.setattr(insights_router, "_schedule_insight_generation", fake_schedule)

        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await get_event_insights(slug, session=session)

        assert exc.value.status_code == 404
        assert "No insights found" in exc.value.detail
        assert triggered["count"] == 1
    finally:
        await engine.dispose()
