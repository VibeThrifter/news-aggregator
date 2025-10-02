from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from backend.app.core.config import Settings
from backend.app.db.models import Base, Event, LLMInsight
from backend.app.main import app
from backend.app.routers.exports import get_export_service
from backend.app.services.export_service import ExportService


async def _prepare_session(tmp_path: Path) -> tuple[AsyncEngine, async_sessionmaker, ExportService, datetime]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    service = ExportService(
        session_factory=session_factory,
        export_dir=tmp_path,
        settings=Settings(mistral_api_key="dummy-key", llm_provider="mistral"),
    )
    return engine, session_factory, service, datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_export_events_endpoint_returns_csv(tmp_path: Path) -> None:
    engine, session_factory, service, now = await _prepare_session(tmp_path)

    async with session_factory() as session:
        event = Event(
            slug="malieveld-protest",
            title="Malieveld protest",
            description="Grote demonstratie",
            first_seen_at=now,
            last_updated_at=now,
            article_count=4,
            spectrum_distribution={"mainstream": 3, "alternatief": 1},
        )
        session.add(event)
        await session.commit()

    app.dependency_overrides[get_export_service] = lambda: service
    try:
        async with httpx.AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/v1/exports/events")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "Malieveld protest" in response.text
    finally:
        app.dependency_overrides.pop(get_export_service, None)
        await engine.dispose()


@pytest.mark.asyncio
async def test_export_event_detail_includes_insight_data(tmp_path: Path) -> None:
    engine, session_factory, service, now = await _prepare_session(tmp_path)

    async with session_factory() as session:
        event = Event(
            slug="energie-debat",
            title="Energie debat",
            description="Discussie over energieprijzen",
            first_seen_at=now,
            last_updated_at=now,
            article_count=2,
            spectrum_distribution={"links": 1, "rechts": 1},
        )
        session.add(event)
        await session.flush()

        insight = LLMInsight(
            event_id=event.id,
            provider="mistral",
            model="mistral-small-latest",
            prompt_metadata={"selected_article_ids": [1, 2]},
            timeline=[
                {
                    "time": "2024-02-01T08:00:00+00:00",
                    "headline": "Kabinet kondigt overleg aan",
                    "sources": ["https://example.com/a"],
                    "spectrum": "mainstream",
                }
            ],
            clusters=[
                {
                    "label": "Publieke omroep",
                    "spectrum": "mainstream",
                    "summary": "NOS en RTL focussen op koopkracht.",
                    "source_types": ["public_broadcaster"],
                    "characteristics": ["economisch"],
                    "sources": [
                        {
                            "title": "NOS nieuws",
                            "url": "https://example.com/a",
                            "spectrum": "center",
                            "stance": "neutraal",
                        }
                    ],
                }
            ],
            contradictions=[
                {
                    "topic": "Kostenplaatje",
                    "claim_a": {
                        "summary": "Oppositie spreekt van lastenverzwaring",
                        "sources": ["https://example.com/b"],
                        "spectrum": "links",
                    },
                    "claim_b": {
                        "summary": "Kabinet benadrukt koopkrachtstijging",
                        "sources": ["https://example.com/c"],
                        "spectrum": "rechts",
                    },
                    "verification": "onbevestigd",
                }
            ],
            fallacies=[
                {
                    "type": "stroman",
                    "description": "Kabinet zou oppositie woorden in de mond leggen.",
                    "sources": ["https://example.com/d"],
                    "spectrum": "rechts",
                }
            ],
            raw_response=json.dumps({}),
            generated_at=now,
        )
        session.add(insight)
        await session.commit()
        event_id = event.id

    app.dependency_overrides[get_export_service] = lambda: service
    try:
        async with httpx.AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(f"/api/v1/exports/events/{event_id}")
        assert response.status_code == 200
        assert "Kabinet kondigt overleg aan" in response.text
        assert "Oppositie spreekt van lastenverzwaring" in response.text
    finally:
        app.dependency_overrides.pop(get_export_service, None)
        await engine.dispose()
