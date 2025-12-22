"""
Een Blik op de NOS (@eenblikopdenos) feed reader implementation.

Fetches tweets from the @eenblikopdenos X/Twitter account using Twitter API v2.
Falls back to Nitter-compatible RSS proxies if API is not configured.

This account provides critical commentary on NOS (Dutch public broadcaster) coverage.
"""

import re
from datetime import datetime
from typing import Any

import tweepy

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger

from .base import FeedItem, FeedReader, FeedReaderError

logger = get_logger(__name__)


class EenBlikOpDeNosReader(FeedReader):
    """
    Reader for @eenblikopdenos X/Twitter account via Twitter API v2.

    This account provides critical commentary on NOS (Dutch public broadcaster)
    coverage, making it valuable for pluralistic news analysis.
    """

    # Twitter user ID for @eenblikopdenos
    DEFAULT_USER_ID = "1496052211709571077"

    @property
    def id(self) -> str:
        """Return unique identifier for Een Blik op de NOS feed reader."""
        return "eenblikopdenos_rss"

    @property
    def source_metadata(self) -> dict[str, Any]:
        """Return metadata about Een Blik op de NOS as a news source."""
        return {
            "name": "Een Blik op de NOS",
            "full_name": "Een Blik op de NOS (@eenblikopdenos)",
            # Right-of-center, critical of public broadcaster (0=far-left, 10=far-right)
            "spectrum": 7,
            "country": "NL",
            "language": "nl",
            "media_type": "social_commentary"
        }

    async def fetch(self) -> list[FeedItem]:
        """
        Fetch tweets from @eenblikopdenos via Twitter API v2.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching fails.
        """
        settings = get_settings()

        # Check if Twitter API is configured
        if not settings.twitter_bearer_token:
            error_msg = (
                "Twitter bearer token not configured. "
                "Set TWITTER_BEARER_TOKEN in .env to enable @eenblikopdenos feed."
            )
            self.logger.warning(error_msg)
            raise FeedReaderError(error_msg)

        try:
            return await self._fetch_via_twitter_api(settings)
        except tweepy.TweepyException as e:
            error_msg = f"Twitter API error: {e}"
            self.logger.error(error_msg)
            raise FeedReaderError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error fetching tweets: {e}"
            self.logger.error(error_msg)
            raise FeedReaderError(error_msg) from e

    async def _fetch_via_twitter_api(self, settings: Any) -> list[FeedItem]:
        """Fetch tweets using Twitter API v2."""
        self.logger.info(
            "Fetching tweets via Twitter API v2",
            user_id=settings.twitter_eenblikopdenos_user_id
        )

        # Initialize Twitter client
        client = tweepy.Client(bearer_token=settings.twitter_bearer_token)

        # Get user's tweets with additional fields
        user_id = settings.twitter_eenblikopdenos_user_id or self.DEFAULT_USER_ID

        response = client.get_users_tweets(
            id=user_id,
            max_results=20,  # Free tier limit consideration
            tweet_fields=["created_at", "author_id", "public_metrics", "entities"],
            expansions=["author_id"],
            user_fields=["username", "name"]
        )

        if not response.data:
            self.logger.warning("No tweets returned from Twitter API")
            return []

        # Parse author info from includes
        author_info = {}
        if response.includes and "users" in response.includes:
            for user in response.includes["users"]:
                author_info[user.id] = {
                    "username": user.username,
                    "name": user.name
                }

        # Convert tweets to FeedItems
        items = []
        for tweet in response.data:
            try:
                item = self._parse_tweet(tweet, author_info)
                items.append(item)
            except Exception as e:
                self.logger.warning(
                    "Failed to parse tweet",
                    tweet_id=tweet.id,
                    error=str(e)
                )
                continue

        self.logger.info(
            "Successfully fetched tweets via Twitter API",
            tweet_count=len(items)
        )

        return items

    def _parse_tweet(self, tweet: Any, author_info: dict) -> FeedItem:
        """Parse a single tweet into a FeedItem."""
        # Build tweet URL
        author_username = "eenblikopdenos"
        if tweet.author_id and tweet.author_id in author_info:
            author_username = author_info[tweet.author_id].get(
                "username", "eenblikopdenos"
            )
        url = f"https://x.com/{author_username}/status/{tweet.id}"

        # Extract title (first 100 chars of tweet)
        text = tweet.text or ""
        title = self._clean_text(text[:100])
        if len(text) > 100:
            title += "..."

        if not title:
            raise ValueError("Tweet has no text content")

        # Full text as summary
        summary = self._clean_text(text)

        # Parse publication date
        published_at = tweet.created_at or datetime.now()
        if isinstance(published_at, str):
            from dateutil import parser
            published_at = parser.parse(published_at)

        # Extract image URL from entities if present
        image_url = self._extract_image_url(tweet)

        # Build source metadata
        source_metadata = {
            **self.source_metadata,
            "tweet_id": str(tweet.id),
            "author_username": author_username,
            "author_name": author_info.get(tweet.author_id, {}).get(
                "name", "Een Blik op de NOS"
            ),
            # Store full text for clustering (tweets are the content)
            "full_text_from_feed": summary,
        }

        # Add metrics if available
        if tweet.public_metrics:
            source_metadata["metrics"] = {
                "likes": tweet.public_metrics.get("like_count", 0),
                "retweets": tweet.public_metrics.get("retweet_count", 0),
                "replies": tweet.public_metrics.get("reply_count", 0),
            }

        return FeedItem(
            guid=f"twitter-{tweet.id}",
            url=url,
            title=title,
            summary=summary,
            published_at=published_at,
            source_metadata=source_metadata,
            image_url=image_url,
        )

    def _clean_text(self, text: str) -> str:
        """Clean up tweet text."""
        if not text:
            return ""

        # Remove t.co URLs (Twitter shortens all URLs)
        clean_text = re.sub(r"https://t\.co/\w+", "", text)

        # Clean up whitespace
        clean_text = re.sub(r"\s+", " ", clean_text).strip()

        return clean_text

    def _extract_image_url(self, tweet: Any) -> str | None:
        """Extract image URL from tweet entities."""
        if not hasattr(tweet, "entities") or not tweet.entities:
            return None

        # Check for media in entities
        if "urls" in tweet.entities:
            for url_entity in tweet.entities["urls"]:
                # Twitter includes expanded_url for media
                expanded = url_entity.get("expanded_url", "")
                if "pic.twitter.com" in expanded or "/photo/" in expanded:
                    # Could try to resolve, but for now just note it exists
                    return url_entity.get("url")

        return None
