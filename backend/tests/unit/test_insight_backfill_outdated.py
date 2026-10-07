# ruff: noqa: S101
"""The backfill redoes an analysis that leaves out a Dutch outlet that joined later (event 7955)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.app.db.models import Article, Event, EventArticle, LLMInsight
from backend.tests.unit._exploration_fixtures import (
    make_session_factory,
    make_settings,
    real_module,
)

NOW = datetime.now(timezone.utc)


async def seed(
    factory,
    slug: str,
    *,
    outlets: list[tuple[str, timedelta]],
    analysed: int | None,
    generated_ago: timedelta,
    foreign: int = 0,
) -> int:
    """One article per outlet (linked that long ago); the analysis read the first `analysed`."""
    async with factory() as session:
        event = Event(
            slug=slug, title=slug, first_seen_at=NOW, last_updated_at=NOW, article_count=1
        )
        session.add(event)
        await session.flush()
        ids: list[int] = []
        sources = [(name, ago, False) for name, ago in outlets]
        sources += [(f"Buitenland {i}", timedelta(hours=2), True) for i in range(foreign)]
        for i, (name, ago, international) in enumerate(sources):
            article = Article(
                guid=f"{slug}-{i}",
                url=f"https://example.com/{slug}/{i}",
                title=f"{name} over {slug}",
                content="tekst",
                source_name=name,
                is_international=international,
            )
            session.add(article)
            await session.flush()
            session.add(EventArticle(event_id=event.id, article_id=article.id, linked_at=NOW - ago))
            ids.append(article.id)
        if analysed is not None:
            session.add(
                LLMInsight(
                    event_id=event.id,
                    provider="claude-code",
                    model="claude-code:sonnet",
                    prompt_metadata={"selected_article_ids": ids[:analysed]},
                    timeline=[],
                    clusters=[],
                    contradictions=[],
                    fallacies=[],
                    raw_response="{}",
                    generated_at=NOW - generated_ago,
                )
            )
        await session.commit()
        return event.id


def make_service(factory):
    module = real_module("backend.app.services.insight_service")
    return module.InsightService(
        session_factory=factory,
        prompt_builder=SimpleNamespace(),
        client=SimpleNamespace(provider="stub"),
        settings=make_settings(mistral_api_key="test", llm_prompt_article_cap=8),
    )


@pytest.mark.asyncio
async def test_finds_an_outlet_that_joined_while_the_analysis_ran() -> None:
    factory, engine = await make_session_factory()
    # AD seeds the event, De Telegraaf joins 35 s later; the analysis read only AD
    stockholm = await seed(
        factory,
        "stockholm",
        outlets=[("AD", timedelta(minutes=63)), ("De Telegraaf", timedelta(minutes=62))],
        analysed=1,
        generated_ago=timedelta(minutes=60),
    )
    # Same, but the analysis is younger than INSIGHT_REFRESH_TTL: EventService may still redo it
    fresh = await seed(
        factory,
        "fresh",
        outlets=[("AD", timedelta(minutes=12)), ("NOS", timedelta(minutes=11))],
        analysed=1,
        generated_ago=timedelta(minutes=10),
    )
    # Both outlets read
    complete = await seed(
        factory,
        "complete",
        outlets=[("AD", timedelta(minutes=63)), ("NOS", timedelta(minutes=62))],
        analysed=2,
        generated_ago=timedelta(minutes=60),
    )
    # The analysis read 6 of 7 Dutch outlets: all the prompt has room for (cap 8, 2 kept for abroad)
    full = await seed(
        factory,
        "full",
        outlets=[(f"Bron {i}", timedelta(minutes=70 - i)) for i in range(7)],
        analysed=6,
        generated_ago=timedelta(minutes=60),
        foreign=2,
    )

    found = await make_service(factory)._events_missing_dutch_outlets(limit=10)

    assert found == [stockholm]
    assert fresh not in found and complete not in found and full not in found
    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_does_missing_analyses_first_then_outdated_ones() -> None:
    factory, engine = await make_session_factory()
    outdated = await seed(
        factory,
        "outdated",
        outlets=[("AD", timedelta(minutes=63)), ("De Telegraaf", timedelta(minutes=62))],
        analysed=1,
        generated_ago=timedelta(minutes=60),
    )
    missing = await seed(
        factory,
        "missing",
        outlets=[("NOS", timedelta(minutes=5))],
        analysed=None,
        generated_ago=timedelta(0),
    )
    service = make_service(factory)
    calls: list[int] = []

    async def generate_for_event(event_id: int, *, correlation_id: str | None = None):
        calls.append(event_id)

    service.generate_for_event = generate_for_event

    stats = await service.backfill_missing_insights(limit=5)

    assert calls == [missing, outdated]
    assert stats["events_found"] == 2
    assert stats["events_outdated"] == 1

    calls.clear()
    await service.backfill_missing_insights(limit=1)
    assert calls == [missing]
    await engine.dispose()
