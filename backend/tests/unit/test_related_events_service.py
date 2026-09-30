# ruff: noqa: S101
"""Tests for related-event scoring and persistence (Story 11.8)."""

from __future__ import annotations

import math
from datetime import timedelta

import pytest
from sqlalchemy import select

from backend.app.db.models import EventEntity, EventRelation, LLMInsight
from backend.app.services.related_events_service import (
    CachedEvent,
    EntityRef,
    EventVectorCache,
    RelatedEventsService,
    RelationParams,
)
from backend.tests.unit._exploration_fixtures import (
    BASE_TIME,
    DIM,
    make_session_factory,
    make_settings,
    seed_event,
    unit_vector,
)

PARAMS = RelationParams(top_k=12, min_score=0.30)


def _cache_with(events: dict[int, dict]) -> EventVectorCache:
    cache = EventVectorCache()
    for event_id, spec in events.items():
        cache.upsert_event(
            CachedEvent(
                event_id=event_id,
                slug=f"event-{event_id}",
                event_type=spec.get("type", "politics"),
                article_count=spec.get("articles", 3),
                archived=spec.get("archived", False),
                countries=frozenset(spec.get("countries", [])),
            ),
            spec.get("vector"),
        )
        cache.set_title(event_id, spec.get("title", f"Titel {event_id}"))
        cache.set_entities(
            event_id,
            {
                key: EntityRef(kind=key.split(":")[0], name=name)
                for key, name in spec.get("entities", {}).items()
            },
        )
    return cache


def test_idf_weighting_prefers_rare_shared_entities() -> None:
    common = {"country:nl": "Nederland"}
    events = {
        1: {"entities": {**common, "person:mark-rutte": "Mark Rutte", "org:a": "A"}},
        2: {"entities": {**common, "person:mark-rutte": "Mark Rutte", "org:b": "B"}},
        3: {"entities": {**common, "org:c": "C", "org:d": "D"}},
        4: {"entities": {**common, "org:e": "E"}},
    }
    cache = _cache_with(events)
    assert cache.idf("country:nl") == pytest.approx(math.log(5 / 5))
    assert cache.idf("person:mark-rutte") == pytest.approx(math.log(5 / 3))
    assert cache.idf("person:unknown") == 0.0
    rare = cache.entity_overlap(1, 2)
    common_only = cache.entity_overlap(1, 3)
    assert rare > 0.08
    assert common_only == 0.0  # idf of an entity present everywhere is 0


def test_entity_union_floor_prevents_trivial_overlap() -> None:
    cache = _cache_with(
        {
            1: {"entities": {"place:utrecht": "Utrecht"}},
            2: {"entities": {"place:utrecht": "Utrecht"}},
            3: {"entities": {"org:x": "X"}},
        }
    )
    # shared weight 0.5 * ln(4/3) ~ 0.14; without the floor the overlap would be 1.0
    assert cache.entity_overlap(1, 2) < 0.08
    assert cache.entity_overlap(1, 3) == 0.0
    assert cache.entity_overlap(1, 99) == 0.0


def test_thresholds_and_skip_rule() -> None:
    cache = _cache_with(
        {
            1: {"vector": unit_vector(1.0, 0.0)},
            2: {"vector": unit_vector(0.9, math.sqrt(1 - 0.81))},  # cos 0.9
            3: {"vector": unit_vector(0.5, math.sqrt(0.75))},  # cos 0.5 -> score 0.275
            4: {"vector": unit_vector(0.2, math.sqrt(0.96))},  # cos 0.2 -> skipped
        }
    )
    assert cache.pair_score(1, 2, PARAMS).score == pytest.approx(0.55 * 0.9, abs=1e-5)
    assert cache.pair_score(1, 3, PARAMS) is None  # below min_score
    assert cache.pair_score(1, 3, RelationParams(min_score=0.2)) is not None
    assert cache.pair_score(1, 4, RelationParams(min_score=0.0)) is None  # skip rule
    assert cache.pair_score(1, 1, PARAMS) is None
    assert cache.pair_score(99, 2, PARAMS) is None
    assert [pair.related_id for pair in cache.top_related(1, PARAMS)] == [2]
    assert cache.top_related(99, PARAMS) == []


