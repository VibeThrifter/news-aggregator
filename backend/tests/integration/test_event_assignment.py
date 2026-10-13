from __future__ import annotations

import asyncio
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle
from backend.app.llm.client import BaseLLMClient, LLMRateLimitError, LLMResponse
from backend.app.services.event_service import EventAssignmentResult, EventService
from backend.app.services.vector_index import VectorIndexService


def _serialize_embedding(vector: list[float]) -> bytes:
    buffer = array("f", vector)
    return buffer.tobytes()


class StubLLM(BaseLLMClient):
    """Answers the event decision without network (or fails like a rate-limited provider)."""

    provider = "stub"

    def __init__(self, answer: str | None = None, error: Exception | None = None) -> None:
        self.answer = answer
        self.error = error
        self.calls = 0

    async def generate_text(self, prompt, *, temperature=None, max_tokens=None, correlation_id=None):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return LLMResponse(provider="stub", model="stub", content=self.answer or "")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("llm", "expect_created"),
    [
        (StubLLM(answer="EVENT_1"), False),
        # A failed call is no verdict: the scores decide, so the story is not split
        (StubLLM(error=LLMRateLimitError("Mistral gaf status 429", provider="mistral")), False),
        # An unclear answer neither
        (StubLLM(answer="weet ik niet"), False),
        # An explicit NEW_EVENT is respected
        (StubLLM(answer="NEW_EVENT"), True),
    ],
    ids=["llm-picks-event", "llm-outage-uses-scores", "llm-unclear-uses-scores", "llm-new-event"],
)
async def test_assign_article_to_existing_event_or_new(
    tmp_path: Path, llm: StubLLM, expect_created: bool
) -> None:
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
        llm_client=llm,
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
    assert llm.calls == 1
    assert result.created is expect_created
    if expect_created:
        assert result.event_id != event_id
        await engine.dispose()
        return
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
        llm_client=StubLLM(answer="EVENT_1"),
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("published_ago", "first_seen_ago"),
    [
        # A source that catches up: the news is from two days ago, not from now
        (timedelta(days=2), timedelta(days=2)),
        # A clock that runs ahead does not put the news in the future
        (-timedelta(hours=1), timedelta(0)),
    ],
    ids=["published-earlier", "published-ahead"],
)
async def test_new_event_starts_when_its_article_came_out(
    tmp_path: Path, published_ago: timedelta, first_seen_ago: timedelta
) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    vector_service = VectorIndexService(
        dimension=3, index_path=tmp_path / "index3.bin", metadata_path=tmp_path / "index3.meta.json"
    )
    service = EventService(
        session_factory=session_factory,
        vector_index=vector_service,
        auto_generate_insights=False,
        llm_client=StubLLM(answer="NEW_EVENT"),
    )

    now = datetime.now(timezone.utc)

    async with session_factory() as session:
        article = Article(
            guid="guid-late",
            url="https://www.trouw.nl/binnenland/artikel~b1/",
            title="Kabinet presenteert asielwet",
            content="Volledige tekst",
            source_name="Trouw",
            normalized_text="volledige tekst",
            embedding=_serialize_embedding([1.0, 0.0, 0.0]),
            tfidf_vector={"asielwet": 1.0},
            entities=[{"text": "Kabinet", "label": "ORG"}],
            published_at=now - published_ago,
            fetched_at=now,
        )
        session.add(article)
        await session.commit()
        article_id = article.id

    async with session_factory() as session:
        await vector_service.ensure_ready(session)

    result = await service.assign_article(article_id=article_id)
    assert result is not None and result.created

    async with session_factory() as session:
        event = (await session.execute(select(Event))).scalar_one()
        first_seen = event.first_seen_at.replace(tzinfo=timezone.utc)
        last_updated = event.last_updated_at.replace(tzinfo=timezone.utc)
        assert abs(first_seen - (now - first_seen_ago)) < timedelta(minutes=1)
        # Activity stays the moment of linking (archiving and the period filter use it)
        assert last_updated >= now

    await engine.dispose()


# --- The LLM judges every candidate that may be the same news (2026-10-08) ----------------------


