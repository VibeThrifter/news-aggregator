from __future__ import annotations

from array import array
from datetime import datetime, timedelta, timezone
from typing import List

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle, LLMInsight
from backend.app.events.maintenance import EventMaintenanceService
from backend.app.repositories import EventMaintenanceBundle


def _serialize(vector: List[float]) -> bytes:
    return array("f", vector).tobytes()


def _enriched_article(key: str, **overrides) -> Article:
    now = datetime.now(timezone.utc)
    fields = dict(
        guid=f"guid-{key}",
        url=f"https://example.com/{key}",
        title=f"Artikel {key}",
        summary="",
        content="Volledige tekst",
        source_name="NOS",
        normalized_text="volledige tekst",
        normalized_tokens=["volledige", "tekst"],
        embedding=_serialize([0.1, 0.2, 0.3]),
        tfidf_vector={"tekst": 1.0},
        entities=[],
        published_at=now,
        fetched_at=now,
    )
    fields.update(overrides)
    return Article(**fields)


def test_recompute_centroids_updates_event_fields() -> None:
    service = EventMaintenanceService()
    now = datetime.now(timezone.utc)

    event = Event(
        id=1,
        slug="demo-event",
        title="Demo",
        centroid_embedding=None,
        centroid_tfidf=None,
        centroid_entities=[],
        first_seen_at=now - timedelta(days=2),
        last_updated_at=now - timedelta(days=2),
        article_count=0,
    )

    article_a = Article(
        id=1,
        guid="guid-a",
        url="https://example.com/a",
        title="Artikel A",
        summary="",
        content="",
        source_name="NOS",
        embedding=_serialize([1.0, 0.0, 0.0]),
        tfidf_vector={"protest": 1.0},
        entities=[{"text": "Den Haag", "label": "GPE"}],
        published_at=now - timedelta(days=1, hours=2),
        fetched_at=now - timedelta(days=1, hours=2),
    )

    article_b = Article(
        id=2,
        guid="guid-b",
        url="https://example.com/b",
        title="Artikel B",
        summary="",
        content="",
        source_name="NU.nl",
        embedding=_serialize([0.0, 1.0, 0.0]),
        tfidf_vector={"protest": 0.5, "politie": 0.5},
        entities=[{"text": "Amsterdam", "label": "GPE"}],
        published_at=now - timedelta(hours=12),
        fetched_at=now - timedelta(hours=12),
    )

    bundle = EventMaintenanceBundle(event=event, articles=[article_a, article_b])

    result = service._recompute_centroids([bundle])

    assert result["events_recomputed"] == 1
    assert len(result["vector_updates"]) == 1
    centroid = event.centroid_embedding
    assert centroid is not None
    assert pytest.approx(centroid[0], rel=1e-6) == 0.5
    assert pytest.approx(centroid[1], rel=1e-6) == 0.5
    assert event.article_count == 2
    assert event.centroid_tfidf is not None
    assert set(event.centroid_tfidf.keys()) == {"protest", "politie"}
    assert event.centroid_entities == [
        {"text": "Amsterdam", "label": "GPE"},
        {"text": "Den Haag", "label": "GPE"},
    ]
    assert event.last_updated_at > now - timedelta(days=2)


@pytest.mark.asyncio
async def test_archive_stale_events_filters_by_cutoff() -> None:
    service = EventMaintenanceService()
    now = datetime.now(timezone.utc)
    stale_event = Event(
        id=99,
        slug="stale",
        title="oude gebeurtenis",
        centroid_embedding=None,
        centroid_tfidf=None,
        centroid_entities=None,
        first_seen_at=now - timedelta(days=10),
        last_updated_at=now - timedelta(days=20),
        article_count=1,
    )
    bundle = EventMaintenanceBundle(event=stale_event, articles=[])

    archived_ids: list[int] = []

    class DummyRepo:
        async def archive_events(self, event_ids, timestamp):  # type: ignore[override]
            archived_ids.extend(event_ids)
            return len(event_ids)

    repo = DummyRepo()
    cutoff = now - timedelta(days=14)
    result = await service._archive_stale_events(repo=repo, bundles=[bundle], cutoff=cutoff)

    assert result == [99]
    assert archived_ids == [99]


def test_recompute_stores_centroid_with_six_decimals() -> None:
    service = EventMaintenanceService()
    now = datetime.now(timezone.utc)
    event = Event(
        id=3,
        slug="afgerond",
        title="Afgerond",
        centroid_embedding=None,
        centroid_tfidf=None,
        centroid_entities=[],
        first_seen_at=now,
        last_updated_at=now,
        article_count=0,
    )
    article = _enriched_article("a", embedding=_serialize([1 / 3, 2 / 3, 1 / 7]))

    result = service._recompute_centroids([EventMaintenanceBundle(event=event, articles=[article])])

    assert event.centroid_embedding == [0.333333, 0.666667, 0.142857]
    assert result["vector_updates"][0].embedding == [0.333333, 0.666667, 0.142857]


