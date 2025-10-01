"""Admin endpoints for manual job triggers and system status."""

from fastapi import APIRouter
from backend.app.core.scheduler import get_scheduler

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/trigger/maintenance")
async def trigger_maintenance():
    """Manually trigger the event maintenance job."""
    scheduler = get_scheduler()
    result = await scheduler.run_event_maintenance_now()
    return result


@router.get("/scheduler/status")
async def scheduler_status():
    """Get current scheduler status and job information."""
    scheduler = get_scheduler()
    return scheduler.get_job_status()
