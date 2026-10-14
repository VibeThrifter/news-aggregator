"""AI-gebruik in Beheer: the noted LLM calls in the local database, summarised.

``backend/app/llm/usage.py`` notes every call in memory; ``flush`` writes them to ``llm_usage``
(job "LLM Usage", every ``LLM_USAGE_FLUSH_SECONDS``, and at shutdown) and removes calls older than
``LLM_USAGE_RETENTION_DAYS``. ``summary`` is what ``/admin/llm-usage`` returns:

- ``claude``: the subscription's windows as Claude Code last reported them (share used, reset).
  That is the whole subscription: the owner's own Claude Code sessions count too.
- ``periods``: the app's own calls in the current 5-hour window, today and the subscription's
  week, per provider and model and per pipeline step: calls, tokens, Claude's API list price.
- ``gemini``: requests per Gemini model since midnight Pacific time, against the free tier.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import case, delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import LlmUsage
from backend.app.db.session import get_sessionmaker
from backend.app.llm.usage import give_back, latest_limits, take_pending

logger = get_logger(__name__).bind(component="LLMUsageService")

AMSTERDAM = ZoneInfo("Europe/Amsterdam")
# Gemini's daily limits reset at midnight Pacific time
PACIFIC = ZoneInfo("America/Los_Angeles")
# The subscription's windows, in the order of the dashboard
WINDOWS: dict[str, timedelta] = {
    "five_hour": timedelta(hours=5),
    "seven_day": timedelta(days=7),
    "seven_day_sonnet": timedelta(days=7),
    "seven_day_opus": timedelta(days=7),
}
TOKEN_FIELDS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")


def _aware(moment: datetime) -> datetime:
    """SQLite gives naive datetimes back; they are UTC."""

    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _epoch(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc) if value else None
    except (TypeError, ValueError, OverflowError):
        return None


def _fraction(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def claude_windows(limits: Mapping[str, Any] | None, now: datetime) -> dict[str, Any] | None:
    """The subscription's state from Claude Code's ``rate_limit_info``; None before any call.

    ``utilization`` is the share used (0.24 = 24%). A window whose reset has passed since the
    measurement is ``expired``: its share is unknown until the next call.
    """

    if not limits or not isinstance(limits.get("info"), Mapping):
        return None
    info: Mapping[str, Any] = limits["info"]
    raw = info.get("unifiedWindows")
    if not isinstance(raw, Mapping) or not raw:
        kind = info.get("rateLimitType")
        raw = (
            {kind: {"utilization": info["utilization"], "resetsAt": info.get("resetsAt")}}
            if kind and "utilization" in info
            else {}
        )
    windows = []
    for key, value in raw.items():
        if not isinstance(value, Mapping):
            continue
        resets_at = _epoch(value.get("resetsAt"))
        length = WINDOWS.get(key)
        windows.append(
            {
                "key": key,
                "utilization": _fraction(value.get("utilization")),
                "resets_at": resets_at,
                "started_at": resets_at - length if resets_at and length else None,
                "expired": bool(resets_at and resets_at <= now),
            }
        )
    order = list(WINDOWS)
    windows.sort(key=lambda w: order.index(w["key"]) if w["key"] in order else len(order))
    return {
        "measured_at": _aware(limits["at"]),
        # allowed, allowed_warning or rejected (the limit is reached)
        "status": info.get("status"),
        # The window that binds now, and when it lets calls through again
        "limit_type": info.get("rateLimitType"),
        "resets_at": _epoch(info.get("resetsAt")),
        "using_overage": bool(info.get("isUsingOverage")),
        "windows": windows,
    }


def _totals(rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    totals: dict[str, Any] = {"calls": 0, "failed": 0, **{field: 0 for field in TOKEN_FIELDS}}
    cost: float | None = None
    for row in rows:
        for field in ("calls", "failed", *TOKEN_FIELDS):
            totals[field] += int(row[field] or 0)
        if row["cost_usd"] is not None:
            cost = (cost or 0.0) + float(row["cost_usd"])
    totals["tokens"] = sum(totals[field] for field in TOKEN_FIELDS)
    totals["cost_usd"] = round(cost, 4) if cost is not None else None
    return totals


def summarise(rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Totals, per provider and model, and per step, the most tokens first."""

    def grouped(key: tuple[str, ...]) -> list[dict[str, Any]]:
        groups: dict[tuple[Any, ...], list[Mapping[str, Any]]] = {}
        for row in rows:
            groups.setdefault(tuple(row[k] for k in key), []).append(row)
        result = [
            {**dict(zip(key, values, strict=True)), **_totals(members)}
            for values, members in groups.items()
        ]
        return sorted(result, key=lambda g: (-g["tokens"], -g["calls"]))

    return {
        "totals": _totals(rows),
        "models": grouped(("provider", "model")),
        "steps": grouped(("step",)),
    }


