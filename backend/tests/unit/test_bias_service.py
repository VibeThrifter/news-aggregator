"""Unit tests for BiasDetectionService."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.core.config import Settings
from backend.app.db.models import Article, Base
from backend.app.llm.client import LLMGenericResult, MistralClient
from backend.app.llm.schemas import BiasAnalysisPayload, SentenceBias
from backend.app.services.bias_service import (
    BiasAnalysisOutcome,
    BiasDetectionService,
)


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
            guid="test-guid-bias",
            url="https://example.com/bias-article",
            title="Test Bias Article",
            content="Dit is een test artikel. Het omstreden beleid werd ingevoerd. 'Dit is rampzalig', zei de minister.",
            source_name="TestBron",
        )
        session.add(article)
        await session.commit()
        await session.refresh(article)
        return article.id


class TestBiasDetectionServiceComputeStats:
    """Tests for the _compute_summary_stats method."""

    def test_compute_stats_with_journalist_biases(self):
        """Test stats computation with journalist biases."""
        service = BiasDetectionService(
            session_factory=MagicMock(),
            client=MagicMock(),
            settings=Settings(mistral_api_key="test"),
        )

        payload = BiasAnalysisPayload(
            total_sentences=10,
            journalist_biases=[
                SentenceBias(
                    sentence_index=1,
                    sentence_text="Het omstreden beleid...",
                    bias_type="Word Choice Bias",
                    bias_source="journalist",
                    score=0.7,
                    explanation="Geladen woordkeuze",
                ),
                SentenceBias(
                    sentence_index=3,
                    sentence_text="Critici beweren...",
                    bias_type="Word Choice Bias",
                    bias_source="journalist",
                    score=0.6,
                    explanation="Vage bronverwijzing",
                ),
            ],
            quote_biases=[
                SentenceBias(
                    sentence_index=5,
                    sentence_text="'Dit is rampzalig', zei de minister.",
                    bias_type="Emotional Sensationalism Bias",
                    bias_source="quote",
                    speaker="Minister",
                    score=0.8,
                    explanation="Quote van minister",
                ),
            ],
        )

        stats = service._compute_summary_stats(payload)

        assert stats["journalist_bias_count"] == 2
        assert stats["quote_bias_count"] == 1
        assert stats["journalist_bias_percentage"] == 20.0
        assert stats["most_frequent_bias"] == "Word Choice Bias"
        assert stats["most_frequent_count"] == 2
        assert stats["average_bias_strength"] == 0.65
        # Overall rating: 0.6 * (20/100) + 0.4 * 0.65 = 0.12 + 0.26 = 0.38
        assert stats["overall_rating"] == 0.38

    def test_compute_stats_no_biases(self):
        """Test stats computation when no biases are found."""
        service = BiasDetectionService(
            session_factory=MagicMock(),
            client=MagicMock(),
            settings=Settings(mistral_api_key="test"),
        )

        payload = BiasAnalysisPayload(
            total_sentences=15,
            journalist_biases=[],
            quote_biases=[],
        )

        stats = service._compute_summary_stats(payload)

        assert stats["journalist_bias_count"] == 0
        assert stats["quote_bias_count"] == 0
        assert stats["journalist_bias_percentage"] == 0.0
        assert stats["most_frequent_bias"] is None
        assert stats["most_frequent_count"] is None
        assert stats["average_bias_strength"] is None
        assert stats["overall_rating"] == 0.0

    def test_compute_stats_only_quote_biases(self):
        """Test that quote biases don't affect the overall rating."""
        service = BiasDetectionService(
            session_factory=MagicMock(),
            client=MagicMock(),
            settings=Settings(mistral_api_key="test"),
        )

        payload = BiasAnalysisPayload(
            total_sentences=10,
            journalist_biases=[],
            quote_biases=[
                SentenceBias(
                    sentence_index=5,
                    sentence_text="'Dit is rampzalig', zei de minister.",
                    bias_type="Emotional Sensationalism Bias",
                    bias_source="quote",
                    speaker="Minister",
                    score=0.9,
                    explanation="Quote",
                ),
            ],
        )

        stats = service._compute_summary_stats(payload)

        # Quote biases shouldn't affect the journalist rating
        assert stats["journalist_bias_count"] == 0
        assert stats["quote_bias_count"] == 1
        assert stats["overall_rating"] == 0.0


