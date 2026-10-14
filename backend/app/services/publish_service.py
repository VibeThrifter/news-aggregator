"""Publish what the website shows from the local working database to Supabase (Story INFRA-2).

The backend works on a local Postgres. Supabase only holds the tables and columns the website
reads: writing there costs no egress, reading does. Every change of a published table is noted in
``publish_queue`` by a trigger. Every few seconds the publisher takes the noted rows, compares each
with what it published last (``publish_state``: an md5 of the published columns) and sends only
the rows that changed. Deletes go first (children before parents, so that a new row can take the
unique key of a removed one), then inserts and updates (parents before children).

- ``skip``: columns that stay local (vectors, normalized text, raw LLM responses). Supabase keeps
  its default for them (NULL).
- ``website``: columns the website writes in Supabase (research requests). Sent for a new row,
  never overwritten; the research jobs pull them into the local row.
- Tables the website writes itself (voice searches, access codes, shared entries) are not
  published: the backend reads and writes them in Supabase (``db/supabase.py``).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class PublishedTable:
    """A table the website reads: its key, the columns that stay local and those it writes."""

    name: str
    key: tuple[str, ...] = ("id",)
    skip: frozenset[str] = frozenset()
    website: frozenset[str] = frozenset()


# Parents before children (foreign keys in Supabase; PostgREST embeds through them).
PUBLISHED_TABLES: tuple[PublishedTable, ...] = (
    PublishedTable("news_sources"),
    PublishedTable(
        "articles",
        # The text stays: "Zoek in alle artikelen" (search_articles) searches title, intro and text
        skip=frozenset(
            {
                "normalized_text",
                "normalized_tokens",
                "embedding",
                "tfidf_vector",
                "entities",
                "extracted_dates",
                "extracted_locations",
            }
        ),
    ),
    PublishedTable(
        "events",
        skip=frozenset(
            {"description", "centroid_embedding", "centroid_tfidf", "centroid_entities"}
        ),
    ),
    PublishedTable("event_articles"),
    PublishedTable("llm_insights", skip=frozenset({"raw_response", "prompt_metadata"})),
    PublishedTable("article_bias_analyses", skip=frozenset({"raw_response"})),
    PublishedTable("event_entities"),
    PublishedTable("event_relations"),
    PublishedTable("pm_entities"),
    PublishedTable("pm_relations"),
    PublishedTable("pm_sources"),
    PublishedTable("pm_arguments"),
    PublishedTable("pm_mechanisms", key=("name",)),
    PublishedTable("pm_aliases", key=("alias", "entity_id")),
    PublishedTable("pm_meta", key=("key",)),
    PublishedTable(
        "entity_research",
        key=("entity_key",),
        skip=frozenset({"summary", "prominence"}),
        website=frozenset({"requested_count", "last_requested_at", "request_event_slug"}),
    ),
    PublishedTable(
        "relation_research",
        key=("relation_id",),
        skip=frozenset({"summary"}),
        website=frozenset({"requested_count", "last_requested_at", "request_events"}),
    ),
)

# The tables the website writes itself: they live only in Supabase, the backend reads and writes
# them there (``db/supabase.py``). The local database has no copy, so a slip fails loudly.
WEBSITE_TABLES: tuple[str, ...] = (
    "voice_searches",
    "access_codes",
    "shared_entry_adoptions",
    "shared_entry_reports",
    "shared_entries",
)

# A TRUNCATE notes this instead of a key: the whole table is compared again.
WHOLE_TABLE = {"*": True}
# Keys per local query
KEY_CHUNK = 5000
# Noted changes taken per run (the rest waits for the next run)
QUEUE_TAKE = 50000

LOCAL_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS publish_queue (
        seq BIGSERIAL PRIMARY KEY,
        table_name TEXT NOT NULL,
        pk JSONB NOT NULL,
        queued_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS publish_state (
        table_name TEXT NOT NULL,
        pk JSONB NOT NULL,
        row_hash TEXT NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (table_name, pk)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS publish_tables (
        table_name TEXT PRIMARY KEY,
        columns TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
)


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _key_object(table: PublishedTable, alias: str) -> str:
    """SQL for the key of a row as jsonb: the same in the trigger and in the publisher."""

    parts = ", ".join(f"'{column}', {alias}.{_ident(column)}" for column in table.key)
    return f"jsonb_build_object({parts})"


def _canonical(pk: Any) -> str:
    """One text per key, whatever the order of its fields."""

    if isinstance(pk, str):
        pk = json.loads(pk)
    return json.dumps(pk, sort_keys=True, separators=(",", ":"))


def _md5(value: str) -> str:
    return hashlib.md5(value.encode("utf-8"), usedforsecurity=False).hexdigest()


def trigger_function_sql(table: PublishedTable) -> str:
    """The function that notes every change of ``table`` in publish_queue."""

    function = _ident(f"publish_note_{table.name}")
    moved = " OR ".join(
        f"OLD.{_ident(column)} IS DISTINCT FROM NEW.{_ident(column)}" for column in table.key
    )
    # Table and column names come from PUBLISHED_TABLES, never from input
    insert = f"INSERT INTO publish_queue (table_name, pk) VALUES ('{table.name}', "  # noqa: S608
    note_whole = insert + "'" + json.dumps(WHOLE_TABLE) + "'::jsonb);"
    note_old = insert + _key_object(table, "OLD") + ");"
    note_new = insert + _key_object(table, "NEW") + ");"
    return f"""
        CREATE OR REPLACE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
            IF TG_OP = 'TRUNCATE' THEN
                {note_whole}
                RETURN NULL;
            END IF;
            IF TG_OP = 'DELETE' THEN
                {note_old}
                RETURN NULL;
            END IF;
            {note_new}
            IF TG_OP = 'UPDATE' AND ({moved}) THEN
                {note_old}
            END IF;
            RETURN NULL;
        END
        $fn$
        """


def trigger_create_sql(table: PublishedTable) -> list[tuple[str, str]]:
    """(name, statement) of the two triggers on ``table`` that call its function."""

    function = _ident(f"publish_note_{table.name}")
    target = f"public.{_ident(table.name)}"
    return [
        (
            "publish_note",
            f"CREATE TRIGGER publish_note AFTER INSERT OR UPDATE OR DELETE ON {target} "
            f"FOR EACH ROW EXECUTE FUNCTION {function}()",
        ),
        (
            "publish_note_truncate",
            f"CREATE TRIGGER publish_note_truncate AFTER TRUNCATE ON {target} "
            f"FOR EACH STATEMENT EXECUTE FUNCTION {function}()",
        ),
    ]


async def table_columns(session: AsyncSession, table: str) -> dict[str, str]:
    """Column name -> type of public.<table>, in table order ({} when the table is missing)."""

    rows = (
        await session.execute(
            text(
                """
                SELECT a.attname, format_type(a.atttypid, a.atttypmod)
                FROM pg_attribute a
                JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = :table AND c.relkind = 'r'
                  AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY a.attnum
                """
            ),
            {"table": table},
        )
    ).all()
    return {name: type_name for name, type_name in rows}


@dataclass
class _Plan:
    """What to send for one table in one run."""

    table: PublishedTable
    columns: list[str]
    key_types: dict[str, str]
    upserts: list[tuple[str, str, str]]  # (key, row as json, md5 of the row)
    deletes: list[str]  # keys


class PublishService:
    """Sends the noted changes of the local database to Supabase."""

    def __init__(
        self,
        *,
        local_sessions: async_sessionmaker[AsyncSession] | None = None,
        remote_sessions: async_sessionmaker[AsyncSession] | None = None,
        tables: Sequence[PublishedTable] = PUBLISHED_TABLES,
        batch_rows: int | None = None,
    ) -> None:
        self._local_sessions = local_sessions
        self._remote_sessions = remote_sessions
        self.tables = tuple(tables)
        self.batch_rows = batch_rows or get_settings().publish_batch_rows
        self._lock = asyncio.Lock()
        self._remote_columns: dict[str, dict[str, str]] = {}
        self._remote_columns_at = 0.0
        self.last_run: dict[str, Any] | None = None
        self.last_change: dict[str, Any] | None = None

    def _local(self) -> async_sessionmaker[AsyncSession]:
        if self._local_sessions is None:
            from backend.app.db.session import get_sessionmaker

            self._local_sessions = get_sessionmaker()
        return self._local_sessions

    def _remote(self) -> async_sessionmaker[AsyncSession]:
        if self._remote_sessions is None:
            from backend.app.db.supabase import get_supabase_sessionmaker

            self._remote_sessions = get_supabase_sessionmaker()
        return self._remote_sessions

    # ------------------------------------------------------------------ local schema
    async def ensure_local_schema(self) -> list[str]:
        """Queue, state and the trigger on every published table (idempotent).

        The trigger functions are replaced every time (no table lock). A trigger is only created
        where it is missing, each table in its own short transaction: a table another process
        holds never blocks the start (2026-10-13: dropping and creating every trigger at once
        deadlocked with the backend that was still stopping). Returns the published tables
        without a trigger.
        """

        async with self._local()() as session:
            for statement in LOCAL_SCHEMA:
                await session.execute(text(statement))
            await session.commit()
        without: list[str] = []
        for table in self.tables:
            try:
                async with self._local()() as session:
                    if not await table_columns(session, table.name):
                        without.append(table.name)
                        continue
                    await session.execute(text("SET LOCAL lock_timeout = '5s'"))
                    await session.execute(text(trigger_function_sql(table)))
                    present = set(
                        (
                            await session.execute(
                                text(
                                    "SELECT tgname FROM pg_trigger "
                                    "WHERE tgrelid = CAST(:t AS regclass) AND NOT tgisinternal"
                                ),
                                {"t": f"public.{table.name}"},
                            )
                        ).scalars()
                    )
                    for name, statement in trigger_create_sql(table):
                        if name not in present:
                            await session.execute(text(statement))
                    await session.commit()
            except Exception as exc:
                without.append(table.name)
                logger.error("publish_trigger_failed", table=table.name, error=str(exc)[:300])
        if without:
            logger.warning("publish_tables_without_trigger", tables=without)
        return without

    # ------------------------------------------------------------------ columns
    async def _remote_columns_of(self, table: str) -> dict[str, str]:
        # Read again every hour: a migration may have added a column in Supabase
        if time.monotonic() - self._remote_columns_at > 3600:
            self._remote_columns = {}
            self._remote_columns_at = time.monotonic()
        if table not in self._remote_columns:
            async with self._remote()() as session:
                self._remote_columns[table] = await table_columns(session, table)
        return self._remote_columns[table]

    async def published_columns(
        self, local: AsyncSession, table: PublishedTable
    ) -> tuple[list[str], dict[str, str], list[str]]:
        """(published columns, types of the key columns, local columns left out) of ``table``.

        Published: in both databases and not skipped. A column a migration has not added to
        Supabase yet is left out until it is there; the table is then compared in full.
        """

        local_columns = await table_columns(local, table.name)
        remote_columns = await self._remote_columns_of(table.name)
        columns = [
            column
            for column in local_columns
            if column in remote_columns and column not in table.skip
        ]
        missing = [column for column in table.key if column not in columns]
        if missing:
            raise RuntimeError(f"{table.name}: key {missing} not in both databases")
        left_out = [column for column in local_columns if column not in columns]
        return columns, {column: local_columns[column] for column in table.key}, left_out

    # ------------------------------------------------------------------ seed
    async def seed_state(self, tables: Iterable[str] | None = None) -> dict[str, int]:
        """Record every local row as published, without sending anything.

        Only right after the local database was restored from a snapshot of Supabase: then both
        hold the same rows.
        """

        names = set(tables) if tables else None
        counts: dict[str, int] = {}
        async with self._local()() as session:
            for table in self.tables:
                if names is not None and table.name not in names:
                    continue
                columns, _, left_out = await self.published_columns(session, table)
                await session.execute(
                    text("DELETE FROM publish_state WHERE table_name = :t"), {"t": table.name}
                )
                result = await session.execute(
                    text(
                        f"""
                        INSERT INTO publish_state (table_name, pk, row_hash)
                        SELECT :t, {_key_object(table, "t")},
                               md5((to_jsonb(t) - CAST(:left_out AS text[]))::text)
                        FROM public.{_ident(table.name)} t
                        """  # noqa: S608 - names from PUBLISHED_TABLES
                    ),
                    {"t": table.name, "left_out": left_out},
                )
                await self._save_signature(session, table.name, columns)
                counts[table.name] = int(result.rowcount or 0)
            await session.commit()
        logger.info("publish_state_seeded", **counts)
        return counts

    @staticmethod
    async def _save_signature(session: AsyncSession, table: str, columns: list[str]) -> None:
        await session.execute(
            text(
                "INSERT INTO publish_tables (table_name, columns, updated_at) "
                "VALUES (:t, :c, now()) ON CONFLICT (table_name) "
                "DO UPDATE SET columns = EXCLUDED.columns, updated_at = now()"
            ),
            {"t": table, "c": ",".join(columns)},
        )

    # ------------------------------------------------------------------ publish
    async def queue_length(self) -> int:
        async with self._local()() as session:
            return int(
                (await session.execute(text("SELECT count(*) FROM publish_queue"))).scalar_one()
            )

    async def publish_once(self) -> dict[str, Any]:
        """Send what changed since the last run.

        The noted changes are taken out of the queue in the same local transaction that records
        what was published: when sending fails, they are back for the next run. Rows Supabase
        refuses go back in the queue.
        """

        async with self._lock:
            started = time.monotonic()
            run: dict[str, Any] = {
                "started_at": datetime.now(timezone.utc).isoformat(),
                "queued": 0,
                "upserted": {},
                "deleted": {},
                "unchanged": 0,
            }
            async with self._local()() as local:
                taken = (
                    await local.execute(
                        text(
                            "DELETE FROM publish_queue WHERE seq IN "
                            "(SELECT seq FROM publish_queue ORDER BY seq LIMIT :n) "
                            "RETURNING table_name, pk::text"
                        ),
                        {"n": QUEUE_TAKE},
                    )
                ).all()
                if not taken:
                    await local.rollback()
                    self.last_run = run
                    return run
                run["queued"] = len(taken)
                noted: dict[str, set[str]] = defaultdict(set)
                whole: set[str] = set()
                for table_name, pk in taken:
                    key = _canonical(pk)
                    if json.loads(key) == WHOLE_TABLE:
                        whole.add(table_name)
                    else:
                        noted[table_name].add(key)

                plans: list[_Plan] = []
                requeue: list[tuple[str, str]] = []
                for table in self.tables:
                    if table.name not in noted and table.name not in whole:
                        continue
                    try:
                        plan = await self._plan(
                            local, table, noted.get(table.name, set()), table.name in whole, run
                        )
                    except Exception as exc:
                        # E.g. a table a migration has not added to Supabase yet: try again later
                        logger.error("publish_plan_failed", table=table.name, error=str(exc)[:300])
                        requeue.extend((table.name, key) for key in noted.get(table.name, ()))
                        if table.name in whole:
                            requeue.append((table.name, _canonical(WHOLE_TABLE)))
                        continue
                    if plan is not None:
                        plans.append(plan)

                refused = await self._send(plans, run)

                for plan in plans:
                    sent = [
                        item for item in plan.upserts if (plan.table.name, item[0]) not in refused
                    ]
                    gone = [key for key in plan.deletes if (plan.table.name, key) not in refused]
                    await self._record(local, plan.table.name, sent, gone)
                    await self._save_signature(local, plan.table.name, plan.columns)
                requeue.extend(sorted(refused))
                for start in range(0, len(requeue), KEY_CHUNK):
                    batch = requeue[start : start + KEY_CHUNK]
                    await local.execute(
                        text(
                            "INSERT INTO publish_queue (table_name, pk) "
                            "SELECT x.t, x.pk "
                            "FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(t text, pk jsonb)"
                        ),
                        {"rows": json.dumps([{"t": t, "pk": json.loads(k)} for t, k in batch])},
                    )
                await local.commit()

            run["refused"] = len(refused)
            run["seconds"] = round(time.monotonic() - started, 3)
            self.last_run = run
            if run["upserted"] or run["deleted"] or refused:
                self.last_change = run
                logger.info(
                    "publish_done",
                    upserted=run["upserted"],
                    deleted=run["deleted"],
                    unchanged=run["unchanged"],
                    refused=len(refused),
                    seconds=run["seconds"],
                )
            return run

    async def _all_keys(self, local: AsyncSession, table: PublishedTable) -> set[str]:
        """Keys of all local rows and of all rows published before."""

        keys = {
            _canonical(pk)
            for pk in (
                await local.execute(
                    text(
                        f"SELECT ({_key_object(table, 't')})::text "  # noqa: S608
                        f"FROM public.{_ident(table.name)} t"
                    )
                )
            ).scalars()
        }
        keys.update(
            _canonical(pk)
            for pk in (
                await local.execute(
                    text("SELECT pk::text FROM publish_state WHERE table_name = :t"),
                    {"t": table.name},
                )
            ).scalars()
        )
        return keys

    async def _plan(
        self,
        local: AsyncSession,
        table: PublishedTable,
        keys: set[str],
        whole: bool,
        run: dict[str, Any],
    ) -> _Plan | None:
        columns, key_types, left_out = await self.published_columns(local, table)
        signature = (
            await local.execute(
                text("SELECT columns FROM publish_tables WHERE table_name = :t"), {"t": table.name}
            )
        ).scalar()
        if whole or signature != ",".join(columns):
            # A TRUNCATE, or other columns than the hashes were made with: compare every row
            keys = keys | await self._all_keys(local, table)
        if not keys:
            return None
        record = ", ".join(f"{_ident(column)} {key_types[column]}" for column in table.key)
        match = " AND ".join(f"t.{_ident(column)} = k.{_ident(column)}" for column in table.key)
        upserts: list[tuple[str, str, str]] = []
        deletes: list[str] = []
        ordered = sorted(keys)
        for start in range(0, len(ordered), KEY_CHUNK):
            chunk = ordered[start : start + KEY_CHUNK]
            current = (
                await local.execute(
                    text(
                        f"""
                        SELECT ({_key_object(table, "t")})::text,
                               (to_jsonb(t) - CAST(:left_out AS text[]))::text
                        FROM public.{_ident(table.name)} t
                        JOIN jsonb_to_recordset(CAST(:keys AS jsonb)) AS k({record}) ON {match}
                        """  # noqa: S608 - names from PUBLISHED_TABLES
                    ),
                    {"keys": "[" + ",".join(chunk) + "]", "left_out": left_out},
                )
            ).all()
            published = {
                _canonical(pk): row_hash
                for pk, row_hash in (
                    await local.execute(
                        text(
                            "SELECT pk::text, row_hash FROM publish_state "
                            "WHERE table_name = :t AND pk = ANY(CAST(:pks AS jsonb[]))"
                        ),
                        {"t": table.name, "pks": chunk},
                    )
                ).all()
            }
            present: set[str] = set()
            for pk, row in current:
                key = _canonical(pk)
                present.add(key)
                row_hash = _md5(row)
                if published.get(key) == row_hash:
                    run["unchanged"] += 1
                else:
                    upserts.append((key, row, row_hash))
            deletes.extend(key for key in chunk if key not in present)
        if not upserts and not deletes:
            return None
        return _Plan(
            table=table, columns=columns, key_types=key_types, upserts=upserts, deletes=deletes
        )

    async def _send(self, plans: list[_Plan], run: dict[str, Any]) -> set[tuple[str, str]]:
        """Deletes (children first), then upserts (parents first), in one Supabase transaction.

        A batch Supabase refuses is sent again row by row; the rows it still refuses are returned.
        """

        refused: set[tuple[str, str]] = set()
        if not plans:
            return refused
        async with self._remote()() as remote:
            for plan in reversed(plans):
                if not plan.deletes:
                    continue
                sql = self._delete_sql(plan)
                before = len(refused)
                for start in range(0, len(plan.deletes), self.batch_rows):
                    batch = plan.deletes[start : start + self.batch_rows]
                    refused |= await self._apply(remote, plan.table.name, sql, batch, batch)
                run["deleted"][plan.table.name] = len(plan.deletes) - (len(refused) - before)
            for plan in plans:
                if not plan.upserts:
                    continue
                sql = self._upsert_sql(plan)
                before = len(refused)
                for start in range(0, len(plan.upserts), self.batch_rows):
                    batch = plan.upserts[start : start + self.batch_rows]
                    refused |= await self._apply(
                        remote,
                        plan.table.name,
                        sql,
                        [key for key, _, _ in batch],
                        [row for _, row, _ in batch],
                    )
                run["upserted"][plan.table.name] = len(plan.upserts) - (len(refused) - before)
            await remote.commit()
        return refused

    @staticmethod
    async def _apply(
        remote: AsyncSession, table: str, sql: str, keys: list[str], items: list[str]
    ) -> set[tuple[str, str]]:
        """Run ``sql`` for a batch; when refused, row by row. Returns the refused rows."""

        try:
            async with remote.begin_nested():
                await remote.execute(text(sql), {"rows": "[" + ",".join(items) + "]"})
            return set()
        except Exception as exc:
            logger.warning(
                "publish_batch_refused", table=table, rows=len(items), error=str(exc)[:300]
            )
        refused: set[tuple[str, str]] = set()
        for key, item in zip(keys, items, strict=True):
            try:
                async with remote.begin_nested():
                    await remote.execute(text(sql), {"rows": "[" + item + "]"})
            except Exception as exc:
                refused.add((table, key))
                logger.error("publish_row_refused", table=table, key=key, error=str(exc)[:300])
        return refused

    @staticmethod
    def _upsert_sql(plan: _Plan) -> str:
        table = f"public.{_ident(plan.table.name)}"
        columns = ", ".join(_ident(column) for column in plan.columns)
        updatable = [
            column
            for column in plan.columns
            if column not in plan.table.key and column not in plan.table.website
        ]
        conflict = ", ".join(_ident(column) for column in plan.table.key)
        action = (
            "DO UPDATE SET " + ", ".join(f"{_ident(c)} = EXCLUDED.{_ident(c)}" for c in updatable)
            if updatable
            else "DO NOTHING"
        )
        return (
            f"INSERT INTO {table} AS dst ({columns}) "  # noqa: S608
            f"SELECT {columns} FROM jsonb_populate_recordset(NULL::{table}, CAST(:rows AS jsonb)) "
            f"ON CONFLICT ({conflict}) {action}"
        )

    @staticmethod
    def _delete_sql(plan: _Plan) -> str:
        table = f"public.{_ident(plan.table.name)}"
        record = ", ".join(f"{_ident(c)} {plan.key_types[c]}" for c in plan.table.key)
        match = " AND ".join(f"dst.{_ident(c)} = k.{_ident(c)}" for c in plan.table.key)
        return (
            f"DELETE FROM {table} AS dst USING jsonb_to_recordset(CAST(:rows AS jsonb)) "  # noqa: S608
            f"AS k({record}) WHERE {match}"
        )

    @staticmethod
    async def _record(
        local: AsyncSession,
        table: str,
        sent: list[tuple[str, str, str]],
        gone: list[str],
    ) -> None:
        """Remember what Supabase now holds."""

        for start in range(0, len(sent), KEY_CHUNK):
            batch = sent[start : start + KEY_CHUNK]
            await local.execute(
                text(
                    """
                    INSERT INTO publish_state (table_name, pk, row_hash, published_at)
                    SELECT :t, x.pk, x.row_hash, now()
                    FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(pk jsonb, row_hash text)
                    ON CONFLICT (table_name, pk)
                    DO UPDATE SET row_hash = EXCLUDED.row_hash, published_at = now()
                    """
                ),
                {
                    "t": table,
                    "rows": json.dumps(
                        [
                            {"pk": json.loads(key), "row_hash": row_hash}
                            for key, _, row_hash in batch
                        ]
                    ),
                },
            )
        for start in range(0, len(gone), KEY_CHUNK):
            await local.execute(
                text(
                    "DELETE FROM publish_state "
                    "WHERE table_name = :t AND pk = ANY(CAST(:pks AS jsonb[]))"
                ),
                {"t": table, "pks": gone[start : start + KEY_CHUNK]},
            )

    def status(self) -> dict[str, Any]:
        return {"last_run": self.last_run, "last_change": self.last_change}


_service: PublishService | None = None


def get_publish_service() -> PublishService:
    global _service
    if _service is None:
        _service = PublishService()
    return _service
