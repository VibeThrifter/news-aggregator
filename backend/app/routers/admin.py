"""Admin endpoints for manual job triggers and system status."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.app.core.scheduler import get_scheduler
from backend.app.services.enrich_service import ArticleEnrichmentService
from backend.app.services.event_service import EventService
from backend.app.services.insight_service import InsightGenerationOutcome, InsightService
from backend.app.services.international_enrichment import (
    get_international_enrichment_service,
)
from backend.app.services.llm_config_service import get_llm_config_service
from backend.app.services.source_service import get_source_service

router = APIRouter(prefix="/admin", tags=["admin"])


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
async def trigger_assign_events():
    """Manually trigger event assignment for enriched articles without events."""
    event_service = EventService()
    result = await event_service.assign_orphaned_articles()
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


def _json_api_error(status_code: int, *, code: str, message: str, details: Any | None = None) -> JSONResponse:
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
