"""Local working database: the backend works on a local Postgres (Story INFRA-2).

Supabase only holds what the website shows; the backend publishes there (publish_service). These
steps move the data once, in this order:

    snapshot             copy every table of schema public from Supabase in one consistent snapshot
                         (COPY, text format) to data/local-db/snapshot-<utc>/, with columns and counts
    schema               the schema of public in Supabase (pg_dump --schema-only, same major version
                         as Supabase) to data/local-db/schema.sql
    restore <snapshot>   create the local database, load schema.sql and the snapshot
    verify <snapshot>    row counts: snapshot, local database, Supabase now
    compare              the published columns of every published table, local vs Supabase (an
                         md5 per table, computed in each database)
    init-publish         publish queue + triggers; every published row counts as published (only
                         right after restore, while Supabase still holds what the snapshot holds)
    prune-supabase       empty in Supabase what stays local (the columns the publisher leaves out,
                         llm_config) and give the space back (VACUUM FULL); --apply to do it

The local database: LOCAL_DATABASE_URL, else DATABASE_URL when it is not Supabase, else
postgresql://localhost:5432/news_aggregator. Supabase: SUPABASE_DATABASE_URL, else DATABASE_URL.

Usage:
    PYTHONPATH=. .venv/bin/python scripts/local_db.py snapshot
    PYTHONPATH=. .venv/bin/python scripts/local_db.py restore data/local-db/snapshot-...
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

import asyncpg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_ROOT = ROOT / "data" / "local-db"
SCHEMA_FILE = SNAPSHOT_ROOT / "schema.sql"
DEFAULT_LOCAL = "postgresql://localhost:5432/news_aggregator"
PG_BIN = Path(
    os.environ.get("PG_BIN", str(Path.home() / ".local/share/news-aggregator/postgres17/bin"))
)
# Roles the Supabase schema names in its policies
SUPABASE_ROLES = ("anon", "authenticated", "service_role")

load_dotenv(ROOT / ".env")


def _plain(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://")


def supabase_dsn() -> str:
    url = os.environ.get("SUPABASE_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    if "supabase" not in url:
        sys.exit("No Supabase URL: set SUPABASE_DATABASE_URL in .env")
    return _plain(url)


def local_dsn() -> str:
    url = os.environ.get("LOCAL_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    if not url or "supabase" in url or url.startswith("sqlite"):
        url = DEFAULT_LOCAL
    return _plain(url)


def _without_password(dsn: str) -> tuple[str, dict[str, str]]:
    """The dsn without its password, and an environment that carries it (not in `ps`)."""

    parts = urlsplit(dsn)
    env = dict(os.environ)
    if parts.password:
        env["PGPASSWORD"] = unquote(parts.password)
        netloc = parts.netloc.split("@", 1)[1]
        user = parts.username or ""
        parts = parts._replace(netloc=f"{user}@{netloc}" if user else netloc)
    return urlunsplit(parts), env


def _database(dsn: str, name: str) -> str:
    parts = urlsplit(dsn)
    return urlunsplit(parts._replace(path=f"/{name}"))


def _name(dsn: str) -> str:
    return urlsplit(dsn).path.lstrip("/")


# ---------------------------------------------------------------------------------------- snapshot
async def snapshot() -> Path:
    target = SNAPSHOT_ROOT / f"snapshot-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}"
    target.mkdir(parents=True)
    conn = await asyncpg.connect(supabase_dsn(), statement_cache_size=0)
    manifest: dict[str, dict[str, object]] = {}
    try:
        await conn.execute("SET statement_timeout = 0")
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            tables = [
                row["tablename"]
                for row in await conn.fetch(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
                )
            ]
            for table in tables:
                columns = [
                    row["attname"]
                    for row in await conn.fetch(
                        """
                        SELECT attname FROM pg_attribute
                        WHERE attrelid = ('public.' || quote_ident($1))::regclass
                          AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
                        ORDER BY attnum
                        """,
                        table,
                    )
                ]
                started = time.monotonic()
                path = target / f"{table}.copy"
                await conn.copy_from_table(
                    table, schema_name="public", columns=columns, output=str(path), format="text"
                )
                rows = await conn.fetchval(f'SELECT count(*) FROM public."{table}"')  # noqa: S608
                manifest[table] = {"columns": columns, "rows": rows, "bytes": path.stat().st_size}
                print(
                    f"{table:28} {rows:>7} rows {path.stat().st_size / 1e6:8.1f} MB "
                    f"{time.monotonic() - started:5.1f} s",
                    flush=True,
                )
    finally:
        await conn.close()
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2))
    total = sum(int(item["bytes"]) for item in manifest.values())
    print(f"snapshot: {target} ({total / 1e6:.1f} MB)")
    return target


# ------------------------------------------------------------------------------------------ schema
def dump_schema() -> Path:
    dsn, env = _without_password(supabase_dsn())
    SNAPSHOT_ROOT.mkdir(parents=True, exist_ok=True)
    subprocess.run(  # noqa: S603 - fixed binary, arguments from our own config
        [
            str(PG_BIN / "pg_dump"),
            "--schema-only",
            "--schema=public",
            "--no-owner",
            "--no-privileges",
            f"--file={SCHEMA_FILE}",
            f"--dbname={dsn}",
        ],
        check=True,
        env=env,
    )
    print(f"schema: {SCHEMA_FILE} ({SCHEMA_FILE.stat().st_size / 1e3:.0f} kB)")
    return SCHEMA_FILE


# ----------------------------------------------------------------------------------------- restore
async def restore(snapshot_dir: Path) -> None:
    manifest = json.loads((snapshot_dir / "manifest.json").read_text())
    if not SCHEMA_FILE.exists():
        sys.exit(f"{SCHEMA_FILE} is missing: run `schema` first")
    target = local_dsn()
    name = _name(target)

    admin = await asyncpg.connect(_database(target, "postgres"))
    try:
        if await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", name):
            sys.exit(f"database {name} exists already: drop it first to restore again")
        await admin.execute(f'CREATE DATABASE "{name}"')
        for role in SUPABASE_ROLES:
            if not await admin.fetchval("SELECT 1 FROM pg_roles WHERE rolname = $1", role):
                await admin.execute(f'CREATE ROLE "{role}" NOLOGIN')
    finally:
        await admin.close()

    conn = await asyncpg.connect(target)
    try:
        # As in Supabase: extensions live in schema extensions, which is on the search path. The
        # schema file creates public itself
        await conn.execute(
            f"""
            DROP SCHEMA IF EXISTS public CASCADE;
            CREATE SCHEMA IF NOT EXISTS extensions;
            CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
            ALTER DATABASE "{name}" SET search_path = "$user", public, extensions;
            """
        )
    finally:
        await conn.close()

    dsn, env = _without_password(target)
    subprocess.run(  # noqa: S603 - fixed binary
        [str(PG_BIN / "psql"), "-q", "-v", "ON_ERROR_STOP=1", "-f", str(SCHEMA_FILE), dsn],
        check=True,
        env=env,
    )
    print(f"schema loaded into {name}")

    from backend.app.services.publish_service import WEBSITE_TABLES

    conn = await asyncpg.connect(target)
    try:
        # The website's own tables live only in Supabase: no stale copy here
        for table in WEBSITE_TABLES:
            await conn.execute(f'DROP TABLE IF EXISTS public."{table}" CASCADE')
    finally:
        await conn.close()
    manifest = {table: item for table, item in manifest.items() if table not in WEBSITE_TABLES}

    conn = await asyncpg.connect(target)
    try:
        # Foreign keys and triggers are checked by the source; load in any order
        await conn.execute("SET session_replication_role = replica")
        for table, item in manifest.items():
            started = time.monotonic()
            await conn.copy_to_table(
                table,
                schema_name="public",
                source=str(snapshot_dir / f"{table}.copy"),
                columns=item["columns"],
                format="text",
            )
            print(
                f"{table:28} {item['rows']:>7} rows {time.monotonic() - started:5.1f} s", flush=True
            )
        await conn.execute("SET session_replication_role = DEFAULT")
        # Sequences continue after the highest id, as in Supabase
        for row in await conn.fetch(
            """
            SELECT s.relname AS seq, t.relname AS tab, a.attname AS col
            FROM pg_class s
            JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
            JOIN pg_class t ON t.oid = d.refobjid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
            JOIN pg_namespace n ON n.oid = s.relnamespace
            WHERE s.relkind = 'S' AND n.nspname = 'public'
            """
        ):
            await conn.execute(
                f"SELECT setval('public.\"{row['seq']}\"', "  # noqa: S608 - catalog names
                f"COALESCE((SELECT max(\"{row['col']}\") FROM public.\"{row['tab']}\"), 1), "
                f"(SELECT max(\"{row['col']}\") FROM public.\"{row['tab']}\") IS NOT NULL)"
            )
        await conn.execute("ANALYZE")
    finally:
        await conn.close()
    await verify(snapshot_dir, with_supabase=False)


# ------------------------------------------------------------------------------------------ verify
async def _counts(dsn: str, tables: list[str]) -> dict[str, int]:
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        return {
            table: await conn.fetchval(f'SELECT count(*) FROM public."{table}"')  # noqa: S608
            for table in tables
        }
    finally:
        await conn.close()


async def verify(snapshot_dir: Path, with_supabase: bool = True) -> bool:
    from backend.app.services.publish_service import WEBSITE_TABLES

    manifest = json.loads((snapshot_dir / "manifest.json").read_text())
    tables = [table for table in manifest if table not in WEBSITE_TABLES]
    local = await _counts(local_dsn(), tables)
    remote = await _counts(supabase_dsn(), tables) if with_supabase else {}
    same = True
    print(f"{'table':28} {'snapshot':>9} {'local':>9} {'supabase':>9}")
    for table in tables:
        expected = manifest[table]["rows"]
        now = remote.get(table)
        mark = "" if local[table] == expected and now in (None, expected) else "  <- differs"
        same = same and not mark
        print(
            f"{table:28} {expected:>9} {local[table]:>9} {now if now is not None else '':>9}{mark}"
        )
    print("all the same" if same else "DIFFERENCES: look before you switch")
    return same


async def checksums(dsn: str) -> dict[str, str]:
    """Per published table an md5 over the published columns of all rows (computed in the
    database: only the hash travels)."""

    from backend.app.services.publish_service import PUBLISHED_TABLES

    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        await conn.execute("SET statement_timeout = 0")
        await conn.execute("SET TIME ZONE 'UTC'")
        sums: dict[str, str] = {}
        for table in PUBLISHED_TABLES:
            key = ", ".join(f'"{column}"' for column in table.key)
            sums[table.name] = await conn.fetchval(
                f"""
                SELECT md5(COALESCE(string_agg(md5((to_jsonb(t) - $1::text[])::text), ''
                                               ORDER BY {key}), ''))
                FROM public."{table.name}" t
                """,  # noqa: S608 - names from PUBLISHED_TABLES
                sorted(table.skip),
            )
        return sums
    finally:
        await conn.close()


async def compare_content() -> bool:
    """The published columns of every published table: the same locally and in Supabase?"""

    local, remote = await asyncio.gather(checksums(local_dsn()), checksums(supabase_dsn()))
    same = True
    for table, value in local.items():
        mark = "same" if value == remote.get(table) else "DIFFERENT"
        same = same and mark == "same"
        print(f"{table:28} {mark}")
    return same


# ------------------------------------------------------------------------------------ init-publish
async def init_publish() -> None:
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from backend.app.services.publish_service import PublishService

    engines = [
        create_async_engine(dsn.replace("postgresql://", "postgresql+asyncpg://"))
        for dsn in (local_dsn(), supabase_dsn())
    ]
    try:
        service = PublishService(
            local_sessions=async_sessionmaker(engines[0], expire_on_commit=False),
            remote_sessions=async_sessionmaker(engines[1], expire_on_commit=False),
            batch_rows=500,
        )
        missing = await service.ensure_local_schema()
        if missing:
            print(f"not in the local database: {missing}")
        counts = await service.seed_state()
        print("recorded as published:", json.dumps(counts, indent=2))
    finally:
        for engine in engines:
            await engine.dispose()


# ---------------------------------------------------------------------------------- prune-supabase
async def prune_supabase(apply: bool) -> None:
    from backend.app.services.publish_service import PUBLISHED_TABLES

    conn = await asyncpg.connect(supabase_dsn(), statement_cache_size=0)
    try:
        await conn.execute("SET statement_timeout = 0")
        print(
            f"database before: {await conn.fetchval('SELECT pg_size_pretty(pg_database_size(current_database()))')}"
        )
        work: list[tuple[str, str, str]] = []  # (table, SET clause, WHERE clause)
        for table in PUBLISHED_TABLES:
            if not table.skip:
                continue
            columns = await conn.fetch(
                """
                SELECT a.attname, pg_get_expr(d.adbin, d.adrelid) AS default_value
                FROM pg_attribute a
                LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                WHERE a.attrelid = ('public.' || quote_ident($1))::regclass
                  AND a.attname = ANY($2::text[]) AND NOT a.attisdropped
                """,
                table.name,
                sorted(table.skip),
            )
            if not columns:
                continue
            sets = ", ".join(f'"{c["attname"]}" = DEFAULT' for c in columns)
            # json has no equality: compare with NULL by IS NOT NULL
            where = " OR ".join(
                f'"{c["attname"]}" IS DISTINCT FROM {c["default_value"]}'
                if c["default_value"]
                else f'"{c["attname"]}" IS NOT NULL'
                for c in columns
            )
            rows = await conn.fetchval(
                f'SELECT count(*) FROM public."{table.name}" WHERE {where}'
            )  # noqa: S608
            print(f"{table.name:24} {rows:>7} rows with {', '.join(c['attname'] for c in columns)}")
            work.append((table.name, sets, where))
        config_rows = await conn.fetchval("SELECT count(*) FROM llm_config")
        print(f"{'llm_config':24} {config_rows:>7} rows (backend only, kept locally)")
        if not apply:
            print("dry run: add --apply to empty these in Supabase")
            return
        # One table at a time: empty, then give the space back (VACUUM FULL), so the database never
        # grows much in between (the emptied rows are new row versions until the vacuum)
        steps = [(name, f'UPDATE public."{name}" SET {sets} WHERE {where}') for name, sets, where in work]
        steps.append(("llm_config", "DELETE FROM llm_config"))
        for name, statement in steps:
            # The publisher may hold a row for a moment: wait for it
            await conn.execute("SET lock_timeout = '60s'")
            print(f"{name}: {await conn.execute(statement)}")  # noqa: S608 - names from config
            for attempt in range(1, 31):
                try:
                    # VACUUM FULL locks the table; the website waits, so only briefly, and again
                    await conn.execute("SET lock_timeout = '2s'")
                    await conn.execute(f'VACUUM (FULL, ANALYZE) public."{name}"')
                    print(f"{name}: vacuumed")
                    break
                except asyncpg.exceptions.LockNotAvailableError:
                    print(f"{name}: busy, attempt {attempt}")
                    await asyncio.sleep(2)
            else:
                print(f"{name}: not vacuumed (run again later)")
        await conn.execute("RESET lock_timeout")
        print(
            f"database after: {await conn.fetchval('SELECT pg_size_pretty(pg_database_size(current_database()))')}"
        )
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "command",
        choices=[
            "snapshot",
            "schema",
            "restore",
            "verify",
            "compare",
            "init-publish",
            "prune-supabase",
        ],
    )
    parser.add_argument("snapshot_dir", nargs="?", type=Path)
    parser.add_argument("--apply", action="store_true", help="prune-supabase: really do it")
    args = parser.parse_args()
    if args.command in ("restore", "verify") and not args.snapshot_dir:
        parser.error(f"{args.command} needs the snapshot directory")
    if args.command == "snapshot":
        asyncio.run(snapshot())
    elif args.command == "schema":
        dump_schema()
    elif args.command == "restore":
        asyncio.run(restore(args.snapshot_dir))
    elif args.command == "verify":
        sys.exit(0 if asyncio.run(verify(args.snapshot_dir)) else 1)
    elif args.command == "compare":
        sys.exit(0 if asyncio.run(compare_content()) else 1)
    elif args.command == "init-publish":
        asyncio.run(init_publish())
    elif args.command == "prune-supabase":
        asyncio.run(prune_supabase(args.apply))


if __name__ == "__main__":
    main()
