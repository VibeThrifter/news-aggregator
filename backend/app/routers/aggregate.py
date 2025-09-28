from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.app.core.orchestrator import build_aggregation
from backend.app.models import AggregateRequest, AggregationResponse

router = APIRouter(prefix="/api", tags=["aggregation"])


@router.post("/news360", response_model=AggregationResponse)
async def aggregate_news(payload: AggregateRequest) -> AggregationResponse:
    try:
        return await build_aggregation(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
