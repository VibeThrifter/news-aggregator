"""Two throwaway Postgres databases: one as the local working database, one as Supabase.

Story INFRA-2 publishes from the local database to Supabase with Postgres features (triggers,
jsonb), so these tests need a real Postgres. They use the local server (``TEST_POSTGRES_URL``,
default the local working database's server) and are skipped when there is none.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

ADMIN_URL = os.environ.get("TEST_POSTGRES_URL", "postgresql://localhost:5432/postgres")


@dataclass
class TwoDatabases:
    local: async_sessionmaker[AsyncSession]
    remote: async_sessionmaker[AsyncSession]
    local_url: str
    remote_url: str


def _with_database(url: str, name: str) -> str:
    base, _, _ = url.rpartition("/")
    return f"{base}/{name}"


async def _admin() -> asyncpg.Connection:
    try:
        return await asyncpg.connect(ADMIN_URL, timeout=3)
    except Exception as exc:  # no local Postgres: these tests cannot run here
        pytest.skip(f"no Postgres at TEST_POSTGRES_URL ({exc.__class__.__name__})")


@asynccontextmanager
async def two_databases(schema: str) -> AsyncIterator[TwoDatabases]:
    """Two new databases with ``schema`` in both; dropped afterwards."""

    admin = await _admin()
    suffix = uuid.uuid4().hex[:8]
    names = [f"publish_test_local_{suffix}", f"publish_test_remote_{suffix}"]
    engines: list[AsyncEngine] = []
    try:
        for name in names:
            await admin.execute(f'CREATE DATABASE "{name}"')
        urls = [_with_database(ADMIN_URL, name) for name in names]
        for url in urls:
            connection = await asyncpg.connect(url)
            try:
                await connection.execute(schema)
            finally:
                await connection.close()
        engines = [
            create_async_engine(url.replace("postgresql://", "postgresql+asyncpg://"))
            for url in urls
        ]
        yield TwoDatabases(
            local=async_sessionmaker(engines[0], expire_on_commit=False),
            remote=async_sessionmaker(engines[1], expire_on_commit=False),
            local_url=urls[0],
            remote_url=urls[1],
        )
    finally:
        for engine in engines:
            await engine.dispose()
        for name in names:
            await admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await admin.close()


async def fetch(url: str, sql: str, *args: object) -> list[asyncpg.Record]:
    connection = await asyncpg.connect(url)
    try:
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


async def execute(url: str, sql: str, *args: object) -> None:
    connection = await asyncpg.connect(url)
    try:
        await connection.execute(sql, *args)
    finally:
        await connection.close()
