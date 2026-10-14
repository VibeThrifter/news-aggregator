"""Approved voice finds join the news in the local database (Story INFRA-2, migration 018)."""

from __future__ import annotations

import json

from backend.app.services.voice_search import VoiceSearchService
from backend.tests.integration._two_databases import TwoDatabases, execute, fetch, two_databases

# Local tables of the news and Supabase's queue; both databases get all (only one side is used)
SCHEMA = """
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
    fetched_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    is_international BOOLEAN DEFAULT FALSE,
    source_country VARCHAR(2)
);
CREATE TABLE event_articles (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    similarity_score DOUBLE PRECISION,
    scoring_breakdown JSON,
    linked_at TIMESTAMPTZ NOT NULL,
    UNIQUE (event_id, article_id)
);
CREATE TABLE voice_searches (
    id BIGSERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    perspective VARCHAR(200) NOT NULL,
    gap_key VARCHAR(80),
    candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

FIND = {
    "id": "c1",
    "url": "https://www.boerderij.nl/boeren-reageren",
    "title": "Boeren reageren op het plan",
    "outlet": "Boerderij",
    "is_international": False,
    "country": "nl",
    "published_at": "2026-10-13T08:00:00+00:00",
    "who": "LTO-voorzitter",
    "gist": "De boeren vinden het plan onhaalbaar.",
    "verdict": "open",
    "article_id": None,
}


def service(dbs: TwoDatabases) -> VoiceSearchService:
    return VoiceSearchService(
        session_factory=dbs.local, queue_session_factory=dbs.remote, llm=object(), web_search=None
    )


async def add_search(dbs: TwoDatabases, **find: object) -> None:
    await execute(dbs.local_url, "INSERT INTO events (id, article_count) VALUES (1, 2)")
    await execute(
        dbs.remote_url,
        "INSERT INTO voice_searches (id, event_id, perspective, gap_key, candidates) "
        "VALUES (5, 1, 'Boeren', 'gap:boeren', $1::jsonb)",
        json.dumps([{**FIND, **find}]),
    )


async def candidate(dbs: TwoDatabases) -> dict:
    rows = await fetch(dbs.remote_url, "SELECT candidates::text AS c FROM voice_searches")
    return json.loads(rows[0]["c"])[0]


async def test_an_approved_find_becomes_an_article_of_the_news() -> None:
    async with two_databases(SCHEMA) as dbs:
        await add_search(dbs, verdict="goedgekeurd", reviewed_at="2026-10-13T09:00:00+00:00")

        assert await service(dbs).apply_reviews() == {"linked": 1, "unlinked": 0, "failed": 0}

        article = dict((await fetch(dbs.local_url, "SELECT * FROM articles"))[0])
        assert article["guid"].startswith("voice:") and article["content"] == ""
        assert article["source_name"] == "Boerderij" and article["source_country"] == "NL"
        metadata = json.loads(article["source_metadata"])
        assert metadata["digest"]["nl"] == FIND["gist"] and metadata["voice_search_id"] == 5
        link = dict((await fetch(dbs.local_url, "SELECT * FROM event_articles"))[0])
        found = json.loads(link["scoring_breakdown"])["found_voice"]
        assert (
            found["perspective"] == "Boeren" and found["approved_at"] == "2026-10-13T09:00:00+00:00"
        )
        count = await fetch(dbs.local_url, "SELECT article_count FROM events")
        assert count[0]["article_count"] == 3
        # The find notes its article: the next round leaves it alone
        assert (await candidate(dbs))["article_id"] == article["id"]
        assert await service(dbs).apply_reviews() == {"linked": 0, "unlinked": 0, "failed": 0}


async def test_an_approved_find_of_a_stored_article_only_links_it() -> None:
    async with two_databases(SCHEMA) as dbs:
        await add_search(dbs, verdict="goedgekeurd")
        await execute(
            dbs.local_url,
            "INSERT INTO articles (guid, url, title, content, fetched_at, created_at, updated_at) "
            "VALUES ('rss:1', $1, 'Al bekend', 'tekst', now(), now(), now())",
            FIND["url"],
        )

        await service(dbs).apply_reviews()

        assert len(await fetch(dbs.local_url, "SELECT id FROM articles")) == 1
        assert len(await fetch(dbs.local_url, "SELECT id FROM event_articles")) == 1


async def test_a_withdrawn_approval_takes_the_find_out_again() -> None:
    async with two_databases(SCHEMA) as dbs:
        await add_search(dbs, verdict="goedgekeurd")
        await service(dbs).apply_reviews()
        await execute(
            dbs.remote_url,
            "UPDATE voice_searches SET candidates = jsonb_set(candidates, '{0,verdict}', '\"afgewezen\"')",
        )

        assert await service(dbs).apply_reviews() == {"linked": 0, "unlinked": 1, "failed": 0}

        assert await fetch(dbs.local_url, "SELECT id FROM event_articles") == []
        assert await fetch(dbs.local_url, "SELECT id FROM articles") == []
        count = await fetch(dbs.local_url, "SELECT article_count FROM events")
        assert count[0]["article_count"] == 2
        assert (await candidate(dbs))["article_id"] is None


async def test_an_open_find_is_left_alone() -> None:
    async with two_databases(SCHEMA) as dbs:
        await add_search(dbs)

        assert await service(dbs).apply_reviews() == {"linked": 0, "unlinked": 0, "failed": 0}
        assert await fetch(dbs.local_url, "SELECT id FROM articles") == []
