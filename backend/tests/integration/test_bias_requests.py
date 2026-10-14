"""Gekleurde zinnen op verzoek (Story 10.7): queued in the app, run by the backend."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from backend.app.services.bias_requests import BiasRequestService
from backend.tests.integration._two_databases import TwoDatabases, execute, fetch, two_databases

MIGRATIONS = Path(__file__).resolve().parents[3] / "database" / "migrations"

# The tables of the news that both sides need (Supabase has the published copy)
NEWS = """
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    article_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    guid VARCHAR(512) NOT NULL UNIQUE,
    url VARCHAR(1024) NOT NULL UNIQUE,
    title VARCHAR(512) NOT NULL,
    content TEXT NOT NULL,
    source_name VARCHAR(255),
    source_metadata JSON,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_international BOOLEAN DEFAULT FALSE,
    source_country VARCHAR(2)
);
CREATE TABLE event_articles (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    similarity_score DOUBLE PRECISION,
    scoring_breakdown JSON,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, article_id)
);
CREATE TABLE article_bias_analyses (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE
);
"""

# Supabase: the news, the access codes (009) and the requests (019)
SUPABASE = (
    NEWS
    + (MIGRATIONS / "009_stemmen_zoeken.sql").read_text()
    + (MIGRATIONS / "019_bias_op_verzoek.sql").read_text()
)

PRO = "pf-pro-abcdefghijklmnop"
ADMIN = "pf-admin-abcdefghijklmnop"


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


async def rpc(dbs: TwoDatabases, sql: str, *args: object) -> dict | None:
    value = (await fetch(dbs.remote_url, f"select {sql} as v", *args))[0]["v"]
    return json.loads(value) if value is not None else None


async def add_codes(dbs: TwoDatabases) -> None:
    await execute(
        dbs.remote_url,
        "INSERT INTO access_codes (code_hash, role) VALUES ($1, 'pro'), ($2, 'admin')",
        code_hash(PRO),
        code_hash(ADMIN),
    )
    await execute(dbs.remote_url, "INSERT INTO events (id) VALUES (1)")


async def test_pro_and_admin_may_request_and_every_reader_sees_it() -> None:
    async with two_databases(SUPABASE) as dbs:
        await add_codes(dbs)

        assert await rpc(dbs, "access_code_role($1)", PRO) == {
            "role": "pro",
            "can_search": False,
            "can_analyze_bias": True,
        }
        assert (await rpc(dbs, "access_code_role($1)", ADMIN))["can_analyze_bias"] is True
        assert (await rpc(dbs, "access_code_role($1)", "pf-onbekend-0000000"))[
            "can_analyze_bias"
        ] is False

        first = await rpc(dbs, "request_bias_analysis($1, $2)", PRO, 1)
        assert first["ok"] is True
        assert first["request"]["status"] == "wachtrij"
        # A second click (or another user) gets the same request back
        again = await rpc(dbs, "request_bias_analysis($1, $2)", ADMIN, 1)
        assert again["request"]["id"] == first["request"]["id"]

        assert (await rpc(dbs, "request_bias_analysis($1, $2)", "pf-onbekend-0000000", 1))[
            "reason"
        ] == "geen_toegang"
        assert (await rpc(dbs, "request_bias_analysis($1, $2)", PRO, 99))[
            "reason"
        ] == "onbekend_event"

        public = await rpc(dbs, "bias_request_for_event($1)", 1)
        assert public["id"] == first["request"]["id"]
        assert public["analysed"] == 0
        assert "requested_by" not in public
        assert await rpc(dbs, "bias_request_for_event($1)", 2) is None

        # The app reads the table only through the functions
        rows = await fetch(
            dbs.remote_url, "select has_table_privilege('anon', 'bias_requests', 'select') as v"
        )
        assert rows[0]["v"] is False


async def test_a_code_has_a_daily_limit() -> None:
    async with two_databases(SUPABASE) as dbs:
        await add_codes(dbs)
        await execute(
            dbs.remote_url,
            "INSERT INTO events (id) SELECT generate_series(2, 22)",
        )
        for event_id in range(1, 21):
            assert (await rpc(dbs, "request_bias_analysis($1, $2)", PRO, event_id))["ok"] is True
        assert (await rpc(dbs, "request_bias_analysis($1, $2)", PRO, 21))["reason"] == "limiet"
        # Another code still may
        assert (await rpc(dbs, "request_bias_analysis($1, $2)", ADMIN, 21))["ok"] is True


QUEUE = """
CREATE TABLE bias_requests (
    id BIGSERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'wachtrij',
    status_reason TEXT,
    total INTEGER,
    done INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

ARTICLES = [
    # id, outlet, hours ago, international, text, analysed
    (1, "NOS", 1, False, "Het kabinet valt.", False),
    (2, "NOS", 5, False, "Het kabinet wankelt.", False),
    (3, "NU.nl", 3, False, "Kabinet gevallen.", False),
    (4, "BBC", 2, True, "The Dutch cabinet fell.", False),
    (5, "Trouw", 2, False, "", False),
    (6, "AD", 2, False, "Het kabinet is gevallen.", True),
]


async def add_news(dbs: TwoDatabases) -> None:
    await execute(dbs.local_url, "INSERT INTO events (id) VALUES (1)")
    for article_id, outlet, hours, international, content, analysed in ARTICLES:
        await execute(
            dbs.local_url,
            "INSERT INTO articles (id, guid, url, title, content, source_name, published_at, "
            "is_international) "
            "VALUES ($1, $2, $3, $4, $5, $6, now() - make_interval(hours => $7), $8)",
            article_id,
            f"guid-{article_id}",
            f"https://example.org/{article_id}",
            f"Artikel {article_id}",
            content,
            outlet,
            hours,
            international,
        )
        await execute(
            dbs.local_url,
            "INSERT INTO event_articles (event_id, article_id) VALUES (1, $1)",
            article_id,
        )
        if analysed:
            await execute(
                dbs.local_url,
                "INSERT INTO article_bias_analyses (article_id) VALUES ($1)",
                article_id,
            )
    await execute(dbs.remote_url, "INSERT INTO bias_requests (id, event_id) VALUES (7, 1)")


async def test_the_backend_analyses_the_dutch_articles_without_analysis() -> None:
    async with two_databases(NEWS + QUEUE) as dbs:
        await add_news(dbs)
        analysed: list[int] = []

        async def analyze(article_id: int, *, correlation_id: str | None = None) -> None:
            if article_id == 3:
                raise RuntimeError("LLM gaf geen JSON")
            analysed.append(article_id)

        service = BiasRequestService(
            session_factory=dbs.local, queue_session_factory=dbs.remote, analyze=analyze
        )
        # Every outlet's newest first: NOS 1 h, NU.nl 3 h, then NOS 5 h. Not: the foreign article,
        # the one without text, the one with an analysis
        assert await service.articles_for(1) == [1, 3, 2]

        stats = await service.run_pending(limit=2)
        assert stats["ran"] == 1
        assert stats["done"] == 1
        assert analysed == [1, 2]

        row = (await fetch(dbs.remote_url, "select * from bias_requests where id = 7"))[0]
        assert row["status"] == "klaar"
        assert (row["total"], row["done"], row["failed"]) == (3, 2, 1)
        assert row["finished_at"] is not None


async def test_a_cap_keeps_one_article_of_every_outlet_first() -> None:
    async with two_databases(NEWS + QUEUE) as dbs:
        await add_news(dbs)
        service = BiasRequestService(
            session_factory=dbs.local, queue_session_factory=dbs.remote, article_cap=2
        )
        assert await service.articles_for(1) == [1, 3]


async def test_a_request_of_which_nothing_works_fails() -> None:
    async with two_databases(NEWS + QUEUE) as dbs:
        await add_news(dbs)

        async def analyze(article_id: int, *, correlation_id: str | None = None) -> None:
            raise RuntimeError("sessielimiet")

        service = BiasRequestService(
            session_factory=dbs.local, queue_session_factory=dbs.remote, analyze=analyze
        )
        stats = await service.run_pending(limit=1)
        assert stats["failed"] == 1

        row = (await fetch(dbs.remote_url, "select * from bias_requests where id = 7"))[0]
        assert row["status"] == "fout"
        assert row["status_reason"] == "sessielimiet"
        assert (row["done"], row["failed"]) == (0, 3)
