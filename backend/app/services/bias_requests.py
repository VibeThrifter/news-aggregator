"""Gekleurde zinnen op verzoek (Story 10.7): the per-sentence bias of one news item, on request.

The per-sentence bias detection (Epic 10, ``bias_service``) costs one LLM call per article, so it
does not run for every article. A paying user or the admin starts it for one news item in the app
(``request_bias_analysis``, migration 019): a row in ``bias_requests``, in Supabase, which signals
the backend (``pg_notify('bias_request')``). The job "Bias Requests" claims it and analyses the
Dutch articles of the news that have text and no analysis yet, the newest of every outlet first
(at most ``BIAS_REQUEST_ARTICLE_CAP``). The analyses go in the local database and are published to
Supabase from there, so every reader sees them; the request row notes the progress.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..core.config import get_settings
from ..db.session import get_sessionmaker
from ..db.supabase import get_frontend_sessionmaker

logger = structlog.get_logger(__name__)

# A request that has been running this long died with its process: it is marked as failed (the
# button shows again, and the articles analysed so far are kept)
STALE_MINUTES = 30
STALE_CHECK_SECONDS = 60

Analyze = Callable[..., Awaitable[Any]]


@dataclass(slots=True)
class BiasRequestJob:
    id: int
    event_id: int


async def _default_analyze(article_id: int, *, correlation_id: str | None = None) -> Any:
    from .bias_service import get_bias_detection_service

    return await get_bias_detection_service().analyze_article(
        article_id, correlation_id=correlation_id
    )


class BiasRequestService:
    """Runs the bias analyses requested in the app."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        queue_session_factory: async_sessionmaker[AsyncSession] | None = None,
        analyze: Analyze | None = None,
        article_cap: int | None = None,
    ) -> None:
        self._session_factory = session_factory
        # The queue (bias_requests) is the website's: in Supabase (Story INFRA-2)
        self._queue_session_factory = queue_session_factory
        self._analyze = analyze or _default_analyze
        self.article_cap = article_cap or get_settings().bias_request_article_cap
        self._table_ready = False
        self._stale_checked_at = float("-inf")

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory or get_sessionmaker()

    def _queue_sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._queue_session_factory or self._session_factory or get_frontend_sessionmaker()

    # --- Queue -----------------------------------------------------------------------------

    async def table_ready(self) -> bool:
        async with self._queue_sessions()() as session:
            return bool(
                (
                    await session.execute(
                        text("select to_regclass('public.bias_requests') is not null")
                    )
                ).scalar()
            )

    async def fail_stale(self) -> int:
        async with self._queue_sessions()() as session:
            result = await session.execute(
                text(
                    "update bias_requests set status = 'fout', status_reason = 'afgebroken', "
                    "finished_at = now(), updated_at = now() where status = 'bezig' "
                    "and started_at < now() - make_interval(mins => :minutes)"
                ),
                {"minutes": STALE_MINUTES},
            )
            await session.commit()
            return int(result.rowcount or 0)

    async def claim(self) -> BiasRequestJob | None:
        """The oldest queued request, marked as running (safe with more than one process)."""

        async with self._queue_sessions()() as session:
            row = (
                await session.execute(
                    text(
                        """
                        update bias_requests
                        set status = 'bezig', started_at = now(), updated_at = now()
                        where id = (
                            select id from bias_requests where status = 'wachtrij'
                            order by created_at limit 1 for update skip locked
                        )
                        returning id, event_id
                        """
                    )
                )
            ).first()
            await session.commit()
        return BiasRequestJob(id=row.id, event_id=row.event_id) if row else None

    async def _progress(self, job_id: int, total: int, done: int, failed: int) -> None:
        async with self._queue_sessions()() as session:
            await session.execute(
                text(
                    "update bias_requests set total = :total, done = :done, failed = :failed, "
                    "updated_at = now() where id = :id"
                ),
                {"id": job_id, "total": total, "done": done, "failed": failed},
            )
            await session.commit()

    async def _finish(self, job_id: int, status: str, reason: str | None) -> None:
        async with self._queue_sessions()() as session:
            await session.execute(
                text(
                    "update bias_requests set status = :status, status_reason = :reason, "
                    "finished_at = now(), updated_at = now() where id = :id"
                ),
                {"id": job_id, "status": status, "reason": reason},
            )
            await session.commit()

    # --- One request -----------------------------------------------------------------------

    async def articles_for(self, event_id: int) -> list[int]:
        """The Dutch articles of the news to analyse: with text, without an analysis; the newest
        of every outlet first, then the next of every outlet, and so on."""

        async with self._sessions()() as session:
            rows = await session.execute(
                text(
                    """
                    select a.id
                    from event_articles ea
                    join articles a on a.id = ea.article_id
                    where ea.event_id = :event_id
                      and not coalesce(a.is_international, false)
                      and length(btrim(coalesce(a.content, ''))) > 0
                      and not exists (
                          select 1 from article_bias_analyses b where b.article_id = a.id
                      )
                    order by
                      row_number() over (
                          partition by lower(coalesce(a.source_name, ''))
                          order by a.published_at desc nulls last, a.id desc
                      ),
                      a.published_at desc nulls last,
                      a.id desc
                    limit :cap
                    """
                ),
                {"event_id": event_id, "cap": self.article_cap},
            )
            return [int(row.id) for row in rows]

    async def run_one(self, job: BiasRequestJob, run_logger: Any) -> str:
        """Analyse the articles of one request: 'done' or 'failed'. Never raises for one article."""

        started = time.monotonic()
        try:
            article_ids = await self.articles_for(job.event_id)
        except Exception as exc:
            await self._finish(job.id, "fout", (str(exc) or type(exc).__name__)[:300])
            run_logger.error("bias_request_failed", request_id=job.id, error=str(exc))
            return "failed"

        total = len(article_ids)
        await self._progress(job.id, total, 0, 0)
        done = failed = 0
        reason: str | None = None
        for article_id in article_ids:
            try:
                await self._analyze(article_id, correlation_id=f"bias-request-{job.id}")
                done += 1
            except Exception as exc:
                failed += 1
                reason = (str(exc) or type(exc).__name__)[:300]
                run_logger.warning(
                    "bias_request_article_failed",
                    request_id=job.id,
                    article_id=article_id,
                    error=str(exc),
                )
            await self._progress(job.id, total, done, failed)

        status = "fout" if failed and not done else "klaar"
        await self._finish(job.id, status, reason if status == "fout" else None)
        run_logger.info(
            "bias_request_done",
            request_id=job.id,
            event_id=job.event_id,
            status=status,
            total=total,
            done=done,
            failed=failed,
            ms=int((time.monotonic() - started) * 1000),
        )
        return "done" if status == "klaar" else "failed"

    async def run_pending(self, *, limit: int, correlation_id: str | None = None) -> dict[str, Any]:
        """Run up to ``limit`` queued requests. Never raises for one failed request."""

        run_logger = logger.bind(
            correlation_id=correlation_id or str(uuid.uuid4()), job="bias_requests"
        )
        stats: dict[str, Any] = {"ran": 0, "done": 0, "failed": 0}
        if not self._table_ready:
            if not await self.table_ready():
                return {**stats, "skipped": "migratie 019 is nog niet gedraaid"}
            self._table_ready = True
        stats["stale"] = 0
        if time.monotonic() - self._stale_checked_at >= STALE_CHECK_SECONDS:
            self._stale_checked_at = time.monotonic()
            stats["stale"] = await self.fail_stale()
        for _ in range(limit):
            job = await self.claim()
            if job is None:
                break
            stats["ran"] += 1
            stats[await self.run_one(job, run_logger)] += 1
        return stats


_service: BiasRequestService | None = None


def get_bias_request_service() -> BiasRequestService:
    global _service
    if _service is None:
        _service = BiasRequestService()
    return _service


__all__ = ["BiasRequestJob", "BiasRequestService", "get_bias_request_service"]
