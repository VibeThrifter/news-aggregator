"""
Scheduler module for coordinating periodic tasks.

This module provides APScheduler integration for running RSS feed polling
and other background jobs according to Story 1.1 requirements.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..db.session import ensure_healthy_connection, get_sessionmaker
from ..db.supabase import SupabaseListener, dispose_supabase_engine
from ..events.maintenance import get_event_maintenance_service
from ..repositories.event_repo import EventRepository
from ..services.article_digest import get_article_digest_service
from ..services.voice_search import get_voice_search_service
from ..services.bias_requests import get_bias_request_service
from ..services.bias_service import BiasDetectionService, get_bias_detection_service
from ..services.exploration_service import get_exploration_service
from ..services.ingest_service import IngestService
from ..services.insight_service import InsightService
from ..services.international_enrichment import (
    InternationalEnrichmentService,
    get_international_enrichment_service,
)
from ..services.entity_research.service import get_entity_research_service
from ..services.evidence_research import get_evidence_research_service
from ..services.propaganda_model_sync import get_propaganda_sync_service
from ..services.llm_usage import get_llm_usage_service
from ..services.local_backup import backup_local_database, latest_backup_age
from ..services.publish_service import get_publish_service
from .config import get_settings

# Maximum time allowed for a single poll cycle (5 minutes)
POLL_CYCLE_TIMEOUT_SECONDS = 300
# Retrying left-behind articles gets its own budget, outside the poll timeout
ORPHAN_CATCH_UP_TIMEOUT_SECONDS = 240
# Maximum time allowed for insight backfill (10 minutes)
INSIGHT_BACKFILL_TIMEOUT_SECONDS = 600
# Maximum time allowed for maintenance (10 minutes)
MAINTENANCE_TIMEOUT_SECONDS = 600
# Event Maintenance runs once a day. An interval trigger counts from the start of the process, and
# the backend restarts more often than daily: from 2026-10-02 to 10-08 it never ran. At night the
# Mac sleeps, so a fixed hour is missed as well. The job therefore looks every hour whether its last
# run is a day ago, and keeps the moment of that run in a file that survives restarts
MAINTENANCE_CHECK_MINUTES = 60
MAINTENANCE_FIRST_CHECK_MINUTES = 5
SCHEDULER_STATE_FILE = Path("data") / "scheduler_state.json"
# Maximum time allowed for international enrichment (15 minutes)
INTERNATIONAL_ENRICHMENT_TIMEOUT_SECONDS = 900
# Maximum time allowed for bias analysis (30 minutes - many LLM calls)
BIAS_ANALYSIS_TIMEOUT_SECONDS = 1800
# Maximum time allowed for one article digest batch (page fetches + one LLM call per article)
ARTICLE_DIGEST_TIMEOUT_SECONDS = 900
# One AI search for a missing voice takes 15 s to a minute; the service times out each one itself
VOICE_SEARCH_TIMEOUT_SECONDS = 900
# One bias request: up to BIAS_REQUEST_ARTICLE_CAP LLM calls, behind the news pipeline
BIAS_REQUEST_TIMEOUT_SECONDS = 1800
# Maximum time allowed for the propaganda-model sync (Story 11.17)
PROPAGANDA_SYNC_TIMEOUT_SECONDS = 600
# Maximum time allowed for one entity research cycle (Epic 12)
ENTITY_RESEARCH_TIMEOUT_SECONDS = 600
# One evidence research cycle (Story 14.13)
EVIDENCE_RESEARCH_TIMEOUT_SECONDS = 300
# Publishing the changes of the local database to Supabase (Story INFRA-2)
PUBLISH_TIMEOUT_SECONDS = 600
# The daily backup of the local database
LOCAL_BACKUP_TIMEOUT_SECONDS = 900
LOCAL_BACKUP_INTERVAL_HOURS = 24

logger = structlog.get_logger()


def _read_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def _write_state(path: Path, **values: str) -> None:
    state = _read_state(path)
    state.update(values)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".tmp")
    partial.write_text(json.dumps(state, indent=2))
    partial.replace(path)


class _QuietVoiceSearchLog(logging.Filter):
    """The voice search job looks at its queue every few seconds: APScheduler's lines about
    running it, and about skipping a turn while a search runs, would flood the log."""

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno > logging.WARNING or '"Voice Search (' not in record.getMessage()


for _name in ("apscheduler.scheduler", "apscheduler.executors.default"):
    logging.getLogger(_name).addFilter(_QuietVoiceSearchLog())


class NewsAggregatorScheduler:
    """Scheduler for News Aggregator background tasks."""

    def __init__(self):
        """Initialize scheduler with configuration."""
        self.settings = get_settings()
        self.scheduler = AsyncIOScheduler()
        # Services are lazily initialized to get fresh session factories
        self._ingest_service: IngestService | None = None
        self._maintenance_service = None
        self._insight_service: InsightService | None = None
        self._international_enrichment_service: InternationalEnrichmentService | None = None
        self._bias_detection_service: BiasDetectionService | None = None
        # Story 11.8: outcome of the exploration refresh that follows event maintenance
        self._exploration_last_run: dict | None = None
        # Story 11.17: outcome of the last propaganda-model sync job
        self._propaganda_sync_last_run: dict | None = None
        # Epic 12: outcome of the last entity research cycle
        self._entity_research_last_run: dict | None = None
        # Story 14.13: outcome of the last evidence research cycle (thin links)
        self._evidence_research_last_run: dict | None = None
        # "Wat schreef …?": outcome of the last foreign article digest batch
        self._article_digest_last_run: dict | None = None
        self._voice_search_last_run: dict | None = None
        # Story INFRA-2: the voice search waits for a signal from Supabase instead of asking every
        # few seconds (None: Supabase is the one database, ask as before)
        self._voice_listener: SupabaseListener | None = (
            SupabaseListener("voice_search", self.settings.voice_search_fallback_seconds)
            if self.settings.supabase_database_url
            else None
        )
        # Story 10.7: bias analyses requested in the app (same way as the voice search)
        self._bias_request_last_run: dict | None = None
        self._bias_listener: SupabaseListener | None = (
            SupabaseListener("bias_request", self.settings.bias_request_fallback_seconds)
            if self.settings.supabase_database_url
            else None
        )
        self._publish_last_error: dict | None = None
        self._local_backup_last_run: dict | None = None
        self._state_file = SCHEDULER_STATE_FILE
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

    def _get_international_enrichment_service(self) -> InternationalEnrichmentService:
        """Get or create international enrichment service."""
        if self._international_enrichment_service is None:
            self._international_enrichment_service = get_international_enrichment_service()
        return self._international_enrichment_service

    def _get_bias_detection_service(self) -> BiasDetectionService:
        """Get or create bias detection service."""
        if self._bias_detection_service is None:
            self._bias_detection_service = get_bias_detection_service()
        return self._bias_detection_service

    def _reset_services(self) -> None:
        """Reset all services to pick up fresh connections after DB reset."""
        self._ingest_service = None
        self._maintenance_service = None
        self._insight_service = None
        self._international_enrichment_service = None
        self._bias_detection_service = None
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
            max_instances=1,  # Prevent overlapping executions
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

        # International enrichment job (Epic 9)
        self.scheduler.add_job(
            func=self._international_enrichment_job,
            trigger=IntervalTrigger(hours=self.settings.international_enrichment_interval_hours),
            id="international_enrichment",
            name="International Enrichment",
            replace_existing=True,
            max_instances=1,
        )

        # Bias analysis job (Epic 10) - optional, disabled by default
        if self.settings.bias_analysis_scheduler_enabled:
            self.scheduler.add_job(
                func=self._bias_analysis_job,
                trigger=IntervalTrigger(hours=self.settings.bias_analysis_interval_hours),
                id="bias_analysis",
                name="Bias Analysis",
                replace_existing=True,
                max_instances=1,
            )
            logger.info(
                "Bias analysis job enabled",
                interval_hours=self.settings.bias_analysis_interval_hours,
                batch_size=self.settings.bias_analysis_batch_size,
            )
        else:
            logger.info(
                "Bias analysis job disabled (set BIAS_ANALYSIS_SCHEDULER_ENABLED=true to enable)"
            )

        logger.info(
            "Scheduled jobs configured",
            rss_interval_minutes=self.settings.scheduler_interval_minutes,
            insight_backfill_interval_minutes=self.settings.insight_backfill_interval_minutes,
            international_enrichment_interval_hours=self.settings.international_enrichment_interval_hours,
            maintenance_interval_hours=self.settings.event_maintenance_interval_hours,
            bias_analysis_enabled=self.settings.bias_analysis_scheduler_enabled,
        )

        # Event Maintenance: every hour it looks whether its last run is a day ago, the first time a
        # few minutes after the start (see MAINTENANCE_CHECK_MINUTES)
        self.scheduler.add_job(
            func=self._event_maintenance_when_due,
            trigger=IntervalTrigger(minutes=MAINTENANCE_CHECK_MINUTES),
            next_run_time=(
                datetime.now(timezone.utc) + timedelta(minutes=MAINTENANCE_FIRST_CHECK_MINUTES)
            ),
            id="event_maintenance",
            name="Event Maintenance",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Foreign article digest - Dutch gist of what foreign articles report ("Wat schreef …?")
        if self.settings.article_digest_enabled:
            self.scheduler.add_job(
                func=self._article_digest_job,
                trigger=IntervalTrigger(minutes=self.settings.article_digest_interval_minutes),
                id="article_digest",
                name="Article Digest",
                replace_existing=True,
                max_instances=1,
            )
            logger.info(
                "Article digest job enabled",
                interval_minutes=self.settings.article_digest_interval_minutes,
                batch_size=self.settings.article_digest_batch_size,
                max_age_hours=self.settings.article_digest_max_age_hours,
            )
        else:
            logger.info("Article digest job disabled (set ARTICLE_DIGEST_ENABLED=true to enable)")

        # Stemmen zoeken (Story 14.10) - AI searches for missing voices the admin queued
        if self.settings.voice_search_enabled:
            self.scheduler.add_job(
                func=self._voice_search_job,
                trigger=IntervalTrigger(seconds=self.settings.voice_search_interval_seconds),
                id="voice_search",
                name="Voice Search",
                replace_existing=True,
                max_instances=1,
                coalesce=True,
            )
            logger.info(
                "Voice search job enabled",
                interval_seconds=self.settings.voice_search_interval_seconds,
                batch_size=self.settings.voice_search_batch_size,
            )
        else:
            logger.info("Voice search job disabled (set VOICE_SEARCH_ENABLED=true to enable)")

        # Gekleurde zinnen op verzoek (Story 10.7) - bias analyses a paying user or the admin requested
        if self.settings.bias_request_enabled:
            self.scheduler.add_job(
                func=self._bias_request_job,
                trigger=IntervalTrigger(seconds=self.settings.bias_request_interval_seconds),
                id="bias_requests",
                name="Bias Requests",
                replace_existing=True,
                max_instances=1,
                coalesce=True,
            )
            logger.info(
                "Bias request job enabled",
                interval_seconds=self.settings.bias_request_interval_seconds,
                article_cap=self.settings.bias_request_article_cap,
            )
        else:
            logger.info("Bias request job disabled (set BIAS_REQUEST_ENABLED=true to enable)")

        # Story INFRA-2: a daily backup of the local working database (it holds what Supabase does not)
        if self.settings.supabase_database_url and self.settings.local_backup_enabled:
            self.scheduler.add_job(
                func=self._local_backup_when_due,
                trigger=IntervalTrigger(minutes=MAINTENANCE_CHECK_MINUTES),
                next_run_time=(
                    datetime.now(timezone.utc) + timedelta(minutes=MAINTENANCE_FIRST_CHECK_MINUTES)
                ),
                id="local_backup",
                name="Local Database Backup",
                replace_existing=True,
                max_instances=1,
                coalesce=True,
            )

        # Story INFRA-2: what changed in the local database goes to Supabase, what the website reads
        if self.settings.supabase_database_url and self.settings.publish_enabled:
            self.scheduler.add_job(
                func=self._publish_job,
                trigger=IntervalTrigger(seconds=self.settings.publish_interval_seconds),
                id="publish_supabase",
                name="Publish to Supabase",
                replace_existing=True,
                max_instances=1,
                coalesce=True,
                # A poll keeps the event loop busy for seconds at a time; then run late, once,
                # instead of skipping the run (APScheduler's default grace is one second)
                misfire_grace_time=None,
            )
            logger.info(
                "Publish job enabled", interval_seconds=self.settings.publish_interval_seconds
            )
        else:
            logger.info("Publish job disabled (no SUPABASE_DATABASE_URL: Supabase is the database)")

        # AI-gebruik in Beheer: the noted LLM calls (tokens, Claude's subscription limits) go to the
        # local database
        self.scheduler.add_job(
            func=self._llm_usage_job,
            trigger=IntervalTrigger(seconds=self.settings.llm_usage_flush_seconds),
            id="llm_usage",
            name="LLM Usage",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Propaganda-model sync (Story 11.17) - only writes when the pm database changed
        if self.settings.propaganda_sync_enabled:
            self.scheduler.add_job(
                func=self._propaganda_sync_job,
                trigger=IntervalTrigger(minutes=self.settings.propaganda_sync_interval_minutes),
                id="propagandamodel_sync",
                name="Propagandamodel Sync",
                replace_existing=True,
                max_instances=1,
            )
            logger.info(
                "Propaganda-model sync job enabled",
                interval_minutes=self.settings.propaganda_sync_interval_minutes,
                db_path=self.settings.propaganda_db_path,
            )
        else:
            logger.info(
                "Propaganda-model sync job disabled (set PROPAGANDA_SYNC_ENABLED=true to enable)"
            )

        # Wie is dit? (Epic 12) - triage names, queue research in the propaganda model and pull
        # the results (the propaganda model schedules the rounds of its nieuws-scout agent)
        if self.settings.entity_research_enabled:
            self.scheduler.add_job(
                func=self._entity_research_job,
                trigger=IntervalTrigger(minutes=self.settings.entity_research_interval_minutes),
                id="entity_research",
                name="Entity Research",
                replace_existing=True,
                max_instances=1,
            )
            logger.info(
                "Entity research job enabled",
                interval_minutes=self.settings.entity_research_interval_minutes,
            )
        else:
            logger.info("Entity research job disabled (set ENTITY_RESEARCH_ENABLED=true to enable)")

        # Dun bewijs (Story 14.13) - queue thin links readers saw for evidence research in the
        # propaganda model and pull the results (it schedules its nieuws-bewijs agent itself)
        if self.settings.evidence_research_enabled:
            self.scheduler.add_job(
                func=self._evidence_research_job,
                trigger=IntervalTrigger(minutes=self.settings.evidence_research_interval_minutes),
                id="evidence_research",
                name="Evidence Research",
                replace_existing=True,
                max_instances=1,
            )
            logger.info(
                "Evidence research job enabled",
                interval_minutes=self.settings.evidence_research_interval_minutes,
            )
        else:
            logger.info(
                "Evidence research job disabled (set EVIDENCE_RESEARCH_ENABLED=true to enable)"
            )

    async def _poll_feeds_job(self) -> None:
        """Job function for RSS feed polling with correlation ID and global timeout."""
        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="poll_rss_feeds")

        try:
            job_logger.info(
                "Starting RSS feed polling job", timeout_seconds=POLL_CYCLE_TIMEOUT_SECONDS
            )

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
                    timeout=POLL_CYCLE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                job_logger.error(
                    "RSS feed polling job timed out",
                    timeout_seconds=POLL_CYCLE_TIMEOUT_SECONDS,
                )
                self._reset_services()
                return

            await self._catch_up_orphans(ingest_service, job_logger, correlation_id)

            if results["success"]:
                job_logger.info(
                    "RSS feed polling job completed successfully",
                    total_items=results["total_items"],
                    successful_readers=results["successful_readers"],
                )
            else:
                job_logger.warning(
                    "RSS feed polling job completed with errors",
                    failed_readers=results["failed_readers"],
                    errors=results["errors"],
                )

        except Exception as e:
            job_logger.error("RSS feed polling job failed", error=str(e))
            # Reset services so next run gets fresh connections
            self._reset_services()
            # Don't re-raise - let scheduler continue with next execution

    async def _catch_up_orphans(
        self, ingest_service: IngestService, job_logger, correlation_id: str
    ) -> None:
        """Enrich and assign articles an earlier cycle left behind (never fails the poll job)."""

        try:
            stats = await asyncio.wait_for(
                ingest_service.catch_up_orphans(correlation_id=correlation_id),
                timeout=ORPHAN_CATCH_UP_TIMEOUT_SECONDS,
            )
            if stats.get("orphans") or stats.get("enriched"):
                job_logger.info("orphan_catch_up_done", **stats)
        except asyncio.TimeoutError:
            job_logger.warning(
                "orphan_catch_up_timed_out", timeout_seconds=ORPHAN_CATCH_UP_TIMEOUT_SECONDS
            )
        except Exception as exc:  # the poll itself succeeded; try again next cycle
            job_logger.warning("orphan_catch_up_failed", error=str(exc))

    async def _insight_backfill_job(self) -> None:
        """Generate insights for events that are missing them."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="insight_backfill")

        try:
            job_logger.info(
                "Starting insight backfill job", timeout_seconds=INSIGHT_BACKFILL_TIMEOUT_SECONDS
            )

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
                    timeout=INSIGHT_BACKFILL_TIMEOUT_SECONDS,
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

    def _maintenance_last_run(self) -> datetime | None:
        """When Event Maintenance last succeeded, also before a restart."""

        value = _read_state(self._state_file).get("event_maintenance_last_run")
        try:
            return datetime.fromisoformat(value) if value else None
        except (TypeError, ValueError):
            return None

    def _record_maintenance_run(self) -> None:
        _write_state(
            self._state_file, event_maintenance_last_run=datetime.now(timezone.utc).isoformat()
        )

    async def _event_maintenance_when_due(self) -> None:
        """Run Event Maintenance when its last successful run is a day ago (or unknown)."""

        last_run = self._maintenance_last_run()
        interval = timedelta(hours=self.settings.event_maintenance_interval_hours)
        if last_run is not None and datetime.now(timezone.utc) - last_run < interval:
            return
        if await self._event_maintenance_job():
            self._record_maintenance_run()

    async def _event_maintenance_job(self) -> bool:
        """Refresh event centroids, archive stale events, and heal the vector index.

        Returns whether the maintenance itself succeeded (the exploration refresh after it may
        fail).
        """

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="event_maintenance")

        try:
            job_logger.info(
                "Starting event maintenance job", timeout_seconds=MAINTENANCE_TIMEOUT_SECONDS
            )

            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                job_logger.error("Database connection unhealthy, skipping maintenance cycle")
                self._reset_services()
                return False

            maintenance_service = self._get_maintenance_service()
            try:
                stats = await asyncio.wait_for(
                    maintenance_service.run(correlation_id=correlation_id),
                    timeout=MAINTENANCE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                job_logger.error(
                    "Event maintenance job timed out",
                    timeout_seconds=MAINTENANCE_TIMEOUT_SECONDS,
                )
                self._reset_services()
                return False

            job_logger.info("Event maintenance job completed", **stats.as_dict())
        except Exception as exc:  # pragma: no cover - defensive logging
            job_logger.error("Event maintenance job failed", error=str(exc))
            self._reset_services()
            return False

        # Story 11.8: refresh exploration data (own timeout, outside the maintenance timeout)
        await self._run_exploration_refresh(correlation_id)
        return True

    async def _local_backup_when_due(self) -> None:
        """A pg_dump of the local working database when the newest backup is a day old (Story
        INFRA-2): it holds what Supabase no longer has. The age comes from the files, so restarts
        and a sleeping Mac never skip or repeat it. Never raises."""

        age = latest_backup_age(self.settings)
        if age is not None and age < timedelta(hours=LOCAL_BACKUP_INTERVAL_HOURS):
            return
        await self._run_local_backup(str(uuid.uuid4()))

    async def _run_local_backup(self, correlation_id: str) -> None:
        """pg_dump of the local working database. Never raises."""

        job_logger = logger.bind(correlation_id=correlation_id, job="local_backup")
        run: dict = {"started_at": datetime.now(timezone.utc).isoformat(), "success": False}
        try:
            result = await asyncio.wait_for(
                backup_local_database(self.settings), timeout=LOCAL_BACKUP_TIMEOUT_SECONDS
            )
            run.update(success=True, result=result)
            job_logger.info("Local database backup completed", **result)
        except asyncio.TimeoutError:
            run["error"] = f"timed out after {LOCAL_BACKUP_TIMEOUT_SECONDS} seconds"
            job_logger.error("Local database backup timed out")
        except Exception as exc:
            run["error"] = str(exc) or type(exc).__name__
            job_logger.error("Local database backup failed", error=run["error"])
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        self._local_backup_last_run = run

    async def _run_exploration_refresh(self, correlation_id: str) -> None:
        """Refresh event entities + related events after maintenance. Never raises."""

        if not self.settings.exploration_enabled:
            return
        job_logger = logger.bind(correlation_id=correlation_id, job="exploration_refresh")
        timeout = self.settings.exploration_refresh_timeout_seconds
        started_at = datetime.now(timezone.utc)
        run: dict = {"started_at": started_at.isoformat(), "success": False}
        try:
            job_logger.info("Starting exploration refresh", timeout_seconds=timeout)
            stats = await asyncio.wait_for(
                get_exploration_service().refresh_active(correlation_id=correlation_id),
                timeout=timeout,
            )
            run.update(success=True, stats=stats)
            job_logger.info("Exploration refresh completed", **stats)
        except asyncio.TimeoutError:
            run["error"] = f"timed out after {timeout} seconds"
            job_logger.error("Exploration refresh timed out", timeout_seconds=timeout)
        except Exception as exc:
            run["error"] = str(exc) or type(exc).__name__
            job_logger.error("Exploration refresh failed", error=run["error"])
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        self._exploration_last_run = run

    async def _article_digest_job(self) -> None:
        """Digest the newest foreign articles without a Dutch gist. Never raises."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="article_digest")
        run: dict = {"started_at": datetime.now(timezone.utc).isoformat(), "success": False}
        try:
            if not await ensure_healthy_connection():
                run["error"] = "database connection unhealthy"
                job_logger.error("Database connection unhealthy, skipping article digest")
                self._reset_services()
            else:
                stats = await asyncio.wait_for(
                    get_article_digest_service().digest_batch(
                        limit=self.settings.article_digest_batch_size,
                        max_age_hours=self.settings.article_digest_max_age_hours,
                        correlation_id=correlation_id,
                    ),
                    timeout=ARTICLE_DIGEST_TIMEOUT_SECONDS,
                )
                run.update(success=True, result=stats)
                job_logger.info("Article digest job completed", **stats)
        except asyncio.TimeoutError:
            run["error"] = f"timed out after {ARTICLE_DIGEST_TIMEOUT_SECONDS} seconds"
            job_logger.error(
                "Article digest job timed out", timeout_seconds=ARTICLE_DIGEST_TIMEOUT_SECONDS
            )
        except Exception as exc:
            run["error"] = str(exc) or type(exc).__name__
            job_logger.error("Article digest job failed", error=run["error"])
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        self._article_digest_last_run = run

    async def _voice_search_job(self) -> None:
        """Run the AI searches for missing voices that are queued. Never raises."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="voice_search")
        run: dict = {"started_at": datetime.now(timezone.utc).isoformat(), "success": False}
        try:
            # Story INFRA-2: only look in Supabase after a signal of the website (or now and then)
            signals = await self._voice_listener.due() if self._voice_listener else []
            if signals is None:
                return
            if signals:
                run["signals"] = signals[:10]
            if not await ensure_healthy_connection():
                run["error"] = "database connection unhealthy"
                self._reset_services()
            else:
                stats = await asyncio.wait_for(
                    get_voice_search_service().run_pending(
                        limit=self.settings.voice_search_batch_size,
                        correlation_id=correlation_id,
                    ),
                    timeout=VOICE_SEARCH_TIMEOUT_SECONDS,
                )
                run.update(success=True, result=stats)
                if stats.get("ran"):
                    job_logger.info("Voice search job completed", **stats)
        except asyncio.TimeoutError:
            run["error"] = f"timed out after {VOICE_SEARCH_TIMEOUT_SECONDS} seconds"
            job_logger.error("Voice search job timed out")
        except Exception as exc:
            run["error"] = str(exc) or type(exc).__name__
            job_logger.error("Voice search job failed", error=run["error"])
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        # Keep the last run that did something (the job runs every few seconds)
        if (
            run.get("error")
            or (run.get("result") or {}).get("ran")
            or self._voice_search_last_run is None
        ):
            self._voice_search_last_run = run

    async def _bias_request_job(self) -> None:
        """Run the bias analyses requested in the app (Story 10.7). Never raises."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="bias_requests")
        run: dict = {"started_at": datetime.now(timezone.utc).isoformat(), "success": False}
        try:
            # Only look in Supabase after a signal of the website (or now and then)
            signals = await self._bias_listener.due() if self._bias_listener else []
            if signals is None:
                return
            if signals:
                run["signals"] = signals[:10]
            if not await ensure_healthy_connection():
                run["error"] = "database connection unhealthy"
                self._reset_services()
            else:
                stats = await asyncio.wait_for(
                    get_bias_request_service().run_pending(limit=1, correlation_id=correlation_id),
                    timeout=BIAS_REQUEST_TIMEOUT_SECONDS,
                )
                run.update(success=True, result=stats)
                if stats.get("ran"):
                    job_logger.info("Bias request job completed", **stats)
        except asyncio.TimeoutError:
            run["error"] = f"timed out after {BIAS_REQUEST_TIMEOUT_SECONDS} seconds"
            job_logger.error("Bias request job timed out")
        except Exception as exc:
            run["error"] = str(exc) or type(exc).__name__
            job_logger.error("Bias request job failed", error=run["error"])
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        # Keep the last run that did something (the job runs every few seconds)
        if (
            run.get("error")
            or (run.get("result") or {}).get("ran")
            or self._bias_request_last_run is None
        ):
            self._bias_request_last_run = run

    async def _publish_job(self) -> None:
        """Send what changed in the local database to Supabase (Story INFRA-2). Never raises."""

        try:
            await asyncio.wait_for(
                get_publish_service().publish_once(), timeout=PUBLISH_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            self._publish_last_error = {
                "at": datetime.now(timezone.utc).isoformat(),
                "error": f"timed out after {PUBLISH_TIMEOUT_SECONDS} seconds",
            }
            logger.error("Publish job timed out", timeout_seconds=PUBLISH_TIMEOUT_SECONDS)
        except Exception as exc:
            self._publish_last_error = {
                "at": datetime.now(timezone.utc).isoformat(),
                "error": str(exc)[:500] or type(exc).__name__,
            }
            logger.error("Publish job failed", error=self._publish_last_error["error"])

    async def _llm_usage_job(self) -> None:
        """Write the noted LLM calls to the local database. Never raises."""

        try:
            await get_llm_usage_service().flush()
        except Exception as exc:  # they stay noted for the next run
            logger.warning("LLM usage flush failed", error=str(exc)[:300] or type(exc).__name__)

    async def _propaganda_sync_job(self) -> None:
        """Sync the approved propaganda-model graph when its database changed. Never raises."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="propagandamodel_sync")
        started_at = datetime.now(timezone.utc)
        run: dict = {"started_at": started_at.isoformat(), "success": False}
        try:
            job_logger.info(
                "Starting propaganda-model sync job",
                timeout_seconds=PROPAGANDA_SYNC_TIMEOUT_SECONDS,
            )
            if not await ensure_healthy_connection():
                run["error"] = "database connection unhealthy"
                job_logger.error("Database connection unhealthy, skipping propaganda-model sync")
                self._reset_services()
            else:
                result = await asyncio.wait_for(
                    get_propaganda_sync_service().sync(correlation_id=correlation_id),
                    timeout=PROPAGANDA_SYNC_TIMEOUT_SECONDS,
                )
                run.update(success=True, result=result)
                job_logger.info("Propaganda-model sync job completed", **result)
        except asyncio.TimeoutError:
            run["error"] = f"timed out after {PROPAGANDA_SYNC_TIMEOUT_SECONDS} seconds"
            job_logger.error(
                "Propaganda-model sync job timed out",
                timeout_seconds=PROPAGANDA_SYNC_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            run["error"] = str(exc) or type(exc).__name__
            job_logger.error("Propaganda-model sync job failed", error=run["error"])
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        self._propaganda_sync_last_run = run

    async def _entity_research_job(self) -> None:
        """One entity research cycle (Epic 12). Never raises."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="entity_research")
        started_at = datetime.now(timezone.utc)
        run: dict = {"started_at": started_at.isoformat(), "success": False}
        try:
            if not await ensure_healthy_connection():
                run["error"] = "database connection unhealthy"
                job_logger.error("Database connection unhealthy, skipping entity research")
                self._reset_services()
            else:
                result = await asyncio.wait_for(
                    get_entity_research_service().run_cycle(correlation_id=correlation_id),
                    timeout=ENTITY_RESEARCH_TIMEOUT_SECONDS,
                )
                run.update(success=True, result=result)
                job_logger.info("Entity research cycle completed")
        except asyncio.TimeoutError:
            run["error"] = f"timed out after {ENTITY_RESEARCH_TIMEOUT_SECONDS} seconds"
            job_logger.error("Entity research cycle timed out")
        except Exception as exc:
            run["error"] = str(exc) or type(exc).__name__
            job_logger.error("Entity research cycle failed", error=run["error"])
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        self._entity_research_last_run = run

    async def _evidence_research_job(self) -> None:
        """One evidence research cycle (Story 14.13). Never raises."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="evidence_research")
        run: dict = {"started_at": datetime.now(timezone.utc).isoformat(), "success": False}
        try:
            if not await ensure_healthy_connection():
                run["error"] = "database connection unhealthy"
                job_logger.error("Database connection unhealthy, skipping evidence research")
                self._reset_services()
            else:
                result = await asyncio.wait_for(
                    get_evidence_research_service().run_cycle(correlation_id=correlation_id),
                    timeout=EVIDENCE_RESEARCH_TIMEOUT_SECONDS,
                )
                run.update(success=True, result=result)
                job_logger.info("Evidence research cycle completed")
        except asyncio.TimeoutError:
            run["error"] = f"timed out after {EVIDENCE_RESEARCH_TIMEOUT_SECONDS} seconds"
            job_logger.error("Evidence research cycle timed out")
        except Exception as exc:
            run["error"] = str(exc) or type(exc).__name__
            job_logger.error("Evidence research cycle failed", error=run["error"])
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        self._evidence_research_last_run = run

    async def _international_enrichment_job(self) -> None:
        """Enrich events with international news perspectives via Google News."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="international_enrichment")

        try:
            job_logger.info(
                "Starting international enrichment job",
                timeout_seconds=INTERNATIONAL_ENRICHMENT_TIMEOUT_SECONDS,
            )

            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                job_logger.error("Database connection unhealthy, skipping enrichment cycle")
                self._reset_services()
                return

            # Get events that need international enrichment
            session_factory = get_sessionmaker()
            async with session_factory() as session:
                event_repo = EventRepository(session)
                events = await event_repo.get_events_without_international(
                    limit=self.settings.international_enrichment_batch_size
                )

            if not events:
                job_logger.info("No events need international enrichment")
                return

            job_logger.info("Found events for enrichment", count=len(events))

            enrichment_service = self._get_international_enrichment_service()
            total_added = 0
            successful = 0
            failed = 0

            try:
                for event in events:
                    try:
                        result = await asyncio.wait_for(
                            enrichment_service.enrich_event(
                                event_id=event.id,
                                max_articles_per_country=self.settings.international_enrichment_max_per_country,
                                correlation_id=correlation_id,
                            ),
                            timeout=120,  # 2 min per event
                        )
                        total_added += result.articles_added
                        successful += 1
                        job_logger.debug(
                            "Event enriched",
                            event_id=event.id,
                            articles_added=result.articles_added,
                        )
                    except asyncio.TimeoutError:
                        job_logger.warning("Event enrichment timed out", event_id=event.id)
                        failed += 1
                    except Exception as e:
                        job_logger.warning(
                            "Event enrichment failed", event_id=event.id, error=str(e)
                        )
                        failed += 1

                    # Rate limiting between events
                    await asyncio.sleep(5)

            except asyncio.TimeoutError:
                job_logger.error(
                    "International enrichment job timed out",
                    timeout_seconds=INTERNATIONAL_ENRICHMENT_TIMEOUT_SECONDS,
                )
                self._reset_services()
                return

            job_logger.info(
                "International enrichment job completed",
                events_processed=successful,
                events_failed=failed,
                total_articles_added=total_added,
            )

        except Exception as exc:  # pragma: no cover - defensive logging
            job_logger.error("International enrichment job failed", error=str(exc))
            self._reset_services()

    async def _bias_analysis_job(self) -> None:
        """Analyze articles for per-sentence bias using LLM (Epic 10)."""

        correlation_id = str(uuid.uuid4())
        job_logger = logger.bind(correlation_id=correlation_id, job="bias_analysis")

        try:
            job_logger.info(
                "Starting bias analysis job",
                timeout_seconds=BIAS_ANALYSIS_TIMEOUT_SECONDS,
                batch_size=self.settings.bias_analysis_batch_size,
            )

            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                job_logger.error("Database connection unhealthy, skipping bias analysis cycle")
                self._reset_services()
                return

            bias_service = self._get_bias_detection_service()
            try:
                stats = await asyncio.wait_for(
                    bias_service.analyze_batch(
                        limit=self.settings.bias_analysis_batch_size,
                        correlation_id=correlation_id,
                    ),
                    timeout=BIAS_ANALYSIS_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                job_logger.error(
                    "Bias analysis job timed out",
                    timeout_seconds=BIAS_ANALYSIS_TIMEOUT_SECONDS,
                )
                self._reset_services()
                return

            job_logger.info("Bias analysis job completed", **stats)

        except Exception as exc:  # pragma: no cover - defensive logging
            job_logger.error("Bias analysis job failed", error=str(exc))
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

    async def close_connections(self) -> None:
        """Close the Supabase connections (Story INFRA-2)."""
        if self._voice_listener is not None:
            await self._voice_listener.close()
        if self._bias_listener is not None:
            await self._bias_listener.close()
        await dispose_supabase_engine()

    def _storage_status(self) -> dict:
        """Story INFRA-2: where the backend works and what it published to Supabase."""
        publish = get_publish_service().status() if self.settings.supabase_database_url else {}
        return {
            "local_database": bool(self.settings.supabase_database_url),
            "publish_enabled": bool(self.settings.supabase_database_url) and self.settings.publish_enabled,
            "publish_last_run": publish.get("last_run"),
            "publish_last_change": publish.get("last_change"),
            "publish_last_error": self._publish_last_error,
            "voice_search_listening": bool(self._voice_listener and self._voice_listener.connected),
            "bias_request_listening": bool(self._bias_listener and self._bias_listener.connected),
            "local_backup_last_run": self._local_backup_last_run,
        }

    def _maintenance_last_run_text(self) -> str | None:
        last_run = self._maintenance_last_run()
        return last_run.isoformat() if last_run else None

    def get_job_status(self) -> dict:
        """Get status of scheduled jobs."""
        if not self._is_running:
            return {
                "status": "stopped",
                "jobs": [],
                "event_maintenance_last_run": self._maintenance_last_run_text(),
                "exploration_last_run": self._exploration_last_run,
                "propagandamodel_last_run": self._propaganda_sync_last_run,
                "entity_research_last_run": self._entity_research_last_run,
                "evidence_research_last_run": self._evidence_research_last_run,
                "article_digest_last_run": self._article_digest_last_run,
                "voice_search_last_run": self._voice_search_last_run,
                "bias_request_last_run": self._bias_request_last_run,
                "storage": self._storage_status(),
            }

        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append(
                {
                    "id": job.id,
                    "name": job.name,
                    "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
                    "trigger": str(job.trigger),
                }
            )

        return {
            "status": "running",
            "jobs": jobs,
            "event_maintenance_last_run": self._maintenance_last_run_text(),
            "exploration_last_run": self._exploration_last_run,
            "propagandamodel_last_run": self._propaganda_sync_last_run,
            "entity_research_last_run": self._entity_research_last_run,
            "evidence_research_last_run": self._evidence_research_last_run,
            "article_digest_last_run": self._article_digest_last_run,
            "voice_search_last_run": self._voice_search_last_run,
            "bias_request_last_run": self._bias_request_last_run,
            "storage": self._storage_status(),
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
                    "correlation_id": correlation_id,
                }

            ingest_service = self._get_ingest_service()
            results = await ingest_service.poll_feeds(correlation_id=correlation_id)
            return results
        except Exception as e:
            logger.error(
                "Manual RSS feed polling failed", error=str(e), correlation_id=correlation_id
            )
            self._reset_services()
            return {"success": False, "error": str(e), "correlation_id": correlation_id}

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
                    "correlation_id": correlation_id,
                }

            maintenance_service = self._get_maintenance_service()
            stats = await maintenance_service.run(correlation_id=correlation_id)
            self._record_maintenance_run()
            return {"success": True, "correlation_id": correlation_id, **stats.as_dict()}
        except Exception as e:
            logger.error(
                "Manual event maintenance failed", error=str(e), correlation_id=correlation_id
            )
            self._reset_services()
            return {"success": False, "error": str(e), "correlation_id": correlation_id}

    async def merge_split_events_now(
        self, *, hours: float, limit: int, dry_run: bool, older_than_hours: float = 0
    ) -> dict:
        """Merge news items of one Dutch article into the item that has the same news (admin).

        Runs on the poll's own event service, so it shares its vector index and takes its turn
        with the assignments of a running poll.
        """
        correlation_id = str(uuid.uuid4())
        event_service = self._get_ingest_service().event_service
        return await event_service.merge_split_events(
            hours=hours,
            older_than_hours=older_than_hours,
            limit=limit,
            dry_run=dry_run,
            correlation_id=correlation_id,
        )

    async def run_catch_up_now(self, *, limit: int, max_age_hours: float) -> dict:
        """Enrich and assign articles earlier cycles left behind (admin; each poll does 25)."""
        correlation_id = str(uuid.uuid4())
        return await self._get_ingest_service().catch_up_orphans(
            limit=limit, max_age_hours=max_age_hours, correlation_id=correlation_id
        )

    async def classify_pending_now(self, *, limit: int, max_age_hours: float | None) -> dict:
        """Ask again the type of enriched Dutch articles whose classification failed (admin)."""
        enrichment_service = self._get_ingest_service().enrichment_service
        return await enrichment_service.classify_pending(limit=limit, max_age_hours=max_age_hours)

    async def run_insight_backfill_now(self, limit: int | None = None) -> dict:
        """Manually trigger insight backfill (for testing/admin)."""
        correlation_id = str(uuid.uuid4())
        batch_size = limit or self.settings.insight_backfill_batch_size
        logger.info(
            "Manual insight backfill triggered", correlation_id=correlation_id, limit=batch_size
        )

        try:
            # Ensure database connection is healthy before proceeding
            if not await ensure_healthy_connection():
                self._reset_services()
                return {
                    "success": False,
                    "error": "Database connection unhealthy after reset attempt",
                    "correlation_id": correlation_id,
                }

            insight_service = self._get_insight_service()
            stats = await insight_service.backfill_missing_insights(
                limit=batch_size,
                correlation_id=correlation_id,
            )
            return {"success": True, "correlation_id": correlation_id, **stats}
        except Exception as e:
            logger.error(
                "Manual insight backfill failed", error=str(e), correlation_id=correlation_id
            )
            self._reset_services()
            return {"success": False, "error": str(e), "correlation_id": correlation_id}


# Global scheduler instance
_scheduler: NewsAggregatorScheduler | None = None


def get_scheduler() -> NewsAggregatorScheduler:
    """Get the global scheduler instance (singleton pattern)."""
    global _scheduler
    if _scheduler is None:
        _scheduler = NewsAggregatorScheduler()
    return _scheduler
