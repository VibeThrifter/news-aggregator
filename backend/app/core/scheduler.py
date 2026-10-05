"""
Scheduler module for coordinating periodic tasks.

This module provides APScheduler integration for running RSS feed polling
and other background jobs according to Story 1.1 requirements.
"""

import asyncio
import uuid
from datetime import datetime, timezone

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..db.session import ensure_healthy_connection, get_sessionmaker
from ..events.maintenance import get_event_maintenance_service
from ..repositories.event_repo import EventRepository
from ..services.article_digest import get_article_digest_service
from ..services.voice_search import get_voice_search_service
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
from .config import get_settings

# Maximum time allowed for a single poll cycle (5 minutes)
POLL_CYCLE_TIMEOUT_SECONDS = 300
# Retrying left-behind articles gets its own budget, outside the poll timeout
ORPHAN_CATCH_UP_TIMEOUT_SECONDS = 240
# Maximum time allowed for insight backfill (10 minutes)
INSIGHT_BACKFILL_TIMEOUT_SECONDS = 600
# Maximum time allowed for maintenance (10 minutes)
MAINTENANCE_TIMEOUT_SECONDS = 600
# Maximum time allowed for international enrichment (15 minutes)
INTERNATIONAL_ENRICHMENT_TIMEOUT_SECONDS = 900
# Maximum time allowed for bias analysis (30 minutes - many LLM calls)
BIAS_ANALYSIS_TIMEOUT_SECONDS = 1800
# Maximum time allowed for one article digest batch (page fetches + one LLM call per article)
ARTICLE_DIGEST_TIMEOUT_SECONDS = 900
# One AI search for a missing voice takes about a minute; the service times out each one itself
VOICE_SEARCH_TIMEOUT_SECONDS = 900
# Maximum time allowed for the propaganda-model sync (Story 11.17)
PROPAGANDA_SYNC_TIMEOUT_SECONDS = 600
# Maximum time allowed for one entity research cycle (Epic 12; research rounds run in the
# background and are not part of this timeout)
ENTITY_RESEARCH_TIMEOUT_SECONDS = 600
# One evidence research cycle (Story 14.13; the rounds of the pm agent run in the background)
EVIDENCE_RESEARCH_TIMEOUT_SECONDS = 300