class _World:
    """An in-memory database and vector index with an event service around a stub LLM."""

    def __init__(self, tmp_path: Path, llm: StubLLM) -> None:
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)
        self.vector_index = VectorIndexService(
            dimension=3, index_path=tmp_path / "index.bin", metadata_path=tmp_path / "index.meta.json"
        )
        self.service = EventService(
            session_factory=self.session_factory,
            vector_index=self.vector_index,
            auto_generate_insights=False,
            llm_client=llm,
        )
        self.now = datetime.now(timezone.utc)

    async def __aenter__(self) -> "_World":
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return self

    async def __aexit__(self, *exc) -> None:
        await self.engine.dispose()

    async def event(self, *, title: str, embedding, tfidf, entities, event_type=None, articles=()) -> int:
        async with self.session_factory() as session:
            event = Event(
                slug=title.lower().replace(" ", "-"),
                title=title,
                event_type=event_type,
                centroid_embedding=list(embedding),
                centroid_tfidf=dict(tfidf),
                centroid_entities=list(entities),
                first_seen_at=self.now - timedelta(hours=5),
                last_updated_at=self.now - timedelta(hours=1),
                article_count=len(articles),
            )
            session.add(event)
            await session.flush()
            for article_id in articles:
                session.add(EventArticle(event_id=event.id, article_id=article_id, similarity_score=1.0, linked_at=self.now))
            await session.commit()
            return event.id

    async def article(
        self,
        *,
        guid: str,
        title: str,
        source: str,
        embedding,
        tfidf,
        entities,
        event_type=None,
        fetched_ago=timedelta(0),
        published_ago: timedelta | None = None,
    ) -> int:
        async with self.session_factory() as session:
            article = Article(
                guid=guid,
                url=f"https://example.com/{guid}",
                title=title,
                content=f"{title}. Volledige tekst.",
                source_name=source,
                source_metadata={"name": source},
                normalized_text="volledige tekst",
                embedding=_serialize_embedding(list(embedding)),
                tfidf_vector=dict(tfidf),
                entities=list(entities),
                event_type=event_type,
                published_at=self.now - (fetched_ago if published_ago is None else published_ago),
                fetched_at=self.now - fetched_ago,
            )
            session.add(article)
            await session.commit()
            return article.id

    async def index(self) -> None:
        async with self.session_factory() as session:
            await self.vector_index.ensure_ready(session)

    async def events(self) -> list[Event]:
        async with self.session_factory() as session:
            return list((await session.execute(select(Event).order_by(Event.id))).scalars().all())

    async def event_of(self, article_id: int) -> int | None:
        async with self.session_factory() as session:
            return (
                await session.execute(select(EventArticle.event_id).where(EventArticle.article_id == article_id))
            ).scalar_one_or_none()


# Same news, other words: an outlet names other people and places, so the hybrid score stays low
# (about 0.25 with the entity penalty), far under the threshold (0.60), but the embeddings (0.8) and
# the shared words (0.46) say "maybe the same"
PROTEST = dict(embedding=[1.0, 0.0, 0.0], tfidf={"protest": 0.7, "den": 0.3}, entities=[{"text": "Den Haag", "label": "GPE"}])
PROTEST_OTHER_WORDS = dict(
    embedding=[0.8, 0.6, 0.0],
    tfidf={"protest": 0.5, "haag": 0.5, "politie": 0.7},
    entities=[{"text": "Rotterdam", "label": "GPE"}, {"text": "Politie", "label": "ORG"}],
)


@pytest.mark.asyncio
async def test_the_llm_verdict_joins_an_event_below_the_score_threshold(tmp_path: Path) -> None:
    """Before, the LLM was only asked from a score of 0.55, and a verdict under 0.60 was overruled."""
    llm = StubLLM(answer="EVENT_1")
    async with _World(tmp_path, llm) as world:
        event_id = await world.event(title="Protest in Den Haag", **PROTEST)
        article_id = await world.article(guid="nu-1", title="Politie grijpt in bij protest", source="NU.nl", **PROTEST_OTHER_WORDS)
        await world.index()

        result = await world.service.assign_article(article_id)

        assert llm.calls == 1
        assert result is not None and not result.created
        assert result.event_id == event_id
        assert result.score < result.threshold


