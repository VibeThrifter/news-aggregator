# ruff: noqa: S101
"""Tests for ExplorationRepository (Story 11.8)."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from backend.app.db.models import EventEntity, EventRelation
from backend.app.repositories.exploration_repo import DisplayFields, ExplorationRepository
from backend.tests.unit._exploration_fixtures import (
    BASE_TIME,
    make_session_factory,
    seed_event,
)


def _entity_row(event_id: int, key: str, *, computed_at=BASE_TIME, **overrides):
    kind = key.split(":")[0]
    row = {
        "event_id": event_id,
        "entity_key": key,
        "name": key.split(":")[1].title(),
        "kind": kind,
        "iso_code": None,
        "aliases": [key.split(":")[1]],
        "mention_count": 2,
        "article_count": 1,
        "outlet_counts": {"NOS": 2},
        "article_ids": [11, 42],
        "salience": 0.5,
        "event_slug": f"event-{event_id}",
        "event_title": f"Titel {event_id}",
        "event_type": "politics",
        "event_last_updated_at": BASE_TIME,
        "computed_at": computed_at,
    }
    row.update(overrides)
    return row


def _relation_row(source: int, target: int, score: float, **overrides):
    row = {
        "event_id": source,
        "related_event_id": target,
        "score": score,
        "embedding_similarity": score,
        "entity_overlap": 0.1,
        "country_overlap": 0.0,
        "reasons": [{"type": "topic", "similarity": score}],
        "related_slug": f"event-{target}",
        "related_title": f"Titel {target}",
        "related_event_type": "politics",
        "related_article_count": 3,
        "related_first_seen_at": BASE_TIME,
        "related_last_updated_at": BASE_TIME,
        "computed_at": BASE_TIME,
    }
    row.update(overrides)
    return row


async def _seeded():
    factory, engine = await make_session_factory()
    ids = [await seed_event(factory, slug=f"event-{n}") for n in range(5)]
    return factory, engine, ids


@pytest.mark.asyncio
async def test_replace_entities_index_and_freshness() -> None:
    factory, engine, ids = await _seeded()
    a, b = ids[0], ids[1]
    later = BASE_TIME + timedelta(hours=1)
    async with factory() as session:
        repo = ExplorationRepository(session)
        assert await repo.replace_event_entities([a], [_entity_row(a, "person:x")]) == 1
        written = await repo.replace_event_entities(
            [a, b],
            [
                _entity_row(a, "person:y"),
                _entity_row(b, "org:z", computed_at=later, event_last_updated_at=later),
            ],
        )
        await session.commit()
        assert written == 2
        index = await repo.load_entity_index()
        assert {(row.event_id, row.entity_key) for row in index} == {
            (a, "person:y"),
            (b, "org:z"),
        }
        delta = await repo.load_entity_index(since=later)
        assert [(row.event_id, row.entity_key, row.kind) for row in delta] == [(b, "org:z", "org")]
        freshness = await repo.entity_freshness()
        assert freshness[a].replace(tzinfo=None) == BASE_TIME.replace(tzinfo=None)
        assert freshness[b].replace(tzinfo=None) == later.replace(tzinfo=None)
        assert await repo.existing_event_ids([a, b, 999]) == {a, b}
    await engine.dispose()


@pytest.mark.asyncio
async def test_replace_entities_persists_article_ids() -> None:
    factory, engine, ids = await _seeded()
    a = ids[0]
    without_ids = _entity_row(a, "org:nordvind")
    del without_ids["article_ids"]
    async with factory() as session:
        repo = ExplorationRepository(session)
        await repo.replace_event_entities(
            [a], [_entity_row(a, "person:x", article_ids=[3, 5, 8]), without_ids]
        )
        await session.commit()
    async with factory() as session:
        rows = {
            row.entity_key: row
            for row in (await session.execute(select(EventEntity))).scalars().all()
        }
    assert rows["person:x"].article_ids == [3, 5, 8]
    assert rows["org:nordvind"].article_ids == []  # column default
    await engine.dispose()


@pytest.mark.asyncio
async def test_upsert_conflict_updates_existing_row() -> None:
    factory, engine, ids = await _seeded()
    a, b = ids[0], ids[1]
    async with factory() as session:
        repo = ExplorationRepository(session)
        await repo.upsert_relations([_relation_row(a, b, 0.4)])
        count = await repo.upsert_relations(
            [
                _relation_row(a, b, 0.5, related_title="Nieuwe titel"),
                _relation_row(a, b, 0.7, related_title="Laatste titel"),  # deduplicated
            ]
        )
        await session.commit()
        assert count == 1
        rows = (await session.execute(select(EventRelation))).scalars().all()
    assert len(rows) == 1
    assert rows[0].score == pytest.approx(0.7)
    assert rows[0].related_title == "Laatste titel"
    await engine.dispose()


@pytest.mark.asyncio
async def test_replace_outgoing_incoming_delete_and_prune() -> None:
    factory, engine, ids = await _seeded()
    a, b, c, d, e = ids
    async with factory() as session:
        repo = ExplorationRepository(session)
        await repo.upsert_relations(
            [
                _relation_row(a, b, 0.9),
                _relation_row(a, c, 0.8),
                _relation_row(b, a, 0.9),
                _relation_row(c, a, 0.8),
                _relation_row(d, a, 0.5),
                _relation_row(d, b, 0.6),
                _relation_row(d, c, 0.7),
                _relation_row(d, e, 0.4),
            ]
        )
        written = await repo.replace_outgoing_relations([a], [_relation_row(a, e, 0.35)])
        assert written == 1
        incoming = await repo.load_incoming_pairs([a], exclude_sources=[b])
        assert sorted(incoming) == [(c, a), (d, a)]
        assert await repo.delete_relation_pairs([(c, a), (c, a), (999, a)]) == 1
        pruned = await repo.prune_relations([d], keep=2)
        await session.commit()
        assert pruned == 2
        rows = (await session.execute(select(EventRelation))).scalars().all()
    pairs = {(row.event_id, row.related_event_id) for row in rows}
    assert (a, b) not in pairs and (a, e) in pairs
    assert {(src, dst) for src, dst in pairs if src == d} == {(d, c), (d, b)}
    await engine.dispose()


@pytest.mark.asyncio
async def test_refresh_display_fields_and_counts() -> None:
    factory, engine, ids = await _seeded()
    a, b = ids[0], ids[1]
    display = DisplayFields(
        slug="nieuwe-slug",
        title="Bijgewerkte LLM titel",
        event_type="crime",
        article_count=9,
        first_seen_at=BASE_TIME,
        last_updated_at=BASE_TIME + timedelta(days=1),
    )
    async with factory() as session:
        repo = ExplorationRepository(session)
        empty = await repo.counts()
        assert empty["event_entities_rows"] == 0 and empty["relations_last_computed_at"] is None
        await repo.upsert_relations([_relation_row(b, a, 0.5)])
        await repo.replace_event_entities([a], [_entity_row(a, "person:x")])
        updated = await repo.refresh_display_fields(a, display)
        await session.commit()
        assert updated == 2
        relation = (await session.execute(select(EventRelation))).scalars().one()
        entity = (await session.execute(select(EventEntity))).scalars().one()
        counts = await repo.counts()
    assert relation.related_title == "Bijgewerkte LLM titel"
    assert relation.related_slug == "nieuwe-slug"
    assert relation.related_article_count == 9
    assert entity.event_title == "Bijgewerkte LLM titel"
    assert entity.event_type == "crime"
    assert counts["event_entities_rows"] == 1
    assert counts["events_with_entities"] == 1
    assert counts["event_relations_rows"] == 1
    assert counts["events_with_relations"] == 1
    assert counts["entities_last_computed_at"] is not None
    await engine.dispose()
