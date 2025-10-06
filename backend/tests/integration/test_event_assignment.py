from __future__ import annotations

from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle
from backend.app.services.event_service import EventAssignmentResult, EventService
from backend.app.services.vector_index import VectorIndexService


def _serialize_embedding(vector: list[float]) -> bytes:
    buffer = array("f", vector)
    return buffer.tobytes()


@pytest.mark.asyncio
async def test_assign_links_article_to_existing_event(tmp_path: Path) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    index_path = tmp_path / "index.bin"
    metadata_path = tmp_path / "index.meta.json"
    vector_service = VectorIndexService(dimension=3, index_path=index_path, metadata_path=metadata_path)
    service = EventService(
        session_factory=session_factory,
        vector_index=vector_service,
        auto_generate_insights=False,
    )

    now = datetime.now(timezone.utc)

    async with session_factory() as session:
        event = Event(
            slug="existing-event",
            title="Protest in Den Haag",
            centroid_embedding=[1.0, 0.0, 0.0],
            centroid_tfidf={"protest": 0.7, "den": 0.3},
            centroid_entities=[{"text": "Den Haag", "label": "GPE"}],
            first_seen_at=now - timedelta(hours=5),
            last_updated_at=now - timedelta(hours=1),
            article_count=1,
        )
        article = Article(
            guid="guid-123",
            url="https://example.com/protest",
            title="Nieuwe protestactie in Den Haag",
            summary="Samenvatting",
            content="Volledige tekst",
            source_name="NOS",
            source_metadata={"spectrum": "mainstream"},
            normalized_text="volledige tekst",
            normalized_tokens=["volledige", "tekst"],
            embedding=_serialize_embedding([1.0, 0.0, 0.0]),
            tfidf_vector={"protest": 0.7, "den": 0.3},
            entities=[{"text": "Den Haag", "label": "GPE"}],
            published_at=now,
            fetched_at=now,
        )
        session.add_all([event, article])
        await session.flush()
        event_id = event.id
        article_id = article.id
        await session.commit()

    async with session_factory() as session:
        await vector_service.ensure_ready(session)

    result = await service.assign_article(article_id=article_id)
    assert isinstance(result, EventAssignmentResult)
    assert not result.created
    assert result.event_id == event_id
    assert result.score >= result.threshold

    async with session_factory() as session:
        refreshed_event = await session.get(Event, event_id)
        assert refreshed_event is not None
        assert refreshed_event.article_count == 2
        links = await session.execute(select(EventArticle).where(EventArticle.event_id == refreshed_event.id))
        assert len(links.scalars().all()) == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_assign_creates_new_event_when_score_below_threshold(tmp_path: Path) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    index_path = tmp_path / "index2.bin"
    metadata_path = tmp_path / "index2.meta.json"
    vector_service = VectorIndexService(dimension=3, index_path=index_path, metadata_path=metadata_path)
    service = EventService(
        session_factory=session_factory,
        vector_index=vector_service,
        auto_generate_insights=False,
    )

    now = datetime.now(timezone.utc)

    async with session_factory() as session:
        unrelated_event = Event(
            slug="sports-event",
            title="Sportnieuws",
            centroid_embedding=[0.0, 1.0, 0.0],
            centroid_tfidf={"voetbal": 1.0},
            centroid_entities=[{"text": "PSV", "label": "ORG"}],
            first_seen_at=now - timedelta(days=1),
            last_updated_at=now - timedelta(days=1),
            article_count=2,
        )
        article = Article(
            guid="guid-789",
            url="https://example.com/politiek",
            title="Politiek debat over klimaat",
            summary="Korte samenvatting",
            content="Volledige politieke tekst",
            source_name="NU.nl",
            source_metadata={"spectrum": "mainstream"},
            normalized_text="volledige politieke tekst",
            normalized_tokens=["volledige", "politieke", "tekst"],
            embedding=_serialize_embedding([1.0, 0.0, 0.0]),
            tfidf_vector={"klimaat": 0.8, "debat": 0.6},
            entities=[{"text": "Tweede Kamer", "label": "ORG"}],
            published_at=now,
            fetched_at=now,
        )
        session.add_all([unrelated_event, article])
        await session.flush()
        article_id = article.id
        await session.commit()

    async with session_factory() as session:
        await vector_service.ensure_ready(session)

    result = await service.assign_article(article_id=article_id)
    assert isinstance(result, EventAssignmentResult)
    assert result.created

    async with session_factory() as session:
        events = await session.execute(select(Event))
        event_list = events.scalars().all()
        assert len(event_list) == 2
        new_event = max(event_list, key=lambda ev: ev.id)
        assert new_event.article_count == 1
        links = await session.execute(select(EventArticle).where(EventArticle.event_id == new_event.id))
        assert len(links.scalars().all()) == 1

    await engine.dispose()
