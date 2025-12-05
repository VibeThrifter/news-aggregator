"""
Scheduler module for coordinating periodic tasks.

This module provides APScheduler integration for running RSS feed polling
and other background jobs according to Story 1.1 requirements.
"""

import uuid
from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import structlog

from .config import get_settings
from ..events.maintenance import get_event_maintenance_service
from ..services.ingest_service import get_ingest_service
from ..services.insight_service import InsightService

logger = structlog.get_logger()


class NewsAggregatorScheduler:
    """Scheduler for News Aggregator background tasks."""

    def __init__(self):
        """Initialize scheduler with configuration."""
        self.settings = get_settings()
        self.scheduler = AsyncIOScheduler()
        self.ingest_service = get_ingest_service()
        self.maintenance_service = get_event_maintenance_service()
        self.insight_service = InsightService(settings=self.settings)
        self._is_running = False

    def setup_jobs(self) -> None:
        """Set up scheduled jobs."""
        # RSS feed polling job
        self.scheduler.add_job(
            func=self._poll_feeds_job,
            trigger=IntervalTrigger(minutes=self.settings.scheduler_interval_minutes),
            id="poll_rss_feeds",
            name="RSS Feed Polling",
            replace_existing=True,
            max_instances=1  # Prevent overlapping executions
        )

        # Insight backfill job - catches up on events missing LLM insights
        self.scheduler.add_job(
            func=self._insight_backfill_job,
            trigger=IntervalTrigger(minutes=self.settings.insight_backfill_interval_minutes),
            id="insight_backfill",
            name="Insight Backfill",
            replace_existing=True,
            max_instances=1,
        )

        logger.info("Scheduled jobs configured",
                   rss_interval_minutes=self.settings.scheduler_interval_minutes,
                   insight_backfill_interval_minutes=self.settings.insight_backfill_interval_minutes,
                   maintenance_interval_hours=self.settings.event_maintenance_interval_hours)

        self.scheduler.add_job(
            func=self._event_maintenance_job,
            trigger=IntervalTrigger(hours=self.settings.event_maintenance_interval_hours),
            id="event_maintenance",
            name="Event Maintenance",
            replace_existing=True,
            max_instances=1,
        )

    async def _poll_feeds_job(self) -> None:
        """Job function for RSS feed polling with correlation ID."""
        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="poll_rss_feeds")

        try:
            job_logger.info("Starting RSS feed polling job")

            # Call the ingest service to poll feeds
            results = await self.ingest_service.poll_feeds(correlation_id=correlation_id)

            if results["success"]:
                job_logger.info("RSS feed polling job completed successfully",
                              total_items=results["total_items"],
                              successful_readers=results["successful_readers"])
            else:
                job_logger.warning("RSS feed polling job completed with errors",
                                 failed_readers=results["failed_readers"],
                                 errors=results["errors"])

        except Exception as e:
            job_logger.error("RSS feed polling job failed", error=str(e))
            # Don't re-raise - let scheduler continue with next execution

    async def _insight_backfill_job(self) -> None:
        """Generate insights for events that are missing them."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="insight_backfill")

        try:
            job_logger.info("Starting insight backfill job")
            stats = await self.insight_service.backfill_missing_insights(
                limit=self.settings.insight_backfill_batch_size,
                correlation_id=correlation_id,
            )
            job_logger.info("Insight backfill job completed", **stats)
        except Exception as exc:  # pragma: no cover - defensive logging
            job_logger.error("Insight backfill job failed", error=str(exc))

    async def _event_maintenance_job(self) -> None:
        """Refresh event centroids, archive stale events, and heal the vector index."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="event_maintenance")

        try:
            job_logger.info("Starting event maintenance job")
            stats = await self.maintenance_service.run(correlation_id=correlation_id)
            job_logger.info("Event maintenance job completed", **stats.as_dict())
        except Exception as exc:  # pragma: no cover - defensive logging
            job_logger.error("Event maintenance job failed", error=str(exc))

    def start(self) -> None:
        """Start the scheduler."""
        if not self._is_running:
            self.setup_jobs()
            self.scheduler.start()
            self._is_running = True
            logger.info("Scheduler started")

    def shutdown(self) -> None:
        """Shutdown the scheduler gracefully."""
        if self._is_running:
            self.scheduler.shutdown()
            self._is_running = False
            logger.info("Scheduler stopped")

    def get_job_status(self) -> dict:
        """Get status of scheduled jobs."""
        if not self._is_running:
            return {"status": "stopped", "jobs": []}

        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "name": job.name,
                "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
                "trigger": str(job.trigger)
            })

        return {
            "status": "running",
            "jobs": jobs
        }

    async def run_poll_feeds_now(self) -> dict:
        """Manually trigger RSS feed polling (for testing/admin)."""
        correlation_id = str(uuid.uuid4())
        logger.info("Manual RSS feed polling triggered", correlation_id=correlation_id)

        try:
            results = await self.ingest_service.poll_feeds(correlation_id=correlation_id)
            return results
        except Exception as e:
            logger.error("Manual RSS feed polling failed", error=str(e), correlation_id=correlation_id)
            return {
                "success": False,
                "error": str(e),
                "correlation_id": correlation_id
            }

    async def run_event_maintenance_now(self) -> dict:
        """Manually trigger event maintenance (for testing/admin)."""
        correlation_id = str(uuid.uuid4())
        logger.info("Manual event maintenance triggered", correlation_id=correlation_id)

        try:
            stats = await self.maintenance_service.run(correlation_id=correlation_id)
            return {
                "success": True,
                "correlation_id": correlation_id,
                **stats.as_dict()
            }
        except Exception as e:
            logger.error("Manual event maintenance failed", error=str(e), correlation_id=correlation_id)
            return {
                "success": False,
                "error": str(e),
                "correlation_id": correlation_id
            }

    async def run_insight_backfill_now(self, limit: int | None = None) -> dict:
        """Manually trigger insight backfill (for testing/admin)."""
        correlation_id = str(uuid.uuid4())
        batch_size = limit or self.settings.insight_backfill_batch_size
        logger.info("Manual insight backfill triggered", correlation_id=correlation_id, limit=batch_size)

        try:
            stats = await self.insight_service.backfill_missing_insights(
                limit=batch_size,
                correlation_id=correlation_id,
            )
            return {
                "success": True,
                "correlation_id": correlation_id,
                **stats
            }
        except Exception as e:
            logger.error("Manual insight backfill failed", error=str(e), correlation_id=correlation_id)
            return {
                "success": False,
                "error": str(e),
                "correlation_id": correlation_id
            }


# Global scheduler instance
_scheduler: Optional[NewsAggregatorScheduler] = None


def get_scheduler() -> NewsAggregatorScheduler:
    """Get the global scheduler instance (singleton pattern)."""
    global _scheduler
    if _scheduler is None:
        _scheduler = NewsAggregatorScheduler()
    return _scheduler
