from __future__ import annotations

from array import array
from datetime import datetime, timedelta, timezone
from typing import List

import pytest

from backend.app.db.models import Article, Event
from backend.app.events.maintenance import EventMaintenanceService
from backend.app.repositories import EventMaintenanceBundle


def _serialize(vector: List[float]) -> bytes:
    return array("f", vector).tobytes()


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
