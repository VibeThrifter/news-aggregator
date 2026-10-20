from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base
from backend.app.feeds.base import FeedItem
from backend.app.ingestion import ArticleFetchError
from backend.app.services.ingest_service import IngestService

@pytest.fixture
def session_factory(tmp_path) -> async_sessionmaker[AsyncSession]:
    import asyncio

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path/'test.db'}", future=True)

    async def setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return async_sessionmaker(engine, expire_on_commit=False)

    loop = asyncio.new_event_loop()
    try:
        factory = loop.run_until_complete(setup())
        yield factory
    finally:
        loop.run_until_complete(engine.dispose())
        loop.close()


@pytest.fixture
def ingest_service(session_factory, monkeypatch) -> IngestService:
    service = IngestService(session_factory=session_factory)

    async def _fake_enrich(article_ids):
        return {"processed": len(article_ids), "skipped": 0}

    monkeypatch.setattr(service.enrichment_service, "enrich_by_ids", _fake_enrich)
    return service


@pytest.fixture
def sample_feed_item() -> FeedItem:
    return FeedItem(
        guid="sample-guid",
        url="https://example.com/artikel/1",
        title="Demonstranten verzamelen zich",
        summary="Kort overzicht van de demonstratie",
        published_at=datetime.now(timezone.utc) - timedelta(hours=2),
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

    # Verify core stats (may include additional event stats)
    assert stats["ingested"] == 1
    assert stats["duplicates"] == 0
    assert stats["fetch_failures"] == 0
    assert stats["parse_failures"] == 0
    assert stats["enriched"] == 1
    assert stats["enrichment_skipped"] == 0

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
    assert stats["enriched"] == 0

    async with session_factory() as session:
        result = await session.execute(select(Article))
        articles = result.scalars().all()
        assert len(articles) == 1


@pytest.mark.asyncio
async def test_fetch_failure_with_rss_summary_fallback(monkeypatch, ingest_service, sample_feed_item, session_factory):
    """Test that when article fetch fails but RSS summary is available, article is still ingested."""
    async def fake_fetch(url: str, **_: object) -> str:
        raise ArticleFetchError("network down")

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)

    profile = ingest_service.reader_profiles.get("nos_rss")
    stats = await ingest_service.process_feed_items(reader_id="nos_rss", items=[sample_feed_item], profile=profile)

    # Fetch failed but RSS summary was used as fallback, so no fetch_failures counted
    assert stats["fetch_failures"] == 0
    assert stats["ingested"] == 1

    async with session_factory() as session:
        result = await session.execute(select(Article))
        stored = result.scalar_one()
        # Content should be the RSS summary since fetch failed
        assert stored.title == sample_feed_item.title


@pytest.mark.asyncio
async def test_fetch_failure_without_summary_counts_as_failure(monkeypatch, ingest_service, session_factory):
    """Test that when article fetch fails and no RSS summary is available, it's counted as a failure."""
    # Create feed item without summary
    item_no_summary = FeedItem(
        guid="no-summary-guid",
        url="https://example.com/artikel/no-summary",
        title="Article Without Summary",
        summary=None,  # No summary
        published_at=datetime.now(timezone.utc) - timedelta(hours=2),
        source_metadata={"name": "Testbron", "spectrum": 4},
    )

    async def fake_fetch(url: str, **_: object) -> str:
        raise ArticleFetchError("network down")

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)

    profile = ingest_service.reader_profiles.get("nos_rss")
    stats = await ingest_service.process_feed_items(reader_id="nos_rss", items=[item_no_summary], profile=profile)

    # No summary to fallback to, so this should be counted as a fetch failure
    assert stats["fetch_failures"] == 1
    assert stats["ingested"] == 0

    async with session_factory() as session:
        result = await session.execute(select(Article))
        assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_parse_failure_with_rss_summary_fallback(monkeypatch, ingest_service, sample_feed_item, session_factory):
    """When the page text is unusable (a paywall as code) the RSS summary is used, like a failed fetch."""
    from backend.app.ingestion import ArticleParseError

    async def fake_fetch(url: str, **_: object) -> str:
        return "<html><body>paywall</body></html>"

    def fake_parse(html: str, **_: object):
        raise ArticleParseError("Extracted text is page code (paywall?), not an article")

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)
    monkeypatch.setattr("backend.app.services.ingest_service.parse_article_html", fake_parse)

    profile = ingest_service.reader_profiles.get("nos_rss")
    stats = await ingest_service.process_feed_items(reader_id="nos_rss", items=[sample_feed_item], profile=profile)

    assert stats["parse_failures"] == 0
    assert stats["ingested"] == 1

    async with session_factory() as session:
        stored = (await session.execute(select(Article))).scalar_one()
        assert stored.content == sample_feed_item.summary


