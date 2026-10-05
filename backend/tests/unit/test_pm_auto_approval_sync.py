# ruff: noqa: S101
"""Epic 12: auto-approved pm elements are flagged; their evidence is exported as unreviewed."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from backend.app.services import propaganda_model_sync as sync
from backend.tests.unit._pm_fixtures import create_pm_database

EDIT_LOG = """
CREATE TABLE edit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL,
    record_id INTEGER NOT NULL, action TEXT NOT NULL, changed_by TEXT, old_value TEXT,
    new_value TEXT, reason TEXT);
"""


def _add_pipeline_rows(path: Path) -> None:
    """A person + relation approved by the news pipeline, with scout evidence not yet merged."""

    connection = sqlite3.connect(path)
    try:
        connection.executescript(EDIT_LOG)
        connection.execute(
            "INSERT INTO entities (id, name, type, primary_role_id, status, vervangen) "
            "VALUES (40, 'Anouk Verbeek', 'persoon', 2, 'goedgekeurd', 0)"
        )
        connection.execute(
            "INSERT INTO relations (id, source_id, target_id, relation_type, mechanism_id, "
            "influence, status, vervangen) VALUES (120, 40, 2, 'personeel', 1, 0.05, "
            "'goedgekeurd', 0)"
        )
        connection.execute(
            "INSERT INTO sources (id, title, publisher, reliability, onderwerp) "
            "VALUES (15, 'Profiel Anouk Verbeek', 'Gemeente Dijkerhoven', 'onbeoordeeld', "
            "'nl_systeem')"
        )
        connection.execute(
            "INSERT INTO source_locations VALUES (6, 15, 'url', 'https://example.org/verbeek')"
        )
        connection.executemany(
            "INSERT INTO arguments (id, relation_id, entity_id, parent_argument_id, property, "
            "stance, claim, status, contributed_by, vervangen, smaad_hold) "
            "VALUES (?,?,?,?,?,?,'claim',?,?,?,?)",
            [
                # scout evidence, not merged yet -> unreviewed source
                (30, 120, None, None, None, "supporting", "voorgesteld", "nieuws-scout", 0, 0),
                # another contributor -> never shown for an unmerged argument
                (31, 120, None, None, None, "supporting", "voorgesteld", "bot", 0, 0),
                # smaad hold -> excluded
                (32, 120, None, None, None, "supporting", "voorgesteld", "nieuws-scout", 0, 1),
                # scout evidence on a relation that was approved by a human -> not exported
                (33, 101, None, None, None, "supporting", "voorgesteld", "nieuws-scout", 0, 0),
            ],
        )
        connection.executemany(
            "INSERT INTO citations VALUES (?,?,?,?,?)",
            [
                (30, 30, 15, "Anouk Verbeek werkt bij Mediahuis.", "verbatim_quote"),
                (31, 31, 12, "Van een ander account.", None),
                (32, 32, 13, "Onder de smaadrem.", None),
                (33, 33, 15, "Niet automatisch goedgekeurd.", None),
            ],
        )
        connection.executemany(
            "INSERT INTO edit_log (table_name, record_id, action, changed_by, new_value) "
            "VALUES (?,?,?,?,?)",
            [
                ("entities", 40, "created", "nieuws-scout", '{"status": "voorgesteld"}'),
                ("entities", 40, "updated", "nieuws-autokeur", '{"status": "goedgekeurd"}'),
                ("relations", 120, "updated", "nieuws-autokeur", '{"status": "goedgekeurd"}'),
                # approved by the pipeline, then re-approved by a human: the human wins
                ("relations", 111, "updated", "nieuws-autokeur", '{"status": "goedgekeurd"}'),
                ("relations", 111, "updated", "maxime", '{"status": "goedgekeurd"}'),
                ("relations", 101, "updated", "maxime", '{"status": "goedgekeurd"}'),
            ],
        )
        connection.commit()
    finally:
        connection.close()


def test_auto_approved_ids_latest_status_change_wins() -> None:
    rows = [
        {
            "id": 1,
            "table_name": "relations",
            "record_id": 5,
            "changed_by": "nieuws-autokeur",
            "new_value": '{"status": "goedgekeurd"}',
        },
        {
            "id": 2,
            "table_name": "relations",
            "record_id": 6,
            "changed_by": "nieuws-autokeur",
            "new_value": '{"status": "goedgekeurd"}',
        },
        # withdrawn by the owner: back to voorgesteld
        {
            "id": 3,
            "table_name": "relations",
            "record_id": 6,
            "changed_by": "maxime",
            "new_value": '{"status": "voorgesteld"}',
        },
        # not a status change / broken JSON / other table: ignored
        {
            "id": 4,
            "table_name": "relations",
            "record_id": 5,
            "changed_by": "maxime",
            "new_value": '{"description": "nieuw"}',
        },
        {
            "id": 5,
            "table_name": "entities",
            "record_id": 7,
            "changed_by": "nieuws-autokeur",
            "new_value": "{kapot",
        },
        {
            "id": 6,
            "table_name": "arguments",
            "record_id": 8,
            "changed_by": "nieuws-autokeur",
            "new_value": '{"status": "goedgekeurd"}',
        },
        {
            "id": 7,
            "table_name": "entities",
            "record_id": 9,
            "changed_by": "nieuws-autokeur",
            "new_value": '{"status": "goedgekeurd"}',
        },
        {
            "id": 8,
            "table_name": "entities",
            "record_id": 10,
            "changed_by": "nieuws-autokeur",
            "new_value": '["status"]',
        },
    ]
    assert sync.auto_approved_ids(rows) == {"entities": {9}, "relations": {5}}


def test_read_without_edit_log_has_no_auto_approvals(tmp_path: Path) -> None:
    raw = sync.read_pm_database(create_pm_database(tmp_path))
    assert raw.auto_approved == {}
    snapshot = sync.transform(raw)
    assert not any(row["auto_approved"] for row in snapshot.entities)
    assert not any(row["auto_approved"] for row in snapshot.relations)
    assert not any(row["unreviewed"] for row in snapshot.sources)


def test_transform_flags_auto_approved_and_exports_unreviewed_evidence(tmp_path: Path) -> None:
    path = create_pm_database(tmp_path)
    _add_pipeline_rows(path)
    raw = sync.read_pm_database(path)
    assert raw.auto_approved == {"entities": {40}, "relations": {120}}

    snapshot = sync.transform(raw)
    entities = {row["id"]: row for row in snapshot.entities}
    relations = {row["id"]: row for row in snapshot.relations}
    assert entities[40]["auto_approved"] is True
    assert entities[1]["auto_approved"] is False
    assert relations[120]["auto_approved"] is True
    assert relations[111]["auto_approved"] is False  # a human approved it last
    assert relations[101]["auto_approved"] is False

    rel_sources = [
        row
        for row in snapshot.sources
        if row["owner_kind"] == "relation" and row["owner_id"] == 120
    ]
    assert [(row["quote"], row["unreviewed"], row["url"]) for row in rel_sources] == [
        ("Anouk Verbeek werkt bij Mediahuis.", True, "https://example.org/verbeek")
    ]
    assert relations[120]["source_count"] == 1

    # the scout's unmerged evidence on a human-approved relation is not exported
    rel_101 = [
        row
        for row in snapshot.sources
        if row["owner_kind"] == "relation" and row["owner_id"] == 101
    ]
    assert rel_101 and not any(row["unreviewed"] for row in rel_101)
    assert "Niet automatisch goedgekeurd." not in {row["quote"] for row in rel_101}
    sync.assert_no_excluded_layers(snapshot)


def test_merged_evidence_is_listed_before_unreviewed(tmp_path: Path) -> None:
    path = create_pm_database(tmp_path)
    _add_pipeline_rows(path)
    connection = sqlite3.connect(path)
    try:
        # a human merged one supporting argument with another source
        connection.execute(
            "INSERT INTO arguments (id, relation_id, stance, claim, status, contributed_by) "
            "VALUES (34, 120, 'supporting', 'claim', 'ongecontroleerd', 'maxime')"
        )
        connection.execute(
            "INSERT INTO citations VALUES (34, 34, 2, 'Jaarverslag noemt Verbeek.', NULL)"
        )
        connection.commit()
    finally:
        connection.close()
    snapshot = sync.transform(sync.read_pm_database(path))
    rows = sorted(
        (
            row
            for row in snapshot.sources
            if row["owner_kind"] == "relation" and row["owner_id"] == 120
        ),
        key=lambda row: row["position"],
    )
    assert [row["unreviewed"] for row in rows] == [False, True]
    assert rows[0]["quote"] == "Jaarverslag noemt Verbeek."


def test_snapshot_format_changed_for_the_new_columns() -> None:
    # 4: auto_approved + unreviewed sources; 5: arguments + mechanisms (Story 14.12)
    assert sync.SNAPSHOT_FORMAT == "5"
    assert sync._is_current({"db_mtime": "x", "format": "3"}, "x") is False
    assert sync._is_current({"db_mtime": "x", "format": "4"}, "x") is False
