"""
Een Blik op de NOS feed reader implementation.

Reads the YouTube channel of Een Blik op de NOS, which posts fragments of NOS coverage with its
criticism in the description. Until 2025-12 the reader used the X API for @eenblikopdenos; X has
answered 403 since then (reading posts needs a paid API plan), and the account has no website.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List

import feedparser
import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .base import FeedItem, FeedReader, FeedReaderError, http_client

# The channel feed of youtube.com/@eenblikopdenos
CHANNEL_ID = "UCpsU4OfNLGVyTmKs4Ir28LQ"
DEFAULT_FEED_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"


class EenBlikOpDeNosReader(FeedReader):
    """Reader for the YouTube channel of Een Blik op de NOS (criticism of NOS coverage)."""

    @property
    def id(self) -> str:
        """Return unique identifier for Een Blik op de NOS feed reader."""
        return "eenblikopdenos_rss"

    @property
    def source_metadata(self) -> Dict[str, Any]:
        """Return metadata about Een Blik op de NOS as a news source."""
        return {
            "name": "Een Blik op de NOS",
            "full_name": "Een Blik op de NOS",
            # Right-of-center, critical of public broadcaster (0=far-left, 10=far-right)
            "spectrum": 7,
            "country": "NL",
            "language": "nl",
            "media_type": "social_commentary",
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def fetch(self) -> List[FeedItem]:
        """
        Fetch the videos of the channel feed.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            async with http_client() as client:
                response = await client.get(self.feed_url)
                response.raise_for_status()
                content = response.content
        except httpx.RequestError as e:
            self.logger.error("Network error fetching Een Blik op de NOS feed", error=str(e))
            raise FeedReaderError(f"Network error fetching Een Blik op de NOS feed: {e}") from e
        except httpx.HTTPStatusError as e:
            self.logger.error(
                "HTTP error fetching Een Blik op de NOS feed", status_code=e.response.status_code
            )
            raise FeedReaderError(f"HTTP error fetching Een Blik op de NOS feed: {e}") from e

        feed = feedparser.parse(content)
        items = []
        for entry in feed.entries:
            try:
                items.append(self._parse_entry(entry))
            except Exception as e:
                self.logger.warning(
                    "Failed to parse video", video_id=entry.get("yt_videoid"), error=str(e)
                )

        self.logger.info(
            "Successfully fetched Een Blik op de NOS feed",
            total_entries=len(feed.entries),
            parsed_items=len(items),
        )
        return self._filter_duplicates(items)

    def _parse_entry(self, entry: Any) -> FeedItem:
        """Parse one video of the channel feed into a FeedItem."""
        video_id = entry.get("yt_videoid")
        url = entry.get("link")
        title = (entry.get("title") or "").strip()
        if not video_id or not url or not title:
            raise ValueError("Video has no id, link or title")

        description = (entry.get("summary") or "").strip()
        published = entry.get("published_parsed")
        if published:
            published_at = datetime(*published[:6], tzinfo=timezone.utc)
        else:
            published_at = datetime.now(timezone.utc)
        thumbnails = entry.get("media_thumbnail") or []

        return FeedItem(
            guid=f"youtube-{video_id}",
            url=url,
            title=title,
            summary=description or None,
            published_at=published_at,
            source_metadata={
                **self.source_metadata,
                "video_id": video_id,
                # The video's page holds no text: the title and the description are the content
                "full_text_from_feed": f"{title}\n\n{description}" if description else title,
            },
            image_url=thumbnails[0].get("url") if thumbnails else None,
        )
