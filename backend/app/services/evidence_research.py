"""Dun bewijs (Epic 14, Story 14.13): evidence research for thin propaganda-model links.

"Wie zit erachter?" shows, per link, what it rests on. Most links of the propaganda model rest on
one argument with one source, sometimes the party's own press release, often never checked. The
event page registers demand for such thin links (``request_relation_research``, migration 011);
one cycle of this service (scheduler job, every 15 minutes) then does:

1. **status**  - pull the research queue of the propaganda model (read-only SQLite) into
   ``relation_research``: queued -> in progress -> finished, what the agent found and whether a
   human has reviewed it yet
2. **enqueue** - requested links that are still thin go to ``POST /api/nieuws/doelen`` (soort
   ``relatie``) within a daily budget, with the news they appeared in, what they rest on now and
   what is missing
3. **priority** - every requested link goes to ``POST /api/nieuws/voorrang`` (no budget, it only
   changes the order): the propaganda model's automatic review checks the sources of what
   readers see first (bronchecker) and its source finder (bronzoeker) looks for a source where
   there is none (owner decision 2026-10-06: agents do everything in the propaganda model)
4. **round**   - when targets are open and rounds are switched on (``NIEUWS_BEWIJS_ENABLED``),
   start a round of the propaganda-model agent ``nieuws-bewijs``. It looks for evidence for AND
   against; everything lands ``voorgesteld``. Right after the round the propaganda model's
   automatic review decides (owner decision 2026-10-06: nobody reviews by hand): the
   bronchecker re-reads every source (A1), the prosecutor attacks influence claims (A2), the
   immune gate merges what holds and the rest is cleaned up. The pm sync then brings the
   merged evidence to the app.

Nothing a reader sends reaches the research agent: the request carries relation ids and an event
slug; the research target is built from the propaganda model and the app's own events only.
"""

from __future__ import annotations

import asyncio
import sqlite3
import time
import unicodedata
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import PmRelation, RelationResearch
from backend.app.repositories.relation_research_repo import (
    RelationResearchRepository,
    event_context,
)
from backend.app.services.entity_research.pm_client import (
    PmApiError,
    PmApiRateLimitError,
    PmApiUnavailableError,
    PmClient,
)
from backend.app.services.entity_research.pm_coverage import read_doelen
from backend.app.services.entity_research.runner import (
    AUTOMATIC_REVIEW_SCRIPT,
    EVIDENCE_ACCOUNT,
    EVIDENCE_BRIEF,
    EVIDENCE_LABEL,
    NieuwsScoutRunner,
    RoundState,
    RunnerConfig,
)
from backend.app.services.propaganda_model_sync import connect_read_only

logger = get_logger(__name__).bind(component="EvidenceResearchService")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

ACTIVE_STATUSES: tuple[str, ...] = ("wachtrij", "bezig")
FINAL_STATUSES: tuple[str, ...] = ("klaar", "niets_gevonden", "overgeslagen", "twijfel", "fout")
DOEL_TO_STATUS: dict[str, str] = {
    "open": "wachtrij",
    "bezig": "bezig",
    "klaar": "klaar",
    "niets_gevonden": "niets_gevonden",
    "overgeslagen": "overgeslagen",
    "twijfel": "twijfel",
    "fout": "fout",
}
# Argument statuses in the propaganda model
CURRENT_STATUSES = frozenset({"geverifieerd", "ongecontroleerd", "bronvermelding_nodig"})
MERGED_STATUSES = frozenset(CURRENT_STATUSES | {"betwist", "verouderd"})
PENDING_STATUS = "voorgesteld"
REJECTED_STATUS = "verworpen"
WELL_SUPPORTED = "onderbouwd"

NOT_IN_MODEL = "Dit verband staat niet (meer) in het model"
WELL_SUPPORTED_REASON = "Stevig onderbouwd: niet nodig"
RETRY_FAILED_AFTER = timedelta(days=1)
# Finished research keeps being refreshed this long (the automatic review decides on what was found)
FOLLOW_UP = timedelta(days=30)
SUMMARY_LIMIT = 4000
# Relation ids per call to the propaganda model's priority endpoint (its maximum)
PRIORITY_BATCH = 200

