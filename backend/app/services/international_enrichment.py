"""Service for enriching events with international news perspectives.

Orchestrates fetching of international articles based on LLM-detected countries,
stores them linked to events, and tracks enrichment status.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.dual_write import sync_entities_to_cache
from backend.app.db.models import Article, Event, EventArticle, LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.feeds.google_news import (
    GoogleNewsArticle,
    GoogleNewsReader,
    GoogleNewsReaderError,
)
from backend.app.services.country_detector import (
    Country,
    CountryMapper,
    get_country_mapper,
)

logger = get_logger(__name__)


# Western/transatlantic sources to filter out when US/GB are not involved in event
# These are major US media and international wire services that don't provide
# unique local perspectives for non-Western events
WESTERN_SOURCES = {
    # US media
    "cnn.com",
    "nytimes.com",
    "washingtonpost.com",
    "foxnews.com",
    "nypost.com",
    "nbcnews.com",
    "cbsnews.com",
    "abcnews.go.com",
    "pbs.org",
    "npr.org",
    "usatoday.com",
    "wsj.com",
    "politico.com",
    "huffpost.com",
    "bloomberg.com",
    "axios.com",
    "vox.com",
    "thehill.com",
    "newsweek.com",
    "time.com",
    "forbes.com",
    # UK / Transatlantic
    "bbc.com",
    "bbc.co.uk",
    "reuters.com",
    "apnews.com",
    "theguardian.com",
    "telegraph.co.uk",
    "independent.co.uk",
    "dailymail.co.uk",
    "news.sky.com",
    "sky.com",
    "ft.com",
    # Wire services
    "afp.com",
}


# Dutch stopwords for keyword extraction
DUTCH_STOPWORDS = {
    "de", "het", "een", "van", "in", "op", "en", "is", "dat", "met",
    "voor", "zijn", "aan", "te", "wordt", "ook", "bij", "naar", "die",
    "niet", "over", "om", "als", "dan", "maar", "nog", "wel", "meer",
    "hebben", "worden", "kunnen", "zal", "zou", "moet", "mag", "heeft",
}


def _extract_domain(url: str) -> str | None:
    """Extract the registrable domain from a URL.

    Examples:
        https://www.cnn.com/article → cnn.com
        https://news.bbc.co.uk/story → bbc.co.uk
        https://edition.cnn.com/news → cnn.com
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        if not hostname:
            return None

        # Remove www. prefix
        if hostname.startswith("www."):
            hostname = hostname[4:]

        parts = hostname.split(".")
        if len(parts) < 2:
            return None

        # Handle compound TLDs like .co.uk
        if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "gov", "ac"):
            # e.g., bbc.co.uk → bbc.co.uk
            return ".".join(parts[-3:])

        # Simple TLD: e.g., cnn.com → cnn.com
        return ".".join(parts[-2:])

    except Exception:
        return None


def is_western_source(url: str) -> bool:
    """Check if a URL is from a known Western/transatlantic source."""
    domain = _extract_domain(url)
    if not domain:
        return False
    return domain in WESTERN_SOURCES


@dataclass
class EnrichmentResult:
    """Result of an international enrichment operation."""

    event_id: int
    countries_detected: list[str]  # ISO codes from LLM
    countries_fetched: list[str]  # ISO codes we actually fetched
    countries_excluded: list[str]  # ISO codes excluded (NL, already have, etc.)
    articles_found: int  # Total articles found from Google News
    articles_added: int  # Articles successfully added to database
    articles_duplicate: int  # Duplicates skipped
    errors: list[str] = field(default_factory=list)


@dataclass
class InternationalArticleCandidate:
    """An article candidate before relevance filtering and deduplication."""

    google_article: GoogleNewsArticle
    country: Country
    keyword_matches: int = 0


