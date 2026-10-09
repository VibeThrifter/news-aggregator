# ruff: noqa: S101
"""Tests for the propaganda-model reader + transformer (Story 11.17)."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.app.db.models import PmArgument, PmMechanism
from backend.app.services import propaganda_model_sync as pm
from backend.app.services.propaganda_model_sync import (
    CERTAINTY_PLAUSIBLE,
    CERTAINTY_UNCERTAIN,
    CERTAINTY_WELL_SUPPORTED,
    FILTERS,
    RELATION_TYPE_PRIORITY,
    ExcludedLayerError,
    PmRawData,
    assert_no_excluded_layers,
    certainty_label,
    connect_read_only,
    db_fingerprint,
    display_name,
    generate_aliases,
    latest_release_version,
    pm_slug,
    read_pm_database,
    relation_filters,
    relation_priority,
    relation_sort_key,
    scrub_text,
    transform,
    truncate_quote,
    version_string,
)
from backend.tests.unit._pm_fixtures import create_pm_database

MIGRATION = (
    Path(__file__).resolve().parents[3] / "database" / "migrations" / ("005_propagandamodel.sql")
)
MIGRATION_010 = MIGRATION.with_name("010_pm_argumenten.sql")
MIGRATION_016 = MIGRATION.with_name("016_besluitvorming.sql")
SYNCED_AT = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


@pytest.fixture()
def pm_db(tmp_path: Path) -> Path:
    return create_pm_database(tmp_path / "propaganda-model")


@pytest.fixture()
def snapshot(pm_db: Path) -> pm.PmSnapshot:
    return transform(read_pm_database(pm_db), synced_at=SYNCED_AT)


def _by_id(rows):
    return {row["id"]: row for row in rows}


# ------------------------------------------------------------------------------- reader


def test_reader_never_modifies_the_database(pm_db: Path) -> None:
    before = hashlib.sha256(pm_db.read_bytes()).hexdigest()
    mtime = pm_db.stat().st_mtime_ns
    raw = read_pm_database(pm_db)
    assert raw.entities and raw.relations
    assert hashlib.sha256(pm_db.read_bytes()).hexdigest() == before
    assert pm_db.stat().st_mtime_ns == mtime


def test_read_only_connection_rejects_writes(pm_db: Path) -> None:
    connection = connect_read_only(pm_db)
    try:
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            connection.execute("DELETE FROM entities")
    finally:
        connection.close()


def test_reader_selects_approved_rows_and_skips_excluded_layers(pm_db: Path) -> None:
    raw = read_pm_database(pm_db)
    assert {row["id"] for row in raw.entities}.isdisjoint({30, 31, 32})
    assert {row["id"] for row in raw.relations}.isdisjoint({106, 107})
    arg_ids = {row["id"] for row in raw.arguments}
    # 7 = machtsvalentie, 8 = politieke_positie, 18 = reply below 8, 14 = vervangen
    assert arg_ids.isdisjoint({7, 8, 14, 18})
    assert {row["property"] for row in raw.arguments}.isdisjoint(pm.EXCLUDED_PROPERTIES)
    assert {row["argument_id"] for row in raw.citations} <= arg_ids
    assert raw.maintainers == {"maxime"}
    assert raw.release_version == "0.10.1"
    assert raw.db_mtime == db_fingerprint(pm_db)


def test_reader_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        read_pm_database(tmp_path / "nope.db")


def test_reader_without_users_table(pm_db: Path) -> None:
    connection = sqlite3.connect(pm_db)
    connection.execute("DROP TABLE users")
    connection.commit()
    connection.close()
    assert read_pm_database(pm_db).maintainers == set()


def test_reader_reads_mechanism_filters(pm_db: Path) -> None:
    rows = read_pm_database(pm_db).mechanism_filters
    assert {"mechanism_id": 3, "filter": "ideologie"} in rows
    assert len(rows) == 8


def test_reader_without_mechanism_filters_table(pm_db: Path) -> None:
    connection = sqlite3.connect(pm_db)
    connection.execute("DROP TABLE mechanism_filters")
    connection.commit()
    connection.close()
    raw = read_pm_database(pm_db)
    assert raw.mechanism_filters == []
    filters = {row["id"]: row["filters"] for row in transform(raw).relations}
    assert filters[103] == ["sourcing"] and filters[100] == ["eigendom"]  # primary fallback


def test_db_fingerprint_includes_wal(tmp_path: Path) -> None:
    db = tmp_path / "x.db"
    db.write_bytes(b"db")
    wal = tmp_path / "x.db-wal"
    wal.write_bytes(b"wal")
    import os

    os.utime(db, (1_000_000_000, 1_000_000_000))
    os.utime(wal, (1_700_000_000, 1_700_000_000))
    assert db_fingerprint(db) == datetime.fromtimestamp(1_700_000_000, tz=timezone.utc).isoformat()


def test_latest_release_version(tmp_path: Path) -> None:
    assert latest_release_version(tmp_path / "missing") is None
    releases = tmp_path / "releases"
    releases.mkdir()
    for name in ("model-v0.9.0.json", "model-v0.10.0.json", "model-v1.0.json", "other.json"):
        (releases / name).write_text("{}")
    assert latest_release_version(releases) == "0.10.0"


def test_version_string() -> None:
    assert version_string("0.1.0", "2026-09-30T12:00:00+00:00") == "0.1.0+live.20260930"
    assert version_string("0.1.0", None) == "0.1.0+live"
    assert version_string(None, "2026-09-30T12:00:00+00:00") == "live.20260930"
    assert version_string(None, None) == "live"


# --------------------------------------------------------------------------- exclusions


def test_transform_drops_proposed_replaced_and_rejected(snapshot: pm.PmSnapshot) -> None:
    entity_ids = set(_by_id(snapshot.entities))
    relation_ids = set(_by_id(snapshot.relations))
    assert entity_ids.isdisjoint({30, 31, 32})
    # 105 points to a proposed entity, 106 is proposed, 107 is replaced
    assert relation_ids == {100, 101, 102, 103, 104, 108, 109, 110, 111}
    for relation in snapshot.relations:
        assert relation["source_id"] in entity_ids and relation["target_id"] in entity_ids


def test_transform_filters_raw_rows_itself() -> None:
    """Defence in depth: the pure transformer re-checks status/vervangen/properties."""

    raw = PmRawData(
        entities=[
            {"id": 1, "name": "A", "type": "bedrijf", "status": "goedgekeurd", "vervangen": 0},
            {"id": 2, "name": "B", "type": "bedrijf", "status": "voorgesteld", "vervangen": 0},
            {"id": 3, "name": "C", "type": "bedrijf", "status": "goedgekeurd", "vervangen": 1},
        ],
        relations=[
            {
                "id": 10,
                "source_id": 1,
                "target_id": 1,
                "relation_type": "eigendom",
                "status": "voorgesteld",
                "vervangen": 0,
            },
        ],
        arguments=[
            {
                "id": 1,
                "entity_id": 1,
                "property": "politieke_positie",
                "stance": "supporting",
                "status": "ongecontroleerd",
            },
        ],
        citations=[{"id": 1, "argument_id": 1, "source_id": 1, "quote": "links"}],
        sources=[{"id": 1, "title": "Positie", "reliability": "primair"}],
    )
    snapshot = transform(raw, synced_at=SYNCED_AT)
    assert [entity["id"] for entity in snapshot.entities] == [1]
    assert snapshot.relations == [] and snapshot.sources == []
    assert snapshot.meta["version"] == "live"


def test_excluded_layers_never_in_serialised_output(snapshot: pm.PmSnapshot) -> None:
    serialised = snapshot.to_json()
    # same check as the pm release discipline: grep -c "politieke_positie\|machtsvalentie"
    assert re.search(r"politieke_positie|machtsvalentie", serialised, re.IGNORECASE) is None
    assert "kleurmeter" not in serialised.lower()
    assert "politieke positie" not in serialised.lower()
    assert "Politieke positie van Kuiken" not in serialised  # cited only by the excluded layer
    assert_no_excluded_layers(snapshot)  # does not raise


def test_assert_no_excluded_layers_raises() -> None:
    with pytest.raises(ExcludedLayerError):
        assert_no_excluded_layers('{"description": "Machtsvalentie: opent"}')
    with pytest.raises(ExcludedLayerError):
        assert_no_excluded_layers({"property": "politieke_positie"})


def test_descriptions_are_scrubbed(snapshot: pm.PmSnapshot) -> None:
    entities = _by_id(snapshot.entities)
    relations = _by_id(snapshot.relations)
    assert entities[9]["description"] == "Ochtendkrant van Mediahuis."
    assert entities[21]["description"] == "Politica."
    assert relations[104]["description"] == "Het AD valt de NOS aan."
    assert relations[100]["description"] == "DPG Media bezit het AD."


def test_scrub_text() -> None:
    assert scrub_text(None) is None
    assert scrub_text("   ") is None
    assert scrub_text("Gewone tekst.") == "Gewone tekst."
    assert scrub_text("Alleen machtsvalentie.") is None
    assert scrub_text("Eerst. Dan de politieke-positie! Laatste?") == "Eerst. Laatste?"


# ------------------------------------------------------------------------------ labels


def test_certainty_labels(snapshot: pm.PmSnapshot) -> None:
    labels = {row["id"]: row["certainty_label"] for row in snapshot.relations}
    assert labels[100] == CERTAINTY_WELL_SUPPORTED  # 3 independent clusters, contradicted
    assert labels[101] == CERTAINTY_PLAUSIBLE  # one merged argument, unclassified source
    assert labels[104] == CERTAINTY_PLAUSIBLE
    assert labels[102] == CERTAINTY_UNCERTAIN  # prior 0.9 only: never more than onzeker
    assert labels[103] == CERTAINTY_UNCERTAIN  # unsourced argument
    assert labels[110] == CERTAINTY_UNCERTAIN  # supporting argument vetoed by a maintainer
    assert set(labels.values()) <= {"onderbouwd", "aannemelijk", "onzeker"}
    # never a number
    assert all("certainty" not in key or key == "certainty_label" for key in snapshot.relations[0])


@pytest.mark.parametrize(
    ("detail", "expected"),
    [
        ({"basis": "prior", "score": 0.9, "n_support_clusters": 0}, CERTAINTY_UNCERTAIN),
        ({"basis": "none", "score": 0.0, "n_support_clusters": 0}, CERTAINTY_UNCERTAIN),
        ({"basis": "evidence", "score": 0.13, "n_support_clusters": 1}, CERTAINTY_UNCERTAIN),
        ({"basis": "evidence", "score": 0.14, "n_support_clusters": 1}, CERTAINTY_PLAUSIBLE),
        ({"basis": "evidence", "score": 0.45, "n_support_clusters": 1}, CERTAINTY_PLAUSIBLE),
        ({"basis": "evidence", "score": 0.30, "n_support_clusters": 2}, CERTAINTY_WELL_SUPPORTED),
    ],
)
def test_certainty_label_thresholds(detail, expected) -> None:
    assert certainty_label(detail) == expected


def test_a_verified_structure_fact_is_well_supported_with_one_source() -> None:
    """Story 14.23: a CV line checked against its source is settled; influence still needs two."""

    verified = {"stance": "supporting", "sigma": 0.7, "cluster": "villamedia", "n_citations": 1}
    fact = pm.instance_certainty([{**verified, "status": "geverifieerd"}])
    assert fact["verified_support"] is True and fact["n_support_clusters"] == 1
    assert certainty_label(fact, "personeel") == CERTAINTY_WELL_SUPPORTED
    assert certainty_label(fact, "bestuurder") == CERTAINTY_WELL_SUPPORTED
    # A claim of influence on the same evidence stays plausible
    assert certainty_label(fact, "beinvloeding") == CERTAINTY_PLAUSIBLE
    assert certainty_label(fact) == CERTAINTY_PLAUSIBLE
    # Not checked, or contradicted by a source: the usual bar
    unchecked = pm.instance_certainty([{**verified, "status": "ongecontroleerd"}])
    assert certainty_label(unchecked, "personeel") == CERTAINTY_PLAUSIBLE
    opposed = {**fact, "opposed": True}
    assert certainty_label(opposed, "personeel") == CERTAINTY_PLAUSIBLE
    # An unclassified source scores below the bar even when checked
    weak = pm.instance_certainty([{**verified, "sigma": 0.4, "status": "geverifieerd"}])
    assert certainty_label(weak, "personeel") == CERTAINTY_PLAUSIBLE


def test_instance_certainty_caps_unopposed_scores() -> None:
    roots = [
        {"stance": "supporting", "sigma": 1.0, "cluster": c, "n_citations": 1, "status": "x"}
        for c in "abcde"
    ]
    detail = pm.instance_certainty(roots)
    assert detail["score"] == pm.CAP_UNOPPOSED and detail["basis"] == "evidence"
    assert pm.instance_certainty([], prior=0.95)["score"] == pm.CAP_UNOPPOSED
    contextual = [{"stance": "contextual", "sigma": 1.0}]
    assert pm.instance_certainty(contextual)["basis"] == "none"


def test_dfquad_and_influence() -> None:
    assert pm._dfquad(0.5, [], []) == 0.5
    assert pm._dfquad(0.5, [0.5], []) == pytest.approx(0.75)
    assert pm._dfquad(0.5, [], [0.5]) == pytest.approx(0.25)
    assert pm.derived_influence(None, []) == 0.0
    assert pm.derived_influence(0.05, []) == 0.05
    root = {"stance": "supporting", "sigma": 0.5, "cluster": "a", "n_citations": 1}
    assert pm.derived_influence(0.05, [root]) > 0.05
    assert pm.derived_influence(None, [root]) == pytest.approx(0.3333, abs=1e-3)


def test_score_arguments_neutralised_objection_and_cycle() -> None:
    sources = {1: {"id": 1, "reliability": "regulier"}}
    arguments = [
        {
            "id": 1,
            "relation_id": 5,
            "parent_argument_id": None,
            "stance": "supporting",
            "status": "ongecontroleerd",
        },
        {
            "id": 2,
            "parent_argument_id": 1,
            "stance": "contradicting",
            "status": "ongecontroleerd",
            "bezwaar_resolutie": "opgelost",
            "contributed_by": "boss",
        },
        {"id": 3, "parent_argument_id": 4, "stance": "supporting", "status": "ongecontroleerd"},
        {"id": 4, "parent_argument_id": 3, "stance": "supporting", "status": "ongecontroleerd"},
    ]
    citations = [{"argument_id": 1, "source_id": 1}, {"argument_id": 1, "source_id": 99}]
    scores = pm.score_arguments(arguments, citations, sources, {"boss"})
    # resolved objection neither dampens nor vetoes
    assert scores.sigma[1] == pytest.approx(0.5 * (0.3 + 0.7 * 0.5))
    assert set(scores.sigma) == {1, 2, 3, 4}  # the 3 <-> 4 cycle terminates


# ------------------------------------------------------------------------ primary filter


def test_primary_filter(snapshot: pm.PmSnapshot) -> None:
    filters = {row["id"]: row["primary_filter"] for row in snapshot.entities}
    assert filters[1] == "eigendom"  # derived from its eigendom relations
    assert filters[2] == "eigendom"  # eigendom beats a vetoed (0) advertentie relation
    assert filters[3] == "flak"
    assert filters[11] == "sourcing"
    assert filters[20] == "tegenmacht"  # only tegenmacht edges -> fallback: role category
    assert filters[21] == "sourcing" and filters[23] == "sourcing"  # bidirectional
    assert filters[7] is None  # no outgoing relation, no role
    assert filters[24] is None  # replaced role is ignored


def test_compute_primary_filters_tie_break_and_tegenmacht() -> None:
    mechanisms = {
        1: {"filter": "sourcing"},
        2: {"filter": "flak"},
        3: {"filter": "tegenmacht"},
        4: {"filter": "eigendom", "vervangen": 1},
    }
    relations = [
        {"id": 1, "source_id": 1, "target_id": 2, "mechanism_id": 1},
        {"id": 2, "source_id": 1, "target_id": 2, "mechanism_id": 2},
        {"id": 3, "source_id": 3, "target_id": 2, "mechanism_id": 3},
        {"id": 4, "source_id": 4, "target_id": 2, "mechanism_id": 4},
        {"id": 5, "source_id": 5, "target_id": 2, "mechanism_id": None},
    ]
    result = pm.compute_primary_filters(relations, mechanisms, {}, {})
    assert result == {1: "sourcing"}  # tie at 0 -> highest filter name wins (as in scoring)


# ---------------------------------------------------------------------- relation filters


@pytest.mark.parametrize(
    ("mechanism", "tags", "expected"),
    [
        # multi-filter mechanism: primary first, then FILTERS order
        (
            {"filter": "sourcing"},
            ["ideologie", "flak", "sourcing"],
            ["sourcing", "flak", "ideologie"],
        ),
        # no mechanism_filters rows -> the primary filter
        ({"filter": "flak"}, None, ["flak"]),
        # cross_filter / overig / NULL without rows -> nothing
        ({"filter": "cross_filter"}, None, []),
        ({"filter": "overig"}, None, []),
        ({"filter": None}, None, []),
        # cross_filter with rows (draaideurconstructie) -> the rows
        (
            {"filter": "cross_filter"},
            ["sourcing", "eigendom", "ideologie"],
            ["eigendom", "sourcing", "ideologie"],
        ),
        ({"filter": "cross_filter"}, [], []),
        # primary filter missing from the tags: primary UNION tags (primary first)
        ({"filter": "sourcing"}, ["flak"], ["sourcing", "flak"]),
        ({"filter": "eigendom"}, ["advertentie"], ["eigendom", "advertentie"]),
        # 'overig' and unknown tags are dropped; the primary filter always counts
        ({"filter": "eigendom"}, ["overig", "advertentie", "onzin"], ["eigendom", "advertentie"]),
        ({"filter": "eigendom"}, ["overig"], ["eigendom"]),
        ({"filter": "eigendom"}, [], ["eigendom"]),
        # no (or a replaced) mechanism
        (None, ["eigendom"], []),
    ],
)
def test_relation_filters(mechanism, tags, expected) -> None:
    assert relation_filters(mechanism, tags) == expected


def test_relation_filters_in_snapshot(snapshot: pm.PmSnapshot) -> None:
    relations = _by_id(snapshot.relations)
    assert relations[103]["filters"] == ["sourcing", "ideologie"]  # multi-filter mechanism
    assert relations[103]["filter"] == "sourcing"  # primary filter unchanged (edge colour)
    assert relations[109]["filters"] == ["sourcing", "ideologie"]
    assert relations[100]["filters"] == ["eigendom", "advertentie"]  # 'overig' dropped
    assert relations[110]["filters"] == ["advertentie"]  # no rows -> primary filter
    # tagged ideologie only: the primary (edge colour) filter flak is added
    assert relations[104]["filters"] == ["flak", "ideologie"] and relations[104]["filter"] == "flak"
    assert relations[108]["filters"] == ["tegenmacht"]
    assert relations[111]["filters"] == [] and relations[111]["filter"] is None  # replaced
    for relation in snapshot.relations:
        assert set(relation["filters"]) <= set(FILTERS)


def test_transform_cross_filter_mechanisms() -> None:
    entity = {"type": "bedrijf", "status": "goedgekeurd", "vervangen": 0}
    relation = {"source_id": 1, "target_id": 2, "relation_type": "draaideur"}
    raw = PmRawData(
        entities=[{"id": 1, "name": "A", **entity}, {"id": 2, "name": "B", **entity}],
        relations=[
            {"id": 10, "mechanism_id": 18, "status": "goedgekeurd", "vervangen": 0, **relation},
            {"id": 11, "mechanism_id": 19, "status": "goedgekeurd", "vervangen": 0, **relation},
            {"id": 12, "mechanism_id": None, "status": "goedgekeurd", "vervangen": 0, **relation},
        ],
        mechanisms=[
            {"id": 18, "name": "draaideurconstructie", "filter": "cross_filter"},
            {"id": 19, "name": "losse_constructie", "filter": "cross_filter"},
        ],
        mechanism_filters=[
            {"mechanism_id": 18, "filter": "eigendom"},
            {"mechanism_id": 18, "filter": "ideologie"},
            {"mechanism_id": 18, "filter": "sourcing"},
        ],
    )
    relations = _by_id(transform(raw, synced_at=SYNCED_AT).relations)
    assert relations[10]["filter"] == "cross_filter"
    assert relations[10]["filters"] == ["eigendom", "sourcing", "ideologie"]
    assert relations[11]["filters"] == []  # cross_filter without rows
    assert relations[12]["filters"] == [] and relations[12]["filter"] is None


def test_transform_leaves_out_the_decision_making_layer_until_switched_on() -> None:
    """Uitbreiding C: bestuur-only relations and their bestuur-only entities stay out by default."""

    entity = {"status": "goedgekeurd", "vervangen": 0}
    approved = {"status": "goedgekeurd", "vervangen": 0}
    raw = PmRawData(
        entities=[
            {"id": 1, "name": "Ministerie van Financiën", "type": "overheidsinstelling", **entity},
            {"id": 2, "name": "A.B. Jansen", "type": "persoon", **entity},
            {"id": 3, "name": "NOS", "type": "omroep", **entity},
            {"id": 4, "name": "Belastingdienst", "type": "overheidsinstelling", **entity},
            {"id": 5, "name": "CDA", "type": "partij", **entity},
            {"id": 6, "name": "B.C.M. Vostermans (burgemeester Peel en Maas)", "type": "persoon",
             **entity},
        ],
        arguments=[
            {"id": 1, "relation_id": 15, "parent_argument_id": None, "stance": "supporting",
             "status": "ongecontroleerd", "claim": "register"},
        ],
        citations=[{"id": 1, "argument_id": 1, "source_id": 9, "quote": "regel"}],
        sources=[{"id": 9, "title": "Register van overheidsorganisaties, uitgave 2026-10-08",
                  "cluster_key": "register:oo", "reliability": "primair"}],
        relations=[
            # ambt (new type): SG -> ministry
            {"id": 10, "source_id": 2, "target_id": 1, "relation_type": "ambt",
             "mechanism_id": 207, **approved},
            # zeggenschap via a formele_macht-only mechanism
            {"id": 11, "source_id": 1, "target_id": 4, "relation_type": "zeggenschap",
             "mechanism_id": 208, **approved},
            # ministry is a source for the NOS (media filter): stays
            {"id": 12, "source_id": 1, "target_id": 3, "relation_type": "bron_van",
             "mechanism_id": 6, **approved},
            # lobbyt with a belangen-only mechanism: hidden
            {"id": 13, "source_id": 3, "target_id": 1, "relation_type": "lobbyt",
             "mechanism_id": 214, **approved},
            # draaideur with an overlapping mechanism (sourcing + werving): stays
            {"id": 14, "source_id": 2, "target_id": 3, "relation_type": "draaideur",
             "mechanism_id": 18, **approved},
            # party line (sourcing!) towards a local official, resting only on the register
            {"id": 15, "source_id": 5, "target_id": 6, "relation_type": "lidmaatschap",
             "mechanism_id": 92, **approved},
        ],
        mechanisms=[
            {"id": 6, "name": "bron_afhankelijkheid", "filter": "sourcing"},
            {"id": 18, "name": "draaideurconstructie", "filter": "cross_filter"},
            {"id": 207, "name": "ambtelijke_leiding", "filter": "formele_macht"},
            {"id": 208, "name": "hierarchische_aansturing", "filter": "formele_macht"},
            {"id": 214, "name": "lobbytoegang", "filter": "belangen"},
            {"id": 92, "name": "partijlijn", "filter": "sourcing"},
        ],
        mechanism_filters=[
            {"mechanism_id": 18, "filter": "sourcing"},
            {"mechanism_id": 18, "filter": "werving"},
            {"mechanism_id": 207, "filter": "formele_macht"},
            {"mechanism_id": 208, "filter": "formele_macht"},
            {"mechanism_id": 214, "filter": "belangen"},
        ],
    )
    off = transform(raw, synced_at=SYNCED_AT)
    assert {relation["id"] for relation in off.relations} == {12, 14}
    # the Belastingdienst and the register-only mayor are hidden; the CDA has no relation left
    # but was never touched by a kept relation either, so it goes too; the SG keeps the draaideur
    assert {entity["id"] for entity in off.entities} == {1, 2, 3}
    for relation in off.relations:
        assert set(relation["filters"]) <= set(FILTERS)

    on = transform(raw, synced_at=SYNCED_AT, bestuur=True)
    assert {relation["id"] for relation in on.relations} == {10, 11, 12, 13, 14, 15}
    assert {entity["id"] for entity in on.entities} == {1, 2, 3, 4, 5, 6}


@pytest.mark.parametrize(
    ("filters", "wanted", "expected"),
    [
        # no filter (NULL or empty array) = every relation
        (["eigendom"], None, True),
        ([], [], True),
        # single filter
        (["sourcing", "ideologie"], ["ideologie"], True),
        (["sourcing"], ["flak"], False),
        # a set of filters (legend default eigendom + sourcing + ideologie): any overlap
        (["flak", "ideologie"], ["eigendom", "sourcing", "ideologie"], True),
        (["flak", "tegenmacht"], ["eigendom", "sourcing", "ideologie"], False),
        # 'overig' = relations without filters
        ([], ["overig"], True),
        (None, ["overig", "flak"], True),
        (["flak"], ["overig"], False),
        ([], ["eigendom"], False),
    ],
)
def test_relation_matches(filters, wanted, expected) -> None:
    assert pm.relation_matches(filters, wanted) is expected


# ------------------------------------------------------------------------ degree, meta


def test_degree(snapshot: pm.PmSnapshot) -> None:
    degree = {row["id"]: row["degree"] for row in snapshot.entities}
    assert degree[1] == 2 and degree[2] == 3 and degree[11] == 4
    assert degree[21] == 1 and degree[23] == 1
    assert degree[22] == 0
    assert sum(degree.values()) == 2 * len(snapshot.relations)


def test_meta_and_counts(snapshot: pm.PmSnapshot, pm_db: Path) -> None:
    assert snapshot.meta["version"].startswith("0.10.1+live.")
    assert snapshot.meta["synced_at"] == SYNCED_AT.isoformat()
    assert snapshot.meta["db_mtime"] == db_fingerprint(pm_db)
    assert snapshot.meta["entity_count"] == str(len(snapshot.entities))
    assert snapshot.meta["relation_count"] == str(len(snapshot.relations))
    assert snapshot.meta["format"] == pm.SNAPSHOT_FORMAT
    assert snapshot.counts() == {
        "entities": len(snapshot.entities),
        "relations": len(snapshot.relations),
        "sources": len(snapshot.sources),
        "aliases": len(snapshot.aliases),
        "arguments": len(snapshot.arguments),
        "mechanisms": len(snapshot.mechanisms),
    }


def test_entity_and_relation_fields(snapshot: pm.PmSnapshot) -> None:
    entities = _by_id(snapshot.entities)
    relations = _by_id(snapshot.relations)
    assert entities[1]["slug"] == "1-dpg-media"
    assert entities[1]["role"] == "Media-eigenaar"
    assert entities[20]["role"] == "Toezichthouder"
    assert entities[26]["slug"] == "26-elan-mediagroep"
    assert relations[110]["mechanism"] == "Commerciële afhankelijkheid"
    assert relations[104]["aard"] == "veld_eigenschap"
    assert relations[111]["mechanism"] is None and relations[111]["filter"] is None
    assert relations[109]["bidirectional"] is True
    assert relations[101]["active_from"] == "2019-05-01"


def test_pm_slug_and_display_name() -> None:
    assert pm_slug(3, "AD (Algemeen Dagblad)") == "3-ad-algemeen-dagblad"
    assert pm_slug(4, "de Volkskrant") == "4-de-volkskrant"  # pm keeps the article
    assert pm_slug(5, "Ça — €") == "5-ca"
    assert pm_slug(6, "") == "6"
    assert display_name(None) is None
    assert display_name("pr_subsidie") == "PR-subsidie"
    assert display_name("bron_afhankelijkheid") == "Bron afhankelijkheid"


# ----------------------------------------------------------------------------- sources


def test_relation_sources(snapshot: pm.PmSnapshot) -> None:
    rows = [row for row in snapshot.sources if row["owner_kind"] == "relation"]
    by_owner: dict[int, list[dict]] = {}
    for row in rows:
        by_owner.setdefault(row["owner_id"], []).append(row)
    titles_100 = [row["title"] for row in sorted(by_owner[100], key=lambda r: r["position"])]
    # verified argument first, then by reliability; the reply chain (NRC) counts too;
    # the contradicting argument, the smaad_hold argument and the replaced one do not
    assert titles_100 == ["Mediamonitor 2021", "Jaarverslag DPG Media", "Nieuwsbericht overname"]
    first, second, third = sorted(by_owner[100], key=lambda r: r["position"])
    assert len(first["quote"]) <= pm.MAX_QUOTE_LENGTH and first["quote"].endswith("…")
    assert first["url"] is None  # ISBN only
    assert second["quote"] == "Tweede citaat uit het jaarverslag."  # verified citation wins
    assert third["url"].startswith("https://web.archive.org/")  # never the local file path
    assert by_owner[101][0]["url"] == "https://doi.org/10.1234/volkskrant"
    # eigen_synthese and the kleurmeter quote are dropped; the quality source stays
    assert [row["title"] for row in by_owner[104]] == ["Flak-bericht"]
    assert 110 not in by_owner  # vetoed argument
    counts = {row["id"]: row["source_count"] for row in snapshot.relations}
    assert counts[100] == 3 and counts[101] == 1 and counts[104] == 1 and counts[110] == 0


def test_entity_sources(snapshot: pm.PmSnapshot) -> None:
    rows = [row for row in snapshot.sources if row["owner_kind"] == "entity"]
    assert [(row["owner_id"], row["title"], row["published_at"]) for row in rows] == [
        (1, "Over DPG Media", "2023")
    ]


def test_sources_are_capped_per_owner() -> None:
    scores = pm.ArgumentScores(
        sigma={1: 0.5},
        meta={
            1: {
                "parent": None,
                "relation_id": 7,
                "entity_id": None,
                "property": None,
                "stance": "supporting",
                "status": "ongecontroleerd",
                "smaad_hold": False,
            },
        },
        children={},
    )
    sources = {i: {"id": i, "title": f"Bron {i}", "reliability": "regulier"} for i in range(20)}
    citations = [{"argument_id": 1, "source_id": i, "quote": None} for i in range(20)]
    rows, counts = pm.collect_sources(
        "relation", [7], scores, citations, sources, {}, max_per_owner=5
    )
    assert len(rows) == 5 and counts == {7: 20}
    assert [row["position"] for row in rows] == list(range(5))


# ---------------------------------------------------------------------------- arguments


def test_relation_arguments(snapshot: pm.PmSnapshot) -> None:
    rows: dict[int, list[dict]] = {}
    for row in snapshot.arguments:
        rows.setdefault(row["owner_id"], []).append(row)
    # for first (the verified one with its reply right after it), then against; never the
    # argument under the smaad hold (15) or the replaced one (14)
    assert [(row["id"], row["parent_id"], row["stance"], row["status"]) for row in rows[100]] == [
        (1, None, "supporting", "geverifieerd"),
        (3, 1, "supporting", "ongecontroleerd"),
        (2, None, "supporting", "ongecontroleerd"),
        (4, None, "contradicting", "ongecontroleerd"),
    ]
    assert [row["position"] for row in rows[100]] == [0, 1, 2, 3]
    first = rows[100][0]
    assert first["claim"] == "Het jaarverslag noemt DPG Media als eigenaar van het AD."
    assert [(source["title"], source["kind"]) for source in first["sources"]] == [
        ("Mediamonitor 2021", "nieuwsartikel"),
        ("Jaarverslag DPG Media", "rapport"),
    ]
    assert len(first["sources"][0]["quote"]) <= pm.MAX_QUOTE_LENGTH
    assert rows[100][2]["sources"][0]["url"] == "https://www.dpgmedia.nl/jaarverslag"
    # the unmerged proposal (13) does not count; an argument about the influence does
    assert [(row["id"], row["aspect"]) for row in rows[101]] == [(5, None), (16, "influence")]
    # the excluded layer is scrubbed from the claim; project material and the kleurmeter quote go
    assert rows[104][0]["claim"] == "Het AD viel de NOS publiekelijk aan."
    assert [source["title"] for source in rows[104][0]["sources"]] == ["Flak-bericht"]
    # a reply against an argument travels along: the reader sees it is contested
    assert [(row["id"], row["parent_id"], row["stance"]) for row in rows[110]] == [
        (10, None, "supporting"),
        (11, 10, "contradicting"),
    ]
    assert set(rows) == {100, 101, 103, 104, 110}
    assert {row["owner_kind"] for row in snapshot.arguments} == {"relation"}
    assert set(snapshot.arguments[0]) == set(PmArgument.__table__.columns.keys())


def test_collect_arguments_statuses_aspects_and_cap() -> None:
    def meta(owner: int, status: str, **extra) -> dict:
        return {
            "parent": None,
            "relation_id": owner,
            "entity_id": None,
            "property": None,
            "stance": "supporting",
            "status": status,
            "smaad_hold": False,
            "contributed_by": "bot",
            **extra,
        }

    metas = {
        1: meta(7, "verworpen"),
        2: meta(7, "voorgesteld"),
        3: meta(7, "voorgesteld", contributed_by="nieuws-scout"),
        4: meta(7, "betwist"),
        5: meta(7, "ongecontroleerd", property="mechanism"),
        6: meta(7, "verouderd"),
        7: meta(7, "ongecontroleerd", stance="contextual"),
        8: meta(8, "ongecontroleerd"),
        9: meta(7, "ongecontroleerd", smaad_hold=True),
        10: meta(7, "ongecontroleerd"),
    }
    scores = pm.ArgumentScores(sigma={key: 0.1 for key in metas}, meta=metas, children={})
    arguments = [{"id": key, "claim": f"Claim {key}." if key != 10 else "  "} for key in metas]
    sources = {i: {"id": i, "title": f"Bron {i}", "reliability": "regulier"} for i in range(5)}
    citations = [{"argument_id": 4, "source_id": i, "quote": None} for i in (0, 1, 1, 2, 3, 4)]

    rows = pm.collect_arguments([7, 8], arguments, scores, citations, sources, {})
    # never rejected, unmerged, classification, smaad hold or empty claims; disputed before outdated
    assert [(row["owner_id"], row["id"]) for row in rows] == [(7, 4), (7, 6), (7, 7), (8, 8)]
    assert [source["title"] for source in rows[0]["sources"]] == ["Bron 0", "Bron 1", "Bron 2"]
    assert rows[2]["stance"] == "contextual"
    # automatically approved relation: the research agent's proposal shows, other proposals not
    unreviewed = pm.collect_arguments([7], arguments, scores, [], {}, {}, unreviewed_owner_ids=[7])
    assert [row["id"] for row in unreviewed] == [3, 4, 6, 7]
    capped = pm.collect_arguments([7], arguments, scores, [], {}, {}, max_per_owner=2)
    assert [row["id"] for row in capped] == [4, 6]
    assert pm.collect_arguments([9], arguments, scores, [], {}, {}) == []


def test_mechanism_rows(snapshot: pm.PmSnapshot) -> None:
    rows = {row["name"]: row for row in snapshot.mechanisms}
    # the mechanisms of exported relations, by display name; never the replaced one
    assert set(rows) == {
        "Eigendomsconcentratie",
        "Commerciële afhankelijkheid",
        "Bron afhankelijkheid",
        "Publieke aanval",
        "Verantwoording",
    }
    assert rows["Eigendomsconcentratie"] == {
        "name": "Eigendomsconcentratie",
        "filter": "eigendom",
        "description": "Twee concerns bezitten bijna alle kranten.",
        "effect": "Minder verschillende stemmen.",
    }
    # the excluded layer is scrubbed; identifiers read as words
    assert rows["Bron afhankelijkheid"]["description"] == (
        "Media leunen op vaste officiële bronnen. Zie ook pr-subsidie."
    )
    assert set(rows["Verantwoording"]) == set(PmMechanism.__table__.columns.keys())
    assert pm.mechanism_rows({1: {"name": "oud", "vervangen": 1}}, [1, None]) == []


def test_source_url_preferences() -> None:
    assert pm._source_url([]) is None
    assert pm._source_url([{"location_type": "url", "location": "ftp://x"}]) is None
    assert pm._source_url([{"location_type": "handle", "location": "1887/1"}]) == (
        "https://hdl.handle.net/1887/1"
    )
    assert pm._source_url([{"location_type": "arxiv", "location": "https://arxiv.org/abs/1"}]) == (
        "https://arxiv.org/abs/1"
    )
    assert (
        pm._source_url(
            [
                {"location_type": "archive_url", "location": "https://web.archive.org/x"},
                {"location_type": "url", "location": "https://example.org"},
                {"location_type": "url", "location": "https://second.example.org"},
            ]
        )
        == "https://example.org"
    )


def test_truncate_quote() -> None:
    assert truncate_quote(None) is None
    assert truncate_quote("  a \n b  ") == "a b"
    long = "x" * 400
    assert truncate_quote(long) == "x" * 299 + "…"
    assert len(truncate_quote(long)) == 300


# ----------------------------------------------------------------------------- aliases


def test_aliases(snapshot: pm.PmSnapshot) -> None:
    aliases: dict[str, set[int]] = {}
    for row in snapshot.aliases:
        aliases.setdefault(row["alias"], set()).add(row["entity_id"])
    # parentheticals: acronym + long form, both directions
    assert aliases["aivd"] == {20}
    assert aliases["algemene-inlichtingen-en-veiligheidsdienst"] == {20}
    assert aliases["abc"] == {24}
    # collision: the long form is another entity's own name
    assert aliases["alpha-beta-corp"] == {25}
    # persons: full name without the parenthetical, never the party / surname only
    assert aliases["attje-kuiken"] == {21}
    assert "pvda" not in aliases
    assert aliases["mark-rutte"] == {23} and "rutte" not in aliases
    # qualifiers are not aliases
    assert aliases["theater-koningsduyn"] == {22} and "castricum" not in aliases
    # curated feed aliases (shared slugify drops leading articles)
    assert aliases["ad"] == {3} and aliases["algemeen-dagblad"] == {3}
    assert aliases["nos"] == {11} and aliases["nos-nl"] == {11}
    assert aliases["nu-nl"] == {7} and aliases["volkskrant"] == {4}
    assert aliases["telegraaf"] == {9}
    # curated alias with a name mismatch (id 5 is not "Trouw" here) is skipped
    assert "trouw" not in aliases and aliases["trouw-media"] == {5}
    # accents
    assert aliases["elan-mediagroep"] == {26}


def test_generate_aliases_edge_cases() -> None:
    rows = generate_aliases(
        [
            {"id": 1, "name": "X (Twitter)", "type": "platform"},
            {"id": 2, "name": "Meta (Facebook/Instagram)", "type": "platform"},
            {"id": 3, "name": "EFE (Agencia EFE)", "type": "persbureau"},
            {"id": 4, "name": "Huisarts (corona)", "type": "persoon"},
            {"id": 5, "name": "Clintel (Climate Intelligence)", "type": "denktank"},
        ]
    )
    aliases = {(row["alias"], row["entity_id"]) for row in rows}
    assert ("x-twitter", 1) in aliases and ("twitter", 1) not in aliases  # "X" too short
    assert ("facebook", 2) not in aliases  # not an acronym, outer not an acronym
    assert ("efe", 3) in aliases and ("agencia-efe", 3) in aliases
    assert ("huisarts", 4) not in aliases  # single-token person name
    assert ("clintel", 5) in aliases and ("climate-intelligence", 5) not in aliases


# ------------------------------------------------------------------ ordering + migration


def test_relation_priority_and_sort_key() -> None:
    assert relation_priority("eigendom") == 0
    assert relation_priority("lidmaatschap") == RELATION_TYPE_PRIORITY.index("lidmaatschap")
    assert relation_priority("controle") == len(RELATION_TYPE_PRIORITY) - 1
    assert relation_priority("onbekend") == len(RELATION_TYPE_PRIORITY)
    assert relation_priority(None) == len(RELATION_TYPE_PRIORITY)
    relations = [
        {"id": 1, "relation_type": "personeel", "source_count": 9, "active_from": "2024"},
        {"id": 2, "relation_type": "eigendom", "source_count": 1, "active_from": None},
        {"id": 3, "relation_type": "eigendom", "source_count": 1, "active_from": "2019"},
        {"id": 4, "relation_type": "eigendom", "source_count": 1, "active_from": "2019-05"},
        {"id": 5, "relation_type": "eigendom", "source_count": 3, "active_from": None},
    ]
    ordered = [row["id"] for row in sorted(relations, key=relation_sort_key)]
    assert ordered == [5, 4, 3, 2, 1]


def test_sql_priority_matches_python() -> None:
    # the newest pm_neighborhood (migration 016) carries the priority CASE
    sql = MIGRATION_016.read_text(encoding="utf-8")
    sql = sql.split("CREATE OR REPLACE FUNCTION pm_neighborhood(", 1)[1].split("$$;", 1)[0]
    pairs = re.findall(r"WHEN '([a-z_]+)' THEN (\d+)", sql)
    assert [name for name, _ in pairs] == list(RELATION_TYPE_PRIORITY)
    assert [int(rank) for _, rank in pairs] == list(range(len(RELATION_TYPE_PRIORITY)))
    assert f"ELSE {len(RELATION_TYPE_PRIORITY)}" in sql


def test_migration_contract() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    for table in ("pm_entities", "pm_relations", "pm_sources", "pm_aliases", "pm_meta"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
    assert "CREATE POLICY" not in sql
    assert "REVOKE ALL ON pm_entities, pm_relations, pm_sources, pm_aliases, pm_meta" in sql
    signatures = {
        "pm_meta_info": "()",
        "pm_match": "(text[])",
        "pm_search": "(text, integer)",
        "pm_neighborhood": "(integer, integer, text[])",
        "pm_details": "(text, integer)",
    }
    for name, args in signatures.items():
        body = sql.split(f"CREATE OR REPLACE FUNCTION {name}(", 1)[1].split("$$;", 1)[0]
        assert "SECURITY DEFINER" in body and "STABLE" in body
        assert "SET search_path = public" in body and "RETURNS json" in body
        assert f"REVOKE ALL ON FUNCTION {name}{args} FROM PUBLIC;" in sql
        assert f"GRANT EXECUTE ON FUNCTION {name}{args} TO anon, authenticated;" in sql
        assert f"'public.{name}{args}'" in sql  # verification block
    # no grants left for the old pm_neighborhood overloads; the verification block checks that
    # they are gone (to_regprocedure) and verifies the text[] one
    verification = sql.rsplit("DO $$", 1)[1]
    for old in ("(integer, integer)", "(integer, integer, text)"):
        assert f"ON FUNCTION pm_neighborhood{old} " not in sql
        assert f"to_regprocedure('public.pm_neighborhood{old}') IS NOT NULL" in verification
        assert f"'public.pm_neighborhood{old}',\n" not in verification
    neighborhood = sql.split("CREATE OR REPLACE FUNCTION pm_neighborhood(", 1)[1]
    neighborhood = neighborhood.split("$$;", 1)[0]
    for key in (
        "'center'",
        "'entities'",
        "'relations'",
        "'total'",
        "'truncated'",
        "'filters', p.filters",  # per relation
        "'filter_counts'",
        "'breakdown', v_breakdown",  # per filter: type of the other party + mechanism (aggregates)
        "'breakdown', '{}'::json",  # unknown id
        "'filters', v_filters",  # echo of p_filters (null when NULL/empty)
    ):
        assert key in neighborhood
    assert "'filter', p_" not in neighborhood  # the single-filter echo is gone
    assert "description" not in neighborhood.split("CASE r.relation_type", 1)[1]
    assert "p_filters text[] DEFAULT NULL" in neighborhood.split("\n)", 1)[0]
    assert "COALESCE(cardinality(p_filters), 0) = 0 THEN NULL" in neighborhood
    predicate = (
        "(v_filters IS NULL OR r.filters && v_filters "
        "OR ('overig' = ANY(v_filters) AND COALESCE(cardinality(r.filters), 0) = 0))"
    )
    assert " ".join(neighborhood.split()).count(predicate) == 2  # total + picked
    assert sql.rstrip().endswith("NOTIFY pgrst, 'reload schema';")
    assert "BEGIN;" in sql and "COMMIT;" in sql and "DO $$" in sql


def test_migration_010_contract() -> None:
    sql = MIGRATION_010.read_text(encoding="utf-8")
    for table in ("pm_arguments", "pm_mechanisms"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
        assert table in pm.PM_TABLES  # the sync refuses to write while they are readable
    assert "CREATE POLICY" not in sql
    assert "REVOKE ALL ON pm_arguments, pm_mechanisms FROM PUBLIC, anon, authenticated;" in sql
    functions = {"pm_details": "(text, integer)", "pm_relation_arguments": "(integer[])"}
    for name, args in functions.items():
        body = sql.split(f"CREATE OR REPLACE FUNCTION {name}(", 1)[1].split("$$;", 1)[0]
        assert "SECURITY DEFINER" in body and "STABLE" in body
        assert "SET search_path = public" in body and "RETURNS json" in body
        assert f"REVOKE ALL ON FUNCTION {name}{args} FROM PUBLIC;" in sql
        assert f"GRANT EXECUTE ON FUNCTION {name}{args} TO anon, authenticated;" in sql
        assert f"'public.{name}{args}'" in sql  # verification block
    details = sql.split("CREATE OR REPLACE FUNCTION pm_details(", 1)[1].split("$$;", 1)[0]
    for key in (
        "'arguments', v_arguments",
        "'source', json_build_object('id', src.id",
        "'target', json_build_object('id', tgt.id",
        "'mechanism_description', m.description",
        "LEFT JOIN pm_mechanisms m ON m.name = r.mechanism",
        "LIMIT 12",
    ):
        assert key in details
    # entities and the sources of a relation are exactly as in migration 005
    old = MIGRATION.read_text(encoding="utf-8")
    old_details = old.split("CREATE OR REPLACE FUNCTION pm_details(", 1)[1].split("$$;", 1)[0]

    def flat(text: str) -> str:
        return " ".join(text.split())

    def entity(text: str) -> str:
        return text.split("IF v_kind = 'entity' THEN", 1)[1].split("ELSE", 1)[0]

    assert flat(entity(details)) == flat(entity(old_details))
    head = old_details.split("IF v_kind = 'entity' THEN", 1)[0]
    assert flat(head.split("BEGIN", 1)[1]) in flat(details)
    batch = sql.split("CREATE OR REPLACE FUNCTION pm_relation_arguments(", 1)[1].split("$$;", 1)[0]
    assert "LIMIT 40" in batch and "LIMIT 12" in batch
    table = sql.split("CREATE TABLE IF NOT EXISTS pm_arguments (", 1)[1].split("\n);", 1)[0]
    for column in PmArgument.__table__.columns.keys():
        assert f"\n    {column} " in table
    mechanisms = sql.split("CREATE TABLE IF NOT EXISTS pm_mechanisms (", 1)[1].split("\n);", 1)[0]
    for column in PmMechanism.__table__.columns.keys():
        assert f"\n    {column} " in mechanisms
    assert sql.rstrip().endswith("NOTIFY pgrst, 'reload schema';")
    assert "BEGIN;" in sql and "COMMIT;" in sql


def test_migration_filters_contract() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    # re-running on a database with an earlier version: drop the old overloads before the CREATE
    for old in ("(integer, integer)", "(integer, integer, text)"):
        drop = f"DROP FUNCTION IF EXISTS pm_neighborhood{old};"
        assert drop in sql
        assert sql.index(drop) < sql.index("CREATE OR REPLACE FUNCTION pm_neighborhood(")
    table = sql.split("CREATE TABLE IF NOT EXISTS pm_relations (", 1)[1].split(");", 1)[0]
    assert "filters TEXT[] NOT NULL DEFAULT '{}'" in table
    assert (
        "ALTER TABLE pm_relations ADD COLUMN IF NOT EXISTS filters TEXT[] NOT NULL DEFAULT '{}';"
        in sql
    )
    details = sql.split("CREATE OR REPLACE FUNCTION pm_details(", 1)[1].split("$$;", 1)[0]
    assert "'filters', NULL::json" in details and "'filters', r.filters" in details


def test_migration_016_contract() -> None:
    """Epic 15: the newest pm_neighborhood/pm_paths/pm_details/request_relation_research."""

    sql = MIGRATION_016.read_text(encoding="utf-8")
    flat = " ".join(sql.split())
    # filter_counts order: FILTERS + the "overig" bucket (same order as Python)
    quoted = ", ".join(f"'{name}'" for name in (*FILTERS, pm.UNFILTERED))
    assert f"ARRAY[{quoted}]" in flat
    for column in (
        "pm_entities ADD COLUMN IF NOT EXISTS bestuurslaag TEXT",
        "pm_entities ADD COLUMN IF NOT EXISTS wikidata TEXT",
        "pm_relations ADD COLUMN IF NOT EXISTS functie TEXT",
    ):
        assert f"ALTER TABLE {column};" in sql
    neighborhood = sql.split("CREATE OR REPLACE FUNCTION pm_neighborhood(", 1)[1]
    neighborhood = neighborhood.split("$$;", 1)[0]
    order = re.findall(r"WHEN '(\w+)' THEN (\d+)", neighborhood)
    assert [name for name, _ in order] == list(pm.RELATION_TYPE_PRIORITY)
    assert [int(rank) for _, rank in order] == list(range(len(pm.RELATION_TYPE_PRIORITY)))
    assert "'functie', p.functie" in neighborhood
    assert "'bestuurslaag', e.bestuurslaag" in neighborhood
    paths = sql.split("CREATE OR REPLACE FUNCTION pm_paths(", 1)[1].split("$$;", 1)[0]
    assert "WHEN 'ambt' THEN 0.35" in paths and "WHEN 'zeggenschap' THEN 0.35" in paths
    details = sql.split("CREATE OR REPLACE FUNCTION pm_details(", 1)[1].split("$$;", 1)[0]
    assert "'functie', r.functie" in details and "'wikidata', e.wikidata" in details
    research = sql.split("CREATE OR REPLACE FUNCTION request_relation_research(", 1)[1].split(
        "$$;", 1
    )[0]
    for kind in ("ambt", "zeggenschap", "geschenk"):
        assert f"'{kind}'" in research
    assert "BEGIN;" in sql and "COMMIT;" in sql
    assert sql.rstrip().endswith("NOTIFY pgrst, 'reload schema';")


def test_sources_an_independent_re_read_confirmed_are_marked_checked():
    """Automatic review (2026-10-06): the newest A1 'klopt' by another account than the author
    marks the source it re-read as checked; the author's own verdict or an older one never."""

    arguments = [
        {"id": 1, "contributed_by": "nieuws-bewijs"},
        {"id": 2, "contributed_by": "nieuws-bewijs"},
        {"id": 3, "contributed_by": "bronchecker"},
        {"id": 4, "contributed_by": "assistent"},
    ]
    checks = [
        {"argument_id": 1, "bron_id": 10, "verdict": "twijfel", "door": "bronchecker"},
        {"argument_id": 1, "bron_id": 10, "verdict": "klopt", "door": "bronchecker"},
        {"argument_id": 2, "bron_id": 20, "verdict": "klopt", "door": "bronchecker"},
        {"argument_id": 2, "bron_id": 20, "verdict": "twijfel", "door": "verificatie-agent"},
        {"argument_id": 3, "bron_id": 30, "verdict": "klopt", "door": "bronchecker"},
        {"argument_id": 4, "bron_id": None, "verdict": "klopt", "door": "bronchecker"},
    ]
    checked = pm.checked_sources(checks, arguments)
    assert checked == {1: {10}, 4: {None}}
    sources = {
        10: {
            "id": 10,
            "title": "NOS-bericht",
            "source_type": "nieuwsartikel",
            "reliability": "regulier",
        },
        11: {
            "id": 11,
            "title": "Persbericht",
            "source_type": "persbericht",
            "reliability": "primair",
        },
    }
    citations = [{"source_id": 10, "quote": "Citaat."}, {"source_id": 11, "quote": "Ander."}]
    rows = pm._argument_sources(citations, sources, {}, checked=checked[1])
    assert [row.get("checked") for row in rows] == [True, None]
    everything = pm._argument_sources(citations, sources, {}, checked=checked[4])
    assert all(row.get("checked") for row in everything)
    assert "checked" not in pm._argument_sources(citations, sources, {})[0]


