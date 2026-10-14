"""Publishing the local working database to Supabase (Story INFRA-2), on two real databases."""

from __future__ import annotations

import json

import pytest

from backend.app.services.publish_service import PublishedTable, PublishService
from backend.tests.integration._two_databases import TwoDatabases, execute, fetch, two_databases

SCHEMA = """
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE,
    title TEXT NOT NULL,
    meta JSON,
    tags TEXT[] NOT NULL DEFAULT '{}',
    score REAL,
    centroid TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE event_articles (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL,
    UNIQUE (event_id, article_id)
);
CREATE TABLE aliases (
    alias TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (alias, entity_id)
);
CREATE TABLE research (
    entity_key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'nieuw',
    summary TEXT,
    prominence JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_count INTEGER NOT NULL DEFAULT 0,
    last_requested_at TIMESTAMPTZ
);
"""

TABLES = (
    PublishedTable("events", skip=frozenset({"centroid"})),
    PublishedTable("event_articles"),
    PublishedTable("aliases", key=("alias", "entity_id")),
    PublishedTable(
        "research",
        key=("entity_key",),
        skip=frozenset({"summary", "prominence"}),
        website=frozenset({"requested_count", "last_requested_at"}),
    ),
)


async def make_service(dbs: TwoDatabases) -> PublishService:
    service = PublishService(
        local_sessions=dbs.local, remote_sessions=dbs.remote, tables=TABLES, batch_rows=2
    )
    assert await service.ensure_local_schema() == []
    return service


async def remote_rows(dbs: TwoDatabases, sql: str) -> list[dict]:
    return [dict(row) for row in await fetch(dbs.remote_url, sql)]


async def test_inserts_updates_and_deletes_reach_supabase_without_local_columns() -> None:
    async with two_databases(SCHEMA) as dbs:
        service = await make_service(dbs)
        await execute(
            dbs.local_url,
            """
            INSERT INTO events (slug, title, meta, tags, score, centroid)
            VALUES ('a', 'Eerste', '{"spectrum": {"links": 2}}', '{x,y}', 0.1, 'vector'),
                   ('b', 'Tweede', NULL, '{}', NULL, 'vector');
            INSERT INTO event_articles (event_id, article_id) VALUES (1, 10), (1, 11), (2, 12);
            INSERT INTO aliases (alias, entity_id) VALUES ('rutte', 1), ('mark rutte', 1);
            """,
        )

        run = await service.publish_once()

        assert run["upserted"] == {"events": 2, "event_articles": 3, "aliases": 2}
        events = await remote_rows(dbs, "SELECT * FROM events ORDER BY id")
        assert [e["title"] for e in events] == ["Eerste", "Tweede"]
        assert all(e["centroid"] is None for e in events)  # stays local
        assert json.loads(events[0]["meta"]) == {"spectrum": {"links": 2}}
        assert events[0]["tags"] == ["x", "y"] and events[0]["score"] == pytest.approx(0.1)
        assert len(await remote_rows(dbs, "SELECT * FROM event_articles")) == 3

        await execute(
            dbs.local_url,
            """
            UPDATE events SET title = 'Eerste (bijgewerkt)' WHERE id = 1;
            DELETE FROM events WHERE id = 2;
            DELETE FROM aliases WHERE alias = 'rutte';
            """,
        )
        run = await service.publish_once()

        assert run["deleted"] == {"aliases": 1, "event_articles": 1, "events": 1}
        assert run["upserted"] == {"events": 1}
        assert await remote_rows(dbs, "SELECT id, title FROM events") == [
            {"id": 1, "title": "Eerste (bijgewerkt)"}
        ]
        assert await remote_rows(dbs, "SELECT alias FROM aliases") == [{"alias": "mark rutte"}]
        assert await service.queue_length() == 0


async def test_a_change_of_local_columns_only_sends_nothing() -> None:
    async with two_databases(SCHEMA) as dbs:
        service = await make_service(dbs)
        await execute(dbs.local_url, "INSERT INTO events (slug, title) VALUES ('a', 'Een')")
        await service.publish_once()

        await execute(dbs.local_url, "UPDATE events SET centroid = 'nieuwe vector'")
        run = await service.publish_once()

        assert run["queued"] == 1
        assert run["upserted"] == {} and run["unchanged"] == 1


async def test_a_new_row_takes_the_unique_key_of_a_removed_one() -> None:
    async with two_databases(SCHEMA) as dbs:
        service = await make_service(dbs)
        await execute(
            dbs.local_url,
            "INSERT INTO events (slug, title) VALUES ('a', 'Een');"
            "INSERT INTO event_articles (event_id, article_id) VALUES (1, 10);",
        )
        await service.publish_once()

        # Same (event_id, article_id), new id: the delete must go first in Supabase
        await execute(
            dbs.local_url,
            "DELETE FROM event_articles WHERE id = 1;"
            "INSERT INTO event_articles (event_id, article_id) VALUES (1, 10);",
        )
        run = await service.publish_once()

        assert run["refused"] == 0
        assert await remote_rows(dbs, "SELECT id, article_id FROM event_articles") == [
            {"id": 2, "article_id": 10}
        ]