@pytest.mark.asyncio
async def test_stored_items_are_not_fetched_again(monkeypatch, ingest_service, sample_feed_item, sample_html, session_factory):
    """A feed repeats its latest items every poll: a stored item is skipped before its page is fetched."""
    calls: list[str] = []

    async def fake_fetch(url: str, **_: object) -> str:
        calls.append(url)
        return sample_html

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)

    profile = ingest_service.reader_profiles.get("nos_rss")
    first = await ingest_service.process_feed_items(reader_id="nos_rss", items=[sample_feed_item], profile=profile)
    again = await ingest_service.process_feed_items(reader_id="nos_rss", items=[sample_feed_item], profile=profile)

    assert first["ingested"] == 1
    assert again["duplicates"] == 1
    assert again["ingested"] == 0
    assert calls == [sample_feed_item.url]


@pytest.mark.asyncio
async def test_items_that_are_no_news_are_never_fetched(monkeypatch, ingest_service, session_factory):
    """A cartoon (source_profiles.yaml) is skipped before its page is fetched, and never stored."""
    fetched: list[str] = []

    async def fake_fetch(url: str, **_: object) -> str:
        fetched.append(url)
        return "<html></html>"

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)
    cartoon = FeedItem(
        guid="trouw-vonk",
        url="https://www.trouw.nl/cartoons/vonk~b60348c7/",
        title="Vonk",
        summary="Cartoon",
        published_at=datetime.now(timezone.utc) - timedelta(hours=2),
        source_metadata={"name": "Trouw"},
    )

    stats = await ingest_service.process_feed_items(
        reader_id="trouw_rss",
        items=[cartoon],
        profile=ingest_service.reader_profiles.get("trouw_rss"),
    )

    assert stats["ingested"] == 0
    assert fetched == []
    async with session_factory() as session:
        assert (await session.execute(select(Article))).scalars().all() == []


@pytest.mark.asyncio
async def test_items_published_more_than_a_day_ago_are_never_fetched(
    monkeypatch, ingest_service, sample_html, session_factory
):
    """Only current news (owner 2026-10-08): of a feed that still lists yesterday's items, or
    YouTube's videos back to July, only the news of the last 24 hours is fetched and stored."""
    fetched: list[str] = []

    async def fake_fetch(url: str, **_: object) -> str:
        fetched.append(url)
        return sample_html

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)
    now = datetime.now(timezone.utc)

    def item(guid: str, published_at: datetime) -> FeedItem:
        return FeedItem(
            guid=guid,
            url=f"https://nos.nl/artikel/{guid}",
            title="Kabinet presenteert plannen",
            summary="Samenvatting",
            published_at=published_at,
            source_metadata={"name": "NOS"},
        )

    # A date without zone counts as UTC
    yesterday = item("gisteren", (now - timedelta(hours=25)).replace(tzinfo=None))
    today = item("vandaag", now - timedelta(hours=23))

    stats = await ingest_service.process_feed_items(
        reader_id="nos_rss", items=[yesterday, today], profile=ingest_service.reader_profiles.get("nos_rss")
    )

    assert stats["ingested"] == 1
    assert fetched == [today.url]
    async with session_factory() as session:
        stored = (await session.execute(select(Article))).scalars().one()
    assert stored.guid == "vandaag"