class LlmUsageService:
    """Writes the noted LLM calls and summarises them for the admin dashboard."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._session_factory = session_factory
        self.settings = settings or get_settings()

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory or get_sessionmaker()

    async def flush(self) -> int:
        """Write the noted calls and drop the expired ones; the calls stay noted when it fails."""

        rows = take_pending()
        cutoff = datetime.now(timezone.utc) - timedelta(days=self.settings.llm_usage_retention_days)
        try:
            async with self._sessions()() as session:
                if rows:
                    await session.execute(insert(LlmUsage), rows)
                await session.execute(delete(LlmUsage).where(LlmUsage.created_at < cutoff))
                await session.commit()
        except Exception:
            give_back(rows)
            raise
        return len(rows)

    async def _stored_limits(self, session: AsyncSession) -> dict[str, Any] | None:
        """The newest limits in the database (after a restart nothing is in memory)."""

        row = (
            await session.execute(
                select(LlmUsage.created_at, LlmUsage.rate_limit)
                .where(LlmUsage.rate_limit.is_not(None))
                .order_by(LlmUsage.created_at.desc())
                .limit(1)
            )
        ).first()
        return {"at": row.created_at, "info": row.rate_limit} if row else None

    async def _rows(self, session: AsyncSession, since: datetime) -> list[Mapping[str, Any]]:
        failed = func.sum(case((LlmUsage.ok.is_(False), 1), else_=0))
        result = await session.execute(
            select(
                LlmUsage.provider,
                LlmUsage.model,
                LlmUsage.step,
                func.count().label("calls"),
                failed.label("failed"),
                *(func.sum(getattr(LlmUsage, field)).label(field) for field in TOKEN_FIELDS),
                func.sum(LlmUsage.cost_usd).label("cost_usd"),
            )
            .where(LlmUsage.created_at >= since.astimezone(timezone.utc))
            .group_by(LlmUsage.provider, LlmUsage.model, LlmUsage.step)
        )
        return [row._mapping for row in result]

    async def _gemini(self, session: AsyncSession, now: datetime) -> dict[str, Any]:
        """Requests per Gemini model since midnight Pacific time; ``limited``: a 429 today."""

        midnight = now.astimezone(PACIFIC).replace(hour=0, minute=0, second=0, microsecond=0)
        failed = func.sum(case((LlmUsage.ok.is_(False), 1), else_=0))
        result = await session.execute(
            select(LlmUsage.model, func.count().label("calls"), failed.label("failed"))
            .where(
                LlmUsage.provider.like("gemini%"),
                LlmUsage.created_at >= midnight.astimezone(timezone.utc),
            )
            .group_by(LlmUsage.model)
            .order_by(LlmUsage.model)
        )
        models = [
            {
                "model": row.model,
                "requests": int(row.calls) - int(row.failed or 0),
                "limited": bool(row.failed),
            }
            for row in result
        ]
        limit = self.settings.gemini_free_daily_requests
        return {
            "limit": limit or None,
            "resets_at": (midnight + timedelta(days=1)).astimezone(timezone.utc),
            "models": models,
        }

    async def summary(self, *, now: datetime | None = None) -> dict[str, Any]:
        try:
            await self.flush()
        except Exception as exc:  # the summary of what is stored still helps
            logger.warning("llm_usage_flush_failed", error=str(exc)[:300])
        now = now or datetime.now(timezone.utc)
        async with self._sessions()() as session:
            claude = claude_windows(latest_limits() or await self._stored_limits(session), now)
            windows = {window["key"]: window for window in (claude or {}).get("windows", [])}

            def start(key: str, fallback: timedelta) -> tuple[datetime, bool]:
                window = windows.get(key)
                if window and window["started_at"] and not window["expired"]:
                    return window["started_at"], True
                return now - fallback, False

            midnight = now.astimezone(AMSTERDAM).replace(hour=0, minute=0, second=0, microsecond=0)
            today = midnight.astimezone(timezone.utc)
            periods = []
            for key, (since, aligned) in (
                ("five_hour", start("five_hour", WINDOWS["five_hour"])),
                ("today", (today, False)),
                ("seven_day", start("seven_day", WINDOWS["seven_day"])),
            ):
                periods.append(
                    {
                        "key": key,
                        "since": since,
                        # True: the period is the subscription's window itself
                        "subscription_window": aligned,
                        **summarise(await self._rows(session, since)),
                    }
                )
            gemini = await self._gemini(session, now)
        return {"generated_at": now, "claude": claude, "periods": periods, "gemini": gemini}


_service: LlmUsageService | None = None


def get_llm_usage_service() -> LlmUsageService:
    global _service
    if _service is None:
        _service = LlmUsageService()
    return _service


__all__ = ["LlmUsageService", "claude_windows", "get_llm_usage_service", "summarise"]
