"""Integration tests for bias API endpoints (Epic 10, Story 10.4)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import (
    Article,
    ArticleBiasAnalysis,
    Base,
    Event,
    EventArticle,
)
from backend.app.routers.bias import get_article_bias, get_event_bias_summary


@pytest.mark.asyncio
async def test_get_article_bias_success(tmp_path: Path) -> None:
    """Test successful retrieval of article bias analysis."""
    db_path = tmp_path / "bias_api.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    now = datetime.now(timezone.utc)

    try:
        async with session_factory() as session:
            article = Article(
                guid="article-bias-test-1",
                url="https://example.com/article",
                title="Example article",
                summary="Summary",
                content="This is a test article with content.",
                source_name="Example Source",
                published_at=now,
            )
            session.add(article)
            await session.flush()

            analysis = ArticleBiasAnalysis(
                article_id=article.id,
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
                        "sentence_text": "The controversial decision...",
                        "bias_type": "Word Choice Bias",
                        "bias_source": "journalist",
                        "score": 0.7,
                        "explanation": "Loaded language in description.",
                    },
                    {
                        "sentence_index": 5,
                        "sentence_text": "Experts claim that...",
                        "bias_type": "Ambiguous Attribution Bias",
                        "bias_source": "journalist",
                        "score": 0.6,
                        "explanation": "Vague expert reference.",
                    },
                ],
                quote_biases=[
                    {
                        "sentence_index": 3,
                        "sentence_text": "'This is a disaster', said Jones.",
                        "bias_type": "Emotional Sensationalism Bias",
                        "bias_source": "quote",
                        "speaker": "Jones",
                        "score": 0.8,
                        "explanation": "Emotional quote from source.",
                    },
                ],
                analyzed_at=now,
            )
            session.add(analysis)
            await session.commit()

            article_id = article.id

        async with session_factory() as session:
            response = await get_article_bias(article_id, session=session)

        assert response["data"]["article_id"] == article_id
        assert response["data"]["provider"] == "mistral"
        assert response["data"]["summary"]["total_sentences"] == 10
        assert response["data"]["summary"]["journalist_bias_count"] == 2
        assert response["data"]["summary"]["overall_journalist_rating"] == 0.35
        assert len(response["data"]["journalist_biases"]) == 2
        assert len(response["data"]["quote_biases"]) == 1
        assert response["meta"]["provider"] == "mistral"

    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_get_article_bias_article_not_found(tmp_path: Path) -> None:
    """Test 404 when article doesn't exist."""
    db_path = tmp_path / "bias_api_404.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    try:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await get_article_bias(9999, session=session)

        assert exc.value.status_code == 404
        assert "Article 9999 not found" in exc.value.detail

    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_get_article_bias_no_analysis(tmp_path: Path) -> None:
    """Test 404 when article exists but has no bias analysis."""
    db_path = tmp_path / "bias_api_no_analysis.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    now = datetime.now(timezone.utc)

    try:
        async with session_factory() as session:
            article = Article(
                guid="article-no-bias",
                url="https://example.com/article-no-bias",
                title="Article without bias analysis",
                summary="Summary",
                content="Content",
                source_name="Source",
                published_at=now,
            )
            session.add(article)
            await session.commit()
            article_id = article.id

        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await get_article_bias(article_id, session=session)

        assert exc.value.status_code == 404
        assert "No bias analysis found" in exc.value.detail

    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_get_event_bias_summary_success(tmp_path: Path) -> None:
    """Test successful retrieval of event bias summary."""
    db_path = tmp_path / "event_bias_summary.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    now = datetime.now(timezone.utc)

    try:
        async with session_factory() as session:
            event = Event(
                slug="test-event-bias",
                title="Test Event",
                description="Test event description",
                first_seen_at=now,
                last_updated_at=now,
                article_count=3,
            )
            session.add(event)
            await session.flush()

            # Create 3 articles from different sources
            article1 = Article(
                guid="art-1",
                url="https://nos.nl/article1",
                title="Article 1",
                content="Content 1",
                source_name="NOS",
                published_at=now,
            )
            article2 = Article(
                guid="art-2",
                url="https://telegraaf.nl/article2",
                title="Article 2",
                content="Content 2",
                source_name="Telegraaf",
                published_at=now,
            )
            article3 = Article(
                guid="art-3",
                url="https://nos.nl/article3",
                title="Article 3",
                content="Content 3",
                source_name="NOS",
                published_at=now,
            )
            session.add_all([article1, article2, article3])
            await session.flush()

            # Link articles to event
            session.add_all([
                EventArticle(event_id=event.id, article_id=article1.id),
                EventArticle(event_id=event.id, article_id=article2.id),
                EventArticle(event_id=event.id, article_id=article3.id),
            ])

            # Add bias analyses for 2 of 3 articles
            analysis1 = ArticleBiasAnalysis(
                article_id=article1.id,
                provider="mistral",
                model="mistral-small-latest",
                total_sentences=10,
                journalist_bias_count=1,
                quote_bias_count=0,
                journalist_bias_percentage=10.0,
                overall_rating=0.3,
                journalist_biases=[
                    {
                        "sentence_index": 1,
                        "sentence_text": "Test",
                        "bias_type": "Word Choice Bias",
                        "bias_source": "journalist",
                        "score": 0.6,
                        "explanation": "Test",
                    }
                ],
                quote_biases=[],
                analyzed_at=now,
            )
            analysis2 = ArticleBiasAnalysis(
                article_id=article2.id,
                provider="mistral",
                model="mistral-small-latest",
                total_sentences=15,
                journalist_bias_count=3,
                quote_bias_count=1,
                journalist_bias_percentage=20.0,
                overall_rating=0.6,
                journalist_biases=[
                    {
                        "sentence_index": 2,
                        "sentence_text": "Test 1",
                        "bias_type": "Word Choice Bias",
                        "bias_source": "journalist",
                        "score": 0.7,
                        "explanation": "Test",
                    },
                    {
                        "sentence_index": 5,
                        "sentence_text": "Test 2",
                        "bias_type": "Speculation Bias",
                        "bias_source": "journalist",
                        "score": 0.6,
                        "explanation": "Test",
                    },
                    {
                        "sentence_index": 8,
                        "sentence_text": "Test 3",
                        "bias_type": "Word Choice Bias",
                        "bias_source": "journalist",
                        "score": 0.5,
                        "explanation": "Test",
                    },
                ],
                quote_biases=[],
                analyzed_at=now,
            )
            session.add_all([analysis1, analysis2])
            await session.commit()

            event_id = event.id

        async with session_factory() as session:
            response = await get_event_bias_summary(str(event_id), session=session)

        data = response["data"]
        assert data["event_id"] == event_id
        assert data["total_articles"] == 3
        assert data["articles_analyzed"] == 2
        assert data["average_bias_rating"] == 0.45  # (0.3 + 0.6) / 2

        # Check by_source
        by_source = {s["source"]: s for s in data["by_source"]}
        assert "NOS" in by_source
        assert by_source["NOS"]["article_count"] == 2
        assert by_source["NOS"]["articles_analyzed"] == 1
        assert by_source["NOS"]["average_rating"] == 0.3

        assert "Telegraaf" in by_source
        assert by_source["Telegraaf"]["article_count"] == 1
        assert by_source["Telegraaf"]["articles_analyzed"] == 1
        assert by_source["Telegraaf"]["average_rating"] == 0.6

        # Check bias type distribution
        bias_types = {b["bias_type"]: b["count"] for b in data["bias_type_distribution"]}
        assert bias_types["Word Choice Bias"] == 3  # 1 from NOS + 2 from Telegraaf
        assert bias_types["Speculation Bias"] == 1

    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_get_event_bias_summary_by_slug(tmp_path: Path) -> None:
    """Test event bias summary can be retrieved by slug."""
    db_path = tmp_path / "event_bias_slug.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    now = datetime.now(timezone.utc)
    slug = "test-event-with-slug"

    try:
        async with session_factory() as session:
            event = Event(
                slug=slug,
                title="Test Event",
                description="Test",
                first_seen_at=now,
                last_updated_at=now,
                article_count=1,
            )
            session.add(event)
            await session.flush()

            article = Article(
                guid="slug-article",
                url="https://example.com/slug",
                title="Slug Article",
                content="Content",
                source_name="Source",
                published_at=now,
            )
            session.add(article)
            await session.flush()

            session.add(EventArticle(event_id=event.id, article_id=article.id))
            await session.commit()

        async with session_factory() as session:
            response = await get_event_bias_summary(slug, session=session)

        assert response["data"]["total_articles"] == 1
        assert response["data"]["articles_analyzed"] == 0  # No analysis yet

    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_get_event_bias_summary_event_not_found(tmp_path: Path) -> None:
    """Test 404 when event doesn't exist."""
    db_path = tmp_path / "event_bias_404.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    try:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await get_event_bias_summary("9999", session=session)

        assert exc.value.status_code == 404
        assert "Event 9999 not found" in exc.value.detail

    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_get_event_bias_summary_no_articles(tmp_path: Path) -> None:
    """Test 404 when event has no articles."""
    db_path = tmp_path / "event_bias_no_articles.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    now = datetime.now(timezone.utc)

    try:
        async with session_factory() as session:
            event = Event(
                slug="empty-event",
                title="Empty Event",
                description="No articles",
                first_seen_at=now,
                last_updated_at=now,
                article_count=0,
            )
            session.add(event)
            await session.commit()
            event_id = event.id

        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await get_event_bias_summary(str(event_id), session=session)

        assert exc.value.status_code == 404
        assert "No articles found" in exc.value.detail

    finally:
        await engine.dispose()