class TestBiasDetectionServiceBuildClient:
    """Tests for client building logic."""

    def test_build_mistral_client(self):
        """Test building a Mistral client."""
        settings = Settings(mistral_api_key="test-key")
        service = BiasDetectionService(settings=settings)

        client = service._build_client("mistral")
        assert isinstance(client, MistralClient)
        assert client.provider == "mistral"

    def test_build_client_defaults_to_mistral(self):
        """Test that client defaults to Mistral when no provider specified."""
        settings = Settings(mistral_api_key="test-key", llm_provider="mistral")
        service = BiasDetectionService(settings=settings)

        # When called without a provider argument, it should use the settings default
        client = service._build_client()
        assert client.provider == "mistral"

    def test_build_client_unknown_provider_raises(self):
        """Test that unknown provider raises ValueError."""
        settings = Settings(mistral_api_key="test-key")
        service = BiasDetectionService(settings=settings)

        with pytest.raises(ValueError, match="wordt nog niet ondersteund"):
            service._build_client("unknown-provider")


class TestBiasDetectionServiceAnalyzeArticle:
    """Tests for the analyze_article method."""

    @pytest.mark.asyncio
    async def test_analyze_article_success(self):
        """Test successful article analysis."""
        session_factory, engine = await create_session_factory()
        article_id = await create_sample_article(session_factory)

        # Mock LLM response
        llm_payload = BiasAnalysisPayload(
            total_sentences=3,
            journalist_biases=[
                SentenceBias(
                    sentence_index=1,
                    sentence_text="Het omstreden beleid werd ingevoerd.",
                    bias_type="Word Choice Bias",
                    bias_source="journalist",
                    score=0.7,
                    explanation="'Omstreden' is geladen woordkeuze",
                ),
            ],
            quote_biases=[
                SentenceBias(
                    sentence_index=2,
                    sentence_text="'Dit is rampzalig', zei de minister.",
                    bias_type="Emotional Sensationalism Bias",
                    bias_source="quote",
                    speaker="de minister",
                    score=0.8,
                    explanation="Quote van minister",
                ),
            ],
        )

        mock_llm_result = LLMGenericResult(
            provider="mistral",
            model="mistral-small-latest",
            payload=llm_payload,
            raw_content=json.dumps(llm_payload.model_dump()),
            usage={"prompt_tokens": 100, "completion_tokens": 50},
        )

        try:
            settings = Settings(mistral_api_key="test-key")
            service = BiasDetectionService(
                session_factory=session_factory,
                settings=settings,
            )

            # Mock the methods
            with patch.object(service, "_get_client_for_bias") as mock_get_client:
                with patch.object(service, "_get_prompt_template") as mock_get_prompt:
                    mock_client = MagicMock()
                    mock_client.provider = "mistral"
                    mock_client.generate_json = AsyncMock(return_value=mock_llm_result)
                    mock_get_client.return_value = mock_client
                    mock_get_prompt.return_value = "Test prompt template {article_content}"

                    result = await service.analyze_article(article_id)

            assert isinstance(result, BiasAnalysisOutcome)
            assert result.created is True
            assert result.analysis.article_id == article_id
            assert result.analysis.provider == "mistral"
            assert result.analysis.journalist_bias_count == 1
            assert result.analysis.quote_bias_count == 1
            assert len(result.payload.journalist_biases) == 1
            assert len(result.payload.quote_biases) == 1

        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_analyze_article_not_found(self):
        """Test that analyzing non-existent article raises ValueError."""
        session_factory, engine = await create_session_factory()

        try:
            settings = Settings(mistral_api_key="test-key")
            service = BiasDetectionService(
                session_factory=session_factory,
                settings=settings,
            )

            with pytest.raises(ValueError, match="not found"):
                await service.analyze_article(99999)
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_analyze_article_no_content(self):
        """Test that analyzing article without content raises ValueError."""
        session_factory, engine = await create_session_factory()

        try:
            # Create article with empty content
            async with session_factory() as session:
                article = Article(
                    guid="empty-content",
                    url="https://example.com/empty",
                    title="Empty Article",
                    content="",
                    source_name="Test",
                )
                session.add(article)
                await session.commit()
                article_id = article.id

            settings = Settings(mistral_api_key="test-key")
            service = BiasDetectionService(
                session_factory=session_factory,
                settings=settings,
            )

            with pytest.raises(ValueError, match="no content"):
                await service.analyze_article(article_id)
        finally:
            await engine.dispose()


