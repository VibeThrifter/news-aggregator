"""CSV export helpers for events and insights."""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Sequence

from sqlalchemy import Select, and_, outerjoin, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Event, LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.repositories import InsightRepository

logger = get_logger(__name__).bind(component="ExportService")

DEFAULT_EXPORT_DIR = Path("data/exports")


class ExportService:
    """Generate CSV exports for events and related insights."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        export_dir: Path | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.session_factory = session_factory or get_sessionmaker()
        self.export_dir = (export_dir or DEFAULT_EXPORT_DIR).resolve()
        self.settings = settings or get_settings()
        self.provider = (self.settings.llm_provider or "mistral").lower()
        self.export_dir.mkdir(parents=True, exist_ok=True)

    async def generate_events_csv(self) -> Path:
        """Create a CSV summarising all events and return the file path."""

        async with self.session_factory() as session:
            rows = await self._gather_event_summary_rows(session)

        filename = self._timestamped_filename(prefix="events")
        path = self.export_dir / filename
        fieldnames = [
            "event_id",
            "slug",
            "title",
            "description",
            "first_seen_at",
            "last_updated_at",
            "article_count",
            "spectrum_distribution",
            "insight_provider",
            "insight_model",
            "insight_generated_at",
        ]
        self._write_csv(path, fieldnames, rows)
        logger.info("events_csv_generated", path=str(path), row_count=len(rows))
        return path

    async def generate_event_detail_csv(self, event_id: int) -> Path:
        """Create a CSV with detailed insight rows for a single event."""

        async with self.session_factory() as session:
            event = await session.get(Event, event_id)
            if event is None:
                raise ValueError(f"Event {event_id} niet gevonden")

            insight_repo = InsightRepository(session)
            insight = await insight_repo.get_by_event_and_provider(event_id, provider=self.provider)
            if insight is None:
                insight = await self._get_latest_insight(session, event_id)
            rows = self._build_event_detail_rows(event, insight)

        filename = self._timestamped_filename(prefix=f"event_{event_id}")
        path = self.export_dir / filename
        fieldnames = [
            "row_type",
            "event_id",
            "title",
            "time",
            "label",
            "summary",
            "spectrum",
            "source_types",
            "characteristics",
            "sources",
            "claim_a_summary",
            "claim_a_spectrum",
            "claim_a_sources",
            "claim_b_summary",
            "claim_b_spectrum",
            "claim_b_sources",
            "verification",
            "description",
        ]
        self._write_csv(path, fieldnames, rows)
        logger.info(
            "event_csv_generated",
            path=str(path),
            event_id=event_id,
            row_count=len(rows),
        )
        return path

    async def _gather_event_summary_rows(self, session: AsyncSession) -> List[dict[str, str]]:
        stmt: Select = (
            select(
                Event.id,
                Event.slug,
                Event.title,
                Event.description,
                Event.first_seen_at,
                Event.last_updated_at,
                Event.article_count,
                Event.spectrum_distribution,
                LLMInsight.provider,
                LLMInsight.model,
                LLMInsight.generated_at,
            )
            .select_from(
                outerjoin(
                    Event,
                    LLMInsight,
                    and_(
                        Event.id == LLMInsight.event_id,
                        LLMInsight.provider == self.provider,
                    ),
                )
            )
            .where(Event.archived_at.is_(None))
            .order_by(Event.last_updated_at.desc())
        )
        result = await session.execute(stmt)
        rows: List[dict[str, str]] = []
        for (
            event_id,
            slug,
            title,
            description,
            first_seen,
            last_updated,
            article_count,
            spectrum_distribution,
            provider,
            model,
            generated_at,
        ) in result.all():
            rows.append(
                {
                    "event_id": str(event_id),
                    "slug": slug or "",
                    "title": title or "",
                    "description": description or "",
                    "first_seen_at": first_seen.isoformat() if first_seen else "",
                    "last_updated_at": last_updated.isoformat() if last_updated else "",
                    "article_count": str(article_count or 0),
                    "spectrum_distribution": self._encode_json(spectrum_distribution),
                    "insight_provider": provider or "",
                    "insight_model": model or "",
                    "insight_generated_at": generated_at.isoformat() if generated_at else "",
                }
            )
        return rows

    def _build_event_detail_rows(
        self,
        event: Event,
        insight: LLMInsight | None,
    ) -> List[dict[str, str]]:
        rows: List[dict[str, str]] = []
        rows.append(
            {
                "row_type": "event",
                "event_id": str(event.id),
                "title": event.title or "",
                "time": "",
                "label": "",
                "summary": event.description or "",
                "spectrum": self._encode_json(event.spectrum_distribution),
                "source_types": "",
                "characteristics": "",
                "sources": "",
                "claim_a_summary": "",
                "claim_a_spectrum": "",
                "claim_a_sources": "",
                "claim_b_summary": "",
                "claim_b_spectrum": "",
                "claim_b_sources": "",
                "verification": "",
                "description": "",
            }
        )

        if insight is None:
            return rows

        rows.append(
            {
                "row_type": "insight",
                "event_id": str(event.id),
                "title": event.title or "",
                "time": insight.generated_at.isoformat() if insight.generated_at else "",
                "label": "LLM samenvatting",
                "summary": f"Provider: {insight.provider} | Model: {insight.model}",
                "spectrum": "",
                "source_types": "",
                "characteristics": "",
                "sources": "",
                "claim_a_summary": "",
                "claim_a_spectrum": "",
                "claim_a_sources": "",
                "claim_b_summary": "",
                "claim_b_spectrum": "",
                "claim_b_sources": "",
                "verification": "",
                "description": "",
            }
        )

        timeline = insight.timeline or []
        for item in timeline:
            rows.append(
                {
                    "row_type": "timeline",
                    "event_id": str(event.id),
                    "title": event.title or "",
                    "time": self._safe_get(item, "time"),
                    "label": self._safe_get(item, "headline"),
                    "summary": self._safe_get(item, "headline"),
                    "spectrum": self._safe_get(item, "spectrum"),
                    "source_types": "",
                    "characteristics": "",
                    "sources": self._join_list(item.get("sources", [])),
                    "claim_a_summary": "",
                    "claim_a_spectrum": "",
                    "claim_a_sources": "",
                    "claim_b_summary": "",
                    "claim_b_spectrum": "",
                    "claim_b_sources": "",
                    "verification": "",
                    "description": "",
                }
            )

        clusters = insight.clusters or []
        for cluster in clusters:
            rows.append(
                {
                    "row_type": "cluster",
                    "event_id": str(event.id),
                    "title": event.title or "",
                    "time": "",
                    "label": self._safe_get(cluster, "label"),
                    "summary": self._safe_get(cluster, "summary"),
                    "spectrum": self._safe_get(cluster, "spectrum"),
                    "source_types": self._join_list(cluster.get("source_types", [])),
                    "characteristics": self._join_list(cluster.get("characteristics", [])),
                    "sources": self._format_cluster_sources(cluster.get("sources", [])),
                    "claim_a_summary": "",
                    "claim_a_spectrum": "",
                    "claim_a_sources": "",
                    "claim_b_summary": "",
                    "claim_b_spectrum": "",
                    "claim_b_sources": "",
                    "verification": "",
                    "description": "",
                }
            )

        contradictions = insight.contradictions or []
        for item in contradictions:
            claim_a = item.get("claim_a", {})
            claim_b = item.get("claim_b", {})
            rows.append(
                {
                    "row_type": "contradiction",
                    "event_id": str(event.id),
                    "title": event.title or "",
                    "time": "",
                    "label": self._safe_get(item, "topic"),
                    "summary": self._safe_get(item, "topic"),
                    "spectrum": "",
                    "source_types": "",
                    "characteristics": "",
                    "sources": "",
                    "claim_a_summary": self._safe_get(claim_a, "summary"),
                    "claim_a_spectrum": self._safe_get(claim_a, "spectrum"),
                    "claim_a_sources": self._join_list(claim_a.get("sources", [])),
                    "claim_b_summary": self._safe_get(claim_b, "summary"),
                    "claim_b_spectrum": self._safe_get(claim_b, "spectrum"),
                    "claim_b_sources": self._join_list(claim_b.get("sources", [])),
                    "verification": self._safe_get(item, "verification"),
                    "description": "",
                }
            )

        fallacies = insight.fallacies or []
        for item in fallacies:
            rows.append(
                {
                    "row_type": "fallacy",
                    "event_id": str(event.id),
                    "title": event.title or "",
                    "time": "",
                    "label": self._safe_get(item, "type"),
                    "summary": self._safe_get(item, "description"),
                    "spectrum": self._safe_get(item, "spectrum"),
                    "source_types": "",
                    "characteristics": "",
                    "sources": self._join_list(item.get("sources", [])),
                    "claim_a_summary": "",
                    "claim_a_spectrum": "",
                    "claim_a_sources": "",
                    "claim_b_summary": "",
                    "claim_b_spectrum": "",
                    "claim_b_sources": "",
                    "verification": "",
                    "description": "",
                }
            )

        return rows

    async def _get_latest_insight(self, session: AsyncSession, event_id: int) -> LLMInsight | None:
        stmt = (
            select(LLMInsight)
            .where(LLMInsight.event_id == event_id)
            .order_by(LLMInsight.generated_at.desc())
        )
        result = await session.execute(stmt)
        return result.scalars().first()

    @staticmethod
    def _write_csv(path: Path, fieldnames: Sequence[str], rows: Iterable[dict[str, str]]) -> None:
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow(row)

    @staticmethod
    def _safe_get(payload: dict, key: str) -> str:
        value = payload.get(key) if isinstance(payload, dict) else None
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value) if value is not None else ""

    @staticmethod
    def _join_list(values: Sequence[str]) -> str:
        if not values:
            return ""
        return "; ".join(str(item) for item in values)

    @staticmethod
    def _encode_json(data: object) -> str:
        if data is None:
            return ""
        try:
            return json.dumps(data, ensure_ascii=False, sort_keys=True)
        except TypeError:
            return str(data)

    @staticmethod
    def _format_cluster_sources(sources: Sequence[dict]) -> str:
        formatted: List[str] = []
        for source in sources or []:
            if not isinstance(source, dict):
                continue
            title = source.get("title") or source.get("url") or ""
            url = source.get("url") or ""
            spectrum = source.get("spectrum") or ""
            formatted.append(f"{title} [{spectrum}] ({url})".strip())
        return "; ".join(filter(None, formatted))

    @staticmethod
    def _timestamped_filename(prefix: str) -> str:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        return f"{prefix}_{timestamp}.csv"


__all__ = ["ExportService"]
