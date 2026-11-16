# ruff: noqa: S101
"""Zelfde tekst (Story 14.27): the job stores the groups on the links, in a real Postgres."""

from __future__ import annotations

import json

from backend.app.services.copy_detection import CopyDetectionService
from backend.tests.integration._two_databases import execute, fetch, two_databases

SCHEMA = """
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    archived_at TIMESTAMPTZ
);
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    url VARCHAR(1024) NOT NULL UNIQUE,
    title VARCHAR(512) NOT NULL,
    content TEXT NOT NULL,
    source_name VARCHAR(255),
    published_at TIMESTAMPTZ,
    is_international BOOLEAN DEFAULT FALSE
);
CREATE TABLE event_articles (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    scoring_breakdown JSON,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, article_id)
);
CREATE TABLE pm_entities (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL);
CREATE TABLE pm_aliases (alias TEXT NOT NULL, entity_id INTEGER NOT NULL);
CREATE TABLE pm_relations (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    active_until TEXT
);
INSERT INTO pm_entities VALUES
    (1, 'DPG Media', 'mediaorganisatie'), (2, 'Mediahuis', 'mediaorganisatie'),
    (579, 'Mediahuis Nederland', 'bedrijf'), (3, 'AD (Algemeen Dagblad)', 'mediaorganisatie'),
    (6, 'Het Parool', 'mediaorganisatie'), (88, 'RTL Nieuws', 'mediaorganisatie'),
    (9, 'De Telegraaf', 'mediaorganisatie'), (11, 'NOS', 'mediaorganisatie'),
    (31, 'Talpa Network', 'bedrijf');
INSERT INTO pm_aliases VALUES ('AD', 3), ('Het Parool', 6), ('RTL Nieuws', 88), ('NOS', 11);
INSERT INTO pm_relations VALUES
    (1, 1, 3, 'eigendom', NULL), (2, 1, 6, 'eigendom', NULL), (3, 1, 88, 'eigendom', NULL),
    (4, 579, 9, 'eigendom', NULL), (5, 2, 579, 'eigendom', NULL),
    (6, 31, 9, 'eigendom', '2017'), (7, 1, 9, 'invloed', NULL);
"""

AGENCY = (
    "De drie vakantieparken van realityster Peter Gillis die gedwongen in de verkoop gaan, "
    "kunnen ruim 27 miljoen euro opleveren. Dat is het totaalbedrag dat donderdag bij veilingen "
    "is geboden voor de parken, die door schuldeiser Marc van Rooi worden verkocht. Deze "
    "vleesondernemer leende in 2023 miljoenen uit aan het vakantieparkenbedrijf Oostappen Groep, "
    "maar die betaalde sinds januari 2025 geen rente meer. Het is nog niet beslist of de parken "
    "ook voor het hoogste bod worden verkocht."
)
OWN = (
    "Voor de campings van Peter Gillis is op de veiling in totaal zo'n 27 miljoen euro geboden. "
    "Zakenman Marc van Rooi, die de parken laat veilen omdat hij geld terug wil zien, kiest "
    "volgende week een koper. Gillis zelf zat niet in de zaal. Een woordvoerder van de "
    "veilingmeester wilde niet zeggen hoeveel bieders er waren en of er ook buitenlandse "
    "partijen meeboden."
)
ARTICLES = [
    # id, outlet, url, content, minutes after 13:41
    (1, "RTL Nieuws", "https://www.rtl.nl/boulevard/artikel/5656608/gillis", AGENCY, 0),
    (2, "De Telegraaf", "https://www.telegraaf.nl/entertainment/162446728.html", AGENCY, 12),
    (3, "NOS", "https://nos.nl/artikel/2590000-gillis", OWN, 30),
    (4, "AD", "https://www.ad.nl/politiek/flater~a43d58b6/", OWN + " " + AGENCY[:200], 40),
    (5, "Het Parool", "https://www.parool.nl/nederland/flater~b43d58b6/", OWN, 45),
]


