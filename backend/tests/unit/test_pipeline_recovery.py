"""Story 14.0: articles from the same story end up in one event again.

Covers the fixes for the October 2026 regression: guid deduplication with a savepoint (RTL),
the AD source-id lookup, orphaned-article catch-up, the provider per pipeline step and the
date window of the Google News enrichment.
"""

from __future__ import annotations

from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle
from backend.app.feeds.base import FeedItem
from backend.app.ingestion.parser import ArticleParseResult
from backend.app.llm import providers
from backend.app.llm.client import BaseLLMClient, DeepSeekClient, LLMResponse, MistralClient
from backend.app.repositories.article_repo import ArticleRepository
from backend.app.services.event_service import EventService
from backend.app.services.international_enrichment import _as_aware, within_event_window
from backend.app.services.vector_index import VectorIndexService


async def _factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False)


def _item(guid: str, url: str, source: str = "RTL Nieuws", **meta) -> FeedItem:
    return FeedItem(
        guid=guid,
        url=url,
        title="Titel",
        summary="Samenvatting",
        published_at=datetime.now(timezone.utc),
        source_metadata={"name": source, **meta},
    )


PARSED = ArticleParseResult(text="Volledige tekst", summary="Samenvatting")


@pytest.mark.asyncio
async def test_same_guid_under_a_new_url_returns_the_stored_article() -> None:
    session_factory = await _factory()
    async with session_factory() as session:
        repo = ArticleRepository(session)
        first = await repo.upsert_from_feed_item(
            _item("rtl-5656611", "https://www.rtl.nl/boulevard/entertainment/artikel/5656611/x"),
            PARSED,
        )
        # RTL moved the article; the guid stays the same
        moved = await repo.upsert_from_feed_item(
            _item("rtl-5656611", "https://www.rtl.nl/boulevard/artikel/5656611/x"), PARSED
        )
        other = await repo.upsert_from_feed_item(
            _item("rtl-1", "https://www.rtl.nl/nieuws/artikel/1/y"), PARSED
        )
        await session.commit()

    assert first.created and not moved.created
    assert moved.article.id == first.article.id
    assert other.created
    async with session_factory() as session:
        assert len((await session.execute(select(Article))).scalars().all()) == 2


@pytest.mark.asyncio
async def test_a_conflicting_insert_does_not_drop_the_rest_of_the_batch() -> None:
    session_factory = await _factory()
    async with session_factory() as session:
        repo = ArticleRepository(session)
        kept = await repo.upsert_from_feed_item(_item("nos-1", "https://nos.nl/artikel/1"), PARSED)
        await repo.upsert_from_feed_item(_item("nos-2", "https://nos.nl/artikel/2"), PARSED)

        # A concurrent insert: the pre-check misses the row, the insert hits the unique guid
        real_find = repo._find_existing
        calls = {"n": 0}

        async def miss_first(url, guid):
            calls["n"] += 1
            return None if calls["n"] == 1 else await real_find(url, guid)

        repo._find_existing = miss_first  # type: ignore[method-assign]
        result = await repo.upsert_from_feed_item(
            _item("nos-2", "https://nos.nl/artikel/2-nieuw"), PARSED
        )
        await session.commit()

    async with session_factory() as session:
        stored = (
            (await session.execute(select(Article.guid).order_by(Article.guid))).scalars().all()
        )
    # The earlier articles of the batch survive (savepoint instead of a full rollback)
    assert stored == ["nos-1", "nos-2"]
    assert kept.created
    assert not result.created and result.article.guid == "nos-2"


@pytest.mark.asyncio
async def test_ad_source_article_id_lookup_runs() -> None:
    session_factory = await _factory()
    async with session_factory() as session:
        repo = ArticleRepository(session)
        first = await repo.upsert_from_feed_item(
            _item(
                "ad-1",
                "https://www.ad.nl/live~a5f2f6c34/",
                source="AD",
                source_article_id="a5f2f6c34",
            ),
            PARSED,
        )
        again = await repo.upsert_from_feed_item(
            _item(
                "ad-1b",
                "https://www.ad.nl/live-update~a5f2f6c34/",
                source="AD",
                source_article_id="a5f2f6c34",
            ),
            PARSED,
        )
        await session.commit()
    assert first.created and not again.created
    assert again.article.id == first.article.id


def _embedding(vector: list[float]) -> bytes:
    return array("f", vector).tobytes()


class Answer(BaseLLMClient):
    provider = "stub"

    async def generate_text(
        self, prompt, *, temperature=None, max_tokens=None, correlation_id=None
    ):
        return LLMResponse(provider="stub", model="stub", content="EVENT_1")