logger = structlog.get_logger()


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

        self.scheduler.add_job(
            func=self._event_maintenance_job,
            trigger=IntervalTrigger(hours=self.settings.event_maintenance_interval_hours),
            id="event_maintenance",
            name="Event Maintenance",
            replace_existing=True,
            max_instances=1,
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
                trigger=IntervalTrigger(minutes=self.settings.voice_search_interval_minutes),
                id="voice_search",
                name="Voice Search",
                replace_existing=True,
                max_instances=1,
            )
            logger.info(
                "Voice search job enabled",
                interval_minutes=self.settings.voice_search_interval_minutes,
                batch_size=self.settings.voice_search_batch_size,
            )
        else:
            logger.info("Voice search job disabled (set VOICE_SEARCH_ENABLED=true to enable)")

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

        # Wie is dit? (Epic 12) - triage names, queue research in the propaganda model, start
        # rounds of its nieuws-scout agent and pull the results
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
                rounds_enabled=self.settings.nieuws_scout_enabled,
            )
        else:
            logger.info("Entity research job disabled (set ENTITY_RESEARCH_ENABLED=true to enable)")

        # Dun bewijs (Story 14.13) - queue thin links readers saw for evidence research in the
        # propaganda model, start rounds of its nieuws-bewijs agent (when switched on), pull results
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
                rounds_enabled=self.settings.nieuws_bewijs_enabled,
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

    async def _event_maintenance_job(self) -> None:
        """Refresh event centroids, archive stale events, and heal the vector index."""

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
                return

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
                return

            job_logger.info("Event maintenance job completed", **stats.as_dict())
        except Exception as exc:  # pragma: no cover - defensive logging
            job_logger.error("Event maintenance job failed", error=str(exc))
            self._reset_services()
            return

        # Story 11.8: refresh exploration data (own timeout, outside the maintenance timeout)
        await self._run_exploration_refresh(correlation_id)

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
        # Keep the last run that did something (the job runs every minute)
        if (
            run.get("error")
            or (run.get("result") or {}).get("ran")
            or self._voice_search_last_run is None
        ):
            self._voice_search_last_run = run

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

    def get_job_status(self) -> dict:
        """Get status of scheduled jobs."""
        if not self._is_running:
            return {
                "status": "stopped",
                "jobs": [],
                "exploration_last_run": self._exploration_last_run,
                "propagandamodel_last_run": self._propaganda_sync_last_run,
                "entity_research_last_run": self._entity_research_last_run,
                "evidence_research_last_run": self._evidence_research_last_run,
                "article_digest_last_run": self._article_digest_last_run,
                "voice_search_last_run": self._voice_search_last_run,
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
            "exploration_last_run": self._exploration_last_run,
            "propagandamodel_last_run": self._propaganda_sync_last_run,
            "entity_research_last_run": self._entity_research_last_run,
            "evidence_research_last_run": self._evidence_research_last_run,
            "article_digest_last_run": self._article_digest_last_run,
            "voice_search_last_run": self._voice_search_last_run,
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
            return {"success": True, "correlation_id": correlation_id, **stats.as_dict()}
        except Exception as e:
            logger.error(
                "Manual event maintenance failed", error=str(e), correlation_id=correlation_id
            )
            self._reset_services()
            return {"success": False, "error": str(e), "correlation_id": correlation_id}

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

    async def run_international_enrichment_now(self, limit: int | None = None) -> dict:
        """Manually trigger international enrichment (for testing/admin)."""
        correlation_id = str(uuid.uuid4())
        batch_size = limit or self.settings.international_enrichment_batch_size
        logger.info(
            "Manual international enrichment triggered",
            correlation_id=correlation_id,
            limit=batch_size,
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

            # Get events that need international enrichment
            session_factory = get_sessionmaker()
            async with session_factory() as session:
                event_repo = EventRepository(session)
                events = await event_repo.get_events_without_international(limit=batch_size)

            if not events:
                return {
                    "success": True,
                    "correlation_id": correlation_id,
                    "events_processed": 0,
                    "total_articles_added": 0,
                    "message": "No events need international enrichment",
                }

            enrichment_service = self._get_international_enrichment_service()
            total_added = 0
            successful = 0
            failed = 0
            results = []

            for event in events:
                try:
                    result = await enrichment_service.enrich_event(
                        event_id=event.id,
                        max_articles_per_country=self.settings.international_enrichment_max_per_country,
                        correlation_id=correlation_id,
                    )
                    total_added += result.articles_added
                    successful += 1
                    results.append(
                        {
                            "event_id": event.id,
                            "articles_added": result.articles_added,
                            "countries_fetched": result.countries_fetched,
                        }
                    )
                except Exception as e:
                    failed += 1
                    results.append(
                        {
                            "event_id": event.id,
                            "error": str(e),
                        }
                    )

                # Rate limiting between events
                await asyncio.sleep(2)

            return {
                "success": failed == 0,
                "correlation_id": correlation_id,
                "events_processed": successful,
                "events_failed": failed,
                "total_articles_added": total_added,
                "results": results,
            }

        except Exception as e:
            logger.error(
                "Manual international enrichment failed",
                error=str(e),
                correlation_id=correlation_id,
            )
            self._reset_services()
            return {
                "success": False,
                "error": str(e),
                "correlation_id": correlation_id,
            }

    async def run_bias_analysis_now(self, limit: int | None = None) -> dict:
        """Manually trigger bias analysis (for testing/admin)."""
        correlation_id = str(uuid.uuid4())
        batch_size = limit or self.settings.bias_analysis_batch_size
        logger.info(
            "Manual bias analysis triggered",
            correlation_id=correlation_id,
            limit=batch_size,
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

            bias_service = self._get_bias_detection_service()
            stats = await bias_service.analyze_batch(
                limit=batch_size,
                correlation_id=correlation_id,
            )
            return {
                "success": stats["articles_failed"] == 0,
                "correlation_id": correlation_id,
                **stats,
            }

        except Exception as e:
            logger.error(
                "Manual bias analysis failed",
                error=str(e),
                correlation_id=correlation_id,
            )
            self._reset_services()
            return {
                "success": False,
                "error": str(e),
                "correlation_id": correlation_id,
            }


# Global scheduler instance
_scheduler: NewsAggregatorScheduler | None = None


def get_scheduler() -> NewsAggregatorScheduler:
    """Get the global scheduler instance (singleton pattern)."""
    global _scheduler
    if _scheduler is None:
        _scheduler = NewsAggregatorScheduler()
    return _scheduler