async def seed(url: str) -> None:
    await execute(url, "INSERT INTO events (id) VALUES (1), (2)")
    for article_id, outlet, link, content, minutes in ARTICLES:
        await execute(
            url,
            "INSERT INTO articles (id, url, title, content, source_name, published_at) "
            "VALUES ($1, $2, $3, $4, $5, "
            "'2026-10-01 13:41+00'::timestamptz + make_interval(mins => $6))",
            article_id,
            link,
            f"Artikel {article_id}",
            content,
            outlet,
            minutes,
        )
    # News item 1: the agency text at RTL and De Telegraaf, the NOS in its own words. A link
    # already holds what the clustering scored
    for article_id in (1, 2, 3):
        await execute(
            url,
            "INSERT INTO event_articles (event_id, article_id, scoring_breakdown) "
            "VALUES (1, $1, $2::json)",
            article_id,
            json.dumps({"final": 0.8}),
        )
    # News item 2: one article of DPG Media in two titles (one code)
    for article_id in (4, 5):
        await execute(
            url, "INSERT INTO event_articles (event_id, article_id) VALUES (2, $1)", article_id
        )


async def copies(url: str) -> dict[int, dict | None]:
    rows = await fetch(
        url, "SELECT article_id, scoring_breakdown::text AS sb FROM event_articles ORDER BY 1"
    )
    result = {}
    for row in rows:
        breakdown = json.loads(row["sb"]) if row["sb"] else {}
        result[row["article_id"]] = breakdown.get("copy")
    return result


async def test_the_job_stores_the_groups_and_only_compares_what_changed() -> None:
    async with two_databases(SCHEMA) as dbs:
        await seed(dbs.local_url)
        service = CopyDetectionService(session_factory=dbs.local, min_probability=0.5)

        dry = await service.refresh_recent(hours=24 * 365 * 5, dry_run=True)
        assert dry["dry_run"] and dry["updated_links"] == 4
        assert all(value is None for value in (await copies(dbs.local_url)).values())

        first = await service.refresh_recent(hours=24 * 365 * 5)
        assert (first["events"], first["groups"], first["updated_links"]) == (2, 2, 4)
        stored = await copies(dbs.local_url)
        assert stored[3] is None
        assert stored[1]["group"] == stored[2]["group"] == 1
        assert stored[1]["source"] == "persbureau" and stored[1]["likely_agency"] == "ANP"
        assert stored[1]["share"] == 1.0 and stored[1]["match"] == 2
        # One article of one publisher, under one code: shared within DPG Media
        assert (stored[4]["source"], stored[4]["publisher"]) == ("uitgever", "DPG Media")
        assert stored[4]["group"] == 4 and stored[5]["group"] == 4

        # What the clustering stored stays
        rows = await fetch(
            dbs.local_url,
            "SELECT scoring_breakdown::text AS sb FROM event_articles WHERE article_id = 1",
        )
        assert json.loads(rows[0]["sb"])["final"] == 0.8

        # Nothing changed: nothing is compared again
        again = await service.refresh_recent(hours=24 * 365 * 5)
        assert (again["events"], again["updated_links"]) == (0, 0)

        # De Telegraaf leaves the news item: RTL is no longer a copy of anything there
        await execute(dbs.local_url, "DELETE FROM event_articles WHERE article_id = 2")
        after = await service.refresh_recent(hours=24 * 365 * 5)
        assert (after["events"], after["updated_links"]) == (1, 1)
        assert (await copies(dbs.local_url))[1] is None

        groups = await service.stored_groups(2)
        assert len(groups) == 1 and groups[0]["source"] == "uitgever"
        assert [a["outlet"] for a in groups[0]["articles"]] == ["AD", "Het Parool"]


async def test_owners_follow_the_current_ownership_in_the_propaganda_model() -> None:
    async with two_databases(SCHEMA) as dbs:
        service = CopyDetectionService(session_factory=dbs.local)
        async with dbs.local() as session:
            await service._load_publishers(
                session, ["AD", "De Telegraaf", "NOS", "RTL Nieuws", "NineForNews"]
            )
        # Talpa's ownership ended in 2017 and DPG's "invloed" is no ownership
        assert service._publishers == {
            "ad": "DPG Media",
            "de telegraaf": "Mediahuis",
            "nos": "",
            "rtl nieuws": "DPG Media",
            "ninefornews": "",
        }
        assert service._know_publishers
