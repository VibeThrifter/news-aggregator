"""API endpoints for CSV exports."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from backend.app.services.export_service import ExportService

router = APIRouter(prefix="/api/v1/exports", tags=["exports"])


def get_export_service() -> ExportService:
    return ExportService()


@router.get("/events", response_class=FileResponse, summary="Download event overview CSV")
async def download_events_csv(
    service: ExportService = Depends(get_export_service),
) -> FileResponse:
    path = await service.generate_events_csv()
    return FileResponse(
        path,
        media_type="text/csv",
        filename=path.name,
    )


@router.get("/events/{event_id}", response_class=FileResponse, summary="Download single event insight CSV")
async def download_event_detail_csv(
    event_id: int,
    service: ExportService = Depends(get_export_service),
) -> FileResponse:
    try:
        path = await service.generate_event_detail_csv(event_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="text/csv",
        filename=path.name,
    )


__all__ = ["router", "get_export_service"]
