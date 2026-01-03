"""Unit tests for BiasRepository."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.db.models import Article, ArticleBiasAnalysis, Base, Event, EventArticle
from backend.app.repositories.bias_repo import BiasRepository


async def create_session_factory():
    """Create an in-memory SQLite database for testing."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return factory, engine


async def create_sample_article(session_factory) -> int:
    """Create a sample article and return its ID."""
    async with session_factory() as session:
        article = Article(
            guid="test-guid-1",
            url="https://example.com/article1",
            title="Test Article",
            content="Dit is een test artikel. Het bevat meerdere zinnen. Sommige zinnen zijn biased.",
            source_name="TestBron",
        )
        session.add(article)
        await session.commit()
        await session.refresh(article)
        return article.id


async def create_sample_event_with_articles(session_factory) -> tuple[int, list[int]]:
    """Create a sample event with articles and return (event_id, article_ids)."""
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        # Create articles
        article1 = Article(
            guid="event-article-1",
            url="https://example.com/event-article1",
            title="Event Article 1",
            content="Content 1",
            source_name="Source1",
        )
        article2 = Article(
            guid="event-article-2",
            url="https://example.com/event-article2",
            title="Event Article 2",
            content="Content 2",
            source_name="Source2",
        )
        session.add_all([article1, article2])
        await session.flush()

        # Create event
        event = Event(
            slug="test-event",
            title="Test Event",
            first_seen_at=now,
            last_updated_at=now,
            article_count=2,
        )
        session.add(event)
        await session.flush()

        # Link articles to event
        ea1 = EventArticle(event_id=event.id, article_id=article1.id, similarity_score=0.9)
        ea2 = EventArticle(event_id=event.id, article_id=article2.id, similarity_score=0.85)
        session.add_all([ea1, ea2])
        await session.commit()

        return event.id, [article1.id, article2.id]


