from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle
from backend.app.llm import PromptBuilder, PromptBuilderError
from backend.app.core.config import Settings


@pytest.fixture
def session_factory() -> async_sessionmaker[AsyncSession]:
    """Create an in-memory SQLite session factory for isolated tests."""
    import asyncio

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

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


async def _seed_event(
    factory: async_sessionmaker[AsyncSession],
    *,
    spectra: Iterable[str],
    content_stub: str | None = "Deterministic inhoud over het event.",
) -> int:
    now = datetime.now(timezone.utc)
    async with factory() as session:
        event = Event(
            slug="test-event",
            title="Test evenement",
            description="Beschrijving van het testevent",
            first_seen_at=now - timedelta(days=1),
            last_updated_at=now,
            article_count=0,
            spectrum_distribution={},
        )
        session.add(event)
        await session.flush()

        for idx, spectrum in enumerate(spectra, start=1):
            published = now - timedelta(hours=idx)
            base_content = content_stub if content_stub is not None else ""
            content = f"{base_content} Spectrum {spectrum}." if base_content else ""
            article = Article(
                guid=f"guid-{idx}",
                url=f"https://example.com/{idx}",
                title=f"Artikel {idx}",
                summary=f"Samenvatting artikel {idx}",
                content=content,
                source_name=f"Bron {idx}",
                source_metadata={
                    "name": f"Bron {idx}",
                    "spectrum": spectrum,
                    "media_type": "public_broadcaster" if spectrum == "center" else "private_media",
                },
                published_at=published,
                fetched_at=published,
            )
            session.add(article)
            await session.flush()

            link = EventArticle(
                event_id=event.id,
                article_id=article.id,
                similarity_score=0.9,
                scoring_breakdown={"hybrid": 0.9},
            )
            session.add(link)
            event.article_count += 1

        await session.commit()
        return event.id


@pytest.mark.asyncio
async def test_build_prompt_contains_required_sections(session_factory: async_sessionmaker[AsyncSession]) -> None:
    event_id = await _seed_event(session_factory, spectra=["center", "rechts", "links"])
    # Use 10000 chars to accommodate expanded template (Epic 9 country detection)
    settings = Settings(llm_prompt_article_cap=3, llm_prompt_max_characters=10000)
    builder = PromptBuilder(session_factory=session_factory, settings=settings)

    prompt = await builder.build_prompt(event_id)

    assert '"timeline": [' in prompt
    assert '"clusters": [' in prompt
    assert '"contradictions": [' in prompt
    assert "Bron: Bron 1" in prompt
    # Verify spectrum labels appear in the prompt (format: "Spectrum: {value}")
    assert "Spectrum:" in prompt


@pytest.mark.asyncio
async def test_build_prompt_balances_spectra_and_trims_when_needed(session_factory: async_sessionmaker[AsyncSession]) -> None:
    spectra = ["center", "center", "rechts", "links", "alternatief"]
    long_stub = "Dit is een uitgebreide paragraaf die wordt herhaald voor prompt trimming. " * 20
    event_id = await _seed_event(session_factory, spectra=spectra, content_stub=long_stub)
    # Use 10000 chars to accommodate expanded template (Epic 9 country detection)
    settings = Settings(llm_prompt_article_cap=5, llm_prompt_max_characters=10000)
    builder = PromptBuilder(session_factory=session_factory, settings=settings)

    prompt = await builder.build_prompt(event_id)

    # Expect spectrum labels to appear in the untrimmed prompt
    assert "Spectrum:" in prompt
    assert len(prompt) <= settings.llm_prompt_max_characters

    # Verify trimming routine shortens the selection under a tighter ceiling
    tight_settings = Settings(llm_prompt_article_cap=5, llm_prompt_max_characters=2500)
    tight_builder = PromptBuilder(session_factory=session_factory, settings=tight_settings)
    async with session_factory() as session:
        event = await tight_builder._fetch_event(session, event_id)
        articles = await tight_builder._fetch_articles(session, event_id)
    capsules = tight_builder._build_capsules(articles)
    selected = tight_builder._select_balanced_subset(capsules, limit=tight_settings.llm_prompt_article_cap)
    context = tight_builder._format_event_context(event, selected, total=len(capsules))
    trimmed_block, trimmed_capsules = tight_builder._trim_prompt(selected, context)
    assert len(trimmed_capsules) < len(selected)
    assert trimmed_block


