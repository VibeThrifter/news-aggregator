"""Synthetic propaganda-model database for the Story 11.17 tests. Not collected by pytest.

A tiny SQLite file with the subset of the propaganda-model schema the sync reads, covering:
approved / proposed / replaced / rejected rows, excluded layers (politieke_positie,
machtsvalentie), a maintainer veto, source chains, parenthetical names, the curated aliases and
multi-filter mechanisms (``mechanism_filters``).
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    vervangen BOOLEAN NOT NULL DEFAULT 0);
CREATE TABLE mechanisms (id INTEGER PRIMARY KEY, name TEXT NOT NULL, filter TEXT NOT NULL,
    aard TEXT NOT NULL DEFAULT 'direct', vervangen BOOLEAN NOT NULL DEFAULT 0);
CREATE TABLE mechanism_filters (mechanism_id INTEGER NOT NULL, filter TEXT NOT NULL,
    PRIMARY KEY (mechanism_id, filter));
CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
    primary_role_id INTEGER, description TEXT, metadata JSON, active_from TEXT,
    active_until TEXT, active BOOLEAN DEFAULT 1, vervangen BOOLEAN NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'goedgekeurd');
CREATE TABLE relations (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL, relation_type TEXT NOT NULL, mechanism_id INTEGER,
    description TEXT, certainty REAL, influence REAL, bidirectional BOOLEAN DEFAULT 0,
    active_from TEXT, active_until TEXT, active BOOLEAN DEFAULT 1,
    vervangen BOOLEAN NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'goedgekeurd');
CREATE TABLE sources (id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT,
    source_type TEXT NOT NULL DEFAULT 'nieuwsartikel', publisher TEXT, date_published DATE,
    reliability TEXT NOT NULL DEFAULT 'onbeoordeeld', cluster_key TEXT,
    onderwerp TEXT NOT NULL DEFAULT 'onbepaald');
CREATE TABLE source_locations (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL,
    location_type TEXT NOT NULL, location TEXT NOT NULL);
CREATE TABLE users (username TEXT PRIMARY KEY, role TEXT NOT NULL);
CREATE TABLE arguments (id INTEGER PRIMARY KEY, relation_id INTEGER, entity_id INTEGER,
    role_id INTEGER, mechanism_id INTEGER, parent_argument_id INTEGER, property TEXT,
    property_value TEXT, stance TEXT NOT NULL, claim TEXT NOT NULL, reasoning TEXT,
    status TEXT NOT NULL DEFAULT 'ongecontroleerd', bezwaar_resolutie TEXT,
    contributed_by TEXT, vervangen BOOLEAN NOT NULL DEFAULT 0, smaad_hold INTEGER DEFAULT 0);
CREATE TABLE citations (id INTEGER PRIMARY KEY, argument_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL, quote TEXT, methode TEXT);
"""

LONG_QUOTE = "DPG Media nam in 2020 de Nederlandse uitgeefactiviteiten over. " * 8