class TestBiasRepository:
    """Tests for BiasRepository CRUD operations."""

    @pytest.mark.asyncio
    async def test_upsert_creates_new_analysis(self):
        """Test that upsert creates a new analysis when none exists."""
        session_factory, engine = await create_session_factory()
        sample_article = await create_sample_article(session_factory)

        try:
            async with session_factory() as session:
                repo = BiasRepository(session)

                result = await repo.upsert_analysis(
                    article_id=sample_article,
                    provider="mistral",
                    model="mistral-small-latest",
                    total_sentences=10,
                    journalist_bias_count=2,
                    quote_bias_count=1,
                    journalist_bias_percentage=20.0,
                    most_frequent_bias="Word Choice Bias",
                    most_frequent_count=2,
                    average_bias_strength=0.65,
                    overall_rating=0.35,
                    journalist_biases=[
                        {
                            "sentence_index": 1,
                            "sentence_text": "Het omstreden beleid...",
                            "bias_type": "Word Choice Bias",
                            "bias_source": "journalist",
                            "score": 0.7,
                            "explanation": "Geladen woordkeuze",
                        }
                    ],
                    quote_biases=[
                        {
                            "sentence_index": 5,
                            "sentence_text": "'Dit is rampzalig', zei de minister.",
                            "bias_type": "Emotional Sensationalism Bias",
                            "bias_source": "quote",
                            "speaker": "Minister",
                            "score": 0.8,
                            "explanation": "Quote van minister",
                        }
                    ],
                    raw_response='{"test": "response"}',
                )

                assert result.created is True
                assert result.analysis.article_id == sample_article
                assert result.analysis.provider == "mistral"
                assert result.analysis.journalist_bias_count == 2
                assert result.analysis.quote_bias_count == 1
                assert len(result.analysis.journalist_biases) == 1
                assert len(result.analysis.quote_biases) == 1

                await session.commit()
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_upsert_updates_existing_analysis(self):
        """Test that upsert updates an existing analysis for same article/provider."""
        session_factory, engine = await create_session_factory()
        sample_article = await create_sample_article(session_factory)

        try:
            async with session_factory() as session:
                repo = BiasRepository(session)

                # Create initial analysis
                await repo.upsert_analysis(
                    article_id=sample_article,
                    provider="mistral",
                    model="mistral-small-latest",
                    total_sentences=10,
                    journalist_bias_count=2,
                    quote_bias_count=0,
                    journalist_bias_percentage=20.0,
                    most_frequent_bias="Word Choice Bias",
                    most_frequent_count=2,
                    average_bias_strength=0.65,
                    overall_rating=0.35,
                    journalist_biases=[{"sentence_index": 1, "bias_type": "Word Choice Bias"}],
                    quote_biases=[],
                )
                await session.commit()

            # Update in new session
            async with session_factory() as session:
                repo = BiasRepository(session)

                result = await repo.upsert_analysis(
                    article_id=sample_article,
                    provider="mistral",
                    model="mistral-large-latest",  # Updated model
                    total_sentences=10,
                    journalist_bias_count=3,  # Updated count
                    quote_bias_count=0,
                    journalist_bias_percentage=30.0,
                    most_frequent_bias="Speculation Bias",
                    most_frequent_count=3,
                    average_bias_strength=0.75,
                    overall_rating=0.45,
                    journalist_biases=[
                        {"sentence_index": 1, "bias_type": "Speculation Bias"},
                        {"sentence_index": 2, "bias_type": "Speculation Bias"},
                        {"sentence_index": 3, "bias_type": "Speculation Bias"},
                    ],
                    quote_biases=[],
                )

                assert result.created is False
                assert result.analysis.model == "mistral-large-latest"
                assert result.analysis.journalist_bias_count == 3
                assert len(result.analysis.journalist_biases) == 3

                await session.commit()
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_get_by_article_id(self):
        """Test retrieving analysis by article ID."""
        session_factory, engine = await create_session_factory()
        sample_article = await create_sample_article(session_factory)

        try:
            async with session_factory() as session:
                repo = BiasRepository(session)

                # Create analysis
                await repo.upsert_analysis(
                    article_id=sample_article,
                    provider="mistral",
                    model="mistral-small-latest",
                    total_sentences=5,
                    journalist_bias_count=1,
                    quote_bias_count=0,
                    journalist_bias_percentage=20.0,
                    most_frequent_bias=None,
                    most_frequent_count=None,
                    average_bias_strength=0.5,
                    overall_rating=0.25,
                    journalist_biases=[],
                    quote_biases=[],
                )
                await session.commit()

            async with session_factory() as session:
                repo = BiasRepository(session)
                analysis = await repo.get_by_article_id(sample_article)

                assert analysis is not None
                assert analysis.article_id == sample_article
                assert analysis.provider == "mistral"
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_get_by_article_id_returns_none_when_not_found(self):
        """Test that get_by_article_id returns None for non-existent article."""
        session_factory, engine = await create_session_factory()

        try:
            async with session_factory() as session:
                repo = BiasRepository(session)
                analysis = await repo.get_by_article_id(99999)
                assert analysis is None
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_get_by_article_and_provider(self):
        """Test retrieving analysis by article ID and provider."""
        session_factory, engine = await create_session_factory()
        sample_article = await create_sample_article(session_factory)

        try:
            async with session_factory() as session:
                repo = BiasRepository(session)

                # Create analyses for different providers
                await repo.upsert_analysis(
                    article_id=sample_article,
                    provider="mistral",
                    model="mistral-small-latest",
                    total_sentences=5,
                    journalist_bias_count=1,
                    quote_bias_count=0,
                    journalist_bias_percentage=20.0,
                    most_frequent_bias=None,
                    most_frequent_count=None,
                    average_bias_strength=0.5,
                    overall_rating=0.25,
                    journalist_biases=[],
                    quote_biases=[],
                )
                await repo.upsert_analysis(
                    article_id=sample_article,
                    provider="deepseek",
                    model="deepseek-chat",
                    total_sentences=5,
                    journalist_bias_count=2,
                    quote_bias_count=0,
                    journalist_bias_percentage=40.0,
                    most_frequent_bias=None,
                    most_frequent_count=None,
                    average_bias_strength=0.6,
                    overall_rating=0.35,
                    journalist_biases=[],
                    quote_biases=[],
                )
                await session.commit()

            async with session_factory() as session:
                repo = BiasRepository(session)

                mistral_analysis = await repo.get_by_article_and_provider(
                    sample_article, "mistral"
                )
                assert mistral_analysis is not None
                assert mistral_analysis.provider == "mistral"
                assert mistral_analysis.journalist_bias_count == 1

                deepseek_analysis = await repo.get_by_article_and_provider(
                    sample_article, "deepseek"
                )
                assert deepseek_analysis is not None
                assert deepseek_analysis.provider == "deepseek"
                assert deepseek_analysis.journalist_bias_count == 2
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_get_by_event_id(self):
        """Test retrieving all analyses for articles in an event."""
        session_factory, engine = await create_session_factory()
        event_id, article_ids = await create_sample_event_with_articles(session_factory)

        try:
            async with session_factory() as session:
                repo = BiasRepository(session)

                # Create analyses for both articles
                for i, article_id in enumerate(article_ids):
                    await repo.upsert_analysis(
                        article_id=article_id,
                        provider="mistral",
                        model="mistral-small-latest",
                        total_sentences=10,
                        journalist_bias_count=i + 1,
                        quote_bias_count=0,
                        journalist_bias_percentage=(i + 1) * 10.0,
                        most_frequent_bias=None,
                        most_frequent_count=None,
                        average_bias_strength=0.5,
                        overall_rating=0.25,
                        journalist_biases=[],
                        quote_biases=[],
                    )
                await session.commit()

            async with session_factory() as session:
                repo = BiasRepository(session)
                analyses = await repo.get_by_event_id(event_id)

                assert len(analyses) == 2
                # Should be ordered by analyzed_at desc
                article_ids_found = [a.article_id for a in analyses]
                assert set(article_ids_found) == set(article_ids)
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_get_articles_without_analysis(self):
        """Test finding articles that don't have bias analyses."""
        session_factory, engine = await create_session_factory()

        try:
            async with session_factory() as session:
                # Create articles
                article_with = Article(
                    guid="with-analysis",
                    url="https://example.com/with",
                    title="With Analysis",
                    content="Some content",
                    source_name="Source",
                )
                article_without = Article(
                    guid="without-analysis",
                    url="https://example.com/without",
                    title="Without Analysis",
                    content="Some other content",
                    source_name="Source",
                )
                session.add_all([article_with, article_without])
                await session.flush()

                # Create analysis only for first article
                repo = BiasRepository(session)
                await repo.upsert_analysis(
                    article_id=article_with.id,
                    provider="mistral",
                    model="mistral-small-latest",
                    total_sentences=5,
                    journalist_bias_count=0,
                    quote_bias_count=0,
                    journalist_bias_percentage=0.0,
                    most_frequent_bias=None,
                    most_frequent_count=None,
                    average_bias_strength=None,
                    overall_rating=0.0,
                    journalist_biases=[],
                    quote_biases=[],
                )
                await session.commit()

                without_id = article_without.id

            async with session_factory() as session:
                repo = BiasRepository(session)
                unanalyzed = await repo.get_articles_without_analysis(limit=10)

                assert without_id in unanalyzed
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_delete_by_article_id(self):
        """Test deleting all analyses for an article."""
        session_factory, engine = await create_session_factory()
        sample_article = await create_sample_article(session_factory)

        try:
            async with session_factory() as session:
                repo = BiasRepository(session)

                # Create analysis
                await repo.upsert_analysis(
                    article_id=sample_article,
                    provider="mistral",
                    model="mistral-small-latest",
                    total_sentences=5,
                    journalist_bias_count=1,
                    quote_bias_count=0,
                    journalist_bias_percentage=20.0,
                    most_frequent_bias=None,
                    most_frequent_count=None,
                    average_bias_strength=0.5,
                    overall_rating=0.25,
                    journalist_biases=[],
                    quote_biases=[],
                )
                await session.commit()

            async with session_factory() as session:
                repo = BiasRepository(session)

                # Verify it exists
                assert await repo.get_by_article_id(sample_article) is not None

                # Delete
                deleted_count = await repo.delete_by_article_id(sample_article)
                await session.commit()

                assert deleted_count == 1

            async with session_factory() as session:
                repo = BiasRepository(session)
                assert await repo.get_by_article_id(sample_article) is None
        finally:
            await engine.dispose()


