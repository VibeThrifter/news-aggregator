"""Supabase: what the website shows (Story INFRA-2).

With ``SUPABASE_DATABASE_URL`` set, ``DATABASE_URL`` is the local working database. The backend
reads and writes there and only:

- publishes what the website shows to Supabase (``services/publish_service.py``), and
- reads what the website writes in Supabase: voice searches, access codes, shared entries and
  research requests.

Without it, Supabase is the one database, as before.
"""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.db.session import get_sessionmaker

logger = get_logger(__name__)

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def supabase_configured() -> bool:
    """Whether the backend works on a local database and publishes to Supabase."""

    return bool(get_settings().supabase_database_url)


def supabase_dsn() -> str:
    """The Supabase connection for asyncpg (LISTEN), without the SQLAlchemy driver prefix."""

    return get_settings().supabase_database_url.replace("postgresql+asyncpg://", "postgresql://")


def get_supabase_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Sessions on Supabase (a small pool: the pooler allows 15 clients for the whole project)."""

    global _engine, _session_factory
    if _session_factory is None:
        settings = get_settings()
        if not settings.supabase_database_url:
            raise RuntimeError("SUPABASE_DATABASE_URL is not set")
        logger.info(
            "initialising_supabase_engine",
            url=make_url(settings.supabase_database_url).render_as_string(hide_password=True),
        )
        _engine = create_async_engine(
            settings.supabase_database_url,
            echo=False,
            pool_pre_ping=True,
            pool_recycle=300,
            pool_size=settings.supabase_pool_size,
            max_overflow=settings.supabase_max_overflow,
            pool_timeout=30,
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _session_factory


def get_frontend_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Sessions on the database the website reads and writes (Supabase, or the one database)."""

    return get_supabase_sessionmaker() if supabase_configured() else get_sessionmaker()


class SupabaseListener:
    """Waits for a signal of the website on one Supabase connection (LISTEN/NOTIFY).

    The website cannot reach the backend; instead of asking Supabase every few seconds whether
    there is work, the backend listens: while nothing happens nothing is sent. ``due()`` says
    whether to look now: after a signal, after a reconnect, and every ``fallback_seconds``
    regardless (a signal sent while the connection was down is otherwise missed).
    """

    def __init__(self, channel: str, fallback_seconds: float, retry_seconds: float = 60.0) -> None:
        self.channel = channel
        self.fallback_seconds = fallback_seconds
        self.retry_seconds = retry_seconds
        self._connection: Any = None
        self._signals: list[str] = []
        self._looked_at = float("-inf")
        self._tried_at = float("-inf")

    @property
    def connected(self) -> bool:
        return self._connection is not None and not self._connection.is_closed()

    def _on_signal(self, _connection: Any, _pid: int, _channel: str, payload: str) -> None:
        self._signals.append(payload)

    async def _connect(self) -> None:
        import asyncpg

        connection = await asyncpg.connect(supabase_dsn(), statement_cache_size=0, timeout=15)
        await connection.add_listener(self.channel, self._on_signal)
        self._connection = connection
        logger.info("supabase_listening", channel=self.channel)

    async def due(self) -> list[str] | None:
        """The signals since the last look ([] for a regular look), or None: no need to look."""

        now = time.monotonic()
        if not self.connected and now - self._tried_at >= self.retry_seconds:
            self._tried_at = now
            await self.close()
            try:
                await self._connect()
                self._looked_at = float("-inf")  # look once: a signal may have been missed
            except Exception as exc:
                logger.warning("supabase_listen_failed", channel=self.channel, error=str(exc)[:200])
        interval = self.fallback_seconds if self.connected else self.retry_seconds
        if self._signals or now - self._looked_at >= interval:
            if self.connected and not self._signals:
                # A regular look also checks that the connection still works
                try:
                    await self._connection.execute("SELECT 1")
                except Exception as exc:
                    logger.warning(
                        "supabase_listen_lost", channel=self.channel, error=str(exc)[:200]
                    )
                    await self.close()
            self._looked_at = now
            signals, self._signals = self._signals, []
            return signals
        return None

    async def close(self) -> None:
        connection, self._connection = self._connection, None
        if connection is not None:
            try:
                await connection.close(timeout=5)
            except Exception:  # pragma: no cover - best effort
                connection.terminate()


async def dispose_supabase_engine() -> None:
    """Close the Supabase connections (shutdown, or a broken connection)."""

    global _engine, _session_factory
    if _engine is not None:
        try:
            await _engine.dispose()
        except Exception as exc:  # pragma: no cover - best effort
            logger.warning("supabase_engine_dispose_error", error=str(exc))
    _engine = None
    _session_factory = None