@pytest.mark.asyncio
async def test_a_type_mismatch_is_left_to_the_llm(tmp_path: Path) -> None:
    """Classifiers disagree on the same news ("politics" and "business"): before, the article only
    reached a candidate of another type above 0.70."""
    llm = StubLLM(answer="EVENT_1")
    async with _World(tmp_path, llm) as world:
        event_id = await world.event(title="Protest in Den Haag", event_type="business", **PROTEST)
        article_id = await world.article(
            guid="nu-2", title="Politie grijpt in bij protest", source="NU.nl", event_type="politics", **PROTEST_OTHER_WORDS
        )
        await world.index()

        result = await world.service.assign_article(article_id)

        assert llm.calls == 1
        assert result is not None and result.event_id == event_id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fetched_ago", "published_ago", "deferred"),
    [
        (timedelta(hours=1), None, True),
        (timedelta(hours=30), None, False),
        # Fetched just now, but news of 22 hours ago: the catch-up looks at the last 24 hours only
        (timedelta(hours=1), timedelta(hours=22), False),
    ],
)
async def test_an_article_the_llm_had_to_judge_waits_while_it_is_unavailable(
    tmp_path: Path, fetched_ago: timedelta, published_ago: timedelta | None, deferred: bool
) -> None:
    """During the Claude Code session limit every article started an event of its own. Now it
    waits for the next round (as an orphan), but only while its news is current."""
    llm = StubLLM(error=LLMRateLimitError("Claude Code faalde: You've hit your session limit", provider="claude-code"))
    async with _World(tmp_path, llm) as world:
        await world.event(title="Protest in Den Haag", **PROTEST)
        article_id = await world.article(
            guid="nu-3",
            title="Politie grijpt in bij protest",
            source="NU.nl",
            fetched_ago=fetched_ago,
            published_ago=published_ago,
            **PROTEST_OTHER_WORDS,
        )
        await world.index()

        result = await world.service.assign_article(article_id)

        assert llm.calls == 1
        if deferred:
            assert result is None
            assert await world.event_of(article_id) is None
            assert len(await world.events()) == 1
        else:
            assert result is not None and result.created


def test_an_article_stops_waiting_before_the_catch_up_stops_looking() -> None:
    """Waiting as long as the catch-up looks (or longer) would leave an article without an event
    for good when the LLM stays unavailable."""
    from backend.app.services.event_service import DEFER_MAX_AGE
    from backend.app.services.ingest_service import ORPHAN_CATCH_UP_MAX_AGE_HOURS

    assert DEFER_MAX_AGE < timedelta(hours=ORPHAN_CATCH_UP_MAX_AGE_HOURS)


@pytest.mark.asyncio
async def test_two_articles_decided_at_the_same_time_share_one_event(tmp_path: Path) -> None:
    """The feed readers run side by side: two outlets' articles on the same news, decided at the
    same moment, each started an event before they were decided one at a time."""
    llm = StubLLM(answer="EVENT_1")
    async with _World(tmp_path, llm) as world:
        first = await world.article(guid="nos-4", title="Protest in Den Haag", source="NOS", **PROTEST)
        second = await world.article(guid="ad-4", title="Protest in Den Haag loopt uit", source="AD", **PROTEST)
        await world.index()

        await asyncio.gather(world.service.assign_article(first), world.service.assign_article(second))

        [event] = await world.events()
        assert event.article_count == 2


@pytest.mark.asyncio
async def test_two_shared_title_words_bring_the_llm_in(tmp_path: Path) -> None:
    """Outlets' boilerplate ("Luister ook naar onze podcast") can keep the shared words of the text
    low, while the titles say it: "BAM koopt bouwbedrijf ..." and "Bouwbedrijf BAM koopt ..."."""
    llm = StubLLM(answer="EVENT_1")
    async with _World(tmp_path, llm) as world:
        event_id = await world.event(
            title="Bouwbedrijf BAM koopt specialist warmtenetten",
            embedding=[1.0, 0.0, 0.0],
            tfidf={"warmtenetten": 1.0},
            entities=[{"text": "BAM", "label": "ORG"}],
        )
        article_id = await world.article(
            guid="ad-5",
            title="BAM koopt bouwbedrijf voor ondergrondse infrastructuur A.Hak",
            source="AD",
            embedding=[0.6, 0.8, 0.0],
            tfidf={"podcast": 0.9, "infrastructuur": 0.4},
            entities=[{"text": "A.Hak", "label": "ORG"}],
        )
        await world.index()

        result = await world.service.assign_article(article_id)

        assert llm.calls == 1
        assert result is not None and result.event_id == event_id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("answer", "joined"),
    [
        ("EVENT_1\n\nIt is no NEW_EVENT: the same people at the same place.", True),
        ("NEW_EVENT\n\nEVENT 1 is about another protest.", False),
    ],
    ids=["event-then-reason", "new-then-reason"],
)
async def test_the_first_verdict_of_an_explained_answer_counts(tmp_path: Path, answer: str, joined: bool) -> None:
    """The model sometimes explains its verdict after it, naming the other options."""
    async with _World(tmp_path, StubLLM(answer=answer)) as world:
        event_id = await world.event(title="Protest in Den Haag", **PROTEST)
        article_id = await world.article(guid="nu-6", title="Politie grijpt in bij protest", source="NU.nl", **PROTEST_OTHER_WORDS)
        await world.index()

        result = await world.service.assign_article(article_id)

        assert result is not None
        assert (result.event_id == event_id) is joined


