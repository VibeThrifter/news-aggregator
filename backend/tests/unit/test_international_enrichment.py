"""Unit tests for InternationalEnrichmentService."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.feeds.google_news import GoogleNewsArticle, GoogleNewsReaderError
from backend.app.services.country_detector import Country, GoogleNewsParams
from backend.app.services.international_enrichment import (
    DUTCH_STOPWORDS,
    EnrichmentResult,
    InternationalArticleCandidate,
    InternationalEnrichmentService,
)


@pytest.fixture
def israel_country() -> Country:
    """Create a test Country object for Israel."""
    return Country(
        key="israel",
        name="Israel",
        iso_code="IL",
        google_news_primary=GoogleNewsParams(gl="IL", hl="en", ceid="IL:en"),
        google_news_native=GoogleNewsParams(gl="IL", hl="iw", ceid="IL:iw"),
    )


@pytest.fixture
def russia_country() -> Country:
    """Create a test Country object for Russia."""
    return Country(
        key="russia",
        name="Russia",
        iso_code="RU",
        google_news_primary=GoogleNewsParams(gl="RU", hl="en", ceid="RU:en"),
        google_news_native=GoogleNewsParams(gl="RU", hl="ru", ceid="RU:ru"),
    )


@pytest.fixture
def sample_google_article() -> GoogleNewsArticle:
    """Create a sample GoogleNewsArticle."""
    return GoogleNewsArticle(
        url="https://www.timesofisrael.com/article/123",
        title="Netanyahu announces new Israel policy",
        published_at=datetime(2024, 12, 28, 10, 0, 0, tzinfo=timezone.utc),
        source_name="Times of Israel",
        source_country="IL",
        summary="The Prime Minister announced...",
        is_international=True,
    )


class TestDutchStopwords:
    """Tests for Dutch stopwords set."""

    def test_common_stopwords_present(self):
        """Test that common Dutch stopwords are in the set."""
        common = ["de", "het", "een", "van", "in", "op", "en"]
        for word in common:
            assert word in DUTCH_STOPWORDS

    def test_content_words_not_stopwords(self):
        """Test that content words are not stopwords."""
        content = ["israel", "regering", "minister", "conflict"]
        for word in content:
            assert word not in DUTCH_STOPWORDS


class TestEnrichmentResult:
    """Tests for EnrichmentResult dataclass."""

    def test_result_creation(self):
        """Test creating an EnrichmentResult."""
        result = EnrichmentResult(
            event_id=123,
            countries_detected=["IL", "RU"],
            countries_fetched=["IL"],
            countries_excluded=["NL"],
            articles_found=10,
            articles_added=5,
            articles_duplicate=2,
        )

        assert result.event_id == 123
        assert result.countries_detected == ["IL", "RU"]
        assert result.countries_fetched == ["IL"]
        assert result.articles_added == 5
        assert result.errors == []  # Default empty list

    def test_result_with_errors(self):
        """Test EnrichmentResult with errors."""
        result = EnrichmentResult(
            event_id=123,
            countries_detected=["IL"],
            countries_fetched=[],
            countries_excluded=[],
            articles_found=0,
            articles_added=0,
            articles_duplicate=0,
            errors=["Network error", "Timeout"],
        )

        assert len(result.errors) == 2
        assert "Network error" in result.errors


class TestInternationalArticleCandidate:
    """Tests for InternationalArticleCandidate dataclass."""

    def test_candidate_creation(self, sample_google_article, israel_country):
        """Test creating a candidate."""
        candidate = InternationalArticleCandidate(
            google_article=sample_google_article,
            country=israel_country,
            keyword_matches=2,
        )

        assert candidate.google_article == sample_google_article
        assert candidate.country.iso_code == "IL"
        assert candidate.keyword_matches == 2

    def test_candidate_default_matches(self, sample_google_article, israel_country):
        """Test default keyword_matches is 0."""
        candidate = InternationalArticleCandidate(
            google_article=sample_google_article,
            country=israel_country,
        )

        assert candidate.keyword_matches == 0


class TestInternationalEnrichmentService:
    """Tests for InternationalEnrichmentService."""

    @pytest.fixture
    def mock_session_factory(self):
        """Create a mock session factory."""
        session = AsyncMock()
        session.get = AsyncMock()
        session.execute = AsyncMock()
        session.add = MagicMock()
        session.flush = AsyncMock()
        session.commit = AsyncMock()

        factory = MagicMock()
        factory.return_value.__aenter__ = AsyncMock(return_value=session)
        factory.return_value.__aexit__ = AsyncMock()

        return factory, session

    @pytest.fixture
    def mock_country_mapper(self, israel_country, russia_country):
        """Create a mock country mapper."""
        mapper = MagicMock()
        mapper.is_excluded = MagicMock(side_effect=lambda x: x in ["NL", "BE"])
        mapper.get_country_by_code = MagicMock(
            side_effect=lambda x: {"IL": israel_country, "RU": russia_country}.get(
                x.upper()
            )
        )
        return mapper

    def test_service_initialization(self, mock_session_factory, mock_country_mapper):
        """Test service initialization."""
        factory, _ = mock_session_factory
        service = InternationalEnrichmentService(
            session_factory=factory,
            country_mapper=mock_country_mapper,
        )

        assert service.session_factory == factory
        assert service.country_mapper == mock_country_mapper
        assert service.MAX_COUNTRIES_PER_EVENT == 5
        assert service.MAX_ARTICLES_PER_COUNTRY == 5

    def test_count_keyword_matches(self, mock_session_factory, mock_country_mapper):
        """Test keyword matching in titles."""
        factory, _ = mock_session_factory
        service = InternationalEnrichmentService(
            session_factory=factory,
            country_mapper=mock_country_mapper,
        )

        # All keywords match
        assert (
            service._count_keyword_matches(
                "Netanyahu announces Israel policy", ["Netanyahu", "Israel"]
            )
            == 2
        )

        # Partial match
        assert (
            service._count_keyword_matches(
                "Netanyahu announces new policy", ["Netanyahu", "Israel"]
            )
            == 1
        )

        # No match
        assert service._count_keyword_matches("Breaking news today", ["Netanyahu"]) == 0

        # Case insensitive
        assert (
            service._count_keyword_matches(
                "NETANYAHU announces policy", ["netanyahu"]
            )
            == 1
        )

    def test_create_article_from_candidate(
        self, mock_session_factory, mock_country_mapper, sample_google_article, israel_country
    ):
        """Test creating an Article from a candidate."""
        factory, _ = mock_session_factory
        service = InternationalEnrichmentService(
            session_factory=factory,
            country_mapper=mock_country_mapper,
        )

        candidate = InternationalArticleCandidate(
            google_article=sample_google_article,
            country=israel_country,
            keyword_matches=1,
        )

        article = service._create_article_from_candidate(candidate)

        assert article.url == sample_google_article.url
        assert article.title == sample_google_article.title
        assert article.source_name == sample_google_article.source_name
        assert article.is_international is True
        assert article.source_country == "IL"
        assert article.guid.startswith("gnews:")
        assert article.source_metadata["country"] == "IL"
        assert article.source_metadata["country_name"] == "Israel"

    @pytest.mark.asyncio
    async def test_enrich_event_not_found(
        self, mock_session_factory, mock_country_mapper
    ):
        """Test enrichment when event is not found."""
        factory, session = mock_session_factory
        session.get.return_value = None

        service = InternationalEnrichmentService(
            session_factory=factory,
            country_mapper=mock_country_mapper,
        )

        result = await service.enrich_event(999)

        assert result.event_id == 999
        assert result.countries_detected == []
        assert result.articles_added == 0
        assert "Event not found" in result.errors

    @pytest.mark.asyncio
    async def test_enrich_event_no_countries_detected(
        self, mock_session_factory, mock_country_mapper
    ):
        """Test enrichment when no countries are detected."""
        factory, session = mock_session_factory

        # Mock event without detected countries
        event = MagicMock()
        event.detected_countries = None
        session.get.return_value = event

        # Mock LLMInsight query returning no countries
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        session.execute.return_value = mock_result

        service = InternationalEnrichmentService(
            session_factory=factory,
            country_mapper=mock_country_mapper,
        )

        result = await service.enrich_event(123)

        assert result.event_id == 123
        assert result.countries_detected == []
        assert result.articles_added == 0

    @pytest.mark.asyncio
    async def test_enrich_event_excluded_countries_only(
        self, mock_session_factory, mock_country_mapper
    ):
        """Test enrichment when all detected countries are excluded."""
        factory, session = mock_session_factory

        # Mock event with only NL as detected country
        event = MagicMock()
        event.detected_countries = ["NL"]
        session.get.return_value = event

        # Mock the existing source countries query
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []  # No existing countries
        session.execute.return_value = mock_result

        service = InternationalEnrichmentService(
            session_factory=factory,
            country_mapper=mock_country_mapper,
        )

        result = await service.enrich_event(123)

        assert result.event_id == 123
        assert result.countries_detected == ["NL"]
        assert result.countries_excluded == ["NL"]
        assert result.countries_fetched == []
        assert result.articles_added == 0


class TestKeywordExtraction:
    """Tests for keyword extraction from events."""

    @pytest.mark.asyncio
    async def test_extract_keywords_from_title(self):
        """Test extracting keywords from event title."""
        # Create minimal mocks
        session = AsyncMock()
        factory = MagicMock()
        factory.return_value.__aenter__ = AsyncMock(return_value=session)
        factory.return_value.__aexit__ = AsyncMock()

        service = InternationalEnrichmentService(session_factory=factory)

        # Mock event with title only
        event = MagicMock()
        event.title = "Netanyahu bezoekt Washington voor gesprekken"
        event.centroid_entities = None

        keywords = await service._extract_keywords(session, event)

        # Should extract significant words, not stopwords
        assert "Netanyahu" in keywords
        assert "Washington" in keywords
        assert "voor" not in keywords  # Dutch stopword
        assert len(keywords) <= 5

    @pytest.mark.asyncio
    async def test_extract_keywords_with_entities(self):
        """Test extracting keywords including entities."""
        session = AsyncMock()
        factory = MagicMock()
        factory.return_value.__aenter__ = AsyncMock(return_value=session)
        factory.return_value.__aexit__ = AsyncMock()

        service = InternationalEnrichmentService(session_factory=factory)

        # Mock event with title and entities
        event = MagicMock()
        event.title = "Conflict escalates"
        event.centroid_entities = [
            {"text": "Netanyahu", "label": "PERSON"},
            {"text": "IDF", "label": "ORG"},
            {"text": "Gaza", "label": "GPE"},
        ]

        keywords = await service._extract_keywords(session, event)

        # Should include entities
        assert "Netanyahu" in keywords or "IDF" in keywords or "Gaza" in keywords
        assert len(keywords) <= 5

    @pytest.mark.asyncio
    async def test_extract_keywords_deduplication(self):
        """Test that keywords are deduplicated."""
        session = AsyncMock()
        factory = MagicMock()
        factory.return_value.__aenter__ = AsyncMock(return_value=session)
        factory.return_value.__aexit__ = AsyncMock()

        service = InternationalEnrichmentService(session_factory=factory)

        # Mock event where entity duplicates title word
        event = MagicMock()
        event.title = "Netanyahu announces policy"
        event.centroid_entities = [
            {"text": "Netanyahu", "label": "PERSON"},  # Duplicate
        ]

        keywords = await service._extract_keywords(session, event)

        # Should not have duplicates
        keyword_lower = [k.lower() for k in keywords]
        assert len(keyword_lower) == len(set(keyword_lower))


class TestGetCountriesFromInsight:
    """Tests for extracting countries from LLM insights."""

    @pytest.mark.asyncio
    async def test_get_countries_from_insight_success(self):
        """Test successful extraction of countries from insight."""
        session = AsyncMock()
        factory = MagicMock()
        factory.return_value.__aenter__ = AsyncMock(return_value=session)
        factory.return_value.__aexit__ = AsyncMock()

        # Mock insight with involved_countries
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = [
            {"iso_code": "IL", "name": "Israel", "relevance": "Main actor"},
            {"iso_code": "US", "name": "United States", "relevance": "Ally"},
        ]
        session.execute.return_value = mock_result

        service = InternationalEnrichmentService(session_factory=factory)
        countries = await service._get_countries_from_insight(session, 123)

        assert countries == ["IL", "US"]

    @pytest.mark.asyncio
    async def test_get_countries_from_insight_empty(self):
        """Test extraction when no insight exists."""
        session = AsyncMock()
        factory = MagicMock()
        factory.return_value.__aenter__ = AsyncMock(return_value=session)
        factory.return_value.__aexit__ = AsyncMock()

        # Mock no insight found
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        session.execute.return_value = mock_result

        service = InternationalEnrichmentService(session_factory=factory)
        countries = await service._get_countries_from_insight(session, 123)

        assert countries == []
