from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Iterator

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base
from backend.app.feeds.base import FeedItem
from backend.app.ingestion import ArticleFetchError
from backend.app.services.ingest_service import IngestService

@pytest.fixture
def session_factory(tmp_path) -> Iterator[async_sessionmaker[AsyncSession]]:
    loop = asyncio.get_event_loop()
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path/'test.db'}", future=True)

    async def _prepare() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    loop.run_until_complete(_prepare())

    factory = async_sessionmaker(engine, expire_on_commit=False)

    yield factory

    loop.run_until_complete(engine.dispose())


@pytest.fixture
def ingest_service(session_factory) -> IngestService:
    return IngestService(session_factory=session_factory)


@pytest.fixture
def sample_feed_item() -> FeedItem:
    return FeedItem(
        guid="sample-guid",
        url="https://example.com/artikel/1",
        title="Demonstranten verzamelen zich",
        summary="Kort overzicht van de demonstratie",
        published_at=datetime(2025, 9, 28, 13, 0, 0),
        source_metadata={"name": "Testbron", "spectrum": "center"},
    )


@pytest.fixture
def sample_html() -> str:
    html_path = Path("backend/tests/fixtures/html/article_simple.html")
    return html_path.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_article_persisted_with_clean_text(monkeypatch, ingest_service, sample_feed_item, sample_html, session_factory):
    async def fake_fetch(url: str, **_: object) -> str:
        return sample_html

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)

    profile = ingest_service.reader_profiles.get("nos_rss")
    stats = await ingest_service.process_feed_items(
        reader_id="nos_rss",
        items=[sample_feed_item],
        profile=profile,
    )

    assert stats == {
        "ingested": 1,
        "duplicates": 0,
        "fetch_failures": 0,
        "parse_failures": 0,
    }

    async with session_factory() as session:
        result = await session.execute(select(Article))
        stored = result.scalar_one()
        assert "Den Haag" in stored.content
        assert stored.summary
        assert stored.title == sample_feed_item.title


@pytest.mark.asyncio
async def test_duplicate_urls_are_skipped(monkeypatch, ingest_service, sample_feed_item, sample_html, session_factory):
    async def fake_fetch(url: str, **_: object) -> str:
        return sample_html

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)

    profile = ingest_service.reader_profiles.get("nos_rss")
    await ingest_service.process_feed_items(reader_id="nos_rss", items=[sample_feed_item], profile=profile)
    stats = await ingest_service.process_feed_items(reader_id="nos_rss", items=[sample_feed_item], profile=profile)

    assert stats["duplicates"] == 1

    async with session_factory() as session:
        result = await session.execute(select(Article))
        articles = result.scalars().all()
        assert len(articles) == 1


@pytest.mark.asyncio
async def test_fetch_failures_do_not_crash_pipeline(monkeypatch, ingest_service, sample_feed_item, session_factory):
    async def fake_fetch(url: str, **_: object) -> str:
        raise ArticleFetchError("network down")

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)

    profile = ingest_service.reader_profiles.get("nos_rss")
    stats = await ingest_service.process_feed_items(reader_id="nos_rss", items=[sample_feed_item], profile=profile)

    assert stats["fetch_failures"] == 1

    async with session_factory() as session:
        result = await session.execute(select(Article))
        assert result.scalar_one_or_none() is None
