"""
Google News RSS feed reader for international perspectives.

Fetches articles from Google News RSS based on keywords and country parameters.
Decodes Google News redirect URLs to actual article URLs.
"""

import asyncio
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import quote_plus, urlencode

import feedparser
import httpx
import structlog
from dateutil import parser as date_parser

from backend.app.services.country_detector import Country, get_country_from_url

logger = structlog.get_logger(__name__)

# Rate limiting defaults
DEFAULT_RATE_LIMIT_DELAY = 1.0  # seconds between requests
DEFAULT_MAX_RESULTS = 10


@dataclass
class GoogleNewsArticle:
    """Represents an article fetched from Google News."""

    url: str
    title: str
    published_at: datetime
    source_name: str
    source_country: str | None  # ISO country code, None if TLD doesn't match search country
    summary: str | None = None
    is_international: bool = True
    google_url: str | None = None  # Original Google News URL (for debugging)


class GoogleNewsReaderError(Exception):
    """Exception raised when Google News fetching fails."""

    pass


class URLDecodingError(GoogleNewsReaderError):
    """Exception raised when URL decoding fails."""

    pass


class GoogleNewsReader:
    """
    Fetches articles from Google News RSS based on keywords and country.

    Uses Google News RSS search API with country/language parameters to get
    perspectives from specific countries. Decodes Google News redirect URLs
    to actual article URLs using the googlenewsdecoder package.
    """

    BASE_URL = "https://news.google.com/rss/search"

    def __init__(
        self,
        country: Country,
        use_native_lang: bool = False,
        rate_limit_delay: float = DEFAULT_RATE_LIMIT_DELAY,
    ):
        """
        Initialize GoogleNewsReader for a specific country.

        Args:
            country: Country object with Google News parameters
            use_native_lang: If True, use native language params; else use English
            rate_limit_delay: Delay in seconds between requests (rate limiting)
        """
        self.country = country
        self.rate_limit_delay = rate_limit_delay

        # Select language params
        if use_native_lang and country.google_news_native:
            self.params = country.google_news_native
        else:
            self.params = country.google_news_primary

        self.logger = logger.bind(
            country=country.iso_code,
            lang=self.params.hl,
        )

    @property
    def country_code(self) -> str:
        """Return ISO country code."""
        return self.country.iso_code

    async def fetch_by_keywords(
        self,
        keywords: list[str],
        max_results: int = DEFAULT_MAX_RESULTS,
    ) -> list[GoogleNewsArticle]:
        """
        Fetch articles matching keywords from this country's perspective.

        Args:
            keywords: List of search keywords
            max_results: Maximum number of articles to return

        Returns:
            List of GoogleNewsArticle objects

        Raises:
            GoogleNewsReaderError: When fetching fails
        """
        if not keywords:
            self.logger.warning("fetch_by_keywords called with empty keywords")
            return []

        query = " ".join(keywords)
        url = self._build_search_url(query)

        self.logger.info(
            "fetching_google_news",
            query=query,
            url=url,
            max_results=max_results,
        )

        try:
            async with httpx.AsyncClient(
                timeout=30.0,
                follow_redirects=True,
            ) as client:
                response = await client.get(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    },
                )
                response.raise_for_status()
                content = response.content

            # Parse RSS feed
            feed = feedparser.parse(content)

            if feed.bozo:
                self.logger.warning(
                    "rss_parsing_issues",
                    bozo_exception=str(feed.bozo_exception),
                )

            # Process entries
            articles = []
            for entry in feed.entries[:max_results]:
                try:
                    article = await self._parse_entry(entry)
                    articles.append(article)
                except Exception as e:
                    self.logger.warning(
                        "failed_to_parse_entry",
                        entry_title=getattr(entry, "title", "unknown"),
                        error=str(e),
                    )
                    continue

            self.logger.info(
                "google_news_fetch_complete",
                total_entries=len(feed.entries),
                parsed_articles=len(articles),
            )

            return articles

        except httpx.RequestError as e:
            self.logger.error("network_error", error=str(e), url=url)
            raise GoogleNewsReaderError(f"Network error fetching Google News: {e}") from e

        except httpx.HTTPStatusError as e:
            self.logger.error(
                "http_error",
                status_code=e.response.status_code,
                error=str(e),
                url=url,
            )
            raise GoogleNewsReaderError(f"HTTP error fetching Google News: {e}") from e

    def _build_search_url(self, query: str) -> str:
        """
        Build Google News RSS search URL with country/language params.

        Args:
            query: Search query string

        Returns:
            Full RSS search URL
        """
        params = {
            "q": query,
            "hl": self.params.hl,
            "gl": self.params.gl,
            "ceid": self.params.ceid,
        }
        return f"{self.BASE_URL}?{urlencode(params, quote_via=quote_plus)}"

    async def _parse_entry(self, entry: Any) -> GoogleNewsArticle:
        """
        Parse a single RSS entry into a GoogleNewsArticle.

        Args:
            entry: feedparser entry object

        Returns:
            GoogleNewsArticle object
        """
        # Get original Google News URL
        google_url = getattr(entry, "link", "")

        # Decode to real article URL
        real_url = await self._decode_google_url(google_url)

        # Extract title
        title = getattr(entry, "title", "").strip()
        if not title:
            raise ValueError("Entry has no title")

        # Extract source name
        source_name = self._extract_source_name(entry)

        # Parse publication date
        published_at = self._parse_date(entry)

        # Extract summary if available
        summary = None
        if hasattr(entry, "summary"):
            summary = self._clean_html(entry.summary)
        elif hasattr(entry, "description"):
            summary = self._clean_html(entry.description)

        # Set source_country based on TLD detection (not search country)
        # This correctly identifies the actual source country:
        # - kuna.net.kw → KW (Kuwait)
        # - aa.com.tr → TR (Turkey)
        # - cnn.com → None (generic TLD, no country)
        source_country = get_country_from_url(real_url)
        if source_country:
            self.logger.debug(
                "source_country_detected",
                url=real_url[:80],
                source_country=source_country,
            )

        return GoogleNewsArticle(
            url=real_url,
            title=title,
            published_at=published_at,
            source_name=source_name,
            source_country=source_country,
            summary=summary,
            is_international=True,
            google_url=google_url,
        )

    async def _decode_google_url(self, google_url: str) -> str:
        """
        Decode Google News redirect URL to actual article URL.

        Uses googlenewsdecoder package for reliable decoding.
        Falls back to the original URL if decoding fails.

        Args:
            google_url: Google News redirect URL

        Returns:
            Decoded article URL or original URL as fallback
        """
        if not google_url or "/articles/" not in google_url:
            return google_url

        try:
            # googlenewsdecoder is synchronous, run in executor
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._decode_url_sync,
                google_url,
            )
            return result

        except Exception as e:
            self.logger.warning(
                "url_decoding_failed",
                google_url=google_url,
                error=str(e),
            )
            # Return original URL as fallback
            return google_url

    def _decode_url_sync(self, google_url: str) -> str:
        """
        Synchronous URL decoding using googlenewsdecoder.

        Args:
            google_url: Google News URL to decode

        Returns:
            Decoded URL or original if decoding fails
        """
        try:
            from googlenewsdecoder import gnewsdecoder

            result = gnewsdecoder(google_url)

            if result.get("status"):
                decoded_url = result.get("decoded_url", google_url)
                self.logger.debug(
                    "url_decoded",
                    original=google_url[:80],
                    decoded=decoded_url[:80],
                )
                return decoded_url
            else:
                self.logger.warning(
                    "decoder_returned_error",
                    message=result.get("message", "Unknown error"),
                )
                return google_url

        except ImportError:
            self.logger.warning("googlenewsdecoder not installed, using original URL")
            return google_url

    def _extract_source_name(self, entry: Any) -> str:
        """
        Extract source name from RSS entry.

        Google News includes source info in the 'source' attribute.

        Args:
            entry: feedparser entry object

        Returns:
            Source name string
        """
        # Google News RSS includes source in 'source' attribute
        if hasattr(entry, "source"):
            source = entry.source
            if hasattr(source, "title"):
                return source.title
            if isinstance(source, dict) and "title" in source:
                return source["title"]

        # Fallback: try to extract from title (format: "Title - Source")
        title = getattr(entry, "title", "")
        if " - " in title:
            parts = title.rsplit(" - ", 1)
            if len(parts) == 2:
                return parts[1].strip()

        return "Unknown"

    def _parse_date(self, entry: Any) -> datetime:
        """
        Parse publication date from RSS entry.

        Args:
            entry: feedparser entry object

        Returns:
            datetime object
        """
        date_fields = ["published", "updated", "created"]

        for field in date_fields:
            if hasattr(entry, field):
                date_str = getattr(entry, field)
                try:
                    return date_parser.parse(date_str)
                except (ValueError, TypeError):
                    continue

        # Try parsed date
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            try:
                import time

                return datetime.fromtimestamp(time.mktime(entry.published_parsed))
            except (ValueError, TypeError, OverflowError):
                pass

        # Fallback to current time
        self.logger.warning("no_publication_date_found")
        return datetime.now()

    def _clean_html(self, text: str) -> str:
        """Remove HTML tags from text."""
        if not text:
            return ""
        clean = re.sub(r"<[^>]+>", "", text)
        clean = re.sub(r"\s+", " ", clean).strip()
        return clean


async def fetch_international_articles(
    keywords: list[str],
    countries: list[Country],
    max_per_country: int = 5,
    rate_limit_delay: float = DEFAULT_RATE_LIMIT_DELAY,
) -> dict[str, list[GoogleNewsArticle]]:
    """
    Fetch articles from multiple countries.

    Convenience function for fetching international perspectives on a topic.

    Args:
        keywords: Search keywords
        countries: List of Country objects to fetch from
        max_per_country: Maximum articles per country
        rate_limit_delay: Delay between country fetches

    Returns:
        Dictionary mapping country ISO codes to article lists
    """
    results: dict[str, list[GoogleNewsArticle]] = {}

    for country in countries:
        reader = GoogleNewsReader(country, rate_limit_delay=rate_limit_delay)

        try:
            articles = await reader.fetch_by_keywords(
                keywords=keywords,
                max_results=max_per_country,
            )
            results[country.iso_code] = articles

        except GoogleNewsReaderError as e:
            logger.warning(
                "country_fetch_failed",
                country=country.iso_code,
                error=str(e),
            )
            results[country.iso_code] = []

        # Rate limiting between countries
        if rate_limit_delay > 0:
            await asyncio.sleep(rate_limit_delay)

    return results