def test_what_an_independent_re_read_found_when_it_did_not_hold():
    """Agents do everything (2026-10-06): a reader sees what the check found - the source carries
    the claim in part, does not carry it, or the quote is not in it - never a technical failure,
    nor the author's own verdict."""

    arguments = [{"id": n, "contributed_by": "nieuws-bewijs"} for n in range(1, 7)]
    checks = [
        {
            "argument_id": 1,
            "bron_id": 10,
            "verdict": "twijfel",
            "door": "bronchecker",
            "detail": "[bronchecker v2] citaat letterlijk gevonden (pbl.nl); niets over NOS",
        },
        {
            "argument_id": 2,
            "bron_id": 20,
            "verdict": "twijfel",
            "door": "bronchecker",
            "detail": "[bronchecker v2] citaat niet teruggevonden in de bron (nos.nl)",
        },
        {
            "argument_id": 3,
            "bron_id": 30,
            "verdict": "klopt-niet",
            "door": "bronchecker",
            "detail": "[bronchecker v2] zonder citaat gevonden (x.nl); zegt iets anders",
        },
        {
            "argument_id": 4,
            "bron_id": 40,
            "verdict": "twijfel",
            "door": "bronchecker",
            "detail": "[bronchecker v2] 3 keer bron niet te lezen: HTTP 403",
        },
        {
            "argument_id": 5,
            "bron_id": 50,
            "verdict": "twijfel",
            "door": "nieuws-bewijs",
            "detail": "citaat letterlijk gevonden (eigen oordeel)",
        },
        {
            "argument_id": 6,
            "bron_id": 60,
            "verdict": "twijfel",
            "door": "bronchecker",
            "detail": "[bronchecker v2] citaat bijna letterlijk gevonden (a.nl); deels",
        },
        {"argument_id": 6, "bron_id": 60, "verdict": "klopt", "door": "bronchecker"},
    ]
    assert pm.source_doubts(checks, arguments) == {
        1: {10: "deels"},
        2: {20: "citaat_weg"},
        3: {30: "draagt_niet"},
    }
    sources = {
        10: {
            "id": 10,
            "title": "Persbericht PBL",
            "source_type": "persbericht",
            "reliability": "primair",
        }
    }
    rows = pm._argument_sources(
        [{"source_id": 10, "quote": "Citaat."}], sources, {}, doubts={10: "deels"}
    )
    assert rows[0]["check"] == "deels" and "checked" not in rows[0]
    confirmed = pm._argument_sources(
        [{"source_id": 10, "quote": "Citaat."}], sources, {}, checked={10}, doubts={10: "deels"}
    )
    assert confirmed[0]["checked"] is True and "check" not in confirmed[0]


def test_relations_say_where_they_come_from(snapshot: pm.PmSnapshot) -> None:
    """Story 14.23: the first draft, a register, the owner, the owner's assistant or an agent."""

    assert pm.relation_origin(None) == pm.ORIGIN_DRAFT
    assert pm.relation_origin("register-import") == pm.ORIGIN_REGISTER
    assert pm.relation_origin("assistent") == pm.ORIGIN_ASSISTANT
    assert pm.relation_origin("maxime", {"maxime"}) == pm.ORIGIN_OWNER
    assert pm.relation_origin("nieuws-scout", {"maxime"}) == pm.ORIGIN_AGENT
    origins = {row["origin"] for row in snapshot.relations}
    assert origins <= {"opzet", "register", "eigenaar", "assistent", "agent"}
    # Never an account name, and the date only
    assert all(row["added_at"] is None or len(row["added_at"]) == 10 for row in snapshot.relations)
