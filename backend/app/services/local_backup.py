"""Daily backup of the local working database (Story INFRA-2).

Supabase only holds what the website shows. The vectors, normalized texts, raw LLM responses, the
prompts (``llm_config``) and the research notes exist only in the local database. Once a day (the
newest backup is a day old) ``pg_dump`` writes it to ``LOCAL_BACKUP_DIR`` (custom format, compressed);
the last ``LOCAL_BACKUP_KEEP`` are kept. Restore with
``pg_restore --clean --if-exists -d <db> <file>``.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.engine import make_url

from backend.app.core.config import Settings

PREFIX = "news-"
SUFFIX = ".dump"


def latest_backup_age(settings: Settings) -> timedelta | None:
    """How old the newest backup is (None: there is none)."""

    backups = sorted(Path(settings.local_backup_dir).glob(f"{PREFIX}*{SUFFIX}"))
    if not backups:
        return None
    newest = max(path.stat().st_mtime for path in backups)
    return datetime.now() - datetime.fromtimestamp(newest)


async def backup_local_database(settings: Settings) -> dict[str, Any]:
    """pg_dump of DATABASE_URL into the backup directory; older backups beyond the limit go."""

    url = make_url(settings.database_url)
    if "supabase" in (url.host or ""):
        # A dump of Supabase is egress: the backup is of the local database only
        raise RuntimeError("DATABASE_URL is Supabase, not the local working database")
    target_dir = Path(settings.local_backup_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{PREFIX}{datetime.now():%Y%m%d-%H%M%S}{SUFFIX}"
    partial = target.with_suffix(".partial")

    env = dict(os.environ)
    if url.password:
        env["PGPASSWORD"] = str(url.password)
    dsn = url.set(drivername="postgresql", password=None).render_as_string(hide_password=False)
    process = await asyncio.create_subprocess_exec(
        settings.pg_dump_path,
        "--format=custom",
        "--compress=6",
        "--no-owner",
        f"--file={partial}",
        f"--dbname={dsn}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"pg_dump failed: {stderr.decode(errors='replace')[-500:]}")
    partial.rename(target)

    backups = sorted(target_dir.glob(f"{PREFIX}*{SUFFIX}"))
    removed = backups[: max(len(backups) - settings.local_backup_keep, 0)]
    for old in removed:
        old.unlink(missing_ok=True)
    return {
        "file": str(target),
        "megabytes": round(target.stat().st_size / 1e6, 1),
        "kept": len(backups) - len(removed),
        "removed": [old.name for old in removed],
    }
