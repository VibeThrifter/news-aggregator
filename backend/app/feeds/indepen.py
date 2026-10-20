"""
INDEPEN RSS feed reader implementation.

Fetches and normalizes the RSS feed of INDEPEN (indepen.eu), a Dutch alternative news platform: a
foundation funded by donations, writing about politics, economy, climate and health. Its WordPress
feed (/feed/, the 10 newest posts, about one a day) carries the full article text in
content:encoded. The page adds the comments and lists of other articles to that text (trafilatura
gave 36,000 characters for an article of 6,000), so the text comes from the feed and the page is
never fetched (source_profiles.yaml: indepen_rss, parser rss_only).
"""

import html
import re
from datetime import datetime
from typing import Any

import feedparser
import httpx
from dateutil import parser
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .base import FeedItem, FeedReader, FeedReaderError, http_client

# Where a paragraph, heading or list item ends, the text gets a line break
_BLOCK_END = re.compile(r"<br\s*/?>|</(?:p|h[1-6]|li|blockquote|div)>", re.IGNORECASE)


class IndepenRssReader(FeedReader):
    """RSS reader for the INDEPEN feed."""

    @property
    def id(self) -> str:
        """Return unique identifier for the INDEPEN feed reader."""
        return "indepen_rss"

    @property
    def source_metadata(self) -> dict[str, Any]:
        """Return metadata about INDEPEN as a news source."""
        return {
            "name": "INDEPEN",
            "full_name": "INDEPEN",
            "spectrum": "alternative",  # Alternative media, shown separately (like NineForNews)
            "country": "NL",
            "language": "nl",
            "media_type": "alternative_online"
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def fetch(self) -> list[FeedItem]:
        """
        Fetch and parse INDEPEN RSS feed entries.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            self.logger.info("Fetching INDEPEN RSS feed", feed_url=self.feed_url)

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
                    items.append(item)
                except Exception as e:
                    self.logger.warning("Failed to parse feed entry",
                                      entry_id=getattr(entry, "id", "unknown"),
                                      error=str(e))
                    continue

            # Filter duplicates and return
            unique_items = self._filter_duplicates(items)
            self.logger.info("Successfully fetched INDEPEN feed",
                           total_entries=len(feed.entries),
                           parsed_items=len(items),
                           unique_items=len(unique_items))

            return unique_items

        except httpx.RequestError as e:
            self.logger.error("Network error fetching INDEPEN RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Network error fetching INDEPEN RSS: {e}") from e

        except httpx.HTTPStatusError as e:
            self.logger.error("HTTP error fetching INDEPEN RSS feed",
                            status_code=e.response.status_code,
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"HTTP error fetching INDEPEN RSS: {e}") from e

        except Exception as e:
            self.logger.error("Unexpected error fetching INDEPEN RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Unexpected error fetching INDEPEN RSS: {e}") from e

    def _parse_entry(self, entry: Any, feed: Any) -> FeedItem:
        """Parse a single RSS entry into a FeedItem."""
        # Extract GUID - WordPress gives https://indepen.eu/?p=<id>, else the link
        guid = getattr(entry, "id", None) or getattr(entry, "link", None)
        if not guid:
            raise ValueError("Entry has no ID or link")

        # Extract URL
        url = getattr(entry, "link", None)
        if not url:
            raise ValueError("Entry has no link")

        # Extract title
        title = html.unescape(getattr(entry, "title", "")).strip()
        if not title:
            raise ValueError("Entry has no title")

        # The description is WordPress' excerpt, about 55 words ending in "[…]"
        summary = None
        if hasattr(entry, "description"):
            summary = re.sub(r"\s*\[…\]$", "…", self._text(entry.description).replace("\n", " ")) or None

        # content:encoded (feedparser: entry.content) is the full article. Without it the excerpt
        # or the title is the text, so the page, full of comments, is never fetched
        full_text = ""
        for content_item in getattr(entry, "content", None) or []:
            if content_item.get("type") in ("text/html", "html"):
                full_text = self._text(content_item.get("value", ""))
                break
        full_text = full_text or summary or title

        # Parse publication date
        published_at = self._parse_date(entry)

        # Extract categories (Politiek, Column, ...) and author (dc:creator)
        categories = [tag.term for tag in getattr(entry, "tags", []) if getattr(tag, "term", None)]
        author = getattr(entry, "author", "")

        # Build source metadata
        source_metadata = {
            **self.source_metadata,
            "feed_title": getattr(feed.feed, "title", "INDEPEN"),
            "feed_link": getattr(feed.feed, "link", ""),
            "categories": categories,
            "author": author,
            # The ingest takes this as the article text (see the module docstring)
            "full_text_from_feed": full_text,
        }

        return FeedItem(
            guid=guid,
            url=url,
            title=title,
            summary=summary,
            published_at=published_at,
            source_metadata=source_metadata,
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

    @staticmethod
    def _text(markup: str) -> str:
        """The text of HTML: a line per paragraph, heading or list item, entities decoded (&#8217; -> ’)."""
        if not markup:
            return ""
        text = html.unescape(re.sub(r"<[^>]+>", "", _BLOCK_END.sub("\n", markup)))
        lines = (re.sub(r"\s+", " ", line).strip() for line in text.split("\n"))
        return "\n".join(line for line in lines if line)
