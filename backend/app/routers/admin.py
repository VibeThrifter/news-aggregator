"""Admin endpoints for manual job triggers and system status."""

from fastapi import APIRouter, HTTPException
from backend.app.core.scheduler import get_scheduler
from backend.app.services.enrich_service import ArticleEnrichmentService
from backend.app.services.insight_service import InsightService

router = APIRouter(prefix="/admin", tags=["admin"])


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


@router.get("/scheduler/status")
async def scheduler_status():
    """Get current scheduler status and job information."""
    scheduler = get_scheduler()
    return scheduler.get_job_status()


@router.post("/trigger/generate-insights/{event_id}")
async def trigger_generate_insights(event_id: int):
    """Manually trigger LLM insight generation for a specific event."""
    service = InsightService()
    try:
        result = await service.generate_for_event(event_id)
        return {
            "event_id": event_id,
            "created": result.created,
            "provider": result.llm_result.provider,
            "model": result.llm_result.model,
            "usage": result.llm_result.usage,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Insight generation failed: {str(e)}") from e
