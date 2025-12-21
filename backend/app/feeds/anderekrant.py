"""
De Andere Krant RSS feed reader implementation.

Fetches and normalizes RSS feeds from De Andere Krant (alternative Dutch news weekly).
"""

import re
from datetime import datetime
from typing import List, Dict, Any
from dateutil import parser
import feedparser
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .base import FeedReader, FeedItem, FeedReaderError, http_client


class AndereKrantRssReader(FeedReader):
    """RSS reader for De Andere Krant feeds."""

    @property
    def id(self) -> str:
        """Return unique identifier for De Andere Krant feed reader."""
        return "anderekrant_rss"

    @property
    def source_metadata(self) -> Dict[str, Any]:
        """Return metadata about De Andere Krant as a news source."""
        return {
            "name": "De Andere Krant",
            "full_name": "De Andere Krant",
            "spectrum": "alternative",  # Alternative media, shown separately
            "country": "NL",
            "language": "nl",
            "media_type": "alternative_weekly"
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def fetch(self) -> List[FeedItem]:
        """
        Fetch and parse De Andere Krant RSS feed entries.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            self.logger.info("Fetching De Andere Krant RSS feed", feed_url=self.feed_url)

            # Fetch RSS content with properly managed HTTP client
            async with http_client() as client:
                response = await client.get(self.feed_url)
                response.raise_for_status()
                content = response.content

            # Parse with feedparser (outside context - client no longer needed)
            feed = feedparser.parse(content)

            if feed.bozo:
                self.logger.warning("RSS feed has parsing issues",
                                  bozo_exception=str(feed.bozo_exception))

            # Convert entries to normalized FeedItems
            items = []
            for entry in feed.entries:
                try:
                    item = self._parse_entry(entry, feed)
                    # Filter out non-news content (edition announcements, promotional content)
                    if self._is_meta_content(item):
                        self.logger.debug("Skipping meta content",
                                        title=item.title)
                        continue
                    items.append(item)
                except Exception as e:
                    self.logger.warning("Failed to parse feed entry",
                                      entry_id=getattr(entry, "id", "unknown"),
                                      error=str(e))
                    continue

            # Filter duplicates and return
            unique_items = self._filter_duplicates(items)
            self.logger.info("Successfully fetched De Andere Krant feed",
                           total_entries=len(feed.entries),
                           parsed_items=len(items),
                           unique_items=len(unique_items))

            return unique_items

        except httpx.RequestError as e:
            self.logger.error("Network error fetching De Andere Krant RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Network error fetching De Andere Krant RSS: {e}")

        except httpx.HTTPStatusError as e:
            self.logger.error("HTTP error fetching De Andere Krant RSS feed",
                            status_code=e.response.status_code,
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"HTTP error fetching De Andere Krant RSS: {e}")

        except Exception as e:
            self.logger.error("Unexpected error fetching De Andere Krant RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Unexpected error fetching De Andere Krant RSS: {e}")

    def _parse_entry(self, entry: Any, feed: Any) -> FeedItem:
        """Parse a single RSS entry into a FeedItem."""
        # Extract GUID - try id first, then link as fallback
        guid = getattr(entry, "id", None) or getattr(entry, "link", None)
        if not guid:
            raise ValueError("Entry has no ID or link")

        # Extract URL
        url = getattr(entry, "link", None)
        if not url:
            raise ValueError("Entry has no link")

        # Extract title
        title = getattr(entry, "title", "").strip()
        if not title:
            raise ValueError("Entry has no title")

        # Extract summary/description - prefer content:encoded for full text
        summary = None
        if hasattr(entry, "content") and entry.content:
            # WordPress uses content:encoded which feedparser stores in entry.content
            for content_item in entry.content:
                if content_item.get("type") in ("text/html", "html"):
                    summary = self._clean_html(content_item.get("value", ""))
                    break
        if not summary and hasattr(entry, "summary"):
            summary = self._clean_html(entry.summary)
        elif not summary and hasattr(entry, "description"):
            summary = self._clean_html(entry.description)

        # Parse publication date
        published_at = self._parse_date(entry)

        # Extract categories
        categories = []
        if hasattr(entry, "tags"):
            categories = [tag.term for tag in entry.tags if hasattr(tag, "term")]
        elif hasattr(entry, "category"):
            categories = [entry.category]

        # Extract author (WordPress uses dc:creator)
        author = ""
        if hasattr(entry, "author"):
            author = entry.author
        elif hasattr(entry, "dc_creator"):
            author = entry.dc_creator

        # Build source metadata
        source_metadata = {
            **self.source_metadata,
            "feed_title": getattr(feed.feed, "title", "De Andere Krant"),
            "feed_link": getattr(feed.feed, "link", ""),
            "categories": categories,
            "author": author,
        }

        return FeedItem(
            guid=guid,
            url=url,
            title=title,
            summary=summary,
            published_at=published_at,
            source_metadata=source_metadata,
            image_url=None,  # Can be extracted if needed
        )

    def _parse_date(self, entry: Any) -> datetime:
        """Parse publication date from RSS entry."""
        # Try different date fields
        date_fields = ["published", "updated", "created"]

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

    def _is_meta_content(self, item: FeedItem) -> bool:
        """
        Detect non-news content like edition announcements, promotional content,
        and tables of contents that should not be treated as news events.
        """
        title_lower = item.title.lower()
        summary_lower = (item.summary or "").lower()

        # Edition/issue announcements (e.g., "uitgave 48 gepubliceerd")
        if re.search(r"uitgave\s+\d+", title_lower):
            return True

        # "Deze week in De Andere Krant" type content
        if "deze week in" in title_lower or "deze editie" in title_lower:
            return True

        # Subscription/sales promotions
        promo_patterns = [
            r"abonnement",
            r"verkooppunt",
            r"bestel\s+(nu|hier|direct)",
            r"neem\s+een\s+abonnement",
        ]
        for pattern in promo_patterns:
            if re.search(pattern, title_lower) or re.search(pattern, summary_lower):
                return True

        # Table of contents indicators (listing multiple topics with "en", "ook", etc.)
        # These are meta-articles summarizing an edition
        if summary_lower:
            # Count topic indicators - if many different topics mentioned, likely a TOC
            topic_markers = ["daarnaast", "ook", "verder", "tevens", "bovendien"]
            marker_count = sum(1 for m in topic_markers if m in summary_lower)
            if marker_count >= 3:
                return True

        return False
