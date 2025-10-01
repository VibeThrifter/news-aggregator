from __future__ import annotations

from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle
from backend.app.events.maintenance import EventMaintenanceService
from backend.app.services.vector_index import VectorIndexService


def _serialize(vector: list[float]) -> bytes:
    return array("f", vector).tobytes()


def _vector(x: float, y: float = 0.0, length: int = 64) -> list[float]:
    padding = [0.0] * max(0, length - 2)
    return [x, y, *padding[: length - 2]]


@pytest.mark.asyncio
async def test_event_maintenance_recomputes_and_archives(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Use small embeddings for faster tests
    monkeypatch.setenv("EMBEDDING_DIMENSION", "64")
    monkeypatch.setenv("EVENT_RETENTION_DAYS", "14")

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    index_path = tmp_path / "maintenance_index.bin"
    metadata_path = tmp_path / "maintenance_index.meta.json"
    vector_service = VectorIndexService(dimension=64, index_path=index_path, metadata_path=metadata_path)
    maintenance = EventMaintenanceService(session_factory=session_factory, vector_index=vector_service)

    now = datetime.now(timezone.utc)

    fresh_event_id = 0
    stale_event_id = 0

    async with session_factory() as session:
        fresh_event = Event(
            slug="fresh-event",
            title="Recente gebeurtenis",
            centroid_embedding=_vector(1.0, 0.0),
            centroid_tfidf={"protest": 1.0},
            centroid_entities=[{"text": "Den Haag", "label": "GPE"}],
            first_seen_at=now - timedelta(days=1),
            last_updated_at=now - timedelta(hours=6),
            article_count=1,
        )
        stale_event = Event(
            slug="stale-event",
            title="Oude gebeurtenis",
            centroid_embedding=_vector(0.0, 1.0),
            centroid_tfidf={"verkeersongeluk": 1.0},
            centroid_entities=[{"text": "Amsterdam", "label": "GPE"}],
            first_seen_at=now - timedelta(days=20),
            last_updated_at=now - timedelta(days=20),
            article_count=1,
        )
        session.add_all([fresh_event, stale_event])
        await session.flush()
        fresh_event_id = fresh_event.id
        stale_event_id = stale_event.id

        article_recent = Article(
            guid="recent-1",
            url="https://example.com/recent-1",
            title="Recente update",
            summary="",
            content="",
            source_name="NOS",
            embedding=_serialize(_vector(1.0, 0.0)),
            tfidf_vector={"protest": 0.8, "den": 0.2},
            entities=[{"text": "Den Haag", "label": "GPE"}],
            published_at=now - timedelta(hours=4),
            fetched_at=now - timedelta(hours=4),
        )
        article_recent_2 = Article(
            guid="recent-2",
            url="https://example.com/recent-2",
            title="Tweede update",
            summary="",
            content="",
            source_name="NU.nl",
            embedding=_serialize(_vector(0.0, 1.0)),
            tfidf_vector={"protest": 0.7, "den": 0.3},
            entities=[{"text": "Den Haag", "label": "GPE"}],
            published_at=now - timedelta(hours=3),
            fetched_at=now - timedelta(hours=3),
        )
        article_old = Article(
            guid="old-1",
            url="https://example.com/old-1",
            title="Oude update",
            summary="",
            content="",
            source_name="NOS",
            embedding=_serialize(_vector(0.0, 1.0)),
            tfidf_vector={"verkeersongeluk": 1.0},
            entities=[{"text": "Amsterdam", "label": "GPE"}],
            published_at=now - timedelta(days=21),
            fetched_at=now - timedelta(days=21),
        )
        session.add_all([article_recent, article_recent_2, article_old])
        await session.flush()

        session.add_all(
            [
                EventArticle(event_id=fresh_event.id, article_id=article_recent.id),
                EventArticle(event_id=fresh_event.id, article_id=article_recent_2.id),
                EventArticle(event_id=stale_event.id, article_id=article_old.id),
            ]
        )
        await session.commit()

    stats = await maintenance.run()

    assert stats.events_processed == 2
    assert stats.events_archived == 1
    assert stats.events_recomputed == 2
    assert stats.vector_upserts >= 1

    async with session_factory() as session:
        refreshed_fresh = await session.get(Event, fresh_event_id)
        assert refreshed_fresh is not None
        assert refreshed_fresh.article_count == 2
        assert refreshed_fresh.centroid_embedding is not None
        assert refreshed_fresh.centroid_embedding is not None
        assert pytest.approx(refreshed_fresh.centroid_embedding[0], rel=1e-6) == 0.5
        assert pytest.approx(refreshed_fresh.centroid_embedding[1], rel=1e-6) == 0.5
        archived = await session.execute(select(Event).where(Event.id == stale_event_id))
        archived_event = archived.scalar_one()
        assert archived_event.archived_at is not None

    indexed_ids = vector_service.get_indexed_event_ids()
    assert fresh_event_id in indexed_ids
    assert stale_event_id not in indexed_ids

    await engine.dispose()