def test_recompute_keeps_centroid_of_event_with_pruned_articles() -> None:
    """An archived event that comes back keeps its centroid: its old articles have no vectors."""

    service = EventMaintenanceService()
    now = datetime.now(timezone.utc)
    stored_centroid = [0.25, 0.75, 0.0]
    event = Event(
        id=7,
        slug="terug",
        title="Terug",
        centroid_embedding=list(stored_centroid),
        centroid_tfidf={"oud": 1.0},
        centroid_entities=[],
        first_seen_at=now - timedelta(days=30),
        last_updated_at=now - timedelta(days=20),
        article_count=1,
    )
    pruned = _enriched_article(
        "oud", embedding=None, tfidf_vector=None, entities=[{"text": "Den Haag", "label": "GPE"}]
    )
    new = _enriched_article(
        "nieuw",
        embedding=_serialize([0.0, 1.0, 0.0]),
        tfidf_vector={"nieuw": 1.0},
        entities=[{"text": "Utrecht", "label": "GPE"}],
    )

    bundle = EventMaintenanceBundle(event=event, articles=[pruned, new])
    result = service._recompute_centroids([bundle])

    assert event.centroid_embedding == stored_centroid
    assert event.centroid_tfidf == {"oud": 1.0}
    assert [entity["text"] for entity in event.centroid_entities] == ["Den Haag", "Utrecht"]
    assert event.article_count == 2
    assert result["vector_updates"][0].embedding == stored_centroid


def test_recompute_ignores_articles_that_were_never_enriched() -> None:
    """International headlines have no vectors either, but were never enriched: not pruned."""

    service = EventMaintenanceService()
    now = datetime.now(timezone.utc)
    event = Event(
        id=8,
        slug="met-buitenland",
        title="Met buitenland",
        centroid_embedding=[0.5, 0.5, 0.0],
        centroid_tfidf=None,
        centroid_entities=[],
        first_seen_at=now,
        last_updated_at=now,
        article_count=1,
    )
    dutch = _enriched_article("nl", embedding=_serialize([1.0, 0.0, 0.0]))
    foreign = _enriched_article(
        "intl", normalized_text=None, normalized_tokens=None, embedding=None, tfidf_vector=None
    )

    service._recompute_centroids([EventMaintenanceBundle(event=event, articles=[dutch, foreign])])

    assert event.centroid_embedding == [1.0, 0.0, 0.0]


@pytest.mark.asyncio
async def test_prune_working_data_keeps_what_active_news_needs() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    service = EventMaintenanceService(session_factory=factory)
    retention = service.settings.raw_llm_response_retention_days
    now = datetime.now(timezone.utc)

    async with factory() as session:
        active = Event(slug="actief", title="Actief", first_seen_at=now, last_updated_at=now)
        archived = Event(
            slug="oud",
            title="Oud",
            first_seen_at=now - timedelta(days=30),
            last_updated_at=now - timedelta(days=20),
            archived_at=now - timedelta(days=6),
        )
        articles = {key: _enriched_article(key) for key in ("oud", "actief", "beide", "los")}
        session.add_all([active, archived, *articles.values()])
        await session.flush()
        session.add_all(
            [
                EventArticle(event_id=archived.id, article_id=articles["oud"].id),
                EventArticle(event_id=active.id, article_id=articles["actief"].id),
                EventArticle(event_id=archived.id, article_id=articles["beide"].id),
                EventArticle(event_id=active.id, article_id=articles["beide"].id),
                LLMInsight(
                    event_id=archived.id,
                    provider="claude-code",
                    model="sonnet",
                    raw_response="{}",
                    generated_at=now - timedelta(days=retention + 1),
                ),
                LLMInsight(
                    event_id=active.id,
                    provider="claude-code",
                    model="sonnet",
                    raw_response="{}",
                    generated_at=now - timedelta(days=retention - 1),
                ),
            ]
        )
        await session.commit()

    async with factory() as session:
        result = await service._prune_working_data(session, now=now)

    assert result == {
        "article_vectors_pruned": 1,
        "article_tokens_pruned": 4,
        "raw_responses_pruned": 1,
    }
    async with factory() as session:
        stored = {
            article.guid.removeprefix("guid-"): article
            for article in (await session.execute(select(Article))).scalars()
        }
        raw = {
            insight.event_id: insight.raw_response
            for insight in (await session.execute(select(LLMInsight))).scalars()
        }
    await engine.dispose()

    # Only in archived news: vectors go, the text they are built from stays
    assert stored["oud"].embedding is None
    assert stored["oud"].tfidf_vector is None
    assert stored["oud"].content == "Volledige tekst"
    assert stored["oud"].normalized_text == "volledige tekst"
    # In active news (also when in archived news as well) or in no event yet: untouched
    for key in ("actief", "beide", "los"):
        assert stored[key].embedding == _serialize([0.1, 0.2, 0.3])
        assert stored[key].tfidf_vector == {"tekst": 1.0}
    assert all(article.normalized_tokens is None for article in stored.values())
    assert raw == {archived.id: None, active.id: "{}"}