async def test_the_website_columns_are_never_overwritten() -> None:
    async with two_databases(SCHEMA) as dbs:
        service = await make_service(dbs)
        await execute(
            dbs.local_url, "INSERT INTO research (entity_key, summary) VALUES ('person:a', 'notes')"
        )
        await service.publish_once()
        # A reader asks for it in the app (Supabase)
        await execute(
            dbs.remote_url,
            "UPDATE research SET requested_count = 5, last_requested_at = now() WHERE entity_key = 'person:a'",
        )

        await execute(dbs.local_url, "UPDATE research SET status = 'klaar'")
        await service.publish_once()

        rows = await remote_rows(dbs, "SELECT status, summary, requested_count FROM research")
        assert rows == [{"status": "klaar", "summary": None, "requested_count": 5}]


async def test_a_refused_row_waits_in_the_queue_and_goes_later() -> None:
    async with two_databases(SCHEMA) as dbs:
        service = await make_service(dbs)
        await execute(dbs.local_url, "INSERT INTO events (slug, title) VALUES ('a', 'Een')")
        await service.publish_once()
        # Supabase has a row the local database does not know: the slug is taken there
        await execute(
            dbs.remote_url, "INSERT INTO events (id, slug, title) VALUES (99, 'b', 'Vreemd')"
        )
        await execute(
            dbs.local_url,
            "INSERT INTO events (slug, title) VALUES ('b', 'Twee'), ('c', 'Drie')",
        )

        run = await service.publish_once()

        assert run["refused"] == 1
        assert run["upserted"] == {"events": 1}
        assert await service.queue_length() == 1
        assert await remote_rows(dbs, "SELECT slug FROM events ORDER BY slug") == [
            {"slug": "a"},
            {"slug": "b"},
            {"slug": "c"},
        ]

        await execute(dbs.remote_url, "DELETE FROM events WHERE id = 99")
        run = await service.publish_once()

        assert run["refused"] == 0 and run["upserted"] == {"events": 1}
        assert await service.queue_length() == 0


async def test_seeded_rows_are_not_sent_again() -> None:
    async with two_databases(SCHEMA) as dbs:
        for url in (dbs.local_url, dbs.remote_url):
            await execute(
                url, "INSERT INTO events (id, slug, title) VALUES (1, 'a', 'Een'), (2, 'b', 'Twee')"
            )
        service = await make_service(dbs)

        assert (await service.seed_state(["events"]))["events"] == 2
        await execute(dbs.local_url, "UPDATE events SET title = title")  # every row noted
        run = await service.publish_once()

        assert run["queued"] == 2 and run["unchanged"] == 2 and run["upserted"] == {}


async def test_a_truncate_empties_the_table_in_supabase() -> None:
    async with two_databases(SCHEMA) as dbs:
        service = await make_service(dbs)
        await execute(
            dbs.local_url, "INSERT INTO aliases (alias, entity_id) VALUES ('a', 1), ('b', 2)"
        )
        await service.publish_once()

        await execute(dbs.local_url, "TRUNCATE aliases")
        run = await service.publish_once()

        assert run["deleted"] == {"aliases": 2}
        assert await remote_rows(dbs, "SELECT * FROM aliases") == []


async def test_a_change_committed_after_a_later_one_is_not_lost() -> None:
    """Queue numbers follow the writes, not the commits: a run must not skip a slow writer."""

    async with two_databases(SCHEMA) as dbs:
        import asyncpg

        service = await make_service(dbs)
        slow = await asyncpg.connect(dbs.local_url)
        try:
            transaction = slow.transaction()
            await transaction.start()
            await slow.execute("INSERT INTO events (slug, title) VALUES ('slow', 'Traag')")  # seq 1
            await execute(dbs.local_url, "INSERT INTO events (slug, title) VALUES ('fast', 'Snel')")
            await service.publish_once()
            await transaction.commit()
        finally:
            await slow.close()

        await service.publish_once()

        assert await remote_rows(dbs, "SELECT slug FROM events ORDER BY slug") == [
            {"slug": "fast"},
            {"slug": "slow"},
        ]


async def test_a_column_supabase_does_not_have_yet_is_left_out_until_it_has() -> None:
    async with two_databases(SCHEMA) as dbs:
        service = await make_service(dbs)
        await execute(dbs.local_url, "ALTER TABLE aliases ADD COLUMN note TEXT")
        await execute(
            dbs.local_url, "INSERT INTO aliases (alias, entity_id, note) VALUES ('a', 1, 'n')"
        )

        run = await service.publish_once()
        assert run["upserted"] == {"aliases": 1}

        # The migration reaches Supabase: every row is compared again and sent with the new column
        await execute(dbs.remote_url, "ALTER TABLE aliases ADD COLUMN note TEXT")
        service._remote_columns = {}
        await execute(dbs.local_url, "INSERT INTO aliases (alias, entity_id) VALUES ('b', 2)")
        run = await service.publish_once()

        assert run["upserted"] == {"aliases": 2}
        assert await remote_rows(dbs, "SELECT alias, note FROM aliases ORDER BY alias") == [
            {"alias": "a", "note": "n"},
            {"alias": "b", "note": None},
        ]