SOURCE_KINDS: dict[str, str] = {
    "nieuwsartikel": "nieuwsartikel",
    "persbericht": "persbericht",
    "rapport": "rapport",
    "academisch_artikel": "wetenschappelijk artikel",
    "boek": "boek",
    "transcript": "transcript",
    "interview": "interview",
    "dataset": "dataset",
    "wetgeving": "wettekst",
    "website": "website",
}


def _default_write_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.session import get_sessionmaker

    return get_sessionmaker()()


def _default_read_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.dual_write import get_read_session

    return get_read_session()


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _clip(text: str | None, limit: int) -> str | None:
    if not text:
        return None
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# --------------------------------------------------------------------------------------
# Pure helpers (tested directly)
# --------------------------------------------------------------------------------------


def fold(text: str | None) -> str:
    """Lowercase letters and digits only, without diacritics: "Leefomgeving (PBL)" ->
    "leefomgevingpbl"."""

    value = unicodedata.normalize("NFKD", text or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    return "".join(char for char in value.lower() if char.isalnum())


def host_label(url: str | None) -> str | None:
    """The name part of a web address: "pbl" for https://www.pbl.nl/actueel, "nos" for nos.nl."""

    try:
        host = urlsplit(url or "").hostname or ""
    except ValueError:
        return None
    parts = [part for part in host.lower().split(".") if part]
    if parts and parts[0] == "www":
        parts = parts[1:]
    if not parts:
        return None
    return parts[-2] if len(parts) >= 2 else parts[0]


def name_tokens(name: str | None) -> set[str]:
    """How an organisation may show up in a web address or as publisher: the folded name and the
    abbreviation between brackets ("Planbureau voor de Leefomgeving (PBL)" -> {"pbl", ...})."""

    outer, _, inner = (name or "").partition("(")
    tokens = {fold(outer)}
    inner = inner.rstrip(") ").strip()
    if inner and len(inner) <= 12:
        tokens.add(fold(inner))
    return {token for token in tokens if len(token) >= 2}


def from_entity(source: Mapping[str, Any], name: str | None) -> bool:
    """Does a source come from this entity itself (its own site, or published by it)?"""

    tokens = name_tokens(name)
    if not tokens:
        return False
    label = host_label(source.get("url"))
    if label and fold(label) in tokens:
        return True
    publisher = fold(source.get("publisher"))
    return bool(publisher) and publisher in tokens


@dataclass(slots=True)
class RelationEvidence:
    """What one relation of the propaganda model rests on now (for the research target)."""

    id: int
    source_name: str
    target_name: str
    relation_type: str
    mechanism: str | None = None
    approved: bool = True
    # Current supporting arguments about whether the link exists: [{id, status, sources}]
    supporting: list[dict[str, Any]] = field(default_factory=list)
    disputed: int = 0
    outdated: int = 0
    against: int = 0
    nuance: int = 0
    pending: int = 0

    @property
    def label(self) -> str:
        how = (self.mechanism or self.relation_type).replace("_", " ")
        return f"{self.source_name} → {self.target_name} ({how})"

    @property
    def sources(self) -> list[dict[str, Any]]:
        seen: set[tuple[str, str]] = set()
        unique: list[dict[str, Any]] = []
        for argument in self.supporting:
            for source in argument.get("sources") or []:
                key = (str(source.get("url") or ""), str(source.get("title") or ""))
                if key not in seen:
                    seen.add(key)
                    unique.append(source)
        return unique

    @property
    def origins(self) -> int:
        """Independent origins of the sources: cluster, else publisher, else web address."""

        keys = set()
        for source in self.sources:
            key = (
                source.get("cluster")
                or fold(source.get("publisher"))
                or host_label(source.get("url"))
                or source.get("title")
            )
            keys.add(str(key))
        return len(keys)

    @property
    def verified(self) -> bool:
        return any(argument.get("status") == "geverifieerd" for argument in self.supporting)

    @property
    def own_sources_only(self) -> bool:
        sources = self.sources
        return bool(sources) and all(from_entity(source, self.source_name) for source in sources)

    def _source_text(self, source: Mapping[str, Any]) -> str:
        kind = SOURCE_KINDS.get(str(source.get("kind") or ""), "bron")
        if from_entity(source, self.source_name):
            return f"{kind} van {self.source_name} zelf"
        who = source.get("publisher") or host_label(source.get("url"))
        return f"{kind} ({who})" if who else kind

    def evidence_line(self) -> str:
        """What the link rests on now, e.g. "1 argument vóór (niet gecontroleerd); 1 bron:
        persbericht van PBL zelf; niets ertegen ingebracht"."""

        parts: list[str] = []
        count = len(self.supporting)
        if count == 0:
            parts.append("geen geldig argument vóór")
        else:
            checked = "gecontroleerd" if self.verified else "niet gecontroleerd"
            parts.append(f"{count} argument{'en' if count != 1 else ''} vóór ({checked})")
            sources = self.sources
            if not sources:
                parts.append("zonder bron")
            else:
                shown = "; ".join(self._source_text(source) for source in sources[:3])
                more = f" en {len(sources) - 3} meer" if len(sources) > 3 else ""
                label = "1 bron" if len(sources) == 1 else f"{len(sources)} bronnen"
                parts.append(f"{label}: {shown}{more}")
        if self.disputed:
            parts.append(f"{self.disputed} betwist")
        if self.outdated:
            parts.append(f"{self.outdated} verouderd")
        parts.append(
            "niets ertegen ingebracht"
            if not self.against
            else f"{self.against} tegenargument{'en' if self.against != 1 else ''}"
        )
        if self.nuance:
            parts.append(f"{self.nuance} nuancering{'en' if self.nuance != 1 else ''}")
        return "; ".join(parts)

    def missing(self) -> list[str]:
        """What the evidence lacks, as tasks for the research agent."""

        gaps: list[str] = []
        if not self.supporting:
            gaps.append("een geldig argument met een bron die de claim draagt")
        elif not self.sources:
            gaps.append("een bron")
        else:
            if self.own_sources_only:
                gaps.append(f"een bron die niet van {self.source_name} zelf komt")
            if self.origins < 2:
                gaps.append("een tweede, onafhankelijke bron")
            if not self.verified:
                gaps.append("controle of de bron de claim werkelijk draagt")
        if not self.against:
            gaps.append("tegenbewijs: er is nog niets tegenin gebracht")
        return gaps


def read_relation_evidence(
    path: Path | str, relation_ids: Iterable[int]
) -> dict[int, RelationEvidence]:
    """The evidence behind relations of the propaganda model (read-only). Unknown or replaced
    relations are left out; relations that are no longer approved get ``approved=False``."""

    ids = sorted({int(i) for i in relation_ids})
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    connection = connect_read_only(Path(path))
    try:
        relations = connection.execute(
            "SELECT r.id, r.status, r.relation_type, s.name AS source_name, "  # noqa: S608
            "t.name AS target_name, m.name AS mechanism FROM relations r "
            "JOIN entities s ON s.id = r.source_id JOIN entities t ON t.id = r.target_id "
            f"LEFT JOIN mechanisms m ON m.id = r.mechanism_id WHERE r.id IN ({marks}) "
            "AND NOT r.vervangen",
            ids,
        ).fetchall()
        result = {
            row["id"]: RelationEvidence(
                id=row["id"],
                source_name=str(row["source_name"]),
                target_name=str(row["target_name"]),
                relation_type=str(row["relation_type"]),
                mechanism=row["mechanism"],
                approved=row["status"] == "goedgekeurd",
            )
            for row in relations
        }
        if not result:
            return {}
        found = ",".join("?" for _ in result)
        arguments = connection.execute(
            "WITH RECURSIVE tree(id, relation_id) AS ("  # noqa: S608 - placeholders only
            f" SELECT id, relation_id FROM arguments WHERE relation_id IN ({found})"
            " AND parent_argument_id IS NULL"
            " UNION ALL"
            " SELECT a.id, t.relation_id FROM arguments a"
            " JOIN tree t ON a.parent_argument_id = t.id"
            ") SELECT a.id, tree.relation_id, a.parent_argument_id, a.property, a.stance,"
            " a.status, a.vervangen, COALESCE(a.smaad_hold, 0) AS smaad_hold"
            " FROM arguments a JOIN tree ON tree.id = a.id ORDER BY a.id",
            list(result),
        ).fetchall()
        wanted = [row["id"] for row in arguments]
        sources: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for chunk_start in range(0, len(wanted), 500):
            chunk = wanted[chunk_start : chunk_start + 500]
            if not chunk:
                continue
            cmarks = ",".join("?" for _ in chunk)
            for row in connection.execute(
                "SELECT c.argument_id, s.title, s.source_type, s.publisher, s.cluster_key, "  # noqa: S608
                "(SELECT l.location FROM source_locations l WHERE l.source_id = s.id "
                "AND l.location_type = 'url' ORDER BY l.id LIMIT 1) AS url "
                f"FROM citations c JOIN sources s ON s.id = c.source_id "
                f"WHERE c.argument_id IN ({cmarks}) ORDER BY c.id",
                chunk,
            ):
                sources[row["argument_id"]].append(
                    {
                        "title": row["title"],
                        "kind": row["source_type"],
                        "publisher": row["publisher"],
                        "cluster": row["cluster_key"],
                        "url": row["url"],
                    }
                )
    finally:
        connection.close()

    for row in arguments:
        evidence = result.get(row["relation_id"])
        if evidence is None or row["vervangen"] or row["smaad_hold"]:
            continue
        status, stance = row["status"], row["stance"]
        if status == PENDING_STATUS:
            evidence.pending += 1
            continue
        if status not in MERGED_STATUSES:
            continue  # rejected
        if row["parent_argument_id"] is not None:
            if stance == "contradicting":
                evidence.against += 1
            continue
        if row["property"] and row["property"] != "existence":
            continue  # aspects (influence, mechanism, ...) are not about whether the link exists
        if stance == "contradicting":
            evidence.against += 1
        elif stance == "contextual":
            evidence.nuance += 1
        elif status == "betwist":
            evidence.disputed += 1
        elif status == "verouderd":
            evidence.outdated += 1
        else:
            evidence.supporting.append(
                {"id": row["id"], "status": status, "sources": sources.get(row["id"], [])}
            )
    return result


def research_found(path: Path | str, resultaat: Mapping[str, Any] | None) -> dict[str, int]:
    """Counts for what a finished research target produced and how far its review is."""

    result = resultaat if isinstance(resultaat, Mapping) else {}
    argument_ids = [int(i) for i in result.get("argument_ids") or [] if str(i).isdigit()]
    source_ids = [int(i) for i in result.get("source_ids") or [] if str(i).isdigit()]
    found = {
        "arguments": len(argument_ids),
        "sources": len(source_ids),
        "pending": 0,
        "merged": 0,
        "rejected": 0,
    }
    if not argument_ids:
        return found
    connection = connect_read_only(Path(path))
    try:
        marks = ",".join("?" for _ in argument_ids)
        for row in connection.execute(
            f"SELECT status, vervangen FROM arguments WHERE id IN ({marks})",  # noqa: S608
            argument_ids,
        ):
            if row["status"] == PENDING_STATUS:
                found["pending"] += 1
            elif row["status"] == REJECTED_STATUS:
                found["rejected"] += 1
            elif row["status"] in MERGED_STATUSES or row["vervangen"]:
                found["merged"] += 1
    except sqlite3.OperationalError:
        pass
    finally:
        connection.close()
    return found


def priority_of(row: RelationResearch, evidence: RelationEvidence | None) -> float:
    """More demand and less evidence first."""

    demand = min(int(row.requested_count or 0), 10) * 5.0
    thin = 0.0
    if evidence is not None:
        thin += 20.0 if not evidence.supporting else 0.0
        thin += 10.0 if evidence.own_sources_only else 0.0
        thin += 5.0 if not evidence.verified else 0.0
    return round(50.0 + demand + thin, 2)


def doel_payload(
    evidence: RelationEvidence,
    row: RelationResearch,
    events: Sequence[Mapping[str, Any]],
    base_url: str | None = None,
) -> dict[str, Any]:
    """The research target sent to the propaganda model (``POST /api/nieuws/doelen``)."""

    context_events: list[dict[str, Any]] = []
    articles: list[dict[str, Any]] = []
    for event in events[:3]:
        item = {"slug": event.get("slug"), "titel": event.get("titel")}
        if base_url and event.get("slug"):
            item["url"] = f"{base_url.rstrip('/')}/event/{event['slug']}"
        context_events.append(item)
        for article in event.get("artikelen") or []:
            if article.get("url") and len(articles) < 12:
                articles.append(dict(article))
    return {
        "sleutel": f"relatie:{evidence.id}",
        "soort": "relatie",
        "naam": evidence.label,
        "relation_id": evidence.id,
        "context": {
            "events": context_events,
            "artikelen": articles,
            "bewijs": evidence.evidence_line(),
            "ontbreekt": evidence.missing(),
            "mechanisme": evidence.mechanism,
            "nog_te_beoordelen": evidence.pending,
        },
        "prioriteit": priority_of(row, evidence),
    }


def status_from_doel(doel: Mapping[str, Any]) -> str:
    return DOEL_TO_STATUS.get(str(doel.get("status") or ""), "wachtrij")


# --------------------------------------------------------------------------------------
# Service
# --------------------------------------------------------------------------------------


class EvidenceResearchService:
    """Queues thin links for evidence research and keeps ``relation_research`` in sync."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        write_session_factory: SessionFactory | None = None,
        read_session_factory: SessionFactory | None = None,
        pm_client: PmClient | None = None,
        runner: NieuwsScoutRunner | None = None,
        pm_sync: Callable[[], Any] | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self.settings = settings or get_settings()
        self._pm_sync = pm_sync
        self._write = write_session_factory or _default_write_factory
        self._read = read_session_factory or _default_read_factory
        self.pm_client = pm_client or PmClient(
            self.settings.pm_api_base_url, self.settings.pm_agent_token_file
        )
        self.runner = runner or NieuwsScoutRunner(
            RunnerConfig(
                project_dir=self.settings.propaganda_project_dir,
                python=self.settings.nieuws_scout_python,
                claude_bin=self.settings.nieuws_scout_claude_bin,
                model=self.settings.nieuws_bewijs_model,
                effort=self.settings.nieuws_bewijs_effort,
                timeout_seconds=self.settings.nieuws_bewijs_timeout_seconds,
                max_rounds_per_day=self.settings.nieuws_bewijs_max_rounds_per_day,
                min_minutes_between_rounds=self.settings.nieuws_bewijs_min_minutes_between_rounds,
                active_start_hour=self.settings.nieuws_scout_active_start_hour,
                active_end_hour=self.settings.nieuws_scout_active_end_hour,
                # After a round: the automatic review of the propaganda model (its A2 step may
                # run one prosecutor round, hence the long timeout)
                autokeur_enabled=True,
                autokeur_script=AUTOMATIC_REVIEW_SCRIPT,
                autokeur_timeout_seconds=self.settings.nieuws_bewijs_timeout_seconds + 1800,
                label=EVIDENCE_LABEL,
                account=EVIDENCE_ACCOUNT,
                brief=EVIDENCE_BRIEF,
                extra_args=("--doel-soort", "relatie"),
            )
        )
        self._clock = clock
        self._lock = asyncio.Lock()
        self._prioritised_at: datetime | None = None
        self.last_runs: dict[str, dict[str, Any] | None] = {"cycle": None, "after_round": None}

    @property
    def enabled(self) -> bool:
        return bool(self.settings.evidence_research_enabled)

    @property
    def db_path(self) -> Path:
        return Path(self.settings.propaganda_db_path)

    def _now(self) -> datetime:
        return self._clock().astimezone(timezone.utc)

    def _start_of_day(self, now: datetime) -> datetime:
        local = now.astimezone()
        return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    # ------------------------------------------------------------------ cycle
    async def run_cycle(self, correlation_id: str | None = None) -> dict[str, Any]:
        """status -> enqueue -> round. Never raises for a missing propaganda model."""

        if not self.enabled:
            return {"skipped": True, "reason": "disabled"}
        started, started_at = time.monotonic(), datetime.now(timezone.utc)
        async with self._lock:
            status = await self.sync_status()
            enqueue = await self.enqueue()
            prioritised = await self.prioritise()
        round_started = await self.maybe_start_round()
        outcome = {
            "skipped": False,
            "status": status,
            "enqueue": enqueue,
            "prioritised": prioritised,
            "round_started": round_started,
        }
        self.last_runs["cycle"] = {
            "started_at": started_at.isoformat(),
            "duration_seconds": round(time.monotonic() - started, 3),
            **outcome,
        }
        logger.info("evidence_research_cycle", correlation_id=correlation_id, **outcome)
        return outcome

    # ------------------------------------------------------------------ enqueue
    async def _well_supported(self, session: AsyncSession, ids: Sequence[int]) -> set[int]:
        if not ids:
            return set()
        result = await session.execute(
            select(PmRelation.id).where(
                PmRelation.id.in_(list(ids)), PmRelation.certainty_label == WELL_SUPPORTED
            )
        )
        return {int(i) for i in result.scalars()}

    def _eligible(self, row: RelationResearch, now: datetime, force: bool) -> bool:
        if force:
            return True
        requested = _utc(row.last_requested_at)
        window = timedelta(days=self.settings.evidence_research_request_window_days)
        if requested is None or now - requested > window:
            return False
        if row.status == "nieuw":
            return True
        researched = _utc(row.researched_at)
        if row.status == "fout":
            return researched is None or now - researched >= RETRY_FAILED_AFTER
        if row.status in ("klaar", "niets_gevonden"):
            cooldown = timedelta(days=self.settings.evidence_research_cooldown_days)
            return bool(researched and now - researched >= cooldown and requested > researched)
        return False

    async def enqueue(self, only: int | None = None, *, force: bool = False) -> dict[str, Any]:
        """Queue requested thin links in the propaganda model within the daily budget."""

        now = self._now()
        queued = 0
        skipped: dict[str, int] = defaultdict(int)
        if not self.db_path.exists():
            return {"queued": 0, "skipped": {"pm_db_missing": 1}}
        async with self._write() as session:
            repo = RelationResearchRepository(session)
            budget = self.settings.evidence_research_daily_targets - await repo.count_queued_since(
                self._start_of_day(now)
            )
            if only is not None:
                rows = list((await repo.get_many([only])).values())
            else:
                rows = await repo.by_status(("nieuw", "klaar", "niets_gevonden", "fout"))
            candidates = [row for row in rows if self._eligible(row, now, force)]
            ids = [row.relation_id for row in candidates]
            solid = await self._well_supported(session, ids)
            evidence = read_relation_evidence(self.db_path, ids) if ids else {}
            slugs = {slug for row in candidates for slug in (row.request_events or [])[:3]}
            async with self._read() as read_session:
                contexts = {
                    item["slug"]: item for item in await event_context(read_session, sorted(slugs))
                }
            for row in candidates:
                item = evidence.get(row.relation_id)
                if item is None or not item.approved:
                    row.status, row.status_reason = "overgeslagen", NOT_IN_MODEL
                    skipped["not_in_model"] += 1
                    continue
                if row.relation_id in solid and not force:
                    row.status, row.status_reason = "niet_nodig", WELL_SUPPORTED_REASON
                    skipped["well_supported"] += 1
                    continue
                row.priority = priority_of(row, item)
            candidates = [
                row for row in candidates if row.status not in ("overgeslagen", "niet_nodig")
            ]
            candidates.sort(key=lambda row: (-(row.priority or 0.0), row.relation_id))
            for row in candidates:
                if not force and budget <= 0:
                    skipped["budget"] += 1
                    continue
                events = [
                    contexts[slug] for slug in (row.request_events or [])[:3] if slug in contexts
                ]
                payload = doel_payload(evidence[row.relation_id], row, events)
                try:
                    response = await self.pm_client.enqueue(
                        payload, again=row.status != "nieuw" or force
                    )
                except PmApiUnavailableError as exc:
                    logger.warning("evidence_research_pm_unavailable", error=str(exc))
                    skipped["pm_unavailable"] += 1
                    break
                except PmApiRateLimitError:
                    skipped["rate_limited"] += 1
                    break
                except PmApiError as exc:
                    logger.warning(
                        "evidence_research_enqueue_failed",
                        relation_id=row.relation_id,
                        error=str(exc),
                    )
                    skipped["error"] += 1
                    continue
                doel = response.get("doel") or {}
                row.pm_doel_id = doel.get("id") or row.pm_doel_id
                if response.get("finished"):
                    row.status = status_from_doel(doel)
                    skipped["already_finished"] += 1
                    continue
                row.status, row.status_reason = "wachtrij", None
                row.queued_at = now
                queued += 1
                budget -= 1
            await session.commit()
        return {"queued": queued, "skipped": dict(skipped)}

    # ------------------------------------------------------------------ priority
    async def prioritise(self) -> dict[str, Any]:
        """Tell the propaganda model which links readers see (requested since the last call):
        its automatic check and source search take those first. No daily budget: it costs
        nothing extra, it only changes the order."""

        now = self._now()
        window = timedelta(days=self.settings.evidence_research_request_window_days)
        since = self._prioritised_at or now - window
        async with self._write() as session:
            ids = await RelationResearchRepository(session).requested_since(since)
        sent = 0
        try:
            for start in range(0, len(ids), PRIORITY_BATCH):
                sent += await self.pm_client.prioritise(ids[start : start + PRIORITY_BATCH])
        except (PmApiUnavailableError, PmApiError) as exc:
            logger.warning("evidence_research_prioritise_failed", error=str(exc))
            return {"sent": sent, "error": str(exc)[:200]}
        self._prioritised_at = now
        return {"sent": sent}

    # ------------------------------------------------------------------ status
    async def sync_status(self) -> dict[str, Any]:
        """Pull the research queue of the propaganda model into relation_research."""

        if not self.db_path.exists():
            return {"skipped": True, "reason": "pm_db_missing"}
        now = self._now()
        updated = 0
        async with self._write() as session:
            repo = RelationResearchRepository(session)
            rows = [
                row
                for row in await repo.by_status((*ACTIVE_STATUSES, "klaar", "twijfel"))
                if row.status in ACTIVE_STATUSES
                or (row.researched_at and now - _utc(row.researched_at) <= FOLLOW_UP)
            ]
            by_key = {f"relatie:{row.relation_id}": row for row in rows}
            doelen = read_doelen(self.db_path, sleutels=sorted(by_key)) if by_key else []
            if doelen is None:
                return {"skipped": True, "reason": "pm_queue_missing"}
            for doel in doelen:
                row = by_key.get(str(doel.get("sleutel")))
                if row is None:
                    continue
                status = status_from_doel(doel)
                changed = status != row.status
                row.status = status
                row.status_reason = None
                row.pm_doel_id = doel.get("id") or row.pm_doel_id
                if status in FINAL_STATUSES:
                    row.found = research_found(self.db_path, doel.get("resultaat"))
                    row.summary = _clip(doel.get("verslag"), SUMMARY_LIMIT)
                    if changed or row.researched_at is None:
                        row.researched_at = now
                updated += 1
            await session.commit()
        return {"updated": updated}

    # ------------------------------------------------------------------ rounds
    async def maybe_start_round(self) -> bool:
        if not self.settings.nieuws_bewijs_enabled:
            return False
        async with self._write() as session:
            waiting = await RelationResearchRepository(session).by_status(("wachtrij",), limit=1)
        if not waiting:
            return False
        return self.runner.start_round(on_finished=self._after_round)

    async def _after_round(self, state: RoundState) -> None:
        started_at = datetime.now(timezone.utc)
        async with self._lock:
            status = await self.sync_status()
        review = state.autokeur or {}
        approved = review.get("goedgekeurd") or {}
        if review.get("gemerged") or approved.get("entities") or approved.get("relations"):
            await self._trigger_pm_sync()
        self.last_runs["after_round"] = {
            "finished_at": started_at.isoformat(),
            "returncode": state.returncode,
            "timed_out": state.timed_out,
            "review": review,
            "status": status,
        }

    async def _trigger_pm_sync(self) -> None:
        """Bring newly merged evidence to Supabase right away (the hourly sync catches up)."""

        try:
            if self._pm_sync is not None:
                result = self._pm_sync()
            else:
                from backend.app.services.propaganda_model_sync import get_propaganda_sync_service

                result = get_propaganda_sync_service().sync(correlation_id="evidence-research")
            if asyncio.iscoroutine(result):
                await result
        except Exception as exc:  # the hourly sync job catches up
            logger.warning("evidence_research_pm_sync_failed", error=str(exc))

    # ------------------------------------------------------------------ admin
    async def research_relation(
        self, relation_id: int, correlation_id: str | None = None
    ) -> dict[str, Any]:
        """Admin: queue one link now (bypasses the budget and the cooldown)."""

        now = self._now()
        async with self._lock:
            evidence = (
                read_relation_evidence(self.db_path, [relation_id]) if self.db_path.exists() else {}
            )
            if relation_id not in evidence:
                return {"relation_id": relation_id, "found": False, "reason": NOT_IN_MODEL}
            async with self._write() as session:
                repo = RelationResearchRepository(session)
                row = (await repo.get_many([relation_id])).get(relation_id)
                await repo.upsert(
                    relation_id,
                    {
                        "requested_count": ((row.requested_count or 0) if row else 0) + 1,
                        "last_requested_at": now,
                        "request_events": list(row.request_events or []) if row else [],
                        "status": row.status if row else "nieuw",
                    },
                )
                await session.commit()
            enqueue = await self.enqueue(relation_id, force=True)
        round_started = await self.maybe_start_round()
        async with self._write() as session:
            row = (await RelationResearchRepository(session).get_many([relation_id])).get(
                relation_id
            )
        logger.info("evidence_research_relation", correlation_id=correlation_id, id=relation_id)
        return {
            "relation_id": relation_id,
            "found": True,
            "label": evidence[relation_id].label,
            "evidence": evidence[relation_id].evidence_line(),
            "missing": evidence[relation_id].missing(),
            "status": row.status if row else None,
            "enqueue": enqueue,
            "round_started": round_started,
        }

    async def status(self) -> dict[str, Any]:
        async with self._write() as session:
            repo = RelationResearchRepository(session)
            counts = await repo.counts_by_status()
            queued_today = await repo.count_queued_since(self._start_of_day(self._now()))
        return {
            "enabled": self.enabled,
            "rounds_enabled": bool(self.settings.nieuws_bewijs_enabled),
            "pm_db": str(self.db_path),
            "pm_db_exists": self.db_path.exists(),
            "pm_server": await self.pm_client.health(),
            "counts": counts,
            "budget": {
                "queued_today": queued_today,
                "max_per_day": self.settings.evidence_research_daily_targets,
            },
            "runner": self.runner.status(),
            "last_runs": dict(self.last_runs),
        }


_service: EvidenceResearchService | None = None


def get_evidence_research_service() -> EvidenceResearchService:
    global _service
    if _service is None:
        _service = EvidenceResearchService()
    return _service


__all__ = [
    "EvidenceResearchService",
    "RelationEvidence",
    "doel_payload",
    "fold",
    "from_entity",
    "get_evidence_research_service",
    "host_label",
    "name_tokens",
    "priority_of",
    "read_relation_evidence",
    "research_found",
    "status_from_doel",
]
