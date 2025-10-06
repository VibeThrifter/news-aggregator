"""Admin endpoints for manual job triggers and system status."""

from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.app.core.scheduler import get_scheduler
from backend.app.services.enrich_service import ArticleEnrichmentService
from backend.app.services.insight_service import InsightGenerationOutcome, InsightService

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


def _build_links(event_id: int) -> Dict[str, str]:
    base_id = str(event_id)
    return {
        "self": f"/admin/trigger/generate-insights/{base_id}",
        "event": f"/api/v1/events/{base_id}",
        "insights": f"/api/v1/insights/{base_id}",
    }


def _build_data_envelope(result: InsightGenerationOutcome) -> Dict[str, Any]:
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


def _build_meta(result: InsightGenerationOutcome) -> Dict[str, Any]:
    meta: Dict[str, Any] = {
        "provider": result.llm_result.provider,
        "model": result.llm_result.model,
        "message": "Insights-run gestart" if result.created else "Bestaande insights geüpdatet",
    }
    if result.llm_result.usage:
        meta["usage"] = result.llm_result.usage
    return meta


def _json_api_error(status_code: int, *, code: str, message: str, details: Any | None = None) -> JSONResponse:
    content: Dict[str, Any] = {"error": {"code": code, "message": message}}
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
