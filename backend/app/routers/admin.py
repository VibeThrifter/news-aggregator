"""Admin endpoints for manual job triggers and system status."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.app.core.logging import get_logger
from backend.app.core.scheduler import get_scheduler
from backend.app.services.article_digest import get_article_digest_service
from backend.app.services.enrich_service import ArticleEnrichmentService
from backend.app.services.entity_research.service import get_entity_research_service
from backend.app.services.evidence_research import get_evidence_research_service
from backend.app.services.event_service import EventService
from backend.app.services.insight_service import InsightGenerationOutcome, InsightService
from backend.app.services.international_enrichment import (
    get_international_enrichment_service,
)
from backend.app.services.bias_service import BiasAnalysisOutcome, get_bias_detection_service
from backend.app.services.exploration_service import (
    EventNotFoundError,
    get_exploration_service,
)
from backend.app.services.llm_config_service import get_llm_config_service
from backend.app.services.propaganda_model_sync import (
    UnsecuredTargetError,
    get_propaganda_sync_service,
)
from backend.app.services.source_service import get_source_service
from backend.app.services.voice_search import get_voice_search_service

router = APIRouter(prefix="/admin", tags=["admin"])
logger = get_logger(__name__)


# Pydantic models for request/response
class SourceResponse(BaseModel):
    source_id: str
    display_name: str
    feed_url: str
    spectrum: str | int | float | None
    enabled: bool
    is_main_source: bool


class SourceUpdateRequest(BaseModel):
    enabled: bool | None = None
    is_main_source: bool | None = None


class SourcesListResponse(BaseModel):
    sources: list[SourceResponse]
    total: int


# LLM Config models
class LlmConfigResponse(BaseModel):
    id: int
    key: str
    value: str
    config_type: str
    description: str | None
    updated_at: datetime


class LlmConfigUpdateRequest(BaseModel):
    value: str
    description: str | None = None


class LlmConfigListResponse(BaseModel):
    configs: list[LlmConfigResponse]
    total: int


# Source management endpoints
@router.get("/sources", response_model=SourcesListResponse)
async def list_sources():
    """List all configured news sources with their settings."""
    service = get_source_service()
    sources = await service.get_all_sources()
    return SourcesListResponse(
        sources=[SourceResponse(**s.to_dict()) for s in sources],
        total=len(sources),
    )


@router.patch("/sources/{source_id}")
async def update_source(source_id: str, update: SourceUpdateRequest):
    """Update source settings (enabled, is_main_source)."""
    service = get_source_service()

    result = None
    if update.enabled is not None:
        result = await service.update_source_enabled(source_id, update.enabled)
    if update.is_main_source is not None:
        result = await service.update_source_is_main(source_id, update.is_main_source)

    if result is None:
        # Try to get the source to check if it exists
        sources = await service.get_all_sources()
        exists = any(s.source_id == source_id for s in sources)
        if not exists:
            raise HTTPException(status_code=404, detail=f"Source {source_id} not found")
        # If exists but no update was made
        for s in sources:
            if s.source_id == source_id:
                return SourceResponse(**s.to_dict())

    return SourceResponse(**result.to_dict())


@router.post("/sources/initialize")
async def initialize_sources():
    """Initialize sources from registered feed readers.

    Creates source entries for any reader that doesn't have one yet.
    """
    from backend.app.services.ingest_service import get_ingest_service

    ingest_service = get_ingest_service()
    source_service = get_source_service()

    stats = await source_service.initialize_sources_from_readers(ingest_service.readers)

    return {
        "message": "Sources initialized from readers",
        "stats": stats,
    }


@router.post("/sources/sync-spectrum")
async def sync_sources_spectrum():
    """Sync spectrum values from feed readers to existing sources.

    Updates spectrum for all sources based on their reader's metadata.
    """
    from backend.app.services.ingest_service import get_ingest_service

    ingest_service = get_ingest_service()
    source_service = get_source_service()

    stats = await source_service.sync_spectrum_from_readers(ingest_service.readers)

    return {
        "message": "Source spectrum values synced from readers",
        "stats": stats,
    }


@router.post("/trigger/poll-feeds")
async def trigger_poll_feeds():
    """Manually trigger RSS feed polling."""
    scheduler = get_scheduler()
    result = await scheduler.run_poll_feeds_now()
    return result


@router.post("/trigger/maintenance")
async def trigger_maintenance():
    """Manually trigger the event maintenance job."""
    scheduler = get_scheduler()
    result = await scheduler.run_event_maintenance_now()
    return result


@router.post("/trigger/enrich")
async def trigger_enrich():
    """Manually trigger article enrichment."""
    enrichment_service = ArticleEnrichmentService()
    result = await enrichment_service.enrich_pending(limit=None)
    return result


@router.post("/trigger/assign-events")
async def trigger_assign_events(limit: int = 200, max_age_hours: float | None = None):
    """Assign enriched Dutch articles that are in no event (oldest first; optionally recent only)."""
    event_service = EventService()
    result = await event_service.assign_orphaned_articles(limit=limit, max_age_hours=max_age_hours)
    return result


@router.get("/scheduler/status")
async def scheduler_status():
    """Get current scheduler status and job information."""
    scheduler = get_scheduler()
    return scheduler.get_job_status()


def _build_links(event_id: int) -> dict[str, str]:
    base_id = str(event_id)
    return {
        "self": f"/admin/trigger/generate-insights/{base_id}",
        "event": f"/api/v1/events/{base_id}",
        "insights": f"/api/v1/insights/{base_id}",
    }


def _build_data_envelope(result: InsightGenerationOutcome) -> dict[str, Any]:
    status = "created" if result.created else "updated"
    generated_at: datetime | None = getattr(result.insight, "generated_at", None)
    return {
        "type": "insight-job",
        "id": str(result.insight.id),
        "attributes": {
            "event_id": result.insight.event_id,
            "status": status,
            "generated_at": generated_at.isoformat() if generated_at else None,
        },
    }


def _build_meta(result: InsightGenerationOutcome) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "provider": result.llm_result.provider,
        "model": result.llm_result.model,
        "message": "Insights-run gestart" if result.created else "Bestaande insights geüpdatet",
    }
    if result.llm_result.usage:
        meta["usage"] = result.llm_result.usage
    return meta


def _json_api_error(
    status_code: int, *, code: str, message: str, details: Any | None = None
) -> JSONResponse:
    content: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details is not None:
        content["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=content)


@router.post("/trigger/generate-insights/{event_id}")
async def trigger_generate_insights(event_id: int):
    """Manually trigger LLM insight generation for a specific event."""
    service = InsightService()
    try:
        result = await service.generate_for_event(event_id)
        return {
            "data": _build_data_envelope(result),
            "meta": _build_meta(result),
            "links": _build_links(event_id),
        }
    except ValueError as e:
        return _json_api_error(
            status_code=404,
            code="EVENT_NOT_FOUND",
            message=str(e),
        )
    except Exception as e:
        # The reason only went to the caller; a batch of failed runs left no trace in the log
        logger.warning("insight_generation_failed", event_id=event_id, error=str(e)[:500])
        return _json_api_error(
            status_code=500,
            code="INSIGHT_GENERATION_FAILED",
            message="Insight generation failed",
            details={"reason": str(e)},
        )


@router.post("/trigger/backfill-insights")
async def trigger_backfill_insights(limit: int | None = None):
    """Manually trigger insight backfill for events missing insights.

    Args:
        limit: Optional maximum number of events to process (default: from config)
    """
    scheduler = get_scheduler()
    result = await scheduler.run_insight_backfill_now(limit=limit)
    return result


# LLM Config endpoints
def _config_to_response(config) -> LlmConfigResponse:
    """Convert LlmConfig model to response."""
    return LlmConfigResponse(
        id=config.id,
        key=config.key,
        value=config.value,
        config_type=config.config_type,
        description=config.description,
        updated_at=config.updated_at,
    )


@router.get("/llm-config", response_model=LlmConfigListResponse)
async def list_llm_configs(config_type: str | None = None):
    """List all LLM configuration entries.

    Args:
        config_type: Optional filter by type (prompt, parameter, scoring)
    """
    service = get_llm_config_service()

    if config_type:
        configs = await service.list_by_type(config_type)
    else:
        configs = await service.list_all()

    return LlmConfigListResponse(
        configs=[_config_to_response(c) for c in configs],
        total=len(configs),
    )


@router.get("/llm-config/{key}", response_model=LlmConfigResponse)
async def get_llm_config(key: str):
    """Get a specific LLM config entry by key."""
    from backend.app.db.session import get_sessionmaker
    from backend.app.repositories.llm_config_repo import LlmConfigRepository

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        repo = LlmConfigRepository(session)
        config = await repo.get_by_key(key)

        if not config:
            raise HTTPException(status_code=404, detail=f"Config '{key}' not found")

        return _config_to_response(config)


@router.patch("/llm-config/{key}", response_model=LlmConfigResponse)
async def update_llm_config(key: str, update: LlmConfigUpdateRequest):
    """Update an LLM config entry value."""
    service = get_llm_config_service()
    config = await service.update_config(
        key=key,
        value=update.value,
        description=update.description,
    )

    if not config:
        raise HTTPException(status_code=404, detail=f"Config '{key}' not found")

    return _config_to_response(config)


@router.post("/llm-config/seed")
async def seed_llm_config(overwrite: bool = False):
    """Seed default LLM configuration values.

    Args:
        overwrite: If True, overwrite existing values with defaults.
    """
    service = get_llm_config_service()
    stats = await service.seed_defaults(overwrite=overwrite)
    return {
        "message": "LLM config seeded",
        "stats": stats,
    }


@router.post("/llm-config/invalidate-cache")
async def invalidate_llm_config_cache():
    """Manually invalidate the LLM config cache."""
    service = get_llm_config_service()
    service.invalidate_cache()
    return {"message": "Config cache invalidated"}


# International Enrichment endpoints (Epic 9)
class InternationalEnrichmentResponse(BaseModel):
    """Response for international enrichment operations."""

    event_id: int
    countries_detected: list[str]
    countries_fetched: list[str]
    countries_excluded: list[str]
    articles_found: int
    articles_added: int
    articles_duplicate: int
    errors: list[str]


class BatchEnrichmentResponse(BaseModel):
    """Response for batch international enrichment."""

    success: bool
    events_processed: int
    total_articles_added: int
    results: list[InternationalEnrichmentResponse]
    errors: list[str]


@router.post(
    "/trigger/enrich-international/{event_id}",
    response_model=InternationalEnrichmentResponse,
)
async def trigger_international_enrichment(
    event_id: int,
    max_per_country: int = 5,
):
    """Trigger international enrichment for a specific event.

    Fetches international news articles from Google News based on the
    countries detected in the event's LLM insight.

    Args:
        event_id: ID of the event to enrich
        max_per_country: Maximum articles to fetch per country (1-20)
    """
    if max_per_country < 1 or max_per_country > 20:
        raise HTTPException(
            status_code=400,
            detail="max_per_country must be between 1 and 20",
        )

    service = get_international_enrichment_service()
    result = await service.enrich_event(
        event_id=event_id,
        max_articles_per_country=max_per_country,
    )

    return InternationalEnrichmentResponse(
        event_id=result.event_id,
        countries_detected=result.countries_detected,
        countries_fetched=result.countries_fetched,
        countries_excluded=result.countries_excluded,
        articles_found=result.articles_found,
        articles_added=result.articles_added,
        articles_duplicate=result.articles_duplicate,
        errors=result.errors,
    )


@router.post(
    "/trigger/enrich-international-batch",
    response_model=BatchEnrichmentResponse,
)
async def trigger_batch_international_enrichment(
    limit: int = 5,
    max_per_country: int = 5,
):
    """Enrich multiple events with international perspectives.

    Finds events that have detected countries but haven't been enriched yet,
    and fetches international articles for each.

    Args:
        limit: Maximum number of events to process (1-20)
        max_per_country: Maximum articles to fetch per country per event (1-20)
    """
    import asyncio

    from backend.app.db.session import get_sessionmaker
    from backend.app.repositories.event_repo import EventRepository

    if limit < 1 or limit > 20:
        raise HTTPException(
            status_code=400,
            detail="limit must be between 1 and 20",
        )
    if max_per_country < 1 or max_per_country > 20:
        raise HTTPException(
            status_code=400,
            detail="max_per_country must be between 1 and 20",
        )

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        event_repo = EventRepository(session)
        events = await event_repo.get_events_without_international(limit=limit)

    if not events:
        return BatchEnrichmentResponse(
            success=True,
            events_processed=0,
            total_articles_added=0,
            results=[],
            errors=[],
        )

    enrichment_service = get_international_enrichment_service()
    results: list[InternationalEnrichmentResponse] = []
    errors: list[str] = []
    total_added = 0

    for event in events:
        try:
            result = await enrichment_service.enrich_event(
                event_id=event.id,
                max_articles_per_country=max_per_country,
            )
            results.append(
                InternationalEnrichmentResponse(
                    event_id=result.event_id,
                    countries_detected=result.countries_detected,
                    countries_fetched=result.countries_fetched,
                    countries_excluded=result.countries_excluded,
                    articles_found=result.articles_found,
                    articles_added=result.articles_added,
                    articles_duplicate=result.articles_duplicate,
                    errors=result.errors,
                )
            )
            total_added += result.articles_added
        except Exception as e:
            errors.append(f"Event {event.id}: {e}")

        # Rate limiting between events
        await asyncio.sleep(2)

    return BatchEnrichmentResponse(
        success=len(errors) == 0,
        events_processed=len(results),
        total_articles_added=total_added,
        results=results,
        errors=errors,
    )


# Bias Analysis endpoints (Epic 10)
class BiasAnalysisResponse(BaseModel):
    """Response for single article bias analysis."""

    article_id: int
    provider: str
    model: str
    total_sentences: int
    journalist_bias_count: int
    quote_bias_count: int
    journalist_bias_percentage: float
    overall_rating: float
    created: bool


class BatchBiasAnalysisResponse(BaseModel):
    """Response for batch bias analysis."""

    success: bool
    articles_found: int
    articles_analyzed: int
    articles_failed: int
    failed_article_ids: list[int] | None = None


@router.post(
    "/trigger/analyze-bias/{article_id}",
    response_model=BiasAnalysisResponse,
)
async def trigger_bias_analysis(article_id: int):
    """Trigger per-sentence bias analysis for a specific article.

    Analyzes the article content using LLM to detect 26 types of journalistic
    biases at sentence level. Results are persisted to the database.

    Args:
        article_id: ID of the article to analyze
    """
    service = get_bias_detection_service()

    try:
        outcome = await service.analyze_article(article_id)
        return BiasAnalysisResponse(
            article_id=article_id,
            provider=outcome.analysis.provider,
            model=outcome.analysis.model,
            total_sentences=outcome.analysis.total_sentences,
            journalist_bias_count=outcome.analysis.journalist_bias_count,
            quote_bias_count=outcome.analysis.quote_bias_count,
            journalist_bias_percentage=outcome.analysis.journalist_bias_percentage,
            overall_rating=outcome.analysis.overall_rating,
            created=outcome.created,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Bias analysis failed: {e}",
        )


@router.post(
    "/trigger/analyze-bias-batch",
    response_model=BatchBiasAnalysisResponse,
)
async def trigger_batch_bias_analysis(limit: int = 10):
    """Trigger batch bias analysis for articles without existing analysis.

    Finds articles that haven't been analyzed yet and runs bias detection
    on each. Articles must have content to be analyzed.

    Args:
        limit: Maximum number of articles to analyze (1-50, default 10)
    """
    if limit < 1 or limit > 50:
        raise HTTPException(
            status_code=400,
            detail="limit must be between 1 and 50",
        )

    service = get_bias_detection_service()
    result = await service.analyze_batch(limit=limit)

    return BatchBiasAnalysisResponse(
        success=result["articles_failed"] == 0,
        articles_found=result["articles_found"],
        articles_analyzed=result["articles_analyzed"],
        articles_failed=result["articles_failed"],
        failed_article_ids=result.get("failed_article_ids"),
    )


# Foreign article digest ("Wat schreef …?"): Dutch gist of what foreign articles report
class ArticleDigestResponse(BaseModel):
    """The stored digest of one article."""

    article_id: int
    digest: dict[str, Any]


class ArticleDigestBatchResponse(BaseModel):
    """Statistics of a digest batch; ``pending`` counts what is left for the same age window."""

    articles_found: int
    articles_digested: int
    from_text: int
    from_title: int
    articles_failed: int
    failed_article_ids: list[int] | None = None
    # Set when the batch stopped at a problem of the LLM provider (rate limit, quota, outage)
    stopped: str | None = None
    pending: int


@router.post("/trigger/article-digest/{article_id}", response_model=ArticleDigestResponse)
async def trigger_article_digest(article_id: int):
    """Fetch and digest one article now, also when it already has a digest."""

    try:
        outcome = await get_article_digest_service().digest_article(article_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Article digest failed: {exc}") from exc
    return ArticleDigestResponse(article_id=outcome.article_id, digest=outcome.digest)


@router.post("/trigger/article-digests", response_model=ArticleDigestBatchResponse)
async def trigger_article_digests(limit: int = 10, max_age_hours: int | None = None):
    """Digest foreign articles of news that is not archived, newest first.

    Args:
        limit: Maximum number of articles (1-50, default 10)
        max_age_hours: Only articles added in the last N hours. Leave it out to backfill all
            foreign articles of active news (the scheduled job only takes recent ones).
    """
    if limit < 1 or limit > 50:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 50")
    if max_age_hours is not None and max_age_hours < 1:
        raise HTTPException(status_code=400, detail="max_age_hours must be at least 1")
    stats = await get_article_digest_service().digest_batch(
        limit=limit, max_age_hours=max_age_hours
    )
    return ArticleDigestBatchResponse(**stats)


# Stemmen zoeken (Epic 14, Story 14.10): AI searches for missing voices, queued in the app
@router.post("/trigger/voice-search")
async def trigger_voice_search(limit: int = 2):
    """Run the queued AI searches for missing voices now (the job does this every minute).

    Args:
        limit: Maximum number of queued searches (1-10, default 2)
    """
    if limit < 1 or limit > 10:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 10")
    return await get_voice_search_service().run_pending(limit=limit)


# Exploration endpoints (Epic 11, Story 11.8)
class ExplorationEventResponse(BaseModel):
    """Response for a single-event exploration refresh."""

    event_id: int
    skipped: bool
    reason: str | None = None
    entities_written: int = 0
    relations_written: int = 0
    relations_deleted: int = 0


class ExplorationBackfillResponse(BaseModel):
    """Response for one page of the exploration backfill."""

    processed: int
    entities_written: int
    relations_written: int
    next_offset: int
    done: bool
    skipped: bool = False
    reason: str | None = None
    total_events: int | None = None
    entity_events_refreshed: int | None = None
    skipped_no_title: int | None = None


class ExplorationRefreshResponse(BaseModel):
    """Response for the exploration refresh of all active events."""

    skipped: bool = False
    reason: str | None = None
    active_events: int = 0
    entity_events_refreshed: int = 0
    entities_written: int = 0
    relations_written: int = 0
    relations_deleted: int = 0


class ExplorationStatusResponse(BaseModel):
    """Exploration table counts, last runs and cache statistics."""

    enabled: bool
    event_entities_rows: int
    events_with_entities: int
    entities_last_computed_at: str | None
    event_relations_rows: int
    events_with_relations: int
    relations_last_computed_at: str | None
    last_runs: dict[str, Any]
    cache: dict[str, Any]


@router.post(
    "/trigger/exploration/{event_id}",
    response_model=ExplorationEventResponse,
)
async def trigger_exploration_event(event_id: int):
    """Recompute entities and related events for one event."""

    service = get_exploration_service()
    try:
        result = await service.refresh_for_event(event_id)
    except EventNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Exploration refresh failed: {exc}") from exc
    return ExplorationEventResponse(**{"event_id": event_id, **result})


@router.post(
    "/trigger/exploration-backfill",
    response_model=ExplorationBackfillResponse,
)
async def trigger_exploration_backfill(
    limit: int = 100,
    offset: int = 0,
    include_archived: bool = True,
    force: bool = False,
):
    """Backfill entities + relations for one page of events (ordered by id).

    Repeat with ``offset=next_offset`` until ``done`` is true.

    Args:
        limit: Events per page (1-500)
        offset: Page offset (>= 0)
        include_archived: Also process archived events (default true)
        force: Recompute entities even when they are up to date (needed once to fill
            ``event_entities.article_ids`` of rows written before migration 004 added it)
    """
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")

    service = get_exploration_service()
    result = await service.backfill(
        limit=limit,
        offset=offset,
        include_archived=include_archived,
        force=force,
    )
    return ExplorationBackfillResponse(**result)


@router.post(
    "/trigger/exploration-refresh",
    response_model=ExplorationRefreshResponse,
)
async def trigger_exploration_refresh():
    """Recompute stale entities and related events for all active events."""

    service = get_exploration_service()
    result = await service.refresh_active()
    return ExplorationRefreshResponse(**result)


@router.get("/exploration/status", response_model=ExplorationStatusResponse)
async def exploration_status():
    """Row counts of event_entities/event_relations, last runs and cache statistics."""

    service = get_exploration_service()
    return ExplorationStatusResponse(**await service.status())


# Propagandamodel-koppeling (Epic 11, Story 11.17)
class PropagandaSyncResponse(BaseModel):
    """Response for a propaganda-model sync run."""

    skipped: bool
    reason: str | None = None
    forced: bool = False
    db_path: str | None = None
    db_mtime: str | None = None
    version: str | None = None
    entities: int = 0
    relations: int = 0
    sources: int = 0
    aliases: int = 0


class PropagandaStatusResponse(BaseModel):
    """Propaganda-model sync configuration, file state, last sync and table counts."""

    enabled: bool
    db_path: str
    db_exists: bool
    db_mtime: str | None
    interval_minutes: int
    synced: dict[str, str]
    up_to_date: bool
    counts: dict[str, int]
    last_run: dict[str, Any] | None


@router.post("/trigger/propagandamodel-sync", response_model=PropagandaSyncResponse)
async def trigger_propagandamodel_sync(force: bool = False):
    """Sync the approved propaganda-model graph to the pm_* tables.

    Skips when the database file did not change since the last sync, unless ``force=true``.
    Returns 409 when the pm_* tables are not secured yet (run migration 005 first).
    """

    service = get_propaganda_sync_service()
    try:
        result = await service.sync(force=force)
    except UnsecuredTargetError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Propaganda-model sync failed: {exc}") from exc
    return PropagandaSyncResponse(**result)


@router.get("/propagandamodel/status", response_model=PropagandaStatusResponse)
async def propagandamodel_status():
    """Configuration, database file state, last sync metadata, row counts and last run."""

    service = get_propaganda_sync_service()
    return PropagandaStatusResponse(**await service.status())


# Wie is dit? (Epic 12): research of named entities by the propaganda-model agents
class EntityResearchCycleResponse(BaseModel):
    """Outcome of one entity research cycle (status, triage, queue, round)."""

    skipped: bool
    reason: str | None = None
    status: dict[str, Any] | None = None
    triage: dict[str, Any] | None = None
    enqueue: dict[str, Any] | None = None
    round_started: bool = False


class EntityResearchKeyResponse(BaseModel):
    """Outcome of researching one name now."""

    key: str
    found: bool
    status: str | None = None
    status_reason: str | None = None
    role_category: str | None = None
    priority: float | None = None
    reason: str | None = None
    triage: dict[str, Any] | None = None
    enqueue: dict[str, Any] | None = None
    round_started: bool = False


class EntityResearchStatusResponse(BaseModel):
    """Queue counts, daily budgets, the research agent, LinkedIn brake and last runs."""

    enabled: bool
    pm_db: str
    pm_db_exists: bool
    pm_server: bool
    pm_token_present: bool
    counts: dict[str, int]
    budget: dict[str, int]
    runner: dict[str, Any]
    linkedin: dict[str, Any] | None = None
    last_runs: dict[str, Any]
    watermark: str | None = None


@router.post("/trigger/entity-research", response_model=EntityResearchCycleResponse)
async def trigger_entity_research():
    """Run one cycle now: pull the research status, triage names, queue targets, start a round."""

    try:
        result = await get_entity_research_service().run_cycle()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Entity research failed: {exc}") from exc
    return EntityResearchCycleResponse(**result)


@router.post("/trigger/entity-research/{key}", response_model=EntityResearchKeyResponse)
async def trigger_entity_research_key(key: str):
    """Assess one name now (e.g. ``person:dilan-yesilgoz``) and queue it, ignoring budgets and
    cooldown. Private persons and names that are not in the news are still never researched."""

    if ":" not in key or key.partition(":")[0] not in ("person", "org", "actor"):
        raise HTTPException(
            status_code=400, detail="Key must be person:<slug>, org:<slug> or actor:<slug>"
        )
    try:
        result = await get_entity_research_service().research_key(key)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Entity research failed: {exc}") from exc
    if not result.get("found"):
        raise HTTPException(status_code=404, detail=result.get("reason") or "Name not found")
    return EntityResearchKeyResponse(**result)


@router.get("/entity-research/status", response_model=EntityResearchStatusResponse)
async def entity_research_status():
    """Queue counts, budgets, the nieuws-scout runner, LinkedIn brake and the last runs."""

    return EntityResearchStatusResponse(**await get_entity_research_service().status())


class EvidenceResearchCycleResponse(BaseModel):
    """Outcome of one evidence research cycle (status, queue, round) - Story 14.13."""

    skipped: bool
    reason: str | None = None
    status: dict[str, Any] | None = None
    enqueue: dict[str, Any] | None = None
    round_started: bool = False


class EvidenceResearchRelationResponse(BaseModel):
    """Outcome of queueing one link for evidence research now."""

    relation_id: int
    found: bool
    reason: str | None = None
    label: str | None = None
    evidence: str | None = None
    missing: list[str] = []
    status: str | None = None
    enqueue: dict[str, Any] | None = None
    round_started: bool = False


class EvidenceResearchStatusResponse(BaseModel):
    """Queue counts, daily budget, the nieuws-bewijs runner and the last runs."""

    enabled: bool
    rounds_enabled: bool
    pm_db: str
    pm_db_exists: bool
    pm_server: bool
    counts: dict[str, int]
    budget: dict[str, int]
    runner: dict[str, Any]
    last_runs: dict[str, Any]


@router.post("/trigger/evidence-research", response_model=EvidenceResearchCycleResponse)
async def trigger_evidence_research():
    """Run one evidence research cycle now: pull the status, queue requested thin links, start a
    round of the pm agent nieuws-bewijs (only when NIEUWS_BEWIJS_ENABLED)."""

    try:
        result = await get_evidence_research_service().run_cycle()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Evidence research failed: {exc}") from exc
    return EvidenceResearchCycleResponse(**result)


@router.post(
    "/trigger/evidence-research/{relation_id}", response_model=EvidenceResearchRelationResponse
)
async def trigger_evidence_research_relation(relation_id: int):
    """Queue one propaganda-model link for evidence research now (ignores the budget and the
    cooldown); a round starts only when NIEUWS_BEWIJS_ENABLED."""

    try:
        result = await get_evidence_research_service().research_relation(relation_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Evidence research failed: {exc}") from exc
    if not result.get("found"):
        raise HTTPException(status_code=404, detail=result.get("reason") or "Link not found")
    return EvidenceResearchRelationResponse(**result)


@router.get("/evidence-research/status", response_model=EvidenceResearchStatusResponse)
async def evidence_research_status():
    """Queue counts, budget, the nieuws-bewijs runner and the last runs (Story 14.13)."""

    return EvidenceResearchStatusResponse(**await get_evidence_research_service().status())
