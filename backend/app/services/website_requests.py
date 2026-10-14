"""Research requests the website writes in Supabase, into the local database (Story INFRA-2).

A reader who taps a name ("Wie is dit?", request_entity_research) or sees a link on thin evidence
(request_relation_research) writes a request in Supabase. The research jobs work on the local
database; at the start of every cycle they take the requests that are newer than the last pull.
Only the request columns come over (the publisher never overwrites them in Supabase); a name
or link the local database does not know yet is added, as the website's function did.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.logging import get_logger

logger = get_logger(__name__)

# The first pull looks back this far; later pulls overlap the previous one a little
FIRST_PULL = timedelta(days=7)
OVERLAP = timedelta(minutes=5)

PULLS: dict[str, dict[str, str]] = {
    "entity_research": {
        "select": (
            "SELECT entity_key, name, kind, request_event_slug, requested_count, last_requested_at "
            "FROM entity_research WHERE last_requested_at > :since ORDER BY last_requested_at"
        ),
        "merge": """
            INSERT INTO entity_research AS er (
                entity_key, name, kind, request_event_slug, requested_count, last_requested_at
            )
            SELECT x.entity_key, x.name, x.kind, x.request_event_slug, x.requested_count,
                   x.last_requested_at
            FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(
                entity_key text, name text, kind text, request_event_slug text,
                requested_count integer, last_requested_at timestamptz
            )
            ON CONFLICT (entity_key) DO UPDATE SET
                requested_count = greatest(er.requested_count, EXCLUDED.requested_count),
                last_requested_at = EXCLUDED.last_requested_at,
                request_event_slug = COALESCE(EXCLUDED.request_event_slug, er.request_event_slug),
                kind = CASE WHEN er.kind = 'unknown' THEN EXCLUDED.kind ELSE er.kind END,
                updated_at = now()
            WHERE er.last_requested_at IS NULL OR er.last_requested_at < EXCLUDED.last_requested_at
        """,
    },
    "relation_research": {
        "select": (
            "SELECT relation_id, request_events, requested_count, last_requested_at "
            "FROM relation_research WHERE last_requested_at > :since ORDER BY last_requested_at"
        ),
        "merge": """
            INSERT INTO relation_research AS rr (
                relation_id, request_events, requested_count, last_requested_at
            )
            SELECT x.relation_id, x.request_events, x.requested_count, x.last_requested_at
            FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(
                relation_id integer, request_events jsonb, requested_count integer,
                last_requested_at timestamptz
            )
            ON CONFLICT (relation_id) DO UPDATE SET
                requested_count = greatest(rr.requested_count, EXCLUDED.requested_count),
                last_requested_at = EXCLUDED.last_requested_at,
                request_events = EXCLUDED.request_events,
                updated_at = now()
            WHERE rr.last_requested_at IS NULL OR rr.last_requested_at < EXCLUDED.last_requested_at
        """,
    },
}

WATERMARKS = """
CREATE TABLE IF NOT EXISTS website_pulls (
    name TEXT PRIMARY KEY,
    pulled_until TIMESTAMPTZ NOT NULL,
    pulled_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


def _json_value(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


async def pull_requests(
    table: str,
    *,
    local_sessions: async_sessionmaker[AsyncSession] | None = None,
    remote_sessions: async_sessionmaker[AsyncSession] | None = None,
) -> dict[str, Any]:
    """Take the website's newer requests of ``table`` into the local database.

    Nothing to do when Supabase is the one database. Returns what was pulled.
    """

    from backend.app.db.session import get_sessionmaker
    from backend.app.db.supabase import get_supabase_sessionmaker, supabase_configured

    if remote_sessions is None:
        if not supabase_configured():
            return {"skipped": "one database"}
        remote_sessions = get_supabase_sessionmaker()
    local_sessions = local_sessions or get_sessionmaker()
    queries = PULLS[table]

    async with local_sessions() as local:
        await local.execute(text(WATERMARKS))
        until = (
            await local.execute(
                text("SELECT pulled_until FROM website_pulls WHERE name = :n"), {"n": table}
            )
        ).scalar()
        await local.commit()
    since = (until - OVERLAP) if until else datetime.now(timezone.utc) - FIRST_PULL

    async with remote_sessions() as remote:
        rows = (await remote.execute(text(queries["select"]), {"since": since})).mappings().all()
    if not rows:
        return {"pulled": 0}

    newest = max(row["last_requested_at"] for row in rows)
    payload = json.dumps(
        [{key: _json_value(value) for key, value in row.items()} for row in rows],
        ensure_ascii=False,
    )
    async with local_sessions() as local:
        merged = await local.execute(text(queries["merge"]), {"rows": payload})
        await local.execute(
            text(
                "INSERT INTO website_pulls (name, pulled_until, pulled_at) VALUES (:n, :u, now()) "
                "ON CONFLICT (name) DO UPDATE SET "
                "pulled_until = greatest(website_pulls.pulled_until, EXCLUDED.pulled_until), "
                "pulled_at = now()"
            ),
            {"n": table, "u": newest},
        )
        await local.commit()
    result = {"pulled": len(rows), "merged": int(merged.rowcount or 0)}
    if result["merged"]:
        logger.info("website_requests_pulled", table=table, **result)
    return result
