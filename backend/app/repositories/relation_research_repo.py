"""Repository for ``relation_research`` and the news context of a research target (Story 14.13).

``relation_research`` is a derived table in the primary database (never dual-written to the
SQLite cache). The events and articles that give the research agent its context are read
through the read session.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.models import Article, Event, EventArticle, RelationResearch

ARTICLES_PER_EVENT = 8


class RelationResearchRepository:
    """Reads/writes ``relation_research`` (primary database)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_many(self, relation_ids: Iterable[int]) -> dict[int, RelationResearch]:
        wanted = sorted({int(i) for i in relation_ids})
        if not wanted:
            return {}
        result = await self.session.execute(
            select(RelationResearch).where(RelationResearch.relation_id.in_(wanted))
        )
        return {row.relation_id: row for row in result.scalars()}

    async def upsert(self, relation_id: int, values: Mapping[str, Any]) -> RelationResearch:
        """Insert or update one row (ORM, dialect independent). Caller commits."""

        row = await self.session.get(RelationResearch, relation_id)
        if row is None:
            row = RelationResearch(relation_id=relation_id)
            self.session.add(row)
        for field, value in values.items():
            setattr(row, field, value)
        return row

    async def by_status(
        self, statuses: Sequence[str], limit: int | None = None
    ) -> list[RelationResearch]:
        query = (
            select(RelationResearch)
            .where(RelationResearch.status.in_(tuple(statuses)))
            .order_by(
                RelationResearch.requested_count.desc(),
                RelationResearch.last_requested_at.desc(),
                RelationResearch.relation_id,
            )
        )
        if limit is not None:
            query = query.limit(limit)
        return list((await self.session.execute(query)).scalars())

    async def count_queued_since(self, since: datetime) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(RelationResearch)
            .where(RelationResearch.queued_at >= since)
        )
        return int(result.scalar_one())

    async def counts_by_status(self) -> dict[str, int]:
        result = await self.session.execute(
            select(RelationResearch.status, func.count()).group_by(RelationResearch.status)
        )
        return {status: int(count) for status, count in result.all()}


async def event_context(session: AsyncSession, slugs: Sequence[str]) -> list[dict[str, Any]]:
    """[{slug, titel, artikelen: [{url, bron, titel, datum}]}] for the given event slugs, in that
    order (unknown slugs are left out). Newest articles first, at most 8 per event."""

    wanted = [slug for slug in dict.fromkeys(slugs) if slug]
    if not wanted:
        return []
    events = {
        row.slug: row
        for row in (
            await session.execute(select(Event.id, Event.slug, Event.title).where(
                Event.slug.in_(wanted)
            ))
        ).all()
    }
    if not events:
        return []
    by_event: dict[int, list[dict[str, Any]]] = {row.id: [] for row in events.values()}
    result = await session.execute(
        select(
            EventArticle.event_id,
            Article.url,
            Article.source_name,
            Article.title,
            Article.published_at,
        )
        .join(Article, Article.id == EventArticle.article_id)
        .where(EventArticle.event_id.in_(list(by_event)))
        .order_by(Article.published_at.desc().nulls_last(), Article.id.desc())
    )
    for row in result.all():
        articles = by_event[row.event_id]
        if len(articles) < ARTICLES_PER_EVENT:
            articles.append(
                {
                    "url": row.url,
                    "bron": row.source_name,
                    "titel": row.title,
                    "datum": row.published_at.isoformat() if row.published_at else None,
                }
            )
    return [
        {"slug": slug, "titel": events[slug].title, "artikelen": by_event[events[slug].id]}
        for slug in wanted
        if slug in events
    ]


__all__ = ["ARTICLES_PER_EVENT", "RelationResearchRepository", "event_context"]
