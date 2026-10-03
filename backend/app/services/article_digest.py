"""Dutch gist of foreign articles: what they actually report ("Wat schreef …?", Epic 11).

Google News (Epic 9) only gives the headline of a foreign article. This service fetches the text
from the publisher (trafilatura, as for other article pages), lets the LLM write at most two Dutch
sentences in its own words and stores only that gist in ``source_metadata["digest"]``. The full
text is not stored (database size) and never shown (copyright). When the text cannot be fetched
(paywall, blocked), the gist is the headline in Dutch and its basis is ``"title"``.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import trafilatura
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.dual_write import sync_entities_to_cache
from backend.app.db.models import Article, Event, EventArticle
from backend.app.db.session import get_sessionmaker
from backend.app.llm.client import (
    BaseLLMClient,
    LLMAuthenticationError,
    LLMQuotaExhaustedError,
    LLMRateLimitError,
    LLMResponseError,
    LLMTimeoutError,
)
from backend.app.llm.providers import build_llm_client
from backend.app.llm.schemas import ArticleDigestPayload
from backend.app.services.llm_config_service import get_llm_config_service

logger = get_logger(__name__).bind(component="ArticleDigestService")

PROMPT_KEY = "prompt_article_digest"
# llm_config key for the provider; without it the provider of the factual analysis is used
PROVIDER_KEY = "provider_digest"
PROMPT_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[1] / "llm" / "templates" / "article_digest_prompt.txt"
)
# Shorter extracted text is a cookie wall or a teaser, not the article
MIN_TEXT_CHARS = 400
FETCH_TIMEOUT_SECONDS = 20
# Batches skip an article whose digest failed this often (a single run still tries it)
MAX_FAILURES = 2


def is_provider_problem(exc: Exception) -> bool:
    """Rate limits, quota, timeouts, outages and credentials: not the article's fault."""

    if isinstance(
        exc, (LLMRateLimitError, LLMQuotaExhaustedError, LLMTimeoutError, LLMAuthenticationError)
    ):
        return True
    return isinstance(exc, LLMResponseError) and exc.retryable


def fetch_article_text(url: str) -> str | None:
    """Download a page and extract its main text (blocking: run it in a thread)."""

    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        return None
    text = trafilatura.extract(
        downloaded, favor_precision=True, include_comments=False, include_tables=False
    )
    return text.strip() if text else None


def build_digest_prompt(template: str, *, source_name: str, title: str, text: str | None) -> str:
    """Fill the template. The article text goes in last: it is never searched for placeholders."""

    text_block = (
        f"TEKST (mogelijk ingekort):\n{text}"
        if text
        else "Er is alleen een kop; de tekst kon niet worden opgehaald."
    )
    return (
        template.replace("{source_name}", source_name)
        .replace("{title}", title)
        .replace("{text_block}", text_block)
    )


@dataclass(slots=True)
class DigestOutcome:
    """The stored digest of one article."""

    article_id: int
    digest: dict[str, Any]


