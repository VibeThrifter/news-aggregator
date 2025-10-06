from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Event, EventArticle, LLMInsight, Base
from backend.app.routers.events import get_event_detail


@pytest.mark.asyncio
async def test_get_event_detail_by_slug_returns_payload(tmp_path: Path) -> None:
    db_path = tmp_path / "events_test.db"
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
                title="Publieke omroepen nog niet eens",
                description="Test event description",
                first_seen_at=now,
                last_updated_at=now,
                article_count=1,
                spectrum_distribution={"mainstream": 1},
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
                source_metadata={"spectrum": "mainstream"},
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
            payload = await get_event_detail(slug, session)

        assert payload["data"]["slug"] == slug
        assert payload["data"]["articles"][0]["source"] == "Example Source"
        assert payload["meta"]["insights_status"] == "available"
    finally:
        await engine.dispose()