ROLES = [
    (1, "mediaeigenaar", "eigendom", 0),
    (2, "politicus", "systeemactor", 0),
    (3, "toezichthouder", "tegenmacht", 0),
    (4, "oude_rol", "flak", 1),
]
MECHANISMS = [
    (1, "eigendomsconcentratie", "eigendom", "direct", 0),
    (2, "commerciele_afhankelijkheid", "advertentie", "direct", 0),
    (3, "bron_afhankelijkheid", "sourcing", "direct", 0),
    (4, "publieke_aanval", "flak", "veld_eigenschap", 0),
    (5, "verantwoording", "tegenmacht", "direct", 0),
    (6, "vervangen_mechanisme", "ideologie", "direct", 1),
]
# mechanism, filter. 1: multi + 'overig' (dropped); 2: no rows (the primary filter only);
# 3: multi (sourcing + ideologie); 4: tagged WITHOUT its primary filter flak (the primary is added);
# 6: replaced mechanism (never used)
MECHANISM_FILTERS = [
    (1, "eigendom"),
    (1, "advertentie"),
    (1, "overig"),
    (3, "ideologie"),
    (3, "sourcing"),
    (4, "ideologie"),
    (5, "tegenmacht"),
    (6, "ideologie"),
]
# id, name, type, role, description, active_from, status, vervangen
ENTITIES = [
    (1, "DPG Media", "mediaorganisatie", 1, "Belgisch mediaconcern.", "2019", "goedgekeurd", 0),
    (2, "Mediahuis", "mediaorganisatie", None, None, None, "goedgekeurd", 0),
    (3, "AD (Algemeen Dagblad)", "mediaorganisatie", None, "Dagblad.", None, "goedgekeurd", 0),
    (4, "de Volkskrant", "mediaorganisatie", None, None, None, "goedgekeurd", 0),
    (5, "Trouw Media", "mediaorganisatie", None, None, None, "goedgekeurd", 0),
    (7, "NU.nl", "mediaorganisatie", None, None, None, "goedgekeurd", 0),
    (
        9,
        "De Telegraaf",
        "mediaorganisatie",
        None,
        "Ochtendkrant van Mediahuis. De machtsvalentie-lading staat op de edge. "
        "Zie ook de kleurmeter.",
        None,
        "goedgekeurd",
        0,
    ),
    (11, "NOS", "omroep", None, None, None, "goedgekeurd", 0),
    (
        20,
        "AIVD (Algemene Inlichtingen- en Veiligheidsdienst)",
        "overheidsinstelling",
        3,
        None,
        None,
        "goedgekeurd",
        0,
    ),
    (
        21,
        "Attje Kuiken (PvdA)",
        "persoon",
        2,
        "Politica. Haar politieke positie is links.",
        None,
        "goedgekeurd",
        0,
    ),
    (22, "Theater Koningsduyn (Castricum)", "stichting", None, None, None, "goedgekeurd", 0),
    (23, "Mark Rutte", "persoon", None, None, None, "goedgekeurd", 0),
    (24, "ABC (Alpha Beta Corp)", "bedrijf", 4, None, None, "goedgekeurd", 0),
    (25, "Alpha Beta Corp", "bedrijf", None, None, None, "goedgekeurd", 0),
    (26, "Élan Médiagroep", "bedrijf", None, None, None, "goedgekeurd", 0),
    (30, "Voorgestelde BV", "bedrijf", None, None, None, "voorgesteld", 0),
    (31, "Oude Naam BV", "bedrijf", None, None, None, "goedgekeurd", 1),
    (32, "Afgewezen BV", "bedrijf", None, None, None, "afgewezen", 0),
]
# id, source, target, type, mechanism, description, certainty, influence, bidirectional,
# active_from, status, vervangen
RELATIONS = [
    (100, 1, 3, "eigendom", 1, "DPG Media bezit het AD.", None, 0.05, 0, "2019", "goedgekeurd", 0),
    (101, 1, 4, "eigendom", 1, None, None, 0.05, 0, "2019-05-01", "goedgekeurd", 0),
    (102, 2, 9, "eigendom", 1, None, 0.9, 0.05, 0, None, "goedgekeurd", 0),
    (103, 11, 7, "bron_van", 3, None, None, 0.05, 0, None, "goedgekeurd", 0),
    (
        104,
        3,
        11,
        "flak",
        4,
        "Het AD valt de NOS aan. De machtsvalentie staat als aspect op deze edge.",
        None,
        0.05,
        0,
        "2021",
        "goedgekeurd",
        0,
    ),
    (105, 1, 30, "eigendom", 1, None, None, 0.05, 0, None, "goedgekeurd", 0),
    (106, 1, 7, "eigendom", 1, None, None, 0.05, 0, None, "voorgesteld", 0),
    (107, 1, 2, "eigendom", 1, None, None, 0.05, 0, None, "goedgekeurd", 1),
    (108, 20, 11, "regulering", 5, None, None, 0.05, 0, None, "goedgekeurd", 0),
    (109, 21, 23, "alliantie", 3, None, None, 0.05, 1, None, "goedgekeurd", 0),
    (110, 2, 11, "adverteerder", 2, None, None, 0.05, 0, None, "goedgekeurd", 0),
    (111, 2, 4, "lidmaatschap", 6, None, None, 0.05, 0, None, "goedgekeurd", 0),
]
# id, title, publisher, date, reliability, cluster, onderwerp
SOURCES = [
    (
        1,
        "Mediamonitor 2021",
        "Commissariaat voor de Media",
        "2021-06-01",
        "academisch",
        "cvdm",
        "nl_systeem",
    ),
    (2, "Jaarverslag DPG Media", "DPG Media", "2022-04-01", "primair", "dpg", "nl_systeem"),
    (3, "Nieuwsbericht overname", "NRC", "2020-01-02", "regulier", None, "onbepaald"),
    (4, "Tegenbericht", "Onbekend", "2020-02-02", "regulier", None, "onbepaald"),
    (5, "Overname Volkskrant", "FD", "2019-05-01", "onbeoordeeld", None, "onbepaald"),
    (6, "Machtsvalentie van de flak-edge", "Eigen", "2023-01-01", "regulier", None, "onbepaald"),
    (7, "Politieke positie van Kuiken", "Krant", "2023-01-01", "regulier", None, "onbepaald"),
    (8, "Eigen synthese", "Project", "2024-01-01", "eigen_synthese", None, "onbepaald"),
    (9, "Kleurmeterverslag", "Krant", "2024-01-01", "regulier", None, "onbepaald"),
    (10, "Advertentiecijfers", "Nielsen", "2022-01-01", "primair", None, "onbepaald"),
    (11, "Over DPG Media", "DPG Media", 2023, "primair", None, "onbepaald"),
    (12, "Voorgestelde bron", "Krant", "2024-01-01", "regulier", None, "onbepaald"),
    (13, "Smaadbron", "Krant", "2024-01-01", "regulier", None, "onbepaald"),
    (14, "Flak-bericht", "Krant", "2021-03-03", "kwaliteitsjournalistiek", None, "onbepaald"),
]
SOURCE_LOCATIONS = [
    (1, 2, "url", "https://www.dpgmedia.nl/jaarverslag"),
    (2, 3, "file", "sources/AI/overname.md"),
    (3, 3, "archive_url", "https://web.archive.org/web/2020/https://nrc.nl/overname"),
    (4, 5, "doi", "10.1234/volkskrant"),
    (5, 1, "isbn", "978-90-000-0000-0"),
]
# id, relation, entity, parent, property, stance, status, bezwaar, author, vervangen, smaad
ARGUMENTS = [
    (1, 100, None, None, None, "supporting", "geverifieerd", None, "bot", 0, 0),
    (2, 100, None, None, "existence", "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (3, None, None, 1, None, "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (4, 100, None, None, None, "contradicting", "ongecontroleerd", None, "bot", 0, 0),
    (5, 101, None, None, None, "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (6, 103, None, None, None, "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (7, 104, None, None, "machtsvalentie", "contextual", "ongecontroleerd", None, "bot", 0, 0),
    (8, None, 21, None, "politieke_positie", "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (9, 104, None, None, None, "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (10, 110, None, None, None, "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (11, None, None, 10, None, "contradicting", "ongecontroleerd", None, "maxime", 0, 0),
    (12, None, 1, None, None, "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (13, 101, None, None, None, "supporting", "voorgesteld", None, "bot", 0, 0),
    (14, 100, None, None, None, "supporting", "ongecontroleerd", None, "bot", 1, 0),
    (15, 100, None, None, None, "supporting", "ongecontroleerd", None, "bot", 0, 1),
    (16, 101, None, None, "influence", "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (17, None, 11, None, "bereik", "supporting", "ongecontroleerd", None, "bot", 0, 0),
    (18, None, None, 8, None, "supporting", "ongecontroleerd", None, "bot", 0, 0),
]
# id, argument, source, quote, methode
CITATIONS = [
    (1, 1, 1, LONG_QUOTE, "verbatim_quote"),
    (2, 2, 2, "DPG Media is eigenaar van het AD.", None),
    (3, 3, 3, None, None),
    (4, 4, 4, "Het AD is onafhankelijk.", None),
    (5, 5, 5, "De Volkskrant valt onder DPG Media.", None),
    (6, 7, 6, "Opent de consensus.", None),
    (7, 8, 7, "Kuiken staat links.", None),
    (8, 9, 8, "Samenvatting.", None),
    (9, 9, 9, "De kleurmeter toont links.", None),
    (10, 9, 14, "Het AD publiceerde een aanval op de NOS.", None),
    (11, 10, 10, "Mediahuis adverteert.", None),
    (12, 12, 11, "DPG Media bestaat.", None),
    (13, 13, 12, "Voorstel.", None),
    (14, 15, 13, "Smaad.", None),
    (15, 16, 5, "Grote invloed.", None),
    (16, 17, 10, "Bereik 1 miljoen.", None),
    (17, 18, 7, "Politieke positie bevestigd.", None),
    (18, 1, 2, "Tweede citaat uit het jaarverslag.", None),
]
USERS = [("maxime", "maintainer"), ("bot", "bijdrager")]


def create_pm_database(root: Path, *, releases: tuple[str, ...] = ("0.2.0", "0.10.1")) -> Path:
    """Create ``<root>/data/propaganda_model.db`` (+ ``<root>/releases``); return the db path."""

    data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    releases_dir = root / "releases"
    releases_dir.mkdir(exist_ok=True)
    for version in releases:
        (releases_dir / f"model-v{version}.json").write_text(json.dumps({"versie": version}))
    (releases_dir / "model-vX.json").write_text("{}")  # ignored: not semver

    path = data_dir / "propaganda_model.db"
    connection = sqlite3.connect(path)
    try:
        connection.executescript(SCHEMA)
        connection.executemany("INSERT INTO roles VALUES (?,?,?,?)", ROLES)
        connection.executemany("INSERT INTO mechanisms VALUES (?,?,?,?,?)", MECHANISMS)
        connection.executemany("INSERT INTO mechanism_filters VALUES (?,?)", MECHANISM_FILTERS)
        connection.executemany(
            "INSERT INTO entities (id, name, type, primary_role_id, description, active_from, "
            "status, vervangen) VALUES (?,?,?,?,?,?,?,?)",
            ENTITIES,
        )
        connection.executemany(
            "INSERT INTO relations (id, source_id, target_id, relation_type, mechanism_id, "
            "description, certainty, influence, bidirectional, active_from, status, vervangen) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            RELATIONS,
        )
        connection.executemany(
            "INSERT INTO sources (id, title, publisher, date_published, reliability, "
            "cluster_key, onderwerp) VALUES (?,?,?,?,?,?,?)",
            SOURCES,
        )
        connection.executemany("INSERT INTO source_locations VALUES (?,?,?,?)", SOURCE_LOCATIONS)
        connection.executemany("INSERT INTO users VALUES (?,?)", USERS)
        connection.executemany(
            "INSERT INTO arguments (id, relation_id, entity_id, parent_argument_id, property, "
            "stance, claim, status, bezwaar_resolutie, contributed_by, vervangen, smaad_hold) "
            "VALUES (?,?,?,?,?,?,'claim',?,?,?,?,?)",
            ARGUMENTS,
        )
        connection.executemany("INSERT INTO citations VALUES (?,?,?,?,?)", CITATIONS)
        connection.commit()
    finally:
        connection.close()
    return path
