"""
Health endpoint with detailed component checks for monitoring.

Story 5.1: Enhanced health endpoint with database, vector index, LLM config,
and scheduler status checks. Returns 200 when all healthy, 503 on failures.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import text

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.core.scheduler import get_scheduler
from backend.app.db.session import get_engine

logger = get_logger(__name__)

router = APIRouter(tags=["health"])


async def check_database() -> Dict[str, Any]:
    """
    Check database connectivity.

    Returns:
        Dict with status, message, and optional error details
    """
    try:
        engine = get_engine()
        # Quick connection test with timeout
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {
            "status": "healthy",
            "message": "Database connection successful"
        }
    except Exception as exc:
        logger.error("health_check_database_failed", error=str(exc))
        return {
            "status": "unhealthy",
            "message": "Database connection failed",
            "error": str(exc)
        }


def check_vector_index() -> Dict[str, Any]:
    """
    Check if vector index file exists.

    Returns:
        Dict with status, message, and file path
    """
    try:
        settings = get_settings()
        index_path = Path(settings.vector_index_path)

        if index_path.exists():
            file_size = index_path.stat().st_size
            return {
                "status": "healthy",
                "message": "Vector index file exists",
                "path": str(index_path),
                "size_bytes": file_size
            }
        else:
            return {
                "status": "warning",
                "message": "Vector index file not found (will be created on first use)",
                "path": str(index_path)
            }
    except Exception as exc:
        logger.error("health_check_vector_index_failed", error=str(exc))
        return {
            "status": "unhealthy",
            "message": "Vector index check failed",
            "error": str(exc)
        }


def check_llm_config() -> Dict[str, Any]:
    """
    Check if LLM API keys are configured.

    Returns:
        Dict with status, message, and configured providers
    """
    try:
        settings = get_settings()
        configured_providers = []

        if settings.mistral_api_key:
            configured_providers.append("mistral")
        if settings.openai_api_key:
            configured_providers.append("openai")

        if configured_providers:
            return {
                "status": "healthy",
                "message": "LLM API keys configured",
                "providers": configured_providers,
                "active_provider": settings.llm_provider
            }
        else:
            return {
                "status": "warning",
                "message": "No LLM API keys configured",
                "providers": []
            }
    except Exception as exc:
        logger.error("health_check_llm_config_failed", error=str(exc))
        return {
            "status": "unhealthy",
            "message": "LLM config check failed",
            "error": str(exc)
        }


def check_scheduler() -> Dict[str, Any]:
    """
    Check scheduler status.

    Returns:
        Dict with status, message, and job details
    """
    try:
        scheduler = get_scheduler()
        job_status = scheduler.get_job_status()

        # Check if scheduler is running
        is_running = job_status.get("status") == "running"

        if is_running:
            return {
                "status": "healthy",
                "message": "Scheduler is running",
                "jobs": job_status.get("jobs", {})
            }
        else:
            return {
                "status": "unhealthy",
                "message": "Scheduler is not running",
                "jobs": job_status.get("jobs", {})
            }
    except Exception as exc:
        logger.error("health_check_scheduler_failed", error=str(exc))
        return {
            "status": "unhealthy",
            "message": "Scheduler check failed",
            "error": str(exc)
        }


@router.get("/health", status_code=status.HTTP_200_OK)
async def health_check() -> JSONResponse:
    """
    Comprehensive health check endpoint.

    Returns 200 when all components are healthy, 503 when any component fails.
    Includes checks for: database, vector index, LLM config, scheduler, system info.

    Story 5.1: Enhanced health endpoint with detailed component status.
    """
    start_time = datetime.utcnow()

    # Run all health checks
    db_check = await check_database()
    vector_check = check_vector_index()
    llm_check = check_llm_config()
    scheduler_check = check_scheduler()

    # Determine overall health status
    checks = [db_check, vector_check, llm_check, scheduler_check]
    unhealthy_checks = [c for c in checks if c.get("status") == "unhealthy"]
    warning_checks = [c for c in checks if c.get("status") == "warning"]

    # Overall status: healthy if no unhealthy, degraded if warnings, unhealthy otherwise
    if unhealthy_checks:
        overall_status = "unhealthy"
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    elif warning_checks:
        overall_status = "degraded"
        status_code = status.HTTP_200_OK
    else:
        overall_status = "healthy"
        status_code = status.HTTP_200_OK

    # Calculate response time
    end_time = datetime.utcnow()
    response_time_ms = (end_time - start_time).total_seconds() * 1000

    # Build response
    response_data = {
        "status": overall_status,
        "timestamp": datetime.utcnow().isoformat(),
        "response_time_ms": round(response_time_ms, 2),
        "version": {
            "app": "0.1.0",
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        },
        "components": {
            "database": db_check,
            "vector_index": vector_check,
            "llm_config": llm_check,
            "scheduler": scheduler_check
        }
    }

    # Log health check result
    logger.info(
        "health_check_completed",
        overall_status=overall_status,
        response_time_ms=response_time_ms,
        unhealthy_count=len(unhealthy_checks),
        warning_count=len(warning_checks)
    )

    return JSONResponse(
        status_code=status_code,
        content=response_data
    )