async def _split_story(world: _World) -> tuple[int, int, int, int]:
    """One story split over two events of one article each (the Telegraaf article came later)."""
    nos = await world.article(guid="nos-7", title="Protest in Den Haag", source="NOS", fetched_ago=timedelta(hours=3), **PROTEST)
    nos_event = await world.event(title="Protest in Den Haag", articles=[nos], **PROTEST)
    telegraaf = await world.article(guid="tel-7", title="Politie grijpt in bij protest", source="De Telegraaf", **PROTEST_OTHER_WORDS)
    telegraaf_event = await world.event(title="Politie grijpt in bij protest", articles=[telegraaf], **PROTEST_OTHER_WORDS)
    await world.index()
    return nos, nos_event, telegraaf, telegraaf_event


@pytest.mark.asyncio
async def test_a_split_story_is_merged_on_the_llms_verdict(tmp_path: Path) -> None:
    async with _World(tmp_path, StubLLM(answer="EVENT_1")) as world:
        nos, nos_event, telegraaf, telegraaf_event = await _split_story(world)

        dry = await world.service.merge_split_events(hours=24, dry_run=True)
        # Newest first: the later article moves to the event that was there before it
        assert [(move["from_event"], move["to_event"]) for move in dry["moves"]] == [(telegraaf_event, nos_event)]
        assert dry["merged"] == 1
        assert await world.event_of(telegraaf) == telegraaf_event

        done = await world.service.merge_split_events(hours=24, dry_run=False)

        assert done["merged"] == 1
        assert await world.event_of(telegraaf) == nos_event
        events = {event.id: event for event in await world.events()}
        assert events[nos_event].article_count == 2
        assert events[nos_event].archived_at is None
        assert events[telegraaf_event].archived_at is not None
        assert events[telegraaf_event].article_count == 0
        assert telegraaf_event not in world.vector_index.get_indexed_event_ids()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("llm", "expected"),
    [
        (StubLLM(answer="NEW_EVENT"), {"merged": 0, "kept": 2}),
        (StubLLM(error=LLMRateLimitError("Claude Code faalde: session limit", provider="claude-code")), {"merged": 0, "stopped": "llm_unavailable"}),
    ],
    ids=["llm-says-new", "llm-unavailable"],
)
async def test_a_split_story_stays_without_the_llms_yes(tmp_path: Path, llm: StubLLM, expected: dict) -> None:
    async with _World(tmp_path, llm) as world:
        _, nos_event, telegraaf, telegraaf_event = await _split_story(world)

        stats = await world.service.merge_split_events(hours=24, dry_run=False)

        assert {key: stats[key] for key in expected} == expected
        assert await world.event_of(telegraaf) == telegraaf_event
        assert all(event.archived_at is None for event in await world.events())


@pytest.mark.asyncio
async def test_an_event_readers_worked_on_is_never_merged(tmp_path: Path, monkeypatch) -> None:
    llm = StubLLM(answer="EVENT_1")
    async with _World(tmp_path, llm) as world:
        _, _, telegraaf, telegraaf_event = await _split_story(world)

        async def reader_content(event_id: int) -> bool:
            return True

        monkeypatch.setattr(world.service, "_has_reader_content", reader_content)
        stats = await world.service.merge_split_events(hours=24, dry_run=False)

        assert stats["merged"] == 0 and stats["skipped"] == 2
        assert llm.calls == 0
        assert await world.event_of(telegraaf) == telegraaf_event



@pytest.mark.asyncio
async def test_an_article_already_in_an_event_is_left_there(tmp_path: Path) -> None:
    """An admin catch-up runs beside the polls: both can hold the same article."""
    llm = StubLLM(answer="EVENT_1")
    async with _World(tmp_path, llm) as world:
        article_id = await world.article(guid="nos-8", title="Protest in Den Haag", source="NOS", **PROTEST)
        event_id = await world.event(title="Protest in Den Haag", articles=[article_id], **PROTEST)
        await world.index()

        result = await world.service.assign_article(article_id)

        assert result is None
        assert llm.calls == 0
        assert await world.event_of(article_id) == event_id
        assert len(await world.events()) == 1



@pytest.mark.asyncio
async def test_a_merge_can_leave_out_the_newest_items(tmp_path: Path) -> None:
    """A second run skips what the first one decided: only items published before the window."""
    llm = StubLLM(answer="NEW_EVENT")
    async with _World(tmp_path, llm) as world:
        await _split_story(world)

        stats = await world.service.merge_split_events(hours=24, older_than_hours=1, dry_run=True)

        # Only the NOS item (3 hours old) is decided again, not the Telegraaf one (just now)
        assert stats["checked"] == 1
        assert llm.calls == 1