@pytest.mark.asyncio
async def test_orphaned_dutch_articles_are_assigned(tmp_path: Path) -> None:
    session_factory = await _factory()
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        event = Event(
            slug="sierra-leone",
            title="EU staakt steun aan Sierra Leone",
            centroid_embedding=[1.0, 0.0, 0.0],
            centroid_tfidf={"sierra": 0.7, "leone": 0.7},
            centroid_entities=[{"text": "Sierra Leone", "label": "GPE"}],
            first_seen_at=now - timedelta(hours=3),
            last_updated_at=now - timedelta(hours=1),
            article_count=1,
        )

        def article(
            guid: str, *, international: bool = False, enriched: bool = True, age_hours: float = 1
        ) -> Article:
            return Article(
                guid=guid,
                url=f"https://example.com/{guid}",
                title="Van Weel en de steun aan Sierra Leone",
                content="tekst",
                source_name="NOS",
                normalized_text="tekst",
                embedding=_embedding([1.0, 0.0, 0.0]),
                tfidf_vector={"sierra": 0.7, "leone": 0.7},
                entities=[{"text": "Sierra Leone", "label": "GPE"}],
                published_at=now - timedelta(hours=age_hours),
                fetched_at=now - timedelta(hours=age_hours),
                enriched_at=now if enriched else None,
                is_international=international,
            )

        orphan = article("orphan")
        foreign = article("foreign", international=True)
        unenriched = article("raw", enriched=False)
        old = article("old", age_hours=200)
        session.add_all([event, orphan, foreign, unenriched, old])
        await session.commit()
        event_id, orphan_id = event.id, orphan.id

    vector_service = VectorIndexService(
        dimension=3, index_path=tmp_path / "i.bin", metadata_path=tmp_path / "i.json"
    )
    async with session_factory() as session:
        await vector_service.ensure_ready(session)
    service = EventService(
        session_factory=session_factory,
        vector_index=vector_service,
        auto_generate_insights=False,
        llm_client=Answer(),
    )

    stats = await service.assign_orphaned_articles(max_age_hours=72)

    assert stats["orphans"] == 1
    assert stats["events_linked"] == 1
    async with session_factory() as session:
        links = (
            (
                await session.execute(
                    select(EventArticle.article_id).where(EventArticle.event_id == event_id)
                )
            )
            .scalars()
            .all()
        )
    assert orphan_id in links


@pytest.mark.asyncio
async def test_step_client_reads_the_provider_per_call(monkeypatch) -> None:
    values = {"provider_classification": None, "provider_factual": "deepseek"}

    class Config:
        async def get_value(self, key, default=None):
            return values.get(key, default)

    monkeypatch.setattr(
        "backend.app.services.llm_config_service.get_llm_config_service", lambda: Config()
    )
    client = providers.StepLLMClient("provider_classification")

    # Without its own key the provider of the factual analysis is used
    assert isinstance(await client.client(), DeepSeekClient)
    values["provider_classification"] = "mistral"
    assert isinstance(await client.client(), MistralClient)


@pytest.mark.asyncio
async def test_step_client_falls_back_to_the_settings_without_config(monkeypatch) -> None:
    def broken():
        raise RuntimeError("no database")

    monkeypatch.setattr("backend.app.services.llm_config_service.get_llm_config_service", broken)
    client = providers.StepLLMClient("provider_event_assignment", default="deepseek")
    assert isinstance(await client.client(), DeepSeekClient)


def test_build_llm_client_names() -> None:
    from backend.app.core.config import Settings

    settings = Settings()
    assert providers.build_llm_client("deepseek", settings).provider == "deepseek"
    assert providers.build_llm_client(" Mistral ", settings).provider == "mistral"
    assert providers.build_llm_client(None, settings).provider == "mistral"


def test_naive_dates_count_as_utc() -> None:
    naive = datetime(2026, 10, 1, 12, 0)
    assert _as_aware(naive) == datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    assert _as_aware(None) is None


def test_foreign_coverage_far_from_the_event_is_dropped() -> None:
    event_start = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)

    def candidate(days: float | None):
        published = (
            None if days is None else (event_start + timedelta(days=days)).replace(tzinfo=None)
        )
        return SimpleNamespace(google_article=SimpleNamespace(published_at=published))

    kept = within_event_window(
        [candidate(-1), candidate(2), candidate(-30), candidate(9), candidate(None)],
        event_start,
        days=7,
    )
    assert [
        c.google_article.published_at is None or c.google_article.published_at.day for c in kept
    ] == [30, 3, True]
    assert within_event_window([candidate(-30)], None, days=7)
