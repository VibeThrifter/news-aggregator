"""Coverage of named entities in the propaganda model (Epic 12 "Wie is dit?", Story 12.6).

Reads the propaganda-model SQLite database strictly read-only (like the pm sync):

- :class:`PmCoverageIndex`: is a name in the approved graph, and with how many approved relations
  (same alias rules and person/organisation guard as the frontend's ``pm_match``)?
- :func:`read_doelen`: the research queue ``nieuws_doelen`` (status of the research agent)
- :func:`research_outcome`: what a finished research target produced (approved automatically,
  still waiting for a human)

Writes to the propaganda model never happen here: they go through its REST API (``pm_client``).
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.app.nlp.entity_keys import slugify
from backend.app.services.propaganda_model_sync import (
    APPROVED_STATUS,
    AUTO_RESEARCH_CONTRIBUTORS,
    PERSON_TYPES,
    auto_approved_ids,
    connect_read_only,
    db_fingerprint,
    generate_aliases,
)

DOEL_COLUMNS: tuple[str, ...] = (
    "id",
    "sleutel",
    "naam",
    "soort",
    "status",
    "vervolg",
    "verslag",
    "resultaat",
    "entity_id",
    "prioriteit",
    "pogingen",
    "aangemaakt",
    "bijgewerkt",
)


@dataclass(frozen=True, slots=True)
class PmEntityInfo:
    id: int
    name: str
    type: str
    degree: int
    auto_approved: bool = False

    @property
    def is_person(self) -> bool:
        return self.type in PERSON_TYPES


def compatible(info: PmEntityInfo, kind: str | None) -> bool:
    """No person <-> organisation mix-ups (mirrors the frontend's compatibleMatches)."""

    if kind == "person":
        return info.is_person
    if kind == "org":
        return not info.is_person
    return True


@dataclass(slots=True)
class PmCoverageIndex:
    """Approved pm entities by alias, with their approved-relation degree."""

    entities: dict[int, PmEntityInfo] = field(default_factory=dict)
    aliases: dict[str, list[int]] = field(default_factory=dict)
    # slugs of entity names the news research agent proposed that are not approved yet
    pending_slugs: set[str] = field(default_factory=set)
    fingerprint: str | None = None

    @classmethod
    def load(cls, path: Path | str) -> PmCoverageIndex:
        db_path = Path(path)
        connection = connect_read_only(db_path)
        try:
            entities = [
                dict(row)
                for row in connection.execute(
                    "SELECT id, name, type FROM entities "
                    "WHERE status = 'goedgekeurd' AND NOT vervangen ORDER BY id"
                )
            ]
            approved = {row["id"] for row in entities}
            degree: dict[int, int] = defaultdict(int)
            for row in connection.execute(
                "SELECT source_id, target_id FROM relations "
                "WHERE status = 'goedgekeurd' AND NOT vervangen"
            ):
                source, target = row["source_id"], row["target_id"]
                if source in approved and target in approved:
                    degree[source] += 1
                    if target != source:
                        degree[target] += 1
            auto = _auto_approvals(connection)
            pending = _pending_scout_names(connection)
        finally:
            connection.close()
        index = cls(fingerprint=db_fingerprint(db_path), pending_slugs=pending)
        for row in entities:
            index.entities[row["id"]] = PmEntityInfo(
                row["id"],
                str(row["name"]),
                str(row["type"]),
                degree.get(row["id"], 0),
                row["id"] in auto.get("entities", set()),
            )
        aliases: dict[str, list[int]] = defaultdict(list)
        for alias in generate_aliases(entities):
            aliases[alias["alias"]].append(alias["entity_id"])
        index.aliases = dict(aliases)
        return index

    def lookup(self, aliases: Iterable[str], kind: str | None = None) -> PmEntityInfo | None:
        """Best compatible match (highest degree) for any of the slugs."""

        best: PmEntityInfo | None = None
        for alias in aliases:
            for entity_id in self.aliases.get(slugify(alias) or alias, ()):
                info = self.entities.get(entity_id)
                if info is None or not compatible(info, kind):
                    continue
                if best is None or (info.degree, -info.id) > (best.degree, -best.id):
                    best = info
        return best

    def is_pending(self, aliases: Iterable[str]) -> bool:
        return any((slugify(alias) or alias) in self.pending_slugs for alias in aliases)


def _auto_approvals(connection: sqlite3.Connection) -> dict[str, set[int]]:
    try:
        return auto_approved_ids(
            dict(row)
            for row in connection.execute(
                "SELECT id, table_name, record_id, changed_by, new_value FROM edit_log "
                "WHERE table_name IN ('entities', 'relations') AND action = 'updated' "
                "AND new_value LIKE '%status%' ORDER BY id"
            )
        )
    except sqlite3.OperationalError:
        return {}


def _pending_scout_names(connection: sqlite3.Connection) -> set[str]:
    """Slugs of voorgesteld entities created by the news research agent."""

    marks = ",".join("?" for _ in AUTO_RESEARCH_CONTRIBUTORS)
    try:
        query = (
            "SELECT e.name FROM entities e JOIN edit_log l "  # noqa: S608 - placeholders only
            "ON l.table_name = 'entities' AND l.record_id = e.id AND l.action = 'created' "
            f"WHERE e.status = 'voorgesteld' AND l.changed_by IN ({marks})"
        )
        rows = connection.execute(
            query,
            tuple(sorted(AUTO_RESEARCH_CONTRIBUTORS)),
        ).fetchall()
    except sqlite3.OperationalError:
        return set()
    return {slug for (name,) in rows if (slug := slugify(str(name)))}


def _decode(value: Any) -> Any:
    if isinstance(value, str) and value[:1] in "{[":
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def read_doelen(
    path: Path | str,
    *,
    sleutels: Sequence[str] | None = None,
    updated_after: str | None = None,
) -> list[dict[str, Any]] | None:
    """Rows of ``nieuws_doelen`` (None when the queue table does not exist yet)."""

    connection = connect_read_only(Path(path))
    try:
        query = f"SELECT {', '.join(DOEL_COLUMNS)} FROM nieuws_doelen"  # noqa: S608
        clauses: list[str] = []
        params: list[Any] = []
        if sleutels is not None:
            if not sleutels:
                return []
            clauses.append(f"sleutel IN ({','.join('?' for _ in sleutels)})")
            params.extend(sleutels)
        if updated_after:
            clauses.append("bijgewerkt > ?")
            params.append(updated_after)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        try:
            rows = connection.execute(query + " ORDER BY id", params).fetchall()
        except sqlite3.OperationalError:
            return None
    finally:
        connection.close()
    return [{key: _decode(row[key]) for key in row.keys()} for row in rows]


@dataclass(frozen=True, slots=True)
class ResearchOutcome:
    entities: int
    relations: int
    auto_approved: int
    pending: int
    rejected: int
    main_entity_id: int | None

    def as_found(self) -> dict[str, int]:
        return {
            "entities": self.entities,
            "relations": self.relations,
            "auto_approved": self.auto_approved,
            "pending": self.pending,
        }


def research_outcome(
    path: Path | str,
    resultaat: Mapping[str, Any] | None,
    *,
    name: str | None = None,
    kind: str | None = None,
) -> ResearchOutcome:
    """Counts for the ids a research target produced, and the entity that is the target itself."""

    result = resultaat if isinstance(resultaat, Mapping) else {}
    entity_ids = [int(i) for i in result.get("entity_ids") or [] if str(i).isdigit()]
    relation_ids = [int(i) for i in result.get("relation_ids") or [] if str(i).isdigit()]
    if not entity_ids and not relation_ids:
        return ResearchOutcome(0, 0, 0, 0, 0, None)
    connection = connect_read_only(Path(path))
    try:
        auto = _auto_approvals(connection)
        statuses: dict[int, str] = {}
        if relation_ids:
            marks = ",".join("?" for _ in relation_ids)
            for row in connection.execute(
                f"SELECT id, status, vervangen FROM relations WHERE id IN ({marks})",  # noqa: S608
                relation_ids,
            ):
                statuses[row["id"]] = "vervangen" if row["vervangen"] else row["status"]
        main: int | None = None
        if entity_ids:
            marks = ",".join("?" for _ in entity_ids)
            rows = connection.execute(
                f"SELECT id, name, type FROM entities WHERE id IN ({marks})",  # noqa: S608
                entity_ids,
            ).fetchall()
            wanted = slugify(name or "")
            for row in rows:
                if wanted and slugify(str(row["name"])) == wanted:
                    main = row["id"]
                    break
            if main is None and kind == "person":
                persons = [row["id"] for row in rows if row["type"] in PERSON_TYPES]
                main = persons[0] if len(persons) == 1 else None
    finally:
        connection.close()
    auto_relations = auto.get("relations", set())
    approved = [rid for rid, status in statuses.items() if status == APPROVED_STATUS]
    return ResearchOutcome(
        entities=len(entity_ids),
        relations=len(relation_ids),
        auto_approved=sum(1 for rid in approved if rid in auto_relations),
        pending=sum(1 for status in statuses.values() if status == "voorgesteld"),
        rejected=sum(1 for status in statuses.values() if status == "afgewezen"),
        main_entity_id=main,
    )


__all__ = [
    "PmCoverageIndex",
    "PmEntityInfo",
    "ResearchOutcome",
    "compatible",
    "read_doelen",
    "research_outcome",
]
