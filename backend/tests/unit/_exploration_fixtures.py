"""Shared helpers for the exploration tests (Story 11.8). Not collected by pytest."""

from __future__ import annotations

import importlib
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from types import ModuleType
from typing import Any

from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from backend.app.core.config import Settings
from backend.app.db.models import Article, Base, Event, EventArticle, LLMInsight

BASE_TIME = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
DIM = 64  # smallest embedding_dimension allowed by Settings


def make_settings(**overrides: Any) -> Settings:
    """Settings without reading the developer's .env file."""

    overrides.setdefault("embedding_dimension", DIM)
    return Settings(_env_file=None, **overrides)


async def make_session_factory() -> tuple[async_sessionmaker, AsyncEngine]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False), engine


def unit_vector(*components: float, dim: int = DIM) -> list[float]:
    values = list(components) + [0.0] * (dim - len(components))
    return values[:dim]


def mention(text: str, label: str) -> dict[str, Any]:
    return {"text": text, "label": label, "start": 0, "end": len(text)}


@dataclass
class SeedArticle:
    source_name: str
    entities: list[dict[str, Any]] = field(default_factory=list)
    is_international: bool = False


_counter = {"article": 0}


async def seed_event(
    factory: async_sessionmaker,
    *,
    slug: str,
    llm_title: str | None = "Een titel",
    articles: Sequence[SeedArticle] = (),
    embedding: list[float] | None = None,
    countries: list[str] | None = None,
    event_type: str | None = "politics",
    archived: bool = False,
    last_updated_at: datetime | None = None,
    event_title: str = "Artikelkop die nooit getoond mag worden",
) -> int:
    """Insert an event with articles and (optionally) an LLM insight whose summary has a title."""

    updated = last_updated_at or BASE_TIME
    async with factory() as session:
        event_row = Event(
            slug=slug,
            title=event_title,
            description="Beschrijving uit artikelen",
            centroid_embedding=embedding,
            detected_countries=countries,
            event_type=event_type,
            article_count=len(articles),
            first_seen_at=updated - timedelta(days=1),
            last_updated_at=updated,
            archived_at=updated if archived else None,
        )
        session.add(event_row)
        await session.flush()
        for item in articles:
            _counter["article"] += 1
            number = _counter["article"]
            article = Article(
                guid=f"guid-{number}",
                url=f"https://example.com/{number}",
                title=f"Artikel {number}",
                content="Inhoud",
                source_name=item.source_name,
                entities=item.entities,
                is_international=item.is_international,
            )
            session.add(article)
            await session.flush()
            session.add(EventArticle(event_id=event_row.id, article_id=article.id))
        if llm_title is not None:
            session.add(
                LLMInsight(
                    event_id=event_row.id,
                    provider="mistral",
                    model="mistral-small-latest",
                    summary=f"{llm_title}\n\nDe samenvatting van het event.",
                    generated_at=updated,
                )
            )
        await session.commit()
        return event_row.id


async def event_timestamps(factory: async_sessionmaker) -> dict[int, tuple[Any, ...]]:
    async with factory() as session:
        rows = await session.execute(
            select(Event.id, Event.last_updated_at, Event.title, Event.archived_at)
        )
        return {row[0]: tuple(row[1:]) for row in rows.all()}


class StatementRecorder:
    """Record every SQL statement executed on an engine."""

    def __init__(self, engine: AsyncEngine) -> None:
        self.statements: list[str] = []
        event.listen(engine.sync_engine, "before_cursor_execute", self._record)

    def _record(self, conn, cursor, statement, parameters, context, executemany) -> None:
        self.statements.append(" ".join(statement.split()))

    def updates_on(self, table: str) -> list[str]:
        prefix = f"UPDATE {table} "
        return [stmt for stmt in self.statements if stmt.upper().startswith(prefix.upper())]


def real_module(name: str) -> ModuleType:
    """Return the real module even if another test stubbed it in ``sys.modules``."""

    module = sys.modules.get(name)
    if module is None or getattr(module, "__file__", None) is None:
        sys.modules.pop(name, None)
        module = importlib.import_module(name)
    return module
