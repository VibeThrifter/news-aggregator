"""The website's research requests (Supabase) into the local database (Story INFRA-2)."""

from __future__ import annotations

from backend.app.services.website_requests import pull_requests
from backend.tests.integration._two_databases import execute, fetch, two_databases

SCHEMA = """
CREATE TABLE entity_research (
    entity_key VARCHAR(170) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'unknown',
    status VARCHAR(20) NOT NULL DEFAULT 'nieuw',
    request_event_slug VARCHAR(255),
    requested_count INTEGER NOT NULL DEFAULT 0,
    last_requested_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE relation_research (
    relation_id INTEGER PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'nieuw',
    request_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    requested_count INTEGER NOT NULL DEFAULT 0,
    last_requested_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


async def pull(dbs, table: str) -> dict:
    return await pull_requests(table, local_sessions=dbs.local, remote_sessions=dbs.remote)


async def test_a_tapped_name_comes_over_and_research_keeps_its_own_columns() -> None:
    async with two_databases(SCHEMA) as dbs:
        await execute(
            dbs.local_url,
            "INSERT INTO entity_research (entity_key, name, kind, status, requested_count) "
            "VALUES ('person:a', 'A', 'person', 'klaar', 1)",
        )
        await execute(
            dbs.remote_url,
            """
            INSERT INTO entity_research (entity_key, name, kind, request_event_slug, requested_count,
                                         last_requested_at)
            VALUES ('person:a', 'A', 'unknown', 'nieuws-1', 3, now() - interval '1 hour'),
                   ('org:b', 'B', 'org', 'nieuws-2', 1, now() - interval '2 hours'),
                   ('person:old', 'Oud', 'person', NULL, 1, now() - interval '30 days')
            """,
        )

        assert await pull(dbs, "entity_research") == {"pulled": 2, "merged": 2}

        rows = {
            row["entity_key"]: dict(row)
            for row in await fetch(
                dbs.local_url,
                "SELECT entity_key, kind, status, request_event_slug, requested_count FROM entity_research",
            )
        }
        assert rows["person:a"] == {
            "entity_key": "person:a",
            "kind": "person",  # known locally: stays
            "status": "klaar",  # the research's own
            "request_event_slug": "nieuws-1",
            "requested_count": 3,
        }
        assert rows["org:b"]["status"] == "nieuw"
        assert "person:old" not in rows  # older than the first pull looks back

        # Nothing new: the next pull overlaps the newest request a little and changes nothing
        assert await pull(dbs, "entity_research") == {"pulled": 1, "merged": 0}


async def test_a_newer_request_of_a_link_replaces_the_requested_news() -> None:
    async with two_databases(SCHEMA) as dbs:
        await execute(
            dbs.remote_url,
            "INSERT INTO relation_research (relation_id, request_events, requested_count, last_requested_at) "
            "VALUES (7, '[\"nieuws-1\"]', 1, now() - interval '1 hour')",
        )
        assert (await pull(dbs, "relation_research"))["merged"] == 1

        await execute(
            dbs.remote_url,
            'UPDATE relation_research SET request_events = \'["nieuws-2", "nieuws-1"]\', '
            "requested_count = 2, last_requested_at = now()",
        )
        assert (await pull(dbs, "relation_research"))["merged"] == 1

        rows = await fetch(
            dbs.local_url,
            "SELECT request_events::text AS events, requested_count FROM relation_research",
        )
        assert [dict(row) for row in rows] == [
            {"events": '["nieuws-2", "nieuws-1"]', "requested_count": 2}
        ]