class TestBiasDetectionServiceAnalyzeBatch:
    """Tests for the analyze_batch method."""

    @pytest.mark.asyncio
    async def test_analyze_batch_no_articles(self):
        """Test batch analysis when no articles need analysis."""
        session_factory, engine = await create_session_factory()

        try:
            settings = Settings(mistral_api_key="test-key")
            service = BiasDetectionService(
                session_factory=session_factory,
                settings=settings,
            )

            result = await service.analyze_batch(limit=10)

            assert result["articles_found"] == 0
            assert result["articles_analyzed"] == 0
            assert result["articles_failed"] == 0
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_analyze_batch_with_articles(self):
        """Test batch analysis with articles needing analysis."""
        session_factory, engine = await create_session_factory()

        try:
            # Create articles
            async with session_factory() as session:
                for i in range(3):
                    article = Article(
                        guid=f"batch-article-{i}",
                        url=f"https://example.com/batch/{i}",
                        title=f"Batch Article {i}",
                        content=f"Dit is test artikel nummer {i}.",
                        source_name="Test",
                    )
                    session.add(article)
                await session.commit()

            # Mock LLM response
            llm_payload = BiasAnalysisPayload(
                total_sentences=1,
                journalist_biases=[],
                quote_biases=[],
            )

            mock_llm_result = LLMGenericResult(
                provider="mistral",
                model="mistral-small-latest",
                payload=llm_payload,
                raw_content=json.dumps(llm_payload.model_dump()),
                usage={},
            )

            settings = Settings(mistral_api_key="test-key")
            service = BiasDetectionService(
                session_factory=session_factory,
                settings=settings,
            )

            with patch.object(service, "_get_client_for_bias") as mock_get_client:
                with patch.object(service, "_get_prompt_template") as mock_get_prompt:
                    mock_client = MagicMock()
                    mock_client.provider = "mistral"
                    mock_client.generate_json = AsyncMock(return_value=mock_llm_result)
                    mock_get_client.return_value = mock_client
                    mock_get_prompt.return_value = "Test prompt {article_content}"

                    result = await service.analyze_batch(limit=10)

            assert result["articles_found"] == 3
            assert result["articles_analyzed"] == 3
            assert result["articles_failed"] == 0

        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_analyze_batch_handles_failures(self):
        """Test that batch analysis continues despite individual failures."""
        session_factory, engine = await create_session_factory()

        try:
            # Create articles
            async with session_factory() as session:
                for i in range(2):
                    article = Article(
                        guid=f"fail-article-{i}",
                        url=f"https://example.com/fail/{i}",
                        title=f"Fail Article {i}",
                        content=f"Content {i}",
                        source_name="Test",
                    )
                    session.add(article)
                await session.commit()

            settings = Settings(mistral_api_key="test-key")
            service = BiasDetectionService(
                session_factory=session_factory,
                settings=settings,
            )

            # Mock analyze_article to fail
            with patch.object(
                service, "analyze_article", side_effect=Exception("LLM Error")
            ):
                result = await service.analyze_batch(limit=10)

            assert result["articles_found"] == 2
            assert result["articles_analyzed"] == 0
            assert result["articles_failed"] == 2
            assert len(result["failed_article_ids"]) == 2

        finally:
            await engine.dispose()


class TestBiasAnalysisPayloadParsing:
    """Tests for parsing LLM responses into BiasAnalysisPayload."""

    def test_parse_valid_response(self):
        """Test parsing a valid LLM response."""
        response = {
            "total_sentences": 10,
            "journalist_biases": [
                {
                    "sentence_index": 1,
                    "sentence_text": "Het omstreden beleid...",
                    "bias_type": "Word Choice Bias",
                    "bias_source": "journalist",
                    "score": 0.7,
                    "explanation": "Geladen woordkeuze",
                }
            ],
            "quote_biases": [],
        }

        payload = BiasAnalysisPayload.model_validate(response)

        assert payload.total_sentences == 10
        assert len(payload.journalist_biases) == 1
        assert payload.journalist_biases[0].bias_type == "Word Choice Bias"
        assert payload.journalist_biases[0].bias_source == "journalist"

    def test_parse_response_with_null_biases(self):
        """Test that null bias arrays are converted to empty lists."""
        response = {
            "total_sentences": 5,
            "journalist_biases": None,
            "quote_biases": None,
        }

        payload = BiasAnalysisPayload.model_validate(response)

        assert payload.journalist_biases == []
        assert payload.quote_biases == []

    def test_parse_response_with_quote_speaker(self):
        """Test parsing quote bias with speaker attribution."""
        response = {
            "total_sentences": 5,
            "journalist_biases": [],
            "quote_biases": [
                {
                    "sentence_index": 2,
                    "sentence_text": "'Dit is een ramp', zei Minister Jansen.",
                    "bias_type": "Emotional Sensationalism Bias",
                    "bias_source": "quote",
                    "speaker": "Minister Jansen",
                    "score": 0.8,
                    "explanation": "Emotionele uitspraak van minister",
                }
            ],
        }

        payload = BiasAnalysisPayload.model_validate(response)

        assert len(payload.quote_biases) == 1
        assert payload.quote_biases[0].speaker == "Minister Jansen"
        assert payload.quote_biases[0].bias_source == "quote"
