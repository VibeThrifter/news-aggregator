from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle
from backend.app.llm import PromptBuilder, PromptBuilderError
from backend.app.core.config import Settings


@pytest.fixture
def session_factory(event_loop: asyncio.AbstractEventLoop, request: pytest.FixtureRequest) -> async_sessionmaker[AsyncSession]:
    """Create an in-memory SQLite session factory for isolated tests."""

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def initialise() -> async_sessionmaker[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return async_sessionmaker(engine, expire_on_commit=False)

    factory = event_loop.run_until_complete(initialise())

    async def teardown() -> None:
        await engine.dispose()

    request.addfinalizer(lambda: event_loop.run_until_complete(teardown()))
    return factory


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
    settings = Settings(llm_prompt_article_cap=3, llm_prompt_max_characters=6000)
    builder = PromptBuilder(session_factory=session_factory, settings=settings)

    prompt = await builder.build_prompt(event_id)

    assert '"timeline": [' in prompt
    assert '"clusters": [' in prompt
    assert '"contradictions": [' in prompt
    assert "Bron: Bron 1" in prompt
    assert "Spectrum: center" in prompt
    assert "Spectrum: rechts" in prompt
    assert "Spectrum: links" in prompt


@pytest.mark.asyncio
async def test_build_prompt_balances_spectra_and_trims_when_needed(session_factory: async_sessionmaker[AsyncSession]) -> None:
    spectra = ["center", "center", "rechts", "links", "alternatief"]
    long_stub = "Dit is een uitgebreide paragraaf die wordt herhaald voor prompt trimming. " * 20
    event_id = await _seed_event(session_factory, spectra=spectra, content_stub=long_stub)
    settings = Settings(llm_prompt_article_cap=5, llm_prompt_max_characters=6000)
    builder = PromptBuilder(session_factory=session_factory, settings=settings)

    prompt = await builder.build_prompt(event_id)

    # Expect at least one representative per spectrum in the untrimmed prompt
    assert "Spectrum: rechts" in prompt
    assert "Spectrum: links" in prompt
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
