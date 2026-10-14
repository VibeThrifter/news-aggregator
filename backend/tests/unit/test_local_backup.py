"""The daily backup of the local working database (Story INFRA-2)."""

from __future__ import annotations

import os
import time
from datetime import timedelta

import pytest

from backend.app.core import scheduler as module
from backend.app.core.config import Settings
from backend.app.services.local_backup import backup_local_database, latest_backup_age


def make_settings(tmp_path, **overrides) -> Settings:
    values = {
        "database_url": "postgresql+asyncpg://me@127.0.0.1:5432/news_aggregator",
        "supabase_database_url": "postgresql+asyncpg://p@aws-1-eu-west-1.pooler.supabase.com:5432/postgres",
        "local_backup_dir": str(tmp_path),
        **overrides,
    }
    return Settings(_env_file=None, **values)


def touch(path, hours_ago: float) -> None:
    path.write_bytes(b"dump")
    moment = time.time() - hours_ago * 3600
    os.utime(path, (moment, moment))


def test_the_age_of_the_newest_backup(tmp_path) -> None:
    settings = make_settings(tmp_path)
    assert latest_backup_age(settings) is None

    touch(tmp_path / "news-20261012-010000.dump", hours_ago=30)
    touch(tmp_path / "news-20261013-010000.dump", hours_ago=5)
    (tmp_path / "other.dump").write_bytes(b"not ours")

    age = latest_backup_age(settings)
    assert age is not None and timedelta(hours=4.9) < age < timedelta(hours=5.1)


@pytest.mark.parametrize("hours_ago, runs", [(5, 0), (25, 1), (None, 1)])
async def test_a_backup_is_made_when_the_newest_is_a_day_old(
    monkeypatch, tmp_path, hours_ago, runs
) -> None:
    if hours_ago is not None:
        touch(tmp_path / "news-20261013-010000.dump", hours_ago=hours_ago)
    made: list[str] = []

    async def backup(settings):
        made.append(settings.local_backup_dir)
        return {"file": "x", "megabytes": 0.0, "kept": 1, "removed": []}

    monkeypatch.setattr(module, "backup_local_database", backup)
    scheduler = module.NewsAggregatorScheduler()
    scheduler.settings = make_settings(tmp_path)

    await scheduler._local_backup_when_due()

    assert len(made) == runs
    if runs:
        assert scheduler._local_backup_last_run["success"] is True


async def test_supabase_is_never_dumped(tmp_path) -> None:
    settings = make_settings(
        tmp_path, database_url="postgresql+asyncpg://p@aws-1-eu-west-1.pooler.supabase.com:5432/db"
    )
    with pytest.raises(RuntimeError, match="Supabase"):
        await backup_local_database(settings)
