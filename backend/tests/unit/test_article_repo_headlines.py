"""Koppen die veranderen (Story 14.32) and Onderzoek in opdracht van (14.36) in the repository."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base
from backend.app.feeds.base import FeedItem
from backend.app.ingestion.parser import ArticleParseResult
from backend.app.repositories.article_repo import ArticleRepository


@pytest.fixture
def session_factory():
    """An in-memory SQLite session factory (sync fixture, like test_prompt_builder)."""
    import asyncio

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return async_sessionmaker(engine, expire_on_commit=False)

    loop = asyncio.new_event_loop()
    try:
        yield loop.run_until_complete(setup())
    finally:
        loop.run_until_complete(engine.dispose())
        loop.close()


def _item(guid: str, title: str) -> FeedItem:
    return FeedItem(
        guid=guid,
        url=f"https://www.trouw.nl/politiek/{guid}",
        title=title,
        summary="Samenvatting",
        published_at=datetime.now(timezone.utc) - timedelta(hours=1),
        source_metadata={"name": "Trouw"},
    )


@pytest.mark.asyncio
async def test_a_new_headline_becomes_the_title_and_the_old_one_history(
    session_factory: async_sessionmaker[AsyncSession],
):
    async with session_factory() as session:
        repo = ArticleRepository(session)
        await repo.upsert_from_feed_item(
            _item("a", "Ook VVD zocht steun bij Denk rond belastingplan"),
            ArticleParseResult(text="Tekst.", summary="Tekst."),
        )
        await repo.upsert_from_feed_item(
            _item("b", "LIVE | Coalitieoverleg"),
            ArticleParseResult(text="Tekst.", summary="Tekst."),
        )
        await repo.upsert_from_feed_item(
            _item("c", "Mirra Andrejeva wint WTA Finals"),
            ArticleParseResult(text="Tekst.", summary="Tekst."),
        )
        await session.commit()

        counts = await repo.record_title_changes(
            [
                _item("a", "Coalitie praat maandag verder op Catshuis"),
                _item("b", "LIVE | Coalitie praat maandag verder"),
                _item("c", "Mirra Andreeva wint WTA Finals"),
            ]
        )
        await session.commit()

    assert counts == {"headline": 1, "minor": 1, "live": 1}
    async with session_factory() as session:
        rows = {a.guid: a for a in (await session.execute(Article.__table__.select())).all()}
    assert rows["a"].title == "Coalitie praat maandag verder op Catshuis"
    [entry] = rows["a"].source_metadata["title_history"]
    assert entry["title"] == "Ook VVD zocht steun bij Denk rond belastingplan"
    assert rows["b"].title == "LIVE | Coalitieoverleg"
    assert rows["c"].title == "Mirra Andreeva wint WTA Finals"
    assert "title_history" not in rows["c"].source_metadata


@pytest.mark.asyncio
async def test_sponsored_research_is_stored_with_the_article(
    session_factory: async_sessionmaker[AsyncSession],
):
    text = "De enquête is uitgevoerd door Q&A in opdracht van Independer. Verder niets."
    async with session_factory() as session:
        result = await ArticleRepository(session).upsert_from_feed_item(
            _item("d", "Enquête"), ArticleParseResult(text=text, summary=text)
        )
        await session.commit()
    assert result.article.source_metadata["sponsored"][0]["sponsor"] == "Independer"
    assert result.article.source_metadata["name"] == "Trouw"
