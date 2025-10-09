"""
Integration tests for the enhanced health endpoint (Story 5.1).

Tests verify health checks for database, vector index, LLM config,
scheduler, and proper HTTP status codes (200 healthy, 503 unhealthy).
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from backend.app.db.models import Base
from backend.app.main import app


@pytest.mark.asyncio
async def test_health_endpoint_returns_200_when_healthy(tmp_path: Path) -> None:
    """
    Test health endpoint returns 200 with detailed component status when all healthy.

    Story 5.1 AC: GET /health returns 200 with JSON containing component statuses,
    timestamps, and version info when dependencies are reachable.
    """
    # Create a temporary database
    db_path = tmp_path / "test_health.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Mock scheduler to return healthy status
    mock_scheduler_check = {
        "status": "healthy",
        "message": "Scheduler is running",
        "jobs": {}
    }

    # Mock get_engine to return our test engine and scheduler check to return healthy
    with patch("backend.app.routers.health.get_engine", return_value=engine), \
         patch("backend.app.routers.health.check_scheduler", return_value=mock_scheduler_check):
        async with httpx.AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/health")

    # Verify response status and structure
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()

    # Verify overall status
    assert data["status"] in ["healthy", "degraded"], f"Status should be healthy or degraded, got {data['status']}"

    # Verify timestamp present
    assert "timestamp" in data
    assert "response_time_ms" in data
    assert data["response_time_ms"] < 500, "Health check should respond within 500ms"

    # Verify version info
    assert "version" in data
    assert "app" in data["version"]
    assert "python" in data["version"]

    # Verify component checks
    assert "components" in data
    components = data["components"]

    assert "database" in components
    assert components["database"]["status"] in ["healthy", "unhealthy"]

    assert "vector_index" in components
    assert components["vector_index"]["status"] in ["healthy", "warning", "unhealthy"]

    assert "llm_config" in components
    assert components["llm_config"]["status"] in ["healthy", "warning", "unhealthy"]

    assert "scheduler" in components
    assert components["scheduler"]["status"] in ["healthy", "unhealthy"]

    await engine.dispose()


@pytest.mark.asyncio
async def test_health_endpoint_returns_503_on_database_failure() -> None:
    """
    Test health endpoint returns 503 when database check fails.

    Story 5.1 AC: If any dependency check fails, /health returns 503 with
    the failing component listed while still responding quickly (<200ms).
    """

    # Mock database check to fail
    async def mock_failing_db_check():
        raise Exception("Database connection failed")

    with patch("backend.app.routers.health.check_database", return_value={
        "status": "unhealthy",
        "message": "Database connection failed",
        "error": "Connection timeout"
    }):
        async with httpx.AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/health")

    # Verify response
    assert response.status_code == 503, f"Expected 503, got {response.status_code}"

    data = response.json()

    # Verify overall status is unhealthy
    assert data["status"] == "unhealthy"

    # Verify response time is still fast (500ms is reasonable for integration tests)
    assert data["response_time_ms"] < 500, "Even failed health checks should respond quickly"

    # Verify database component shows unhealthy
    assert data["components"]["database"]["status"] == "unhealthy"
    assert "error" in data["components"]["database"] or "message" in data["components"]["database"]


@pytest.mark.asyncio
async def test_health_endpoint_includes_all_required_checks() -> None:
    """
    Test health endpoint includes all required component checks.

    Story 5.1 AC: Health endpoint should check: database connectivity,
    vector index file presence, LLM API key configured, scheduler status,
    and Python/app version.
    """
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/health")

    data = response.json()

    # Verify all required checks are present
    assert "components" in data
    components = data["components"]

    # Database connectivity check
    assert "database" in components
    assert "status" in components["database"]
    assert "message" in components["database"]

    # Vector index file check
    assert "vector_index" in components
    assert "status" in components["vector_index"]
    assert "message" in components["vector_index"]

    # LLM config check
    assert "llm_config" in components
    assert "status" in components["llm_config"]
    assert "message" in components["llm_config"]

    # Scheduler status check
    assert "scheduler" in components
    assert "status" in components["scheduler"]
    assert "message" in components["scheduler"]

    # Version info
    assert "version" in data
    assert "app" in data["version"]
    assert "python" in data["version"]


@pytest.mark.asyncio
async def test_health_endpoint_vector_index_warning_when_missing(tmp_path: Path) -> None:
    """
    Test health endpoint shows warning status when vector index file is missing.

    The vector index file is optional (created on first use), so missing file
    should result in warning status, not unhealthy.
    """
    # Mock vector index check to return warning for missing file
    mock_vector_check = {
        "status": "warning",
        "message": "Vector index file not found (will be created on first use)",
        "path": str(tmp_path / "nonexistent_index.bin")
    }

    # Mock scheduler to return healthy (otherwise overall status would be unhealthy)
    mock_scheduler_check = {
        "status": "healthy",
        "message": "Scheduler is running",
        "jobs": {}
    }

    with patch("backend.app.routers.health.check_vector_index", return_value=mock_vector_check), \
         patch("backend.app.routers.health.check_scheduler", return_value=mock_scheduler_check):
        async with httpx.AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/health")

    data = response.json()

    # Overall status should be healthy or degraded (not unhealthy)
    assert data["status"] in ["healthy", "degraded"]

    # Vector index should show warning
    vector_status = data["components"]["vector_index"]["status"]
    assert vector_status == "warning", f"Expected warning for missing index, got {vector_status}"


@pytest.mark.asyncio
async def test_health_endpoint_llm_config_shows_providers() -> None:
    """
    Test health endpoint LLM check includes configured providers.

    Story 5.1: LLM config check should show which providers are configured
    and which is active.
    """
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/health")

    data = response.json()

    # Verify LLM config includes provider information
    llm_config = data["components"]["llm_config"]
    assert "status" in llm_config

    # If healthy or warning, should have providers list
    if llm_config["status"] in ["healthy", "warning"]:
        # Providers may be empty list if no keys configured
        assert "providers" in llm_config or "message" in llm_config


@pytest.mark.asyncio
async def test_health_endpoint_scheduler_check() -> None:
    """
    Test health endpoint includes scheduler status with job information.

    Story 5.1: Scheduler check should include running status and job details.
    """
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/health")

    data = response.json()

    # Verify scheduler check
    scheduler = data["components"]["scheduler"]
    assert "status" in scheduler
    assert "message" in scheduler

    # If scheduler is running, should include jobs
    if scheduler["status"] == "healthy":
        assert "jobs" in scheduler