@pytest.mark.asyncio
async def test_a_feed_only_source_never_fetches_the_page(monkeypatch, ingest_service, session_factory):
    """Een Blik op de NOS comes from YouTube: the title and description are the text, the video
    page is never fetched, also when the text is short."""
    fetched: list[str] = []

    async def fake_fetch(url: str, **_: object) -> str:
        fetched.append(url)
        return "<html></html>"

    monkeypatch.setattr("backend.app.services.ingest_service.fetch_article_html", fake_fetch)
    video = FeedItem(
        guid="youtube-MRWPnZVOtCc",
        url="https://www.youtube.com/watch?v=MRWPnZVOtCc",
        title="NOS: 'Turkije wordt bedreigd door Israël'",
        summary="Een vergaande bewering.",
        published_at=datetime.now(timezone.utc) - timedelta(hours=2),
        source_metadata={
            "name": "Een Blik op de NOS",
            "full_text_from_feed": "NOS: 'Turkije wordt bedreigd door Israël'\n\nEen vergaande bewering.",
        },
    )

    stats = await ingest_service.process_feed_items(
        reader_id="eenblikopdenos_rss",
        items=[video],
        profile=ingest_service.reader_profiles.get("eenblikopdenos_rss"),
    )

    assert stats["ingested"] == 1
    assert fetched == []
    async with session_factory() as session:
        stored = (await session.execute(select(Article))).scalars().one()
    assert "vergaande bewering" in stored.content


@pytest.mark.asyncio
async def test_a_source_just_added_is_polled_and_gets_its_row(ingest_service, session_factory):
    """De Dagelijkse Standaard (added 2026-10-19) had no row in news_sources, so every poll skipped
    it. A new reader now gets its row, enabled and no main source; a disabled source stays off."""
    from backend.app.db.models import NewsSource
    from backend.app.services.ingest_service import _get_enabled_source_ids

    async with session_factory() as session:
        session.add_all(
            [
                NewsSource(source_id="nos_rss", display_name="NOS", feed_url="https://feeds.nos.nl/x", enabled=True),
                NewsSource(source_id="nunl_rss", display_name="NU.nl", feed_url="https://www.nu.nl/x", enabled=False),
            ]
        )
        await session.commit()

    readers = {rid: ingest_service.readers[rid] for rid in ("nos_rss", "nunl_rss", "indepen_rss")}
    assert await _get_enabled_source_ids(session_factory, readers) == {"nos_rss", "indepen_rss"}

    async with session_factory() as session:
        rows = {row.source_id: row for row in (await session.execute(select(NewsSource))).scalars()}
    indepen = rows["indepen_rss"]
    assert (indepen.display_name, indepen.feed_url, indepen.spectrum) == ("INDEPEN", "https://indepen.eu/feed/", "alternative")
    assert indepen.enabled is True and indepen.is_main_source is False
    assert rows["nunl_rss"].enabled is False
    # The next poll finds the row: nothing is created twice
    assert await _get_enabled_source_ids(session_factory, readers) == {"nos_rss", "indepen_rss"}
    async with session_factory() as session:
        assert len((await session.execute(select(NewsSource))).scalars().all()) == 3


@pytest.mark.asyncio
async def test_the_catch_up_assigns_ready_articles_before_enriching_more(monkeypatch, ingest_service):
    """Enrichment can use up the catch-up's time budget; articles enriched before must still get an
    event, so the catch-up assigns first."""
    calls: list[str] = []

    async def assign(**_: object) -> dict:
        calls.append("assign")
        return {"orphans": 0, "events_created": 0, "events_linked": 0, "events_skipped": 0, "failed": 0}

    async def enrich(**_: object) -> dict:
        calls.append("enrich")
        return {"processed": 2, "skipped": 0}

    async def classify(**_: object) -> dict:
        calls.append("classify")
        return {"unclassified": 1, "classified": 1}

    monkeypatch.setattr(ingest_service.event_service, "assign_orphaned_articles", assign)
    monkeypatch.setattr(ingest_service.enrichment_service, "enrich_pending", enrich)
    monkeypatch.setattr(ingest_service.enrichment_service, "classify_pending", classify)

    stats = await ingest_service.catch_up_orphans()

    assert calls == ["assign", "enrich", "classify"]
    assert stats["enriched"] == 2 and stats["reclassified"] == 1
