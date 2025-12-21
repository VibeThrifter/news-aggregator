"""
Scheduler module for coordinating periodic tasks.

This module provides APScheduler integration for running RSS feed polling
and other background jobs according to Story 1.1 requirements.
"""

import asyncio
import uuid
from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import structlog

from .config import get_settings

# Maximum time allowed for a single poll cycle (5 minutes)
POLL_CYCLE_TIMEOUT_SECONDS = 300
# Maximum time allowed for insight backfill (10 minutes)
INSIGHT_BACKFILL_TIMEOUT_SECONDS = 600
# Maximum time allowed for maintenance (10 minutes)
MAINTENANCE_TIMEOUT_SECONDS = 600
from ..db.session import ensure_healthy_connection, get_sessionmaker
from ..events.maintenance import get_event_maintenance_service
from ..services.ingest_service import IngestService
from ..services.insight_service import InsightService

logger = structlog.get_logger()


class NewsAggregatorScheduler:
    """Scheduler for News Aggregator background tasks."""

    def __init__(self):
        """Initialize scheduler with configuration."""
        self.settings = get_settings()
        self.scheduler = AsyncIOScheduler()
        # Services are lazily initialized to get fresh session factories
        self._ingest_service: Optional[IngestService] = None
        self._maintenance_service = None
        self._insight_service: Optional[InsightService] = None
        self._is_running = False

    def _get_ingest_service(self) -> IngestService:
        """Get or create ingest service with current session factory."""
        if self._ingest_service is None:
            self._ingest_service = IngestService(session_factory=get_sessionmaker())
        return self._ingest_service

    def _get_maintenance_service(self):
        """Get or create maintenance service."""
        if self._maintenance_service is None:
            self._maintenance_service = get_event_maintenance_service()
        return self._maintenance_service

    def _get_insight_service(self) -> InsightService:
        """Get or create insight service with current settings."""
        if self._insight_service is None:
            self._insight_service = InsightService(settings=self.settings)
        return self._insight_service

    def _reset_services(self) -> None:
        """Reset all services to pick up fresh connections after DB reset."""
        self._ingest_service = None
        self._maintenance_service = None
        self._insight_service = None
        logger.info("scheduler_services_reset")

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
        """Job function for RSS feed polling with correlation ID and global timeout."""
        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="poll_rss_feeds")

        try:
            job_logger.info("Starting RSS feed polling job", timeout_seconds=POLL_CYCLE_TIMEOUT_SECONDS)

            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                job_logger.error("Database connection unhealthy, skipping poll cycle")
                self._reset_services()
                return

            # Call the ingest service to poll feeds with a global timeout
            ingest_service = self._get_ingest_service()
            try:
                results = await asyncio.wait_for(
                    ingest_service.poll_feeds(correlation_id=correlation_id),
                    timeout=POLL_CYCLE_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                job_logger.error(
                    "RSS feed polling job timed out",
                    timeout_seconds=POLL_CYCLE_TIMEOUT_SECONDS,
                )
                self._reset_services()
                return

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
            # Reset services so next run gets fresh connections
            self._reset_services()
            # Don't re-raise - let scheduler continue with next execution

    async def _insight_backfill_job(self) -> None:
        """Generate insights for events that are missing them."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="insight_backfill")

        try:
            job_logger.info("Starting insight backfill job", timeout_seconds=INSIGHT_BACKFILL_TIMEOUT_SECONDS)

            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                job_logger.error("Database connection unhealthy, skipping backfill cycle")
                self._reset_services()
                return

            insight_service = self._get_insight_service()
            try:
                stats = await asyncio.wait_for(
                    insight_service.backfill_missing_insights(
                        limit=self.settings.insight_backfill_batch_size,
                        correlation_id=correlation_id,
                    ),
                    timeout=INSIGHT_BACKFILL_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                job_logger.error(
                    "Insight backfill job timed out",
                    timeout_seconds=INSIGHT_BACKFILL_TIMEOUT_SECONDS,
                )
                self._reset_services()
                return

            job_logger.info("Insight backfill job completed", **stats)
        except Exception as exc:  # pragma: no cover - defensive logging
            job_logger.error("Insight backfill job failed", error=str(exc))
            self._reset_services()

    async def _event_maintenance_job(self) -> None:
        """Refresh event centroids, archive stale events, and heal the vector index."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="event_maintenance")

        try:
            job_logger.info("Starting event maintenance job", timeout_seconds=MAINTENANCE_TIMEOUT_SECONDS)

            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                job_logger.error("Database connection unhealthy, skipping maintenance cycle")
                self._reset_services()
                return

            maintenance_service = self._get_maintenance_service()
            try:
                stats = await asyncio.wait_for(
                    maintenance_service.run(correlation_id=correlation_id),
                    timeout=MAINTENANCE_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                job_logger.error(
                    "Event maintenance job timed out",
                    timeout_seconds=MAINTENANCE_TIMEOUT_SECONDS,
                )
                self._reset_services()
                return

            job_logger.info("Event maintenance job completed", **stats.as_dict())
        except Exception as exc:  # pragma: no cover - defensive logging
            job_logger.error("Event maintenance job failed", error=str(exc))
            self._reset_services()

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
            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                self._reset_services()
                return {
                    "success": False,
                    "error": "Database connection unhealthy after reset attempt",
                    "correlation_id": correlation_id
                }

            ingest_service = self._get_ingest_service()
            results = await ingest_service.poll_feeds(correlation_id=correlation_id)
            return results
        except Exception as e:
            logger.error("Manual RSS feed polling failed", error=str(e), correlation_id=correlation_id)
            self._reset_services()
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
            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                self._reset_services()
                return {
                    "success": False,
                    "error": "Database connection unhealthy after reset attempt",
                    "correlation_id": correlation_id
                }

            maintenance_service = self._get_maintenance_service()
            stats = await maintenance_service.run(correlation_id=correlation_id)
            return {
                "success": True,
                "correlation_id": correlation_id,
                **stats.as_dict()
            }
        except Exception as e:
            logger.error("Manual event maintenance failed", error=str(e), correlation_id=correlation_id)
            self._reset_services()
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
            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                self._reset_services()
                return {
                    "success": False,
                    "error": "Database connection unhealthy after reset attempt",
                    "correlation_id": correlation_id
                }

            insight_service = self._get_insight_service()
            stats = await insight_service.backfill_missing_insights(
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
            self._reset_services()
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
