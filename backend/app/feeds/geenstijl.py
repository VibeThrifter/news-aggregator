"""
GeenStijl Atom feed reader implementation.

Fetches and normalizes Atom feeds from GeenStijl (opinionated Dutch news/commentary site).
The Atom feed provides full article content in the <content> tag, so no Playwright is needed.
"""

import re
from datetime import datetime
from typing import List, Dict, Any
from dateutil import parser
import feedparser
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .base import FeedReader, FeedItem, FeedReaderError


class GeenStijlAtomReader(FeedReader):
    """Atom feed reader for GeenStijl feeds."""

    def __init__(self, feed_url: str):
        """Initialize GeenStijl Atom reader."""
        super().__init__(feed_url)
        self._session: httpx.AsyncClient | None = None

    @property
    def session(self) -> httpx.AsyncClient:
        """Lazy-initialize HTTP client on first use."""
        if self._session is None or self._session.is_closed:
            self._session = httpx.AsyncClient(
                timeout=30.0,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
            )
        return self._session

    @property
    def id(self) -> str:
        """Return unique identifier for GeenStijl feed reader."""
        return "geenstijl_atom"

    @property
    def source_metadata(self) -> Dict[str, Any]:
        """Return metadata about GeenStijl as a news source."""
        return {
            "name": "GeenStijl",
            "full_name": "GeenStijl",
            "spectrum": "right-leaning",  # Opinionated, libertarian-right perspective
            "country": "NL",
            "language": "nl",
            "media_type": "opinion_blog"
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def fetch(self) -> List[FeedItem]:
        """
        Fetch and parse GeenStijl Atom feed entries.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            self.logger.info("Fetching GeenStijl Atom feed", feed_url=self.feed_url)

            # Fetch Atom content with HTTPX
            response = await self.session.get(self.feed_url)
            response.raise_for_status()

            # Parse with feedparser (handles both RSS and Atom)
            feed = feedparser.parse(response.content)

            if feed.bozo:
                self.logger.warning("Atom feed has parsing issues",
                                  bozo_exception=str(feed.bozo_exception))

            # Convert entries to normalized FeedItems
            items = []
            for entry in feed.entries:
                try:
                    item = self._parse_entry(entry, feed)
                    items.append(item)
                except Exception as e:
                    self.logger.warning("Failed to parse feed entry",
                                      entry_id=getattr(entry, "id", "unknown"),
                                      error=str(e))
                    continue

            # Filter duplicates and return
            unique_items = self._filter_duplicates(items)
            self.logger.info("Successfully fetched GeenStijl feed",
                           total_entries=len(feed.entries),
                           parsed_items=len(items),
                           unique_items=len(unique_items))

            return unique_items

        except httpx.RequestError as e:
            self.logger.error("Network error fetching GeenStijl Atom feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Network error fetching GeenStijl Atom: {e}")

        except httpx.HTTPStatusError as e:
            self.logger.error("HTTP error fetching GeenStijl Atom feed",
                            status_code=e.response.status_code,
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"HTTP error fetching GeenStijl Atom: {e}")

        except Exception as e:
            self.logger.error("Unexpected error fetching GeenStijl Atom feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Unexpected error fetching GeenStijl Atom: {e}")

    def _parse_entry(self, entry: Any, feed: Any) -> FeedItem:
        """Parse a single Atom entry into a FeedItem."""
        # Extract GUID - Atom uses id element
        guid = getattr(entry, "id", None) or getattr(entry, "link", None)
        if not guid:
            raise ValueError("Entry has no ID or link")

        # Extract URL - Atom uses link with rel="alternate"
        url = getattr(entry, "link", None)
        if not url:
            raise ValueError("Entry has no link")

        # Extract title
        title = getattr(entry, "title", "").strip()
        if not title:
            raise ValueError("Entry has no title")

        # Extract full content from Atom <content> tag (GeenStijl provides full articles here)
        # The content tag has the full HTML article content
        summary = None
        full_text = None

        if hasattr(entry, "content") and entry.content:
            # feedparser stores Atom <content> in entry.content list
            for content_item in entry.content:
                if content_item.get("type") in ("text/html", "html"):
                    full_text = self._clean_html(content_item.get("value", ""))
                    break

        # Use summary element as fallback or for short summary
        if hasattr(entry, "summary") and entry.summary:
            summary = self._clean_html(entry.summary)

        # If we got full text from content, use that as summary if no explicit summary
        if full_text and not summary:
            summary = full_text[:500] + "..." if len(full_text) > 500 else full_text

        # Parse publication date
        published_at = self._parse_date(entry)

        # Extract author (Atom has explicit author element)
        author = ""
        if hasattr(entry, "author"):
            author = entry.author
        elif hasattr(entry, "author_detail"):
            author = entry.author_detail.get("name", "")

        # Build source metadata
        source_metadata = {
            **self.source_metadata,
            "feed_title": getattr(feed.feed, "title", "GeenStijl"),
            "feed_link": getattr(feed.feed, "link", ""),
            "author": author,
            # Store full text in metadata for later use in ingestion
            "full_text_from_feed": full_text,
        }

        # Extract image URL from enclosure link
        image_url = self._extract_image_url(entry)

        return FeedItem(
            guid=guid,
            url=url,
            title=title,
            summary=summary,
            published_at=published_at,
            source_metadata=source_metadata,
            image_url=image_url,
        )

    def _parse_date(self, entry: Any) -> datetime:
        """Parse publication date from Atom entry."""
        # Atom uses published and updated elements
        date_fields = ["published", "updated"]

        for field in date_fields:
            if hasattr(entry, field):
                date_str = getattr(entry, field)
                try:
                    return parser.parse(date_str)
                except (ValueError, TypeError):
                    continue

        # Try parsed date fields
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            try:
                import time
                return datetime.fromtimestamp(time.mktime(entry.published_parsed))
            except (ValueError, TypeError, OverflowError):
                pass

        if hasattr(entry, "updated_parsed") and entry.updated_parsed:
            try:
                import time
                return datetime.fromtimestamp(time.mktime(entry.updated_parsed))
            except (ValueError, TypeError, OverflowError):
                pass

        # Fallback to current time if no date found
        self.logger.warning("No valid publication date found, using current time",
                          entry_id=getattr(entry, "id", "unknown"))
        return datetime.now()

    def _clean_html(self, text: str) -> str:
        """Remove HTML tags and clean up text content."""
        if not text:
            return ""

        # Simple HTML tag removal
        clean_text = re.sub(r"<[^>]+>", "", text)

        # Clean up whitespace
        clean_text = re.sub(r"\s+", " ", clean_text).strip()

        return clean_text

    def _extract_image_url(self, entry: Any) -> str | None:
        """Extract image URL from Atom enclosure link."""
        # Check for links with rel="enclosure" (GeenStijl uses this for images)
        if hasattr(entry, "links"):
            for link in entry.links:
                rel = link.get("rel", "")
                link_type = link.get("type", "")
                href = link.get("href")
                if rel == "enclosure" and href and link_type.startswith("image/"):
                    return href

        # Try media:content
        media_content = getattr(entry, "media_content", [])
        for media in media_content:
            media_type = media.get("type", "") or media.get("medium", "")
            media_url = media.get("url")
            if media_url and ("image" in media_type or media_type == "" or media_type == "image"):
                return media_url

        return None