@pytest.mark.asyncio
async def test_missing_article_content_raises_clear_error(session_factory: async_sessionmaker[AsyncSession]) -> None:
    event_id = await _seed_event(session_factory, spectra=["center"], content_stub=None)
    settings = Settings(llm_prompt_article_cap=3, llm_prompt_max_characters=4000)
    builder = PromptBuilder(session_factory=session_factory, settings=settings)

    with pytest.raises(PromptBuilderError) as exc:
        await builder.build_prompt(event_id)

    assert "verrijkingsstap" in str(exc.value)


def _capsule(
    article_id: int,
    source: str,
    *,
    hours_ago: int,
    spectrum: str = "center",
    international: bool = False,
):
    from backend.app.llm.prompt_builder import ArticleCapsule

    moment = datetime(2026, 10, 6, 21, 0, tzinfo=timezone.utc) - timedelta(hours=hours_ago)
    return ArticleCapsule(
        article_id=article_id,
        title=f"Artikel {article_id}",
        url=f"https://example.com/{article_id}",
        spectrum=spectrum,
        source_name=source,
        source_type="private_media",
        published_at=moment,
        fetched_at=moment,
        summary="",
        key_points=[],
        entities=[],
        is_international=international,
        source_country="US" if international else None,
    )


def test_dutch_outlets_are_not_pushed_out_by_foreign_headlines() -> None:
    """Event 7807 (2026-10-06): eight newer Google News headlines took every place of the prompt."""
    builder = PromptBuilder(settings=Settings(llm_prompt_article_cap=8))
    dutch = [
        _capsule(1, "De Telegraaf", hours_ago=12, spectrum="center-right"),
        _capsule(2, "RTL Nieuws", hours_ago=11),
        _capsule(3, "AD", hours_ago=1),
    ]
    foreign = [
        _capsule(10 + i, f"Buitenland {i}", hours_ago=0, international=True) for i in range(8)
    ]

    selected = builder._select_balanced_subset(dutch + foreign, limit=8)

    assert len(selected) == 8
    dutch_names = {c.source_name for c in selected if not c.is_international}
    assert dutch_names == {"De Telegraaf", "RTL Nieuws", "AD"}
    assert len([c for c in selected if c.is_international]) == 5


def test_every_dutch_outlet_before_a_second_article_of_one() -> None:
    builder = PromptBuilder(settings=Settings(llm_prompt_article_cap=3))
    capsules = [_capsule(i, "NOS", hours_ago=i) for i in range(1, 6)] + [
        _capsule(20, "NU.nl", hours_ago=30),
        _capsule(21, "De Volkskrant", hours_ago=40, spectrum="links"),
    ]

    selected = builder._select_balanced_subset(capsules, limit=3)

    assert sorted(c.source_name for c in selected) == ["De Volkskrant", "NOS", "NU.nl"]
    # The newest NOS article represents NOS
    assert [c.article_id for c in selected if c.source_name == "NOS"] == [1]


def test_keeps_room_for_foreign_outlets_when_dutch_ones_would_fill_the_prompt() -> None:
    builder = PromptBuilder(settings=Settings(llm_prompt_article_cap=8))
    spectra = ["links", "center", "rechts", "center-left", "center-right"]
    dutch = [
        _capsule(i, f"Bron {i}", hours_ago=i, spectrum=spectra[i % len(spectra)]) for i in range(10)
    ]
    foreign = [
        _capsule(50 + i, f"Buitenland {i}", hours_ago=i, international=True) for i in range(3)
    ]

    selected = builder._select_balanced_subset(dutch + foreign, limit=8)

    assert len([c for c in selected if c.is_international]) == 2
    dutch_selected = [c for c in selected if not c.is_international]
    assert len(dutch_selected) == 6
    # Spread over the spectrum: every side is there
    assert {c.spectrum for c in dutch_selected} == set(spectra)