class TestBiasAnalysisModel:
    """Tests for ArticleBiasAnalysis model behavior."""

    @pytest.mark.asyncio
    async def test_unique_constraint_article_provider(self):
        """Test that article_id + provider must be unique."""
        from sqlalchemy.exc import IntegrityError

        session_factory, engine = await create_session_factory()
        sample_article = await create_sample_article(session_factory)

        try:
            async with session_factory() as session:
                analysis1 = ArticleBiasAnalysis(
                    article_id=sample_article,
                    provider="mistral",
                    model="test",
                    total_sentences=5,
                    journalist_biases=[],
                    quote_biases=[],
                )
                session.add(analysis1)
                await session.commit()

            async with session_factory() as session:
                analysis2 = ArticleBiasAnalysis(
                    article_id=sample_article,
                    provider="mistral",  # Same provider
                    model="test2",
                    total_sentences=5,
                    journalist_biases=[],
                    quote_biases=[],
                )
                session.add(analysis2)

                with pytest.raises(IntegrityError):
                    await session.commit()
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="SQLite doesn't enforce FK cascade; tested in PostgreSQL")
    async def test_cascade_delete_on_article_delete(self):
        """Test that deleting an article cascades to its bias analyses.

        Note: This test is skipped for SQLite (unit tests) because SQLite doesn't
        enforce foreign key constraints by default. The CASCADE DELETE is properly
        tested in PostgreSQL integration tests.
        """
        session_factory, engine = await create_session_factory()

        try:
            async with session_factory() as session:
                article = Article(
                    guid="cascade-test",
                    url="https://example.com/cascade",
                    title="Cascade Test",
                    content="Content",
                    source_name="Source",
                )
                session.add(article)
                await session.flush()

                repo = BiasRepository(session)
                await repo.upsert_analysis(
                    article_id=article.id,
                    provider="mistral",
                    model="test",
                    total_sentences=5,
                    journalist_bias_count=0,
                    quote_bias_count=0,
                    journalist_bias_percentage=0.0,
                    most_frequent_bias=None,
                    most_frequent_count=None,
                    average_bias_strength=None,
                    overall_rating=0.0,
                    journalist_biases=[],
                    quote_biases=[],
                )
                await session.commit()
                article_id = article.id

            # Delete article
            async with session_factory() as session:
                from sqlalchemy import delete

                await session.execute(delete(Article).where(Article.id == article_id))
                await session.commit()

            # Verify bias analysis is also deleted
            async with session_factory() as session:
                repo = BiasRepository(session)
                assert await repo.get_by_article_id(article_id) is None
        finally:
            await engine.dispose()