def test_score_is_weighted_sum_and_clipped() -> None:
    cache = _cache_with(
        {
            1: {
                "vector": unit_vector(1.0),
                "countries": ["IL", "PS"],
                "entities": {"person:a": "A"},
            },
            2: {"vector": unit_vector(1.0), "countries": ["IL"], "entities": {"person:a": "A"}},
            3: {"entities": {"org:z": "Z"}},
        }
    )
    pair = cache.pair_score(1, 2, PARAMS)
    expected = 0.55 * 1.0 + 0.35 * pair.entity_overlap + 0.10 * 0.5
    assert pair.country_overlap == pytest.approx(0.5)
    assert pair.score == pytest.approx(expected, abs=1e-5)
    heavy = RelationParams(weight_embedding=1.0, weight_entities=1.0, weight_countries=1.0)
    assert cache.pair_score(1, 2, heavy).score == 1.0


def test_reasons_and_title_filter() -> None:
    cache = _cache_with(
        {
            1: {
                "vector": unit_vector(1.0),
                "countries": ["IL"],
                "type": "international",
                "entities": {
                    "person:donald-trump": "Donald Trump",
                    "group:hamas": "Hamas",
                    "place:gaza": "Gaza",
                    "org:vn": "VN",
                    "country:il": "Israël",
                },
            },
            2: {
                "vector": unit_vector(0.95, math.sqrt(1 - 0.95**2)),
                "countries": ["IL", "US"],
                "type": "international",
                "entities": {
                    "person:donald-trump": "Trump",
                    "group:hamas": "Hamas",
                    "place:gaza": "Gaza",
                    "org:vn": "Verenigde Naties",
                    "country:il": "Israël",
                },
            },
            3: {"vector": unit_vector(1.0), "title": None},  # no LLM title
            4: {"vector": unit_vector(0.99, 0.141), "archived": True},  # archived: allowed
            5: {"entities": {"org:other": "Other"}},
        }
    )
    related = cache.top_related(1, PARAMS)
    # 2 shares entities, country and category; 4 is archived but still a candidate
    assert [pair.related_id for pair in related] == [2, 4]
    pair = next(p for p in related if p.related_id == 2)
    reasons = cache.reasons(1, 2, pair)
    entity_reasons = [r for r in reasons if r["type"] == "entity"]
    assert len(entity_reasons) == 3
    assert entity_reasons[0] == {
        "type": "entity",
        "key": "person:donald-trump",
        "name": "Donald Trump",  # name from the viewer's perspective
        "kind": "person",
    }
    assert all(r["key"] != "country:il" for r in entity_reasons)  # covered by country reason
    assert {"type": "country", "iso": "IL"} in reasons
    assert {"type": "category", "value": "international"} in reasons
    assert {"type": "topic", "similarity": 0.95} in reasons
    reverse = cache.reasons(2, 1, pair)
    assert reverse[0]["name"] == "Trump"
    assert cache.reasons(1, 99, pair) == []


def test_top_k_cap_and_vector_validation() -> None:
    events = {1: {"vector": unit_vector(1.0)}}
    for event_id in range(2, 20):
        events[event_id] = {"vector": unit_vector(1.0, event_id / 100)}
    cache = _cache_with(events)
    related = cache.top_related(1, RelationParams(top_k=5))
    assert len(related) == 5
    assert [pair.related_id for pair in related] == [2, 3, 4, 5, 6]
    # wrong dimension / zero vectors / garbage are ignored
    cache.upsert_event(CachedEvent(event_id=50), [1.0, 2.0])
    cache.upsert_event(CachedEvent(event_id=51), [0.0] * DIM)
    cache.upsert_event(CachedEvent(event_id=52), ["x"] * DIM)
    assert {50, 51, 52}.isdisjoint(cache.vectors)
    cache.remove_event(2)
    assert 2 not in cache.events
    # with a configured dimension a malformed first vector cannot poison the cache
    configured = EventVectorCache(dimension=DIM)
    configured.upsert_event(CachedEvent(event_id=1), [1.0, 2.0])
    configured.upsert_event(CachedEvent(event_id=2), unit_vector(1.0))
    assert set(configured.vectors) == {2}
    configured.clear()
    configured.upsert_event(CachedEvent(event_id=3), [1.0, 2.0])
    assert configured.vectors == {}
    assert cache.stats()["events"] == len(cache.events)