class ArticleDigestService:
    """Fetch foreign article texts and store a Dutch gist per article."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        client: BaseLLMClient | None = None,
        settings: Settings | None = None,
        fetch_text: Callable[[str], str | None] = fetch_article_text,
        prompt_template: str | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.session_factory = session_factory or get_sessionmaker()
        self._client = client
        self._fetch_text = fetch_text
        self._prompt_template = prompt_template

    async def _llm_client(self) -> BaseLLMClient:
        """The injected client, else the provider from llm_config (per call: it may change)."""

        if self._client is not None:
            return self._client
        provider: str | None = None
        try:
            config = get_llm_config_service()
            provider = await config.get_value(PROVIDER_KEY) or await config.get_value(
                "provider_factual"
            )
        except Exception as exc:  # fall back to the default provider of the settings
            logger.debug("digest_provider_config_unavailable", error=str(exc))
        return build_llm_client(provider or self.settings.llm_provider, self.settings)

    async def _template(self) -> str:
        """The prompt from llm_config (production) when present, else the local template."""

        if self._prompt_template is not None:
            return self._prompt_template
        try:
            prompt = await get_llm_config_service().get_value(PROMPT_KEY)
        except Exception as exc:  # the prompt is optional in llm_config
            logger.debug("digest_prompt_config_unavailable", error=str(exc))
            prompt = None
        return prompt or PROMPT_TEMPLATE_PATH.read_text(encoding="utf-8")

    async def _article_text(self, url: str) -> str | None:
        """The article text for the prompt, or None when it cannot be fetched."""

        try:
            text = await asyncio.wait_for(
                asyncio.to_thread(self._fetch_text, url), timeout=FETCH_TIMEOUT_SECONDS
            )
        except Exception as exc:  # network errors, timeouts, parser errors
            logger.info(
                "digest_text_unavailable", url=url[:120], error=str(exc) or type(exc).__name__
            )
            return None
        if not text or len(text) < MIN_TEXT_CHARS:
            return None
        return text[: self.settings.article_digest_text_chars]

    async def digest_article(
        self, article_id: int, *, correlation_id: str | None = None
    ) -> DigestOutcome:
        """Fetch, summarise and store the digest of one article (also when it already has one)."""

        log = logger.bind(article_id=article_id, correlation_id=correlation_id)
        async with self.session_factory() as session:
            article = await session.get(Article, article_id)
            if article is None:
                raise ValueError(f"Article {article_id} not found")
            url, title = article.url, article.title
            source_name = article.source_name or "onbekende bron"

        text = await self._article_text(url)
        prompt = build_digest_prompt(
            await self._template(), source_name=source_name, title=title, text=text
        )
        try:
            result = await (await self._llm_client()).generate_json(
                prompt, ArticleDigestPayload, correlation_id=correlation_id
            )
        except Exception as exc:
            # Only an answer that is unusable counts against the article (Mistral 429 does not)
            if not is_provider_problem(exc):
                await self._record_failure(article_id)
            log.warning("digest_llm_failed", error=str(exc) or type(exc).__name__)
            raise

        digest = {
            "nl": result.payload.kern,
            "basis": "text" if text else "title",
            "provider": result.provider,
            "model": result.model,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        async with self.session_factory() as session:
            article = await session.get(Article, article_id)
            if article is None:
                raise ValueError(f"Article {article_id} not found")
            metadata = {
                key: value
                for key, value in (article.source_metadata or {}).items()
                if key != "digest_failures"
            }
            metadata["digest"] = digest
            # A new dict, so SQLAlchemy sees the JSON change
            article.source_metadata = metadata
            await session.commit()
        await sync_entities_to_cache([article], "articles")

        log.info("digest_stored", basis=digest["basis"], chars=len(digest["nl"]))
        return DigestOutcome(article_id=article_id, digest=digest)

    async def _record_failure(self, article_id: int) -> None:
        try:
            async with self.session_factory() as session:
                article = await session.get(Article, article_id)
                if article is None:
                    return
                metadata = dict(article.source_metadata or {})
                metadata["digest_failures"] = int(metadata.get("digest_failures") or 0) + 1
                article.source_metadata = metadata
                await session.commit()
        except Exception as exc:  # pragma: no cover - never hide the original error
            logger.warning("digest_failure_not_recorded", article_id=article_id, error=str(exc))

    def _pending_filter(self, max_age_hours: int | None) -> list[Any]:
        """Foreign articles in news that is not archived, without a digest, not failed too often."""

        in_active_news = (
            select(EventArticle.id)
            .join(Event, Event.id == EventArticle.event_id)
            .where(EventArticle.article_id == Article.id, Event.archived_at.is_(None))
            .exists()
        )
        conditions: list[Any] = [
            Article.is_international.is_(True),
            in_active_news,
            # as text: SQLite would turn a missing key into the JSON text "null"
            Article.source_metadata["digest"].as_string().is_(None),
            func.coalesce(Article.source_metadata["digest_failures"].as_integer(), 0)
            < MAX_FAILURES,
        ]
        if max_age_hours:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
            conditions.append(Article.created_at >= cutoff)
        return conditions

    async def pending_article_ids(
        self, *, limit: int, max_age_hours: int | None = None
    ) -> list[int]:
        """Newest first; only ids, to keep database egress small."""

        stmt = (
            select(Article.id)
            .where(*self._pending_filter(max_age_hours))
            .order_by(Article.created_at.desc(), Article.id.desc())
            .limit(limit)
        )
        async with self.session_factory() as session:
            return list((await session.execute(stmt)).scalars().all())

    async def count_pending(self, *, max_age_hours: int | None = None) -> int:
        stmt = select(func.count(Article.id)).where(*self._pending_filter(max_age_hours))
        async with self.session_factory() as session:
            return int((await session.execute(stmt)).scalar_one())

    async def digest_batch(
        self,
        *,
        limit: int = 10,
        max_age_hours: int | None = None,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        """Digest up to ``limit`` pending foreign articles, newest first. Stops at the first
        problem of the LLM provider (rate limit, quota, outage): the next run tries again."""

        log = logger.bind(correlation_id=correlation_id, component="digest_batch")
        article_ids = await self.pending_article_ids(limit=limit, max_age_hours=max_age_hours)
        basis: Counter[str] = Counter()
        failed_ids: list[int] = []
        stopped: str | None = None
        for article_id in article_ids:
            try:
                outcome = await self.digest_article(article_id, correlation_id=correlation_id)
                basis[outcome.digest["basis"]] += 1
            except Exception as exc:
                if is_provider_problem(exc):
                    stopped = str(exc) or type(exc).__name__
                    log.warning("digest_batch_stopped", article_id=article_id, error=stopped)
                    break
                failed_ids.append(article_id)
                log.warning("digest_article_failed", article_id=article_id, error=str(exc))

        stats = {
            "articles_found": len(article_ids),
            "articles_digested": basis["text"] + basis["title"],
            "from_text": basis["text"],
            "from_title": basis["title"],
            "articles_failed": len(failed_ids),
            "failed_article_ids": failed_ids or None,
            "stopped": stopped,
            "pending": await self.count_pending(max_age_hours=max_age_hours),
        }
        log.info("digest_batch_completed", **stats)
        return stats


_service: ArticleDigestService | None = None


def get_article_digest_service() -> ArticleDigestService:
    """Singleton used by the scheduler and the admin endpoints."""

    global _service
    if _service is None:
        _service = ArticleDigestService()
    return _service


__all__ = [
    "ArticleDigestService",
    "DigestOutcome",
    "build_digest_prompt",
    "build_llm_client",
    "fetch_article_text",
    "get_article_digest_service",
    "is_provider_problem",
]