class InternationalEnrichmentService:
    """Enriches events with international news perspectives via Google News.

    Flow:
    1. Get detected countries from event (populated by LLM during insight generation)
    2. Filter out excluded countries (NL, countries we already have)
    3. Extract keywords from event for search
    4. Fetch articles from each country via Google News RSS
    5. Filter by relevance (keyword matching)
    6. Deduplicate and persist as international articles linked to event
    """

    # Rate limiting
    RATE_LIMIT_BETWEEN_COUNTRIES = 1.0  # seconds
    MAX_COUNTRIES_PER_EVENT = 5
    MAX_ARTICLES_PER_COUNTRY = 5

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        country_mapper: CountryMapper | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.session_factory = session_factory or get_sessionmaker()
        self.country_mapper = country_mapper or get_country_mapper()
        self.log = logger.bind(component="InternationalEnrichmentService")

    async def enrich_event(
        self,
        event_id: int,
        *,
        max_articles_per_country: int | None = None,
        search_keywords: list[str] | None = None,
        correlation_id: str | None = None,
    ) -> EnrichmentResult:
        """Enrich an event with international perspectives.

        Args:
            event_id: ID of the event to enrich
            max_articles_per_country: Override default max articles per country
            search_keywords: Pre-extracted English keywords (from keyword extraction phase)
            correlation_id: Optional correlation ID for logging

        Returns:
            EnrichmentResult with statistics about the enrichment
        """
        max_per_country = max_articles_per_country or self.MAX_ARTICLES_PER_COUNTRY
        log = self.log.bind(event_id=event_id, correlation_id=correlation_id)

        async with self.session_factory() as session:
            # Load event and check if it has detected countries
            event = await session.get(Event, event_id)
            if not event:
                log.warning("event_not_found")
                return EnrichmentResult(
                    event_id=event_id,
                    countries_detected=[],
                    countries_fetched=[],
                    countries_excluded=[],
                    articles_found=0,
                    articles_added=0,
                    articles_duplicate=0,
                    errors=["Event not found"],
                )

            detected_countries = event.detected_countries or []
            if not detected_countries:
                # Try to get from LLMInsight if not cached on event
                detected_countries = await self._get_countries_from_insight(
                    session, event_id
                )
                if detected_countries:
                    # Cache on event for future use
                    event.detected_countries = detected_countries
                    await session.flush()

            if not detected_countries:
                log.info("no_countries_detected")
                return EnrichmentResult(
                    event_id=event_id,
                    countries_detected=[],
                    countries_fetched=[],
                    countries_excluded=[],
                    articles_found=0,
                    articles_added=0,
                    articles_duplicate=0,
                )

            log.info(
                "enrichment_starting",
                detected_countries=detected_countries,
            )

            # Get existing source countries to avoid duplicates
            existing_countries = await self._get_existing_source_countries(
                session, event_id
            )

            # Filter countries: exclude NL/BE, already have, unsupported
            countries_to_fetch: list[Country] = []
            excluded: list[str] = []

            for iso_code in detected_countries[: self.MAX_COUNTRIES_PER_EVENT]:
                if self.country_mapper.is_excluded(iso_code):
                    excluded.append(iso_code)
                    continue
                if iso_code in existing_countries:
                    excluded.append(iso_code)
                    continue
                country = self.country_mapper.get_country_by_code(iso_code)
                if country:
                    countries_to_fetch.append(country)
                else:
                    log.debug("country_not_supported", iso_code=iso_code)
                    excluded.append(iso_code)

            if not countries_to_fetch:
                log.info("no_new_countries_to_fetch", excluded=excluded)
                return EnrichmentResult(
                    event_id=event_id,
                    countries_detected=detected_countries,
                    countries_fetched=[],
                    countries_excluded=excluded,
                    articles_found=0,
                    articles_added=0,
                    articles_duplicate=0,
                )

            # Use provided keywords or extract from event
            keywords = search_keywords or await self._extract_keywords(session, event)
            if not keywords:
                log.warning("no_keywords_extracted")
                return EnrichmentResult(
                    event_id=event_id,
                    countries_detected=detected_countries,
                    countries_fetched=[],
                    countries_excluded=excluded,
                    articles_found=0,
                    articles_added=0,
                    articles_duplicate=0,
                    errors=["No keywords could be extracted from event"],
                )

            log.info(
                "fetching_international_articles",
                keywords=keywords,
                countries=[c.iso_code for c in countries_to_fetch],
            )

            # Fetch articles from each country
            all_candidates: list[InternationalArticleCandidate] = []
            fetched_countries: list[str] = []
            errors: list[str] = []

            for country in countries_to_fetch:
                try:
                    reader = GoogleNewsReader(
                        country,
                        use_native_lang=True,  # Search in local language for local sources
                        rate_limit_delay=self.RATE_LIMIT_BETWEEN_COUNTRIES,
                    )
                    articles = await reader.fetch_by_keywords(
                        keywords=keywords,
                        max_results=max_per_country,
                    )

                    for article in articles:
                        candidate = InternationalArticleCandidate(
                            google_article=article,
                            country=country,
                            keyword_matches=self._count_keyword_matches(
                                article.title, keywords
                            ),
                        )
                        all_candidates.append(candidate)

                    fetched_countries.append(country.iso_code)
                    log.debug(
                        "country_fetch_complete",
                        country=country.iso_code,
                        articles_found=len(articles),
                    )

                except GoogleNewsReaderError as e:
                    log.warning(
                        "country_fetch_failed",
                        country=country.iso_code,
                        error=str(e),
                    )
                    errors.append(f"{country.iso_code}: {e}")

                # Rate limiting between countries
                if country != countries_to_fetch[-1]:
                    await asyncio.sleep(self.RATE_LIMIT_BETWEEN_COUNTRIES)

            # Filter by relevance (must have at least 1 keyword match in title)
            relevant = [c for c in all_candidates if c.keyword_matches > 0]

            # Filter out Western sources if US/GB are not involved in the event
            # This removes CNN, BBC, Reuters etc. for non-Western events
            filter_western = "US" not in detected_countries and "GB" not in detected_countries
            western_filtered = 0

            if filter_western:
                filtered = []
                for c in relevant:
                    if is_western_source(c.google_article.url):
                        western_filtered += 1
                        log.debug(
                            "western_source_filtered",
                            url=c.google_article.url[:60],
                            source=c.google_article.source_name,
                        )
                    else:
                        filtered.append(c)
                relevant = filtered

            log.info(
                "relevance_filtering",
                total_found=len(all_candidates),
                relevant=len(relevant),
                western_filtered=western_filtered,
                filter_western_active=filter_western,
            )

            # Deduplicate by URL and persist
            added = 0
            duplicates = 0
            seen_urls: set[str] = set()
            new_articles: list[Article] = []  # Collect for SQLite cache sync
            new_links: list[EventArticle] = []  # Collect for SQLite cache sync

            for candidate in relevant:
                url = candidate.google_article.url
                if url in seen_urls:
                    duplicates += 1
                    continue
                seen_urls.add(url)

                # Check if URL already exists in database
                existing = await session.execute(
                    select(Article).where(Article.url == url)
                )
                if existing.scalar_one_or_none():
                    duplicates += 1
                    continue

                # Create and persist article
                article = self._create_article_from_candidate(candidate)
                session.add(article)
                await session.flush()
                new_articles.append(article)

                # Link to event
                link = EventArticle(
                    event_id=event_id,
                    article_id=article.id,
                    similarity_score=None,  # Not calculated for international articles
                    scoring_breakdown={"source": "google_news_international"},
                    linked_at=datetime.now(timezone.utc),
                )
                session.add(link)
                await session.flush()
                new_links.append(link)
                added += 1

                log.debug(
                    "international_article_added",
                    article_id=article.id,
                    country=candidate.country.iso_code,
                    source=candidate.google_article.source_name,
                )

            # Update event enrichment timestamp
            event.international_enriched_at = datetime.now(timezone.utc)
            event.article_count = (event.article_count or 0) + added

            await session.commit()

            # Sync new entities to SQLite cache (INFRA-1: dual-write)
            if new_articles:
                await sync_entities_to_cache(new_articles, "articles")
            if new_links:
                await sync_entities_to_cache(new_links, "event_articles")
            await sync_entities_to_cache([event], "events")

            log.info(
                "enrichment_complete",
                countries_fetched=fetched_countries,
                articles_found=len(all_candidates),
                articles_added=added,
                articles_duplicate=duplicates,
            )

            # NOTE: Insight regeneration is now handled by
            # InsightService._extract_keywords_and_enrich() which calls this method
            # synchronously BEFORE generating insights.

            return EnrichmentResult(
                event_id=event_id,
                countries_detected=detected_countries,
                countries_fetched=fetched_countries,
                countries_excluded=excluded,
                articles_found=len(all_candidates),
                articles_added=added,
                articles_duplicate=duplicates,
                errors=errors,
            )

    async def _get_countries_from_insight(
        self, session: AsyncSession, event_id: int
    ) -> list[str]:
        """Extract detected countries from LLM insight if not on event."""
        stmt = (
            select(LLMInsight.involved_countries)
            .where(LLMInsight.event_id == event_id)
            .where(LLMInsight.involved_countries.isnot(None))
            .limit(1)
        )
        result = await session.execute(stmt)
        row = result.scalar_one_or_none()

        if not row:
            return []

        # involved_countries is List[Dict] with iso_code keys
        return [c.get("iso_code") for c in row if c.get("iso_code")]

    async def _get_existing_source_countries(
        self, session: AsyncSession, event_id: int
    ) -> set[str]:
        """Get source countries of articles already linked to this event."""
        stmt = (
            select(Article.source_country)
            .join(EventArticle, EventArticle.article_id == Article.id)
            .where(EventArticle.event_id == event_id)
            .where(Article.source_country.isnot(None))
            .distinct()
        )
        result = await session.execute(stmt)
        return {row[0] for row in result.fetchall() if row[0]}

    async def _extract_keywords(
        self, session: AsyncSession, event: Event
    ) -> list[str]:
        """Extract search keywords for international news search.

        Strategy:
        1. FIRST: Use LLM-generated English search keywords (best for international)
        2. FALLBACK: Named entities (PERSON, ORG, GPE) from centroid
        3. LAST RESORT: Title words (less effective for international search)
        """
        # Try to get LLM-generated keywords from insight
        keywords = await self._get_search_keywords_from_insight(session, event.id)
        if keywords:
            return keywords[:5]

        # Fallback: Extract from named entities (work across languages)
        keywords = []
        if event.centroid_entities:
            for entity in event.centroid_entities[:15]:
                text = entity.get("text", "")
                label = entity.get("label", "")
                if label in ("PERSON", "ORG", "GPE") and text and len(text) > 2:
                    keywords.append(text)
                    if len(keywords) >= 4:
                        break

        # Last resort: Title words (skip Dutch stopwords)
        if len(keywords) < 3 and event.title:
            title_words = [
                w.strip(".,!?:;\"'()[]")
                for w in event.title.split()
                if len(w) > 3 and w.lower() not in DUTCH_STOPWORDS
            ]
            for word in title_words[:3]:
                if word not in keywords:
                    keywords.append(word)
                    if len(keywords) >= 5:
                        break

        # Deduplicate
        seen = set()
        unique = []
        for kw in keywords:
            if kw.lower() not in seen:
                seen.add(kw.lower())
                unique.append(kw)
        return unique[:5]

    async def _get_search_keywords_from_insight(
        self, session: AsyncSession, event_id: int
    ) -> list[str]:
        """Get LLM-generated English search keywords from insight."""
        stmt = (
            select(LLMInsight.prompt_metadata)
            .where(LLMInsight.event_id == event_id)
            .limit(1)
        )
        result = await session.execute(stmt)
        row = result.scalar_one_or_none()

        if row and isinstance(row, dict):
            keywords = row.get("search_keywords", [])
            if keywords and isinstance(keywords, list):
                return [k for k in keywords if isinstance(k, str)]
        return []

    def _count_keyword_matches(self, title: str, keywords: list[str]) -> int:
        """Count how many keywords appear in the article title."""
        title_lower = title.lower()
        return sum(1 for kw in keywords if kw.lower() in title_lower)

    def _create_article_from_candidate(
        self, candidate: InternationalArticleCandidate
    ) -> Article:
        """Create an Article model from a GoogleNewsArticle."""
        ga = candidate.google_article
        return Article(
            guid=f"gnews:{ga.url}",  # Synthetic GUID for Google News
            url=ga.url,
            title=ga.title,
            summary=ga.summary,
            content=ga.summary or "",  # Google News only provides summary
            source_name=ga.source_name,
            source_metadata={
                "google_news_url": ga.google_url,
                "search_country": candidate.country.iso_code,  # Country we searched in
                "search_country_name": candidate.country.name,
            },
            published_at=ga.published_at,
            fetched_at=datetime.now(timezone.utc),
            is_international=True,
            # Use the validated source_country from GoogleNewsArticle
            # This is None if the URL's TLD doesn't match the search country
            source_country=ga.source_country,
        )


# Singleton instance
_service: InternationalEnrichmentService | None = None


def get_international_enrichment_service() -> InternationalEnrichmentService:
    """Get the singleton InternationalEnrichmentService instance."""
    global _service
    if _service is None:
        _service = InternationalEnrichmentService()
    return _service


__all__ = [
    "EnrichmentResult",
    "InternationalEnrichmentService",
    "get_international_enrichment_service",
]