@pytest.mark.asyncio
async def test_persistence_both_directions_pruning_and_reconciliation() -> None:
    factory, engine = await make_session_factory()
    base = unit_vector(1.0)
    a = await seed_event(factory, slug="a", llm_title="Event A titel", embedding=base)
    b = await seed_event(
        factory, slug="b", llm_title="Event B titel", embedding=unit_vector(0.95, 0.312)
    )
    c = await seed_event(
        factory, slug="c", llm_title="Event C titel", embedding=unit_vector(0.9, -0.436)
    )
    far = await seed_event(factory, slug="far", llm_title="Ver weg", embedding=unit_vector(0, 1))
    untitled = await seed_event(factory, slug="untitled", llm_title=None, embedding=base)
    settings = make_settings(related_events_top_k=1)
    service = RelatedEventsService(
        settings=settings,
        read_session_factory=factory,
        write_session_factory=factory,
    )

    result = await service.refresh([a])

    async with factory() as session:
        rows = (await session.execute(select(EventRelation))).scalars().all()
    pairs = {(row.event_id, row.related_event_id) for row in rows}
    assert (a, b) in pairs  # best outgoing (top_k=1)
    assert (b, a) in pairs  # reverse row
    assert all(untitled not in pair and far not in pair for pair in pairs)
    row = next(r for r in rows if (r.event_id, r.related_event_id) == (b, a))
    assert row.related_title == "Event A titel"
    assert row.related_slug == "a"
    assert row.reasons[-1]["type"] == "topic"
    assert result.outgoing_rows == 1 and result.reverse_rows == 1

    # C is recomputed: its top-1 is A, so A->C is not written but C->A is; B keeps B->A
    await service.refresh([c])
    async with factory() as session:
        pairs = {
            (r.event_id, r.related_event_id)
            for r in (await session.execute(select(EventRelation))).scalars().all()
        }
    assert (c, a) in pairs and (a, b) in pairs
    assert (a, c) not in pairs  # A was pruned back to its top-1 (B)

    # A moves far away: incoming rows that no longer qualify are deleted
    service.cache.upsert_event(
        CachedEvent(event_id=a, slug="a", title="Event A titel"), unit_vector(0, 0, 1)
    )
    result = await service.refresh([a], refresh_cache=False)
    async with factory() as session:
        pairs = {
            (r.event_id, r.related_event_id)
            for r in (await session.execute(select(EventRelation))).scalars().all()
        }
    assert all(a not in pair for pair in pairs)
    assert result.deleted_rows >= 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_missing_events_are_evicted_from_cache() -> None:
    factory, engine = await make_session_factory()
    a = await seed_event(factory, slug="a", embedding=unit_vector(1.0))
    service = RelatedEventsService(
        settings=make_settings(), read_session_factory=factory, write_session_factory=factory
    )
    await service.refresh_cache()
    service.cache.upsert_event(CachedEvent(event_id=777, title="Spook"), unit_vector(1.0))
    result = await service.refresh([a, 888], refresh_cache=False)
    assert result.missing == [888]
    assert 777 not in service.cache.events
    async with factory() as session:
        assert (await session.execute(select(EventRelation))).scalars().all() == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_cache_delta_refresh_picks_up_changes() -> None:
    factory, engine = await make_session_factory()
    a = await seed_event(factory, slug="a", llm_title="Titel A", embedding=unit_vector(1.0))
    service = RelatedEventsService(
        settings=make_settings(), read_session_factory=factory, write_session_factory=factory
    )
    await seed_event(
        factory,
        slug="old",
        llm_title="Oud event",
        embedding=unit_vector(0, 1.0),
        last_updated_at=BASE_TIME - timedelta(days=5),
    )
    stats = await service.refresh_cache()
    assert stats["full"] is True
    assert stats["events_loaded"] == 2
    assert service.cache.events[a].title == "Titel A"
    loaded_at = service.cache.loaded_at

    later = BASE_TIME + timedelta(days=2)
    b = await seed_event(
        factory,
        slug="b",
        llm_title="Titel B",
        embedding=unit_vector(0.9, 0.436),
        last_updated_at=later,
    )
    async with factory() as session:
        session.add(
            EventEntity(
                event_id=b,
                entity_key="person:x",
                name="X",
                kind="person",
                aliases=["x"],
                event_title="Titel B",
                computed_at=later,
            )
        )
        session.add(
            LLMInsight(
                event_id=a,
                provider="deepseek",
                model="deepseek-chat",
                summary="Nieuwe titel A\n\nTekst",
                generated_at=later,
            )
        )
        await session.commit()

    stats = await service.refresh_cache()
    assert stats["full"] is False
    assert stats["events_loaded"] == 2  # A (watermark, inclusive) and B; not the old event
    assert stats["titles_loaded"] == 3  # A's insight at the watermark, B, A's new insight
    assert service.cache.loaded_at == loaded_at
    assert service.cache.events[b].title == "Titel B"
    assert service.cache.events[a].title == "Nieuwe titel A"
    assert service.cache.entities[b] == {"person:x": EntityRef(kind="person", name="X")}
    assert [pair.related_id for pair in service.compute(a)] == [b]

    full = await service.refresh_cache(full=True)
    assert full["full"] is True and full["events_loaded"] == 3
    assert service.cache.stats()["events_with_entities"] == 1
    await engine.dispose()
