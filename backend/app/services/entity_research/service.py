"""Entity research orchestration (Epic 12 "Wie is dit?", Story 12.7).

One cycle (scheduler job, every 15 minutes):

1. **status**  - pull the research queue of the propaganda model (read-only SQLite) into
   ``entity_research``: queued -> in progress -> finished, with what was found and approved
2. **triage**  - names of recently updated events and names tapped in the app: role, importance,
   coverage in the propaganda model -> ``entity_research`` (private persons are never researched)
3. **enqueue** - the most important thin/missing names go to ``POST /api/nieuws/doelen`` within a
   daily budget (automatic names and tapped names have separate budgets)
4. **round**   - when targets are open, start a round of the propaganda-model agent
   ``nieuws-scout``; afterwards the propaganda model's auto-approval runs, the status is pulled
   again and the pm sync copies the approved graph to Supabase.

The research, every proposal and the approval gates live in the propaganda model; this service
only decides WHO and shows the outcome.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import EntityResearch, EventEntity
from backend.app.nlp.entity_keys import slugify
from backend.app.repositories.entity_research_repo import (
    EntityResearchRepository,
    TriageInputRepository,
)
from backend.app.services.entity_research import priority as prio
from backend.app.services.entity_research.pm_client import (
    PmApiError,
    PmApiRateLimitError,
    PmApiUnavailableError,
    PmClient,
)
from backend.app.services.entity_research.pm_coverage import (
    PmCoverageIndex,
    read_doelen,
    research_outcome,
)
from backend.app.services.entity_research.roles import (
    ORGANISATIE,
    MentionContext,
    RoleAssessment,
    assess_organisation,
    assess_person,
    classify_word,
    infer_kind,
)
from backend.app.services.entity_research.runner import (
    NieuwsScoutRunner,
    RoundState,
    RunnerConfig,
)

logger = get_logger(__name__).bind(component="EntityResearchService")

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
DOEL_REASONS: dict[str, str] = {
    "overgeslagen": "Geen publieke rol gevonden — niet uitgezocht",
    "twijfel": "Meerdere personen met deze naam — niet eenduidig",
    "niets_gevonden": "Geen bronnen gevonden",
    "fout": "Onderzoek mislukt — wordt later opnieuw geprobeerd",
}
LINKEDIN_FOLLOW_UP = "Aanvulling via LinkedIn volgt"
NOT_IN_NEWS = "Niet gevonden in het nieuws — wordt niet uitgezocht"
NO_PUBLIC_ROLE = "Geen publieke rol gevonden in het nieuws — wordt (nog) niet uitgezocht"
REQUEST_WINDOW = timedelta(days=7)
RETRY_FAILED_AFTER = timedelta(days=1)
MAX_MENTIONS_PER_ARTICLE = 6
SUMMARY_LIMIT = 2000


def _default_read_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.dual_write import get_read_session

    return get_read_session()


def _default_write_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.session import get_sessionmaker

    return get_sessionmaker()()


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _clip(text: str | None, limit: int) -> str | None:
    if not text:
        return None
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def key_kind(key: str) -> str:
    prefix = key.partition(":")[0]
    return prefix if prefix in ("person", "org") else "unknown"


def key_slug(key: str) -> str:
    return key.partition(":")[2] or key


# --------------------------------------------------------------------------------------
# Pure helpers (tested directly)
# --------------------------------------------------------------------------------------


def span_matches(span_text: str, aliases: set[str]) -> bool:
    """Does a NER span refer to the entity? Handles titles inside the span and trailing
    appositions ("Boudewijn de Jong van De Hypotheker"); never surname prefixes."""

    slug = slugify(span_text)
    if not slug:
        return False
    if slug in aliases:
        return True
    words = span_text.split()
    while len(words) > 1 and classify_word(words[0]) is not None:
        words = words[1:]
        if slugify(" ".join(words)) in aliases:
            return True
    return any("-" in alias and slug.startswith(alias + "-") for alias in aliases)


def mention_contexts(
    article: Mapping[str, Any], aliases: set[str], limit: int = MAX_MENTIONS_PER_ARTICLE
) -> list[MentionContext]:
    """Text around the PERSON mentions of the entity in one article (NER offsets)."""

    content = str(article.get("content") or "")
    contexts: list[MentionContext] = []
    for entity in article.get("entities") or []:
        if not isinstance(entity, Mapping) or entity.get("label") != "PERSON":
            continue
        start, end = entity.get("start"), entity.get("end")
        if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end:
            continue
        if end > len(content):
            continue  # beyond the prefix that was read
        span = content[start:end]
        if not span_matches(span, aliases):
            continue
        line_start = start == 0 or content[start - 1] == "\n"
        next_line = None
        if line_start and (end == len(content) or content[end] == "\n"):
            stop = content.find("\n", end + 1)
            next_line = content[end + 1 : stop if stop != -1 else end + 81]
        contexts.append(
            MentionContext(
                before=content[max(0, start - 90) : start],
                after=content[end : end + 120],
                span=span,
                line_start=line_start,
                next_line=next_line,
                outlet=article.get("source_name"),
            )
        )
        if len(contexts) >= limit:
            break
    return contexts


def authority_slugs(name: str) -> set[str]:
    """Slugs of an LLM authority name: full name and without a parenthetical."""

    slugs = {slugify(name)}
    if "(" in name:
        outer, _, inner = name.partition("(")
        slugs.add(slugify(outer))
        inner = inner.rstrip(") ").strip()
        if inner.isupper() and 2 <= len(inner) <= 12:
            slugs.add(slugify(inner))
    return {slug for slug in slugs if slug}


def matching_authorities(
    authorities: Sequence[Mapping[str, Any]], aliases: set[str], kind: str
) -> list[Mapping[str, Any]]:
    matched: list[Mapping[str, Any]] = []
    for authority in authorities:
        name = str(authority.get("authority") or "").strip()
        if not name:
            continue
        slugs = authority_slugs(name)
        if kind == "person":
            # persons: full-name match only (surname aliases may be ambiguous)
            hit = bool(slugs & {alias for alias in aliases if "-" in alias})
        else:
            hit = bool(slugs & aliases)
        if hit:
            matched.append(authority)
    return matched


@dataclass(slots=True)
class Candidate:
    """Aggregated news presence of one name over its recent events."""

    key: str
    name: str
    kind: str
    aliases: set[str] = field(default_factory=set)
    article_ids: list[int] = field(default_factory=list)
    outlets: set[str] = field(default_factory=set)
    articles: int = 0
    mentions: int = 0
    event_ids: list[int] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    last_seen: datetime | None = None
    canonical: str | None = None  # an actor key resolved to an entity key
    authorities: list[Mapping[str, Any]] = field(default_factory=list)

    @property
    def prominence(self) -> prio.Prominence:
        return prio.Prominence(
            articles=self.articles,
            outlets=len(self.outlets),
            events=len(self.event_ids),
            mentions=self.mentions,
        )


def aggregate_candidates(
    rows: Sequence[EventEntity], max_article_ids: int = 40
) -> dict[str, Candidate]:
    """Group event_entities rows (newest event first) per entity key."""

    candidates: dict[str, Candidate] = {}
    for row in rows:
        candidate = candidates.get(row.entity_key)
        if candidate is None:
            candidate = Candidate(key=row.entity_key, name=row.name, kind=row.kind)
            candidates[row.entity_key] = candidate
        candidate.aliases.update(row.aliases or [])
        candidate.aliases.add(key_slug(row.entity_key))
        for article_id in row.article_ids or []:
            if (
                article_id not in candidate.article_ids
                and len(candidate.article_ids) < max_article_ids
            ):
                candidate.article_ids.append(article_id)
        candidate.outlets.update((row.outlet_counts or {}).keys())
        candidate.articles += int(row.article_count or 0)
        candidate.mentions += int(row.mention_count or 0)
        if row.event_id not in candidate.event_ids:
            candidate.event_ids.append(row.event_id)
            if len(candidate.events) < 3:
                candidate.events.append({"slug": row.event_slug, "titel": row.event_title})
        seen = _utc(row.event_last_updated_at)
        if seen and (candidate.last_seen is None or seen > candidate.last_seen):
            candidate.last_seen = seen
    return candidates


def doel_payload(row: EntityResearch, base_url: str | None = None) -> dict[str, Any]:
    """The research target sent to the propaganda model (``POST /api/nieuws/doelen``)."""

    prominence = row.prominence or {}
    context = dict(prominence.get("context") or {})
    events = context.get("events") or []
    if base_url:
        for event in events:
            if event.get("slug") and not event.get("url"):
                event["url"] = f"{base_url.rstrip('/')}/event/{event['slug']}"
    kind = (
        row.kind if row.kind in ("person", "org") else key_kind(prominence.get("canonical") or "")
    )
    payload: dict[str, Any] = {
        "sleutel": prominence.get("canonical") or row.entity_key,
        "naam": row.name,
        "soort": "persoon" if kind == "person" else "organisatie",
        "rol_categorie": row.role_category,
        "rol_hint": row.role_label,
        "context": {
            "events": events,
            "artikelen": context.get("artikelen") or [],
            "organisaties": context.get("organisaties") or [],
            "rolzinnen": context.get("rolzinnen") or [],
        },
        "prioriteit": round(float(row.priority or 0.0), 2),
    }
    if row.pm_entity_id:
        payload["entity_id"] = row.pm_entity_id
    return payload


def status_from_doel(doel: Mapping[str, Any]) -> tuple[str, str | None]:
    status = DOEL_TO_STATUS.get(str(doel.get("status") or ""), "wachtrij")
    reason = DOEL_REASONS.get(status)
    if status == "klaar" and doel.get("vervolg") == "linkedin":
        reason = LINKEDIN_FOLLOW_UP
    return status, reason


# --------------------------------------------------------------------------------------
# Service
# --------------------------------------------------------------------------------------


class EntityResearchService:
    """Decides which names are researched and keeps ``entity_research`` in sync."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        read_session_factory: SessionFactory | None = None,
        write_session_factory: SessionFactory | None = None,
        pm_client: PmClient | None = None,
        runner: NieuwsScoutRunner | None = None,
        coverage_loader: Callable[[Path], PmCoverageIndex] | None = None,
        pm_sync: Callable[[], Any] | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self.settings = settings or get_settings()
        self._read = read_session_factory or _default_read_factory
        self._write = write_session_factory or _default_write_factory
        self.pm_client = pm_client or PmClient(
            self.settings.pm_api_base_url, self.settings.pm_agent_token_file
        )
        self.runner = runner or NieuwsScoutRunner(
            RunnerConfig(
                project_dir=self.settings.propaganda_project_dir,
                python=self.settings.nieuws_scout_python,
                claude_bin=self.settings.nieuws_scout_claude_bin,
                model=self.settings.nieuws_scout_model,
                effort=self.settings.nieuws_scout_effort,
                timeout_seconds=self.settings.nieuws_scout_timeout_seconds,
                max_rounds_per_day=self.settings.nieuws_scout_max_rounds_per_day,
                min_minutes_between_rounds=self.settings.nieuws_scout_min_minutes_between_rounds,
                active_start_hour=self.settings.nieuws_scout_active_start_hour,
                active_end_hour=self.settings.nieuws_scout_active_end_hour,
                autokeur_enabled=self.settings.pm_autokeur_enabled,
            )
        )
        self._coverage_loader = coverage_loader or PmCoverageIndex.load
        self._pm_sync = pm_sync
        self._clock = clock
        self._coverage: PmCoverageIndex | None = None
        self._watermark: datetime | None = None
        self._lock = asyncio.Lock()
        self.last_runs: dict[str, dict[str, Any] | None] = {"cycle": None, "after_round": None}

    # ------------------------------------------------------------------ helpers
    @property
    def enabled(self) -> bool:
        return bool(self.settings.entity_research_enabled)

    @property
    def db_path(self) -> Path:
        return Path(self.settings.propaganda_db_path)

    def coverage(self) -> PmCoverageIndex | None:
        """The pm coverage index, reloaded when the pm database changed."""

        if not self.db_path.exists():
            return None
        from backend.app.services.propaganda_model_sync import db_fingerprint

        fingerprint = db_fingerprint(self.db_path)
        if self._coverage is None or self._coverage.fingerprint != fingerprint:
            self._coverage = self._coverage_loader(self.db_path)
        return self._coverage

    def _start_of_day(self, now: datetime) -> datetime:
        local = now.astimezone()
        return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    # ------------------------------------------------------------------ cycle
    async def run_cycle(self, correlation_id: str | None = None) -> dict[str, Any]:
        """status -> triage -> enqueue -> round. Never raises for a missing propaganda model."""

        if not self.enabled:
            return {"skipped": True, "reason": "disabled"}
        started, started_at = time.monotonic(), datetime.now(timezone.utc)
        async with self._lock:
            status = await self.sync_status()
            triage = await self.triage()
            enqueue = await self.enqueue()
        round_started = await self.maybe_start_round()
        outcome = {
            "skipped": False,
            "status": status,
            "triage": triage,
            "enqueue": enqueue,
            "round_started": round_started,
        }
        self.last_runs["cycle"] = {
            "started_at": started_at.isoformat(),
            "duration_seconds": round(time.monotonic() - started, 3),
            **outcome,
        }
        logger.info("entity_research_cycle", correlation_id=correlation_id, **outcome)
        return outcome

    # ------------------------------------------------------------------ triage
    async def _load_candidates(
        self, repo: EntityResearchRepository, now: datetime
    ) -> tuple[dict[str, Candidate], dict[str, EntityResearch], list[str]]:
        """Changed names of recent events + unassessed taps; returns (candidates, rows, missing)."""

        since = now - timedelta(days=self.settings.entity_research_lookback_days)
        watermark = self._watermark or since
        batch = self.settings.entity_research_triage_batch
        requests = await repo.requests_to_triage(batch)
        keys = await repo.changed_entity_keys(
            computed_after=watermark, updated_after=since, limit=batch
        )
        latest = await repo.latest_computed_at()
        if latest is not None:
            self._watermark = _utc(latest)

        entity_keys = set(keys)
        actor_requests: list[EntityResearch] = []
        for row in requests:
            if row.entity_key.startswith("actor:"):
                actor_requests.append(row)
            else:
                entity_keys.add(row.entity_key)
        # Tapped names are assessed over all their events (the tap may come from an older event)
        rows = await repo.entity_rows(sorted(entity_keys), updated_after=None)
        recent_or_requested = {row.entity_key for row in requests}
        filtered = [
            row
            for row in rows
            if row.entity_key in recent_or_requested
            or (_utc(row.event_last_updated_at) or since) >= since
        ]
        candidates = aggregate_candidates(filtered)

        missing: list[str] = []
        for request in actor_requests:
            candidate = await self._resolve_actor(repo, request)
            if candidate is None:
                missing.append(request.entity_key)
            else:
                candidates[request.entity_key] = candidate
        for request in requests:
            if request.entity_key not in candidates and request.entity_key not in missing:
                missing.append(request.entity_key)
        existing = await repo.get_many([*candidates, *missing])
        return candidates, existing, missing

    async def _resolve_actor(
        self, repo: EntityResearchRepository, request: EntityResearch
    ) -> Candidate | None:
        """An actor key (LLM authority) tapped on an event page -> its entity or authority."""

        slug = key_slug(request.entity_key)
        if not request.request_event_slug:
            return None
        event_rows = await repo.event_rows_by_slug(request.request_event_slug)
        for row in event_rows:
            if row.kind in ("person", "org") and slug in (row.aliases or []):
                rows = await repo.entity_rows([row.entity_key])
                candidate = aggregate_candidates(rows).get(row.entity_key)
                if candidate is not None:
                    candidate.canonical = row.entity_key
                    candidate.key = request.entity_key
                    return candidate
        event_ids = sorted({row.event_id for row in event_rows})
        if not event_ids:
            return None
        async with self._read() as session:
            authorities = await TriageInputRepository(session).authorities_by_event(event_ids)
        for event_id, items in authorities.items():
            for authority in items:
                name = str(authority.get("authority") or "")
                if slug in authority_slugs(name):
                    kind = (
                        request.kind
                        if request.kind in ("person", "org")
                        else infer_kind(name, str(authority.get("authority_type") or ""))
                    )
                    event = next((row for row in event_rows if row.event_id == event_id), None)
                    return Candidate(
                        key=request.entity_key,
                        name=name,
                        kind=kind,
                        aliases=authority_slugs(name),
                        event_ids=[event_id],
                        events=(
                            [{"slug": event.event_slug, "titel": event.event_title}]
                            if event
                            else []
                        ),
                        articles=1,
                        outlets=set(),
                        authorities=[authority],
                        last_seen=_utc(event.event_last_updated_at) if event else None,
                    )
        return None

    async def _assess(
        self, candidates: Mapping[str, Candidate]
    ) -> dict[str, tuple[RoleAssessment, dict[int, dict[str, Any]]]]:
        """Role assessment per candidate (reads article prefixes for persons only)."""

        max_articles = self.settings.entity_research_max_articles
        person_ids: set[int] = set()
        ref_ids: set[int] = set()
        event_ids: set[int] = set()
        for candidate in candidates.values():
            event_ids.update(candidate.event_ids[:5])
            if candidate.kind == "person":
                person_ids.update(candidate.article_ids[:max_articles])
            else:
                ref_ids.update(candidate.article_ids[:3])
        async with self._read() as session:
            inputs = TriageInputRepository(session)
            snippets = await inputs.article_snippets(sorted(person_ids)) if person_ids else {}
            refs = await inputs.article_refs(sorted(ref_ids - person_ids)) if ref_ids else {}
            authorities = await inputs.authorities_by_event(sorted(event_ids)) if event_ids else {}
        articles = {**refs, **snippets}

        results: dict[str, tuple[RoleAssessment, dict[int, dict[str, Any]]]] = {}
        for key, candidate in candidates.items():
            matched = list(candidate.authorities)
            for event_id in candidate.event_ids[:5]:
                matched.extend(
                    matching_authorities(
                        authorities.get(event_id, []), candidate.aliases, candidate.kind
                    )
                )
            own = {
                article_id: articles[article_id]
                for article_id in candidate.article_ids[
                    : max_articles if candidate.kind == "person" else 3
                ]
                if article_id in articles
            }
            if candidate.kind == "person":
                contexts = [
                    context
                    for article in own.values()
                    for context in mention_contexts(article, candidate.aliases)
                ]
                assessment = assess_person(contexts, matched)
            else:
                assessment = assess_organisation(matched)
            results[key] = (assessment, own)
        return results

    async def triage(self) -> dict[str, Any]:
        """Assess changed and tapped names; write role, priority and coverage."""

        now = self._clock().astimezone(timezone.utc)
        coverage = self.coverage()
        async with self._write() as session:
            repo = EntityResearchRepository(session)
            candidates, existing, missing = await self._load_candidates(repo, now)
            assessments = await self._assess(candidates) if candidates else {}
            counts: dict[str, int] = defaultdict(int)
            for key, candidate in candidates.items():
                assessment, articles = assessments[key]
                row = existing.get(key)
                requested = bool(
                    row is not None
                    and row.last_requested_at is not None
                    and now - _utc(row.last_requested_at) <= REQUEST_WINDOW
                )
                kind = candidate.kind if candidate.kind in ("person", "org") else "unknown"
                lookup_aliases = {*candidate.aliases, slugify(candidate.name)}
                info = coverage.lookup(lookup_aliases, kind) if coverage else None
                decision = prio.decide(
                    kind=kind,
                    category=assessment.category,
                    prominence=candidate.prominence,
                    pm_degree=info.degree if info else None,
                    is_foreign=assessment.is_foreign,
                    single_name=kind == "person" and len(candidate.name.split()) < 2,
                    requested=requested,
                    min_relations=self.settings.entity_research_min_pm_relations,
                    auto_threshold=self.settings.entity_research_auto_threshold,
                )
                values = self._triage_values(
                    candidate,
                    assessment,
                    decision,
                    articles,
                    info.id if info else None,
                    info.degree if info else None,
                    now,
                )
                if coverage and coverage.is_pending(lookup_aliases):
                    values["prominence"]["pending_in_pm"] = True
                if requested and decision.decision == prio.WAIT:
                    # a tap on a name without a known public role: say so instead of "aangevraagd"
                    # (re-assessed when new articles about it arrive)
                    values["status"] = "overgeslagen"
                    values["status_reason"] = NO_PUBLIC_ROLE
                if row is not None and row.status in (*ACTIVE_STATUSES, *FINAL_STATUSES):
                    # research in progress or done: keep its status, refresh the rest
                    if not (row.status == "overgeslagen" and row.pm_doel_id is None):
                        values.pop("status")
                        values.pop("status_reason")
                await repo.upsert(key, values)
                counts[values.get("status", row.status if row else "nieuw")] += 1
            for key in missing:
                row = existing.get(key)
                if row is None or row.status in ACTIVE_STATUSES:
                    continue
                await repo.upsert(
                    key, {"status": "overgeslagen", "status_reason": NOT_IN_NEWS, "triaged_at": now}
                )
                counts["overgeslagen"] += 1
            await session.commit()
        return {"assessed": len(candidates), "not_in_news": len(missing), "by_status": dict(counts)}

    def _triage_values(
        self,
        candidate: Candidate,
        assessment: RoleAssessment,
        decision: prio.Decision,
        articles: Mapping[int, Mapping[str, Any]],
        pm_entity_id: int | None,
        pm_degree: int | None,
        now: datetime,
    ) -> dict[str, Any]:
        if decision.decision == prio.NOT_NEEDED:
            status = "niet_nodig"
        elif decision.decision == prio.SKIP:
            status = "overgeslagen"
        else:
            status = "nieuw"
        artikelen = [
            {
                "url": article.get("url"),
                "bron": article.get("source_name"),
                "datum": _iso(article.get("published_at")),
            }
            for article in list(articles.values())[:5]
            if article.get("url")
        ]
        prominence: dict[str, Any] = {
            "articles": candidate.articles,
            "outlets": len(candidate.outlets),
            "events": len(candidate.event_ids),
            "mentions": candidate.mentions,
            "last_seen": _iso(candidate.last_seen),
            "decision": decision.decision,
            "confidence": assessment.confidence,
            "context": {
                "events": candidate.events,
                "artikelen": artikelen,
                "organisaties": assessment.organisations,
                "rolzinnen": assessment.evidence,
            },
        }
        if candidate.canonical:
            prominence["canonical"] = candidate.canonical
        kind = candidate.kind if candidate.kind in ("person", "org") else "unknown"
        return {
            "name": _clip(candidate.name, 255) or candidate.key,
            "kind": kind,
            "role_category": (
                assessment.category
                if kind == "person" or assessment.category != ORGANISATIE
                else ORGANISATIE
            ),
            "role_label": _clip(assessment.label, 255),
            "is_foreign": assessment.is_foreign,
            "priority": decision.priority,
            "prominence": prominence,
            "pm_entity_id": pm_entity_id,
            "pm_degree": pm_degree,
            "status": status,
            "status_reason": (
                decision.reason if status != "nieuw" or decision.decision == prio.WAIT else None
            ),
            "triaged_at": now,
        }

    # ------------------------------------------------------------------ enqueue
    async def enqueue(self, only_key: str | None = None, *, force: bool = False) -> dict[str, Any]:
        """Queue research targets in the propaganda model within the daily budgets."""

        now = self._clock().astimezone(timezone.utc)
        today = self._start_of_day(now)
        cooldown = timedelta(days=self.settings.entity_research_cooldown_days)
        queued = 0
        skipped: dict[str, int] = defaultdict(int)
        async with self._write() as session:
            repo = EntityResearchRepository(session)
            budget_auto = (
                self.settings.entity_research_daily_targets
                - await repo.count_queued_since(today, requested=False)
            )
            budget_requests = (
                self.settings.entity_research_daily_requests
                - await repo.count_queued_since(today, requested=True)
            )
            if only_key:
                rows = list((await repo.get_many([only_key])).values())
            else:
                rows = await repo.by_status(("nieuw", "klaar", "niets_gevonden", "fout"))
            candidates: list[tuple[bool, EntityResearch]] = []
            for row in rows:
                decision = (row.prominence or {}).get("decision")
                requested = (
                    row.last_requested_at is not None
                    and now - _utc(row.last_requested_at) <= REQUEST_WINDOW
                )
                again = row.status != "nieuw"
                if not force:
                    if (row.prominence or {}).get("pending_in_pm"):
                        skipped["pending_in_pm"] += 1
                        continue
                    if row.status in ("klaar", "niets_gevonden"):
                        researched = _utc(row.researched_at)
                        thin = (
                            row.pm_degree is None
                            or row.pm_degree < self.settings.entity_research_min_pm_relations
                        )
                        if not (researched and now - researched >= cooldown and thin):
                            continue
                    if row.status == "fout":
                        researched = _utc(row.researched_at)
                        if researched and now - researched < RETRY_FAILED_AFTER:
                            continue
                    if decision == prio.RESEARCH or (requested and decision == prio.ON_REQUEST):
                        pass
                    else:
                        continue
                candidates.append((again, row))
            # tapped names first, then by priority
            candidates.sort(
                key=lambda item: (
                    item[1].last_requested_at is None,
                    -(item[1].priority or 0.0),
                    item[1].entity_key,
                )
            )
            for again, row in candidates:
                requested = row.last_requested_at is not None
                if not force:
                    if requested and budget_requests <= 0:
                        skipped["budget_requests"] += 1
                        continue
                    if not requested and budget_auto <= 0:
                        skipped["budget_auto"] += 1
                        continue
                try:
                    response = await self.pm_client.enqueue(doel_payload(row), again=again or force)
                except PmApiUnavailableError as exc:
                    logger.warning("entity_research_pm_unavailable", error=str(exc))
                    skipped["pm_unavailable"] += 1
                    break
                except PmApiRateLimitError:
                    skipped["rate_limited"] += 1
                    break
                except PmApiError as exc:
                    logger.warning(
                        "entity_research_enqueue_failed", key=row.entity_key, error=str(exc)
                    )
                    skipped["error"] += 1
                    continue
                doel = response.get("doel") or {}
                if response.get("finished"):
                    status, reason = status_from_doel(doel)
                    row.status, row.status_reason = status, reason
                    row.pm_doel_id = doel.get("id") or row.pm_doel_id
                    skipped["already_finished"] += 1
                    continue
                row.status = "wachtrij"
                row.status_reason = None
                row.pm_doel_id = doel.get("id") or row.pm_doel_id
                row.queued_at = now
                queued += 1
                if requested:
                    budget_requests -= 1
                else:
                    budget_auto -= 1
            await session.commit()
        return {"queued": queued, "skipped": dict(skipped)}

    # ------------------------------------------------------------------ status
    async def sync_status(self) -> dict[str, Any]:
        """Pull the research queue of the propaganda model into entity_research."""

        if not self.db_path.exists():
            return {"skipped": True, "reason": "pm_db_missing"}
        now = self._clock().astimezone(timezone.utc)
        coverage = self.coverage()
        updated = 0
        auto_approved = 0
        async with self._write() as session:
            repo = EntityResearchRepository(session)
            recent_final = [
                row
                for row in await repo.by_status(("klaar",))
                if row.researched_at and now - _utc(row.researched_at) <= timedelta(days=2)
            ]
            rows = [*await repo.by_status(ACTIVE_STATUSES), *recent_final]
            by_sleutel: dict[str, list[EntityResearch]] = defaultdict(list)
            for row in rows:
                by_sleutel[(row.prominence or {}).get("canonical") or row.entity_key].append(row)
            doelen = read_doelen(self.db_path, sleutels=sorted(by_sleutel)) if by_sleutel else []
            if doelen is None:
                return {"skipped": True, "reason": "pm_queue_missing"}
            for doel in doelen:
                for row in by_sleutel.get(str(doel.get("sleutel")), []):
                    status, reason = status_from_doel(doel)
                    changed = status != row.status
                    row.status, row.status_reason = status, reason
                    row.pm_doel_id = doel.get("id") or row.pm_doel_id
                    if status in FINAL_STATUSES:
                        outcome = research_outcome(
                            self.db_path, doel.get("resultaat"), name=row.name, kind=row.kind
                        )
                        previous = int((row.found or {}).get("auto_approved") or 0)
                        row.found = outcome.as_found()
                        auto_approved += max(0, outcome.auto_approved - previous)
                        row.summary = _clip(doel.get("verslag"), SUMMARY_LIMIT)
                        entity_id = outcome.main_entity_id or doel.get("entity_id")
                        if entity_id:
                            row.pm_entity_id = int(entity_id)
                        if changed or row.researched_at is None:
                            row.researched_at = now
                        if coverage and row.pm_entity_id in coverage.entities:
                            row.pm_degree = coverage.entities[row.pm_entity_id].degree
                    updated += 1
            await session.commit()
        if auto_approved:
            await self._trigger_pm_sync()
        return {"updated": updated, "new_auto_approved": auto_approved}

    async def _trigger_pm_sync(self) -> None:
        """Copy newly approved graph elements to Supabase right away (the sync skips when the pm
        database did not change)."""

        try:
            if self._pm_sync is not None:
                result = self._pm_sync()
            else:
                from backend.app.services.propaganda_model_sync import get_propaganda_sync_service

                result = get_propaganda_sync_service().sync(correlation_id="entity-research")
            if asyncio.iscoroutine(result):
                await result
        except Exception as exc:  # the hourly sync job catches up
            logger.warning("entity_research_pm_sync_failed", error=str(exc))

    # ------------------------------------------------------------------ rounds
    async def maybe_start_round(self) -> bool:
        if not self.settings.nieuws_scout_enabled:
            return False
        async with self._write() as session:
            waiting = await EntityResearchRepository(session).by_status(("wachtrij",), limit=1)
        if not waiting:
            return False
        return self.runner.start_round(on_finished=self._after_round)

    async def _after_round(self, state: RoundState) -> None:
        started_at = datetime.now(timezone.utc)
        async with self._lock:
            status = await self.sync_status()
        if (state.autokeur or {}).get("goedgekeurd"):
            await self._trigger_pm_sync()
        self.last_runs["after_round"] = {
            "finished_at": started_at.isoformat(),
            "returncode": state.returncode,
            "timed_out": state.timed_out,
            "autokeur": state.autokeur,
            "status": status,
        }

    # ------------------------------------------------------------------ admin
    async def research_key(self, key: str, correlation_id: str | None = None) -> dict[str, Any]:
        """Admin: assess one name now and queue it (bypasses budgets and cooldown)."""

        key = key.strip().lower()
        now = self._clock().astimezone(timezone.utc)
        async with self._lock:
            async with self._write() as session:
                repo = EntityResearchRepository(session)
                row = (await repo.get_many([key])).get(key)
                if row is None:
                    rows = await repo.entity_rows([key])
                    if not rows and not key.startswith("actor:"):
                        return {"key": key, "found": False, "reason": NOT_IN_NEWS}
                    name = rows[0].name if rows else key_slug(key).replace("-", " ")
                    await repo.upsert(key, {"name": name, "kind": key_kind(key)})
                    await session.commit()
            async with self._write() as session:
                repo = EntityResearchRepository(session)
                row = (await repo.get_many([key])).get(key)
                if row is not None:
                    row.last_requested_at = now
                    row.requested_count = (row.requested_count or 0) + 1
                    row.triaged_at = None
                    await session.commit()
            triage = await self.triage()
            async with self._write() as session:
                row = (await EntityResearchRepository(session).get_many([key])).get(key)
                blocked = (
                    row is None
                    or row.status in ("niet_nodig",)
                    or (
                        # the admin may force a name without a known role (the agent checks the
                        # public role first); private and foreign persons stay blocked
                        row.status == "overgeslagen"
                        and row.pm_doel_id is None
                        and row.status_reason != NO_PUBLIC_ROLE
                    )
                )
            enqueue = (
                {"queued": 0, "skipped": {"not_eligible": 1}}
                if blocked
                else await self.enqueue(key, force=True)
            )
        round_started = await self.maybe_start_round()
        async with self._write() as session:
            row = (await EntityResearchRepository(session).get_many([key])).get(key)
        logger.info("entity_research_key", correlation_id=correlation_id, key=key)
        return {
            "key": key,
            "found": row is not None,
            "status": row.status if row else None,
            "status_reason": row.status_reason if row else None,
            "role_category": row.role_category if row else None,
            "priority": row.priority if row else None,
            "triage": triage,
            "enqueue": enqueue,
            "round_started": round_started,
        }

    async def status(self) -> dict[str, Any]:
        async with self._write() as session:
            repo = EntityResearchRepository(session)
            counts = await repo.counts_by_status()
            now = self._clock().astimezone(timezone.utc)
            today = self._start_of_day(now)
            queued_auto = await repo.count_queued_since(today, requested=False)
            queued_requests = await repo.count_queued_since(today, requested=True)
        return {
            "enabled": self.enabled,
            "pm_db": str(self.db_path),
            "pm_db_exists": self.db_path.exists(),
            "pm_server": await self.pm_client.health(),
            "pm_token_present": Path(self.settings.pm_agent_token_file).exists(),
            "counts": counts,
            "budget": {
                "auto_today": queued_auto,
                "auto_max": self.settings.entity_research_daily_targets,
                "requests_today": queued_requests,
                "requests_max": self.settings.entity_research_daily_requests,
            },
            "runner": self.runner.status(),
            "linkedin": await self.runner.linkedin_status(),
            "last_runs": dict(self.last_runs),
            "watermark": _iso(self._watermark),
        }


_service: EntityResearchService | None = None


def get_entity_research_service() -> EntityResearchService:
    global _service
    if _service is None:
        _service = EntityResearchService()
    return _service


__all__ = [
    "Candidate",
    "EntityResearchService",
    "aggregate_candidates",
    "authority_slugs",
    "doel_payload",
    "get_entity_research_service",
    "key_kind",
    "key_slug",
    "matching_authorities",
    "mention_contexts",
    "span_matches",
    "status_from_doel",
]
