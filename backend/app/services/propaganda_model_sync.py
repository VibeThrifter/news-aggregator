"""Propagandamodel-koppeling (Epic 11, Story 11.17).

Synchronises the approved part of the sibling ``propaganda-model`` knowledge graph (a SQLite
database, opened strictly read-only) into the ``pm_*`` tables. On Supabase those tables are not
readable by ``anon``: the frontend reaches them only through the SECURITY DEFINER RPC functions
of migration 005, one small neighbourhood / search result / detail at a time, so the dataset
cannot be downloaded in one go (data licence: no redistribution).

Pipeline
--------
1. :func:`read_pm_database` - read-only reader (``file:...?mode=ro``). Selects approved rows only
   and never reads the political-position layer or ``machtsvalentie`` arguments.
2. :func:`transform` - pure function: raw rows -> :class:`PmSnapshot` (rows for the pm_* tables).
3. :func:`assert_no_excluded_layers` - mechanical release check on the serialised snapshot
   (mirrors ``grep -c "politieke_positie\\|machtsvalentie"`` from the pm release discipline).
4. :func:`write_snapshot` - full refresh in one transaction (delete pm_* then batched inserts).

Since format 5 (migration 010) the arguments about each exported relation travel along: claim,
stance (for / against / nuance), review status and up to three sources each, plus what every
mechanism means. The frontend shows them so a reader sees what a link rests on and how sure the
model is, instead of one bare description.

Rules copied from the propaganda-model project (deliberately not imported - keep in sync by hand):

- approval filter ``status = 'goedgekeurd' AND NOT vervangen`` (``scripts/export_dataset.py``);
  a relation is exported only when both endpoints are exported entities.
- derived relation certainty = ``scoring.py`` layer B: argument force tau = status factor x
  source factor (reliability x relevance x method), DF-QuAD tree propagation incl. the admin
  veto, cluster balance ``support / (support + attack + 1)``, capped at 0.70 without a sourced
  contradiction; without root arguments the stored prior is used. It is exported ONLY as a
  qualitative label (:func:`certainty_label`) - never as a number (0.05 floor = "unproven").
- primary filter = ``scoring.entity_primary_filter``: argmax over the non-``tegenmacht`` filters
  of sum(derived certainty x derived influence) over the relations the entity is the *source*
  of (both ends for bidirectional relations); fallback = category of the primary role.
  ``overig`` is exported as NULL.
- relation filters = the primary mechanism filter (when it is one of the six filters, i.e. not
  ``cross_filter``/``overig``/NULL) UNION all filter tags of the relation's mechanism
  (``mechanism_filters``, as in ``viz_data.py``), ``overig`` dropped: an edge coloured by its
  primary filter is always found when exploring via that filter. The primary ``filter`` (edge
  colour) is kept separately.
- slug = ``paginas.maak_slug`` (``<id>-<slug>``) so links to the pm site are canonical.
- mechanism/role display names = ``paginas.NAAM_WEERGAVE`` / ``weergave_naam``.
"""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import time
import unicodedata
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote as url_quote

from sqlalchemy import delete, func, insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import (
    PmAlias,
    PmArgument,
    PmEntity,
    PmMechanism,
    PmMeta,
    PmRelation,
    PmSource,
)
from backend.app.nlp.entity_keys import slugify

logger = get_logger(__name__).bind(component="PropagandaModelSync")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# --------------------------------------------------------------------------------------
# Exclusions (licence + GDPR art. 9) and approval
# --------------------------------------------------------------------------------------

APPROVED_STATUS = "goedgekeurd"
# Epic 12: elements approved by the automatic news pipeline (pm machine account) are flagged, and
# the not-yet-merged evidence of the pipeline's research agent is exported as unreviewed sources.
AUTO_APPROVER_ACCOUNT = "nieuws-autokeur"
# Since 2026-10-07 the propaganda model's hourly automatic review approves everything (account
# merge-service, after an independent source check); both count as "automatically added".
AUTO_APPROVER_ACCOUNTS: frozenset[str] = frozenset({AUTO_APPROVER_ACCOUNT, "merge-service"})
AUTO_RESEARCH_CONTRIBUTORS: frozenset[str] = frozenset({"nieuws-scout"})
# Argument properties that are never read (political-position layer and machtsvalentie).
EXCLUDED_PROPERTIES: tuple[str, ...] = ("politieke_positie", "machtsvalentie")
# Mechanical check on everything we export (serialised snapshot, demo slice).
EXCLUDED_LAYER_TERMS = re.compile(r"politieke_positie|machtsvalentie", re.IGNORECASE)
# Broader scrub for free text: sentences mentioning the excluded layers are dropped.
EXCLUDED_TEXT_PATTERN = re.compile(
    r"politieke[\s_-]*positie|machtsvalentie|kleurmeter", re.IGNORECASE
)
# Only arguments about the existence of the element count as its sources.
EXISTENCE_PROPERTIES: frozenset[str | None] = frozenset({None, "existence"})
# Person types (legacy role-like types included) - no parenthetical aliases for persons.
PERSON_TYPES: frozenset[str] = frozenset(
    {
        "persoon",
        "politicus",
        "journalist",
        "voorlichter",
        "lobbyist",
        "columnist",
        "academicus",
        "mediaeigenaar",
        "toezichthouder_persoon",
        "advocaat",
        "klokkenluider",
    }
)

# --------------------------------------------------------------------------------------
# Scoring constants (copied from propaganda-model scoring.py)
# --------------------------------------------------------------------------------------

ASPECT_PROPERTIES: frozenset[str] = frozenset(
    {
        "influence",
        "indirecte_invloed_op",
        "compositie",
        "mechanism",
        "filter",
        "politieke_positie",
        "inkomensaandeel",
        "machtsvalentie",
        "doelgroepklasse",
        "bereik",
    }
)
STATUS_FACTOR: dict[str, float] = {
    "geverifieerd": 1.00,
    "ongecontroleerd": 0.50,
    "bronvermelding_nodig": 0.40,
    "verouderd": 0.40,
    "betwist": 0.25,
    "verworpen": 0.00,
    "voorgesteld": 0.00,
}
DEFAULT_STATUS_FACTOR = 0.50
RELIABILITY_WEIGHT: dict[str, float] = {
    "academisch": 1.00,
    "primair": 0.95,
    "institutioneel": 0.85,
    "kwaliteitsjournalistiek": 0.70,
    "regulier": 0.50,
    "opinie": 0.35,
    "grijs": 0.20,
    "eigen_synthese": 0.00,
    "onbeoordeeld": 0.15,
}
RELEVANCE_FACTOR: dict[str, float] = {
    "nl_systeem": 1.15,
    "algemeen": 1.00,
    "buitenlands": 0.85,
    "onbepaald": 1.00,
}
METHOD_FACTOR: dict[str, float] = {
    "verbatim_quote": 1.00,
    "officieel_register_scrape": 0.85,
    "llm_samenvatting_van_pagina": 0.55,
}
NO_CITATION_FACTOR = 0.30
K_INSTANCE = 1.0
K_INFLUENCE = 2.0
CAP_UNOPPOSED = 0.70
NO_SOURCE_CLUSTER = "_zonder_bron"

# --------------------------------------------------------------------------------------
# Certainty label (qualitative only - the numbers are never exported)
# --------------------------------------------------------------------------------------

CERTAINTY_WELL_SUPPORTED = "onderbouwd"
CERTAINTY_PLAUSIBLE = "aannemelijk"
CERTAINTY_UNCERTAIN = "onzeker"
# Derived certainty from evidence (scoring.py layer B, 0..1). Calibration on the live graph:
# one merged ("ongecontroleerd") argument citing one not-yet-classified source scores ~0.17,
# an unsourced one ~0.13, a disputed one ~0.09; two independent classified sources >= 0.30.
#   onderbouwd  >= 0.30 AND >= 2 independent supporting source clusters (no single point of
#               failure), e.g. two merged arguments from independent, reviewer-classified sources
#   aannemelijk >= 0.14: at least one merged, sourced supporting argument that is not outweighed
#               by contradiction
#   onzeker     everything else: unsourced, disputed or outweighed evidence, and relations
#               without evidence in the discussion tree (the stored prior / the 0.05 floor never
#               makes a relation more than "onzeker")
CERTAINTY_WELL_SUPPORTED_MIN = 0.30
CERTAINTY_WELL_SUPPORTED_MIN_CLUSTERS = 2
CERTAINTY_PLAUSIBLE_MIN = 0.14

# --------------------------------------------------------------------------------------
# Presentation constants
# --------------------------------------------------------------------------------------

# Informative relation types first. MUST match the CASE in pm_neighborhood (migration 016) and
# TYPE_PRIORITY in frontend/lib/explore/pm-local.ts; unlisted types rank after the list. The
# decision-making types (Epic 15) come last: offices and hierarchy connect everything.
RELATION_TYPE_PRIORITY: tuple[str, ...] = (
    "eigendom",
    "financiering",
    "adverteerder",
    "flak",
    "bron_van",
    "beinvloeding",
    "draaideur",
    "bestuurder",
    "adviseur",
    "censuur",
    "mediaplatform",
    "personeel",
    "lidmaatschap",
    "ambt",
    "zeggenschap",
    "geschenk",
    "controle",
)
_PRIORITY_INDEX = {name: index for index, name in enumerate(RELATION_TYPE_PRIORITY)}
OWNERSHIP_RELATION_TYPES: frozenset[str] = frozenset({"eigendom", "financiering"})
EXPORTED_FILTERS: frozenset[str] = frozenset(
    {
        "eigendom",
        "advertentie",
        "sourcing",
        "flak",
        "ideologie",
        "tegenmacht",
        "cross_filter",
        "systeemactor",
        # Uitbreiding C (Epic 15): the decision-making categories
        "formele_macht",
        "belangen",
        "kennis_advies",
        "polder",
        "werving",
    }
)
# The categories a relation can belong to (pm_relations.filters), in display order: the five
# filters, tegenmacht, then the five decision-making categories (Epic 15). MUST match the
# ARRAY[...] order in pm_neighborhood (migration 016); relations without any category are
# counted under UNFILTERED ("overig") in its filter_counts.
FILTERS: tuple[str, ...] = (
    "eigendom",
    "advertentie",
    "sourcing",
    "flak",
    "ideologie",
    "tegenmacht",
    "formele_macht",
    "belangen",
    "kennis_advies",
    "polder",
    "werving",
)
UNFILTERED = "overig"
# The six media filters (Herman & Chomsky + tegenmacht), the scope of the app before Epic 15.
MEDIA_FILTERS: frozenset[str] = frozenset(FILTERS[:6])
# Uitbreiding C of the propaganda model (2026-10-07): decision-making categories and relation
# types. Until PROPAGANDA_SYNC_BESTUUR is on, relations that only belong to these (and entities
# that only have such relations) stay out of the pm_* tables, so the live app is unchanged.
BESTUUR_CATEGORIES: frozenset[str] = frozenset(
    {"formele_macht", "belangen", "kennis_advies", "polder", "werving"}
)
BESTUUR_RELATION_TYPES: frozenset[str] = frozenset({"ambt", "zeggenschap", "controle", "geschenk"})
# Version of the pm_* row format (pm_meta.format). A sync is never skipped as "unchanged" while
# the stored format differs, so a new column is filled right after the migration adds it.
# 4: auto_approved + unreviewed sources (Epic 12); 5: arguments + mechanisms; 6: sources an
# independent A1 re-read found to carry the argument ("checked", automatic review 2026-10-06);
# 7: what that re-read found when it did not hold ("check": deels / draagt_niet / citaat_weg);
# 8: decision-making (Epic 15): bestuurslaag + wikidata on entities, functie on relations, the
# five decision-making categories in filters, merge-service approvals flagged as automatic
SNAPSHOT_FORMAT = "8"
MAX_SOURCES_PER_OWNER = 12
MAX_QUOTE_LENGTH = 300
# Arguments shown with a relation (migration 010): whether it exists, how strong, when it held and
# what kind of tie it is - not the classification debates (mechanism, filter, role). The excluded
# layers are never read at all.
ARGUMENT_ASPECTS: frozenset[str | None] = frozenset(
    {
        None,
        "existence",
        "description",
        "certainty",
        "influence",
        "active_from",
        "active_until",
        "relation_type",
    }
)
# Review statuses a reader may see (rejected arguments and unmerged proposals never count)
SHOWN_ARGUMENT_STATUSES: frozenset[str] = frozenset(
    {"geverifieerd", "ongecontroleerd", "bronvermelding_nodig", "betwist", "verouderd"}
)
STANCE_ORDER: dict[str, int] = {"supporting": 0, "contextual": 1, "contradicting": 2}
ARGUMENT_STATUS_ORDER: dict[str, int] = {
    "geverifieerd": 0,
    "ongecontroleerd": 1,
    "bronvermelding_nodig": 2,
    "voorgesteld": 3,
    "betwist": 4,
    "verouderd": 5,
}
MAX_ARGUMENTS_PER_OWNER = 12
MAX_SOURCES_PER_ARGUMENT = 3
MAX_CLAIM_LENGTH = 600
MIN_DERIVED_ALIAS_LENGTH = 3

# Curated aliases for the aggregator's feeds: pm id -> (expected pm name, alias names).
# The expected name guards against id drift (compared with slugify); only exported entities.
CURATED_ALIASES: dict[int, tuple[str, tuple[str, ...]]] = {
    11: ("NOS", ("NOS", "NOS Nieuws", "nos.nl")),
    7: ("NU.nl", ("NU.nl", "NUnl")),
    3: ("AD (Algemeen Dagblad)", ("AD", "Algemeen Dagblad", "AD.nl")),
    88: ("RTL Nieuws", ("RTL Nieuws", "rtlnieuws.nl")),
    9: ("De Telegraaf", ("De Telegraaf", "Telegraaf", "telegraaf.nl")),
    4: ("de Volkskrant", ("de Volkskrant", "Volkskrant", "volkskrant.nl")),
    6: ("Het Parool", ("Het Parool", "Parool", "parool.nl")),
    5: ("Trouw", ("Trouw", "trouw.nl")),
    342: ("GeenStijl", ("GeenStijl", "Geen Stijl", "geenstijl.nl")),
    248: ("De Andere Krant", ("De Andere Krant", "deanderekrant.nl")),
    1215: ("NieuwRechts", ("NieuwRechts", "Nieuw Rechts", "nieuwrechts.nl")),
}

# Demo slice (scripts/export_pm_demo_slice.py): the outlets of the demo event + two owners.
DEMO_SEEDS: dict[int, str] = {
    11: "NOS",
    7: "NU.nl",
    3: "AD (Algemeen Dagblad)",
    9: "De Telegraaf",
    4: "de Volkskrant",
    342: "GeenStijl",
    248: "De Andere Krant",
    1: "DPG Media",
    2: "Mediahuis",
}
DEMO_MAX_ENTITIES = 200
DEMO_MAX_RELATIONS = 480
DEMO_PER_FILTER = 6  # relations per seed and per filter that are selected first
DEMO_MAX_ARGUMENTS = 4  # arguments per relation in the demo slice
# The real institutions of the demo story: only their relations carry arguments in the demo, so
# the slice stays small and bundles little of the model's reasoning (data licence).
DEMO_ARGUMENT_FOCUS: dict[int, str] = {
    82: "RIVM",
    865: "Planbureau voor de Leefomgeving (PBL)",
    12: "ANP",
    870: "Ipsos I&O",
}

# Display names (copied from propaganda-model paginas.NAAM_WEERGAVE; roles + mechanisms).
DISPLAY_NAMES: dict[str, str] = {
    "mediaeigenaar": "Media-eigenaar",
    # Uitbreiding C (Epic 15)
    "eu_instelling": "EU-instelling",
    "ministeriele_verantwoordelijkheid": "Ministeriële verantwoordelijkheid",
    "hierarchische_aansturing": "Hiërarchische aansturing",
    "akkoord_preemptie": "Akkoord-preëmptie",
    "raad_van_commissarissen": "Raad van commissarissen (RvC)",
    "columnist_opiniemaker": "Columnist / opiniemaker",
    "elite_forum": "Elite-forum",
    "vakbond_media": "Vakbond (media)",
    "commerciele_afhankelijkheid": "Commerciële afhankelijkheid",
    "continuiteitsborging": "Continuïteitsborging",
    "gecoordineerde_voorlichting": "Gecoördineerde voorlichting",
    "inlichtingen_cooptatie": "Inlichtingen-coöptatie",
    "pr_inhuur": "PR-inhuur",
    "pr_subsidie": "PR-subsidie",
    "woo_obstructie": "Woo-obstructie",
    "stak_stemzeggenschap": "STAK-stemzeggenschap",
    "cross_media_eigendom": "Cross-media-eigendom",
    "media_agendering": "Media-agendering",
    "intermedia_agendering": "Intermedia-agendering",
    "journalist_bronrelatie": "Journalist-bronrelatie",
    "belang_elite_netwerk": "Belanghebbende in elite-netwerk",
    "mediaeigenaar_elite_netwerk": "Media-eigenaar in elite-netwerk",
    "politicus_elite_netwerk": "Politicus in elite-netwerk",
    "elite_media_netwerk": "Elite-medianetwerk",
    "elite_kennisnetwerk": "Elite-kennisnetwerk",
    "draaideur_journalistiek_politiek": "Draaideur journalistiek ↔ politiek",
    "draaideur_journalistiek_voorlichting": "Draaideur journalistiek ↔ voorlichting",
    "draaideur_politiek_bedrijfsleven": "Draaideur politiek ↔ bedrijfsleven",
    "draaideur_politiek_institutie": "Draaideur politiek ↔ institutie",
    "draaideur_politiek_lobby": "Draaideur politiek ↔ lobby",
    "draaideur_politiek_media": "Draaideur politiek ↔ media",
    "denktank_naar_persbureau": "Denktank → persbureau",
    "denktank_naar_politiek": "Denktank → politiek",
    "lobbyist_naar_journalist": "Lobbyist → journalist",
    "lobbyist_naar_politicus": "Lobbyist → politicus",
    "academische_socialisatie_hoofdredacteur": "Academische socialisatie (hoofdredacteur)",
    "academische_socialisatie_politiek": "Academische socialisatie (politiek)",
    "academische_orthodoxie_denktank": "Academische orthodoxie (denktank)",
    "academische_orthodoxie_instituut": "Academische orthodoxie (instituut)",
}

# URL-like source locations, in order of preference (local 'file' paths are never exported).
_LOCATION_PREFERENCE: tuple[str, ...] = ("url", "doi", "handle", "arxiv", "archive_url")
_LOCATION_PREFIX: dict[str, str] = {
    "doi": "https://doi.org/",
    "handle": "https://hdl.handle.net/",
    "arxiv": "https://arxiv.org/abs/",
}
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_PARENTHETICAL = re.compile(r"^(?P<outer>[^()]+?)\s*\((?P<inner>[^()]+)\)\s*$")
_ACRONYM = re.compile(r"[A-Z0-9][A-Za-z0-9.&-]{0,11}")

PM_TABLES: tuple[str, ...] = (
    "pm_entities",
    "pm_relations",
    "pm_sources",
    "pm_aliases",
    "pm_meta",
    "pm_arguments",
    "pm_mechanisms",
)


class ExcludedLayerError(RuntimeError):
    """Raised when an excluded layer (political position, machtsvalentie) leaks into output."""


class UnsecuredTargetError(RuntimeError):
    """Raised when the pm_* tables are readable by anon (migration 005 missing)."""


# --------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------


def display_name(name: str | None) -> str | None:
    """Human-readable name of a role/mechanism (port of pm ``weergave_naam``)."""

    if not name:
        return None
    if name in DISPLAY_NAMES:
        return DISPLAY_NAMES[name]
    flat = str(name).replace("_", " ").strip()
    return flat[:1].upper() + flat[1:] if flat else None


def pm_slug(entity_id: int, name: str | None) -> str:
    """Canonical pm site slug ``<id>-<slug>`` (port of pm ``paginas.maak_slug``)."""

    normalised = unicodedata.normalize("NFKD", str(name or ""))
    ascii_text = normalised.encode("ascii", "ignore").decode("ascii").lower()
    text_slug = re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", ascii_text)).strip("-")
    return f"{entity_id}-{text_slug}" if text_slug else str(entity_id)


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def _is_approved(row: Mapping[str, Any]) -> bool:
    return row.get("status") == APPROVED_STATUS and not row.get("vervangen")


def scrub_text(value: str | None) -> str | None:
    """Drop sentences that mention an excluded analysis layer (None when nothing remains)."""

    text_value = _as_text(value)
    if text_value is None:
        return None
    if not EXCLUDED_TEXT_PATTERN.search(text_value):
        return text_value
    kept = [
        sentence
        for sentence in _SENTENCE_SPLIT.split(text_value)
        if not EXCLUDED_TEXT_PATTERN.search(sentence)
    ]
    return " ".join(kept).strip() or None


def truncate_quote(value: str | None, limit: int = MAX_QUOTE_LENGTH) -> str | None:
    """Collapse whitespace and cut a quote to ``limit`` characters (with an ellipsis)."""

    text_value = _as_text(value)
    if text_value is None:
        return None
    collapsed = " ".join(text_value.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip() + "…"


def relation_filters(mechanism: Mapping[str, Any] | None, tags: Iterable[str] | None) -> list[str]:
    """All filters of a relation: its primary mechanism filter UNION the mechanism's filter tags.

    ``tags`` are the ``mechanism_filters`` rows of the mechanism (None or [] = no rows). The
    primary filter counts when it is one of :data:`FILTERS` (not ``cross_filter``/``overig``/
    NULL), so an edge coloured by its primary filter is always found via that filter; ``overig``
    and unknown tags are dropped. Order: the primary filter first, then :data:`FILTERS` order.
    No mechanism (or a replaced one) -> [].
    """

    if mechanism is None:
        return []
    primary = mechanism.get("filter")
    wanted = {tag for tag in tags or () if tag in FILTERS}
    if primary in FILTERS:
        wanted.add(primary)
    return sorted(wanted, key=lambda flt: (flt != primary, FILTERS.index(flt)))


def relation_matches(filters: Iterable[str] | None, wanted: Iterable[str] | None) -> bool:
    """Python mirror of the p_filters predicate of pm_neighborhood (migration 005).

    ``wanted`` None/empty = every relation matches. Otherwise the relation matches when it shares
    a filter with ``wanted`` (``r.filters && p_filters``) or, when ``wanted`` contains
    :data:`UNFILTERED` ("overig"), when it has no filters at all.
    """

    wanted_set = set(wanted or ())
    if not wanted_set:
        return True
    own = set(filters or ())
    return bool(own & wanted_set) or (UNFILTERED in wanted_set and not own)


def relation_priority(relation_type: str | None) -> int:
    """Rank of a relation type (lower = more informative)."""

    return _PRIORITY_INDEX.get(relation_type or "", len(RELATION_TYPE_PRIORITY))


def _desc_text_key(value: str | None) -> tuple[int, tuple[int, ...]]:
    """Sort key for ``value DESC NULLS LAST`` on text (as in the SQL function)."""

    if value is None:
        return (1, ())
    return (0, tuple(-ord(char) for char in value) + (1,))


def relation_sort_key(relation: Mapping[str, Any]) -> tuple[Any, ...]:
    """Order of pm_neighborhood: priority, source_count desc, active_from desc, id."""

    return (
        relation_priority(relation.get("relation_type")),
        -int(relation.get("source_count") or 0),
        _desc_text_key(relation.get("active_from")),
        int(relation["id"]),
    )


# --------------------------------------------------------------------------------------
# Reader (strictly read-only)
# --------------------------------------------------------------------------------------


@dataclass(slots=True)
class PmRawData:
    """Raw rows read from the propaganda-model database (only what the transformer needs)."""

    entities: list[dict[str, Any]] = field(default_factory=list)
    relations: list[dict[str, Any]] = field(default_factory=list)
    roles: list[dict[str, Any]] = field(default_factory=list)
    mechanisms: list[dict[str, Any]] = field(default_factory=list)
    mechanism_filters: list[dict[str, Any]] = field(default_factory=list)
    arguments: list[dict[str, Any]] = field(default_factory=list)
    citations: list[dict[str, Any]] = field(default_factory=list)
    sources: list[dict[str, Any]] = field(default_factory=list)
    source_locations: list[dict[str, Any]] = field(default_factory=list)
    # A1 re-verifications (immuun_oordelen, fase 'herverificatie'), oldest first
    checks: list[dict[str, Any]] = field(default_factory=list)
    maintainers: set[str] = field(default_factory=set)
    # {"entities": {ids}, "relations": {ids}} whose latest status change is an automatic approval
    auto_approved: dict[str, set[int]] = field(default_factory=dict)
    release_version: str | None = None
    db_mtime: str | None = None


def db_fingerprint(path: Path) -> str:
    """Latest modification time of the database and its WAL file (ISO 8601, UTC).

    The WAL file matters: in WAL mode committed writes may live in ``-wal`` for a long time
    before a checkpoint touches the main file.
    """

    mtimes = [path.stat().st_mtime]
    wal = path.with_name(path.name + "-wal")
    if wal.exists():
        mtimes.append(wal.stat().st_mtime)
    return datetime.fromtimestamp(max(mtimes), tz=timezone.utc).isoformat()


def latest_release_version(releases_dir: Path) -> str | None:
    """Semver of the newest ``releases/model-v<X.Y.Z>.json`` (None when there is none)."""

    best: tuple[int, int, int] | None = None
    if releases_dir.is_dir():
        for candidate in releases_dir.glob("model-v*.json"):
            match = re.fullmatch(r"model-v(\d+)\.(\d+)\.(\d+)\.json", candidate.name)
            if match:
                version = (int(match[1]), int(match[2]), int(match[3]))
                if best is None or version > best:
                    best = version
    return ".".join(map(str, best)) if best else None


def version_string(release: str | None, db_mtime: str | None) -> str:
    """``<release>+live.<YYYYMMDD>``: the live graph after the newest release (or ``live``)."""

    stamp = (db_mtime or "")[:10].replace("-", "")
    if release:
        return f"{release}+live.{stamp}" if stamp else f"{release}+live"
    return f"live.{stamp}" if stamp else "live"


def connect_read_only(path: Path) -> sqlite3.Connection:
    """Open the propaganda-model database strictly read-only (``mode=ro``)."""

    uri = f"file:{url_quote(str(path.resolve()))}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


_EXCLUDED_SQL_LIST = ", ".join(f"'{name}'" for name in EXCLUDED_PROPERTIES)

_READ_QUERIES: dict[str, str] = {
    "entities": """
        SELECT id, name, type, primary_role_id, description, active_from, active_until,
               status, vervangen
        FROM entities
        WHERE status = 'goedgekeurd' AND NOT vervangen
        ORDER BY id""",
    "relations": """
        SELECT id, source_id, target_id, relation_type, mechanism_id, description, certainty,
               influence, bidirectional, active_from, active_until, status, vervangen
        FROM relations
        WHERE status = 'goedgekeurd' AND NOT vervangen
        ORDER BY id""",
    "roles": "SELECT id, name, category, vervangen FROM roles ORDER BY id",
    "mechanisms": """
        SELECT id, name, filter, aard, description, effect, vervangen
        FROM mechanisms ORDER BY id""",
    # Never read the excluded layers (incl. every reply below such an argument). The claim is
    # shown with its relation (format 5); the longer reasoning is not needed.
    "arguments": f"""
        WITH RECURSIVE excluded(id) AS (
            SELECT id FROM arguments WHERE property IN ({_EXCLUDED_SQL_LIST})
            UNION
            SELECT a.id FROM arguments a JOIN excluded e ON a.parent_argument_id = e.id
        )
        SELECT id, relation_id, entity_id, parent_argument_id, property, stance, status,
               claim, bezwaar_resolutie, contributed_by, smaad_hold
        FROM arguments
        WHERE NOT vervangen AND id NOT IN (SELECT id FROM excluded)
        ORDER BY id""",  # noqa: S608 - constant list, no user input
    "citations": f"""
        WITH RECURSIVE excluded(id) AS (
            SELECT id FROM arguments WHERE property IN ({_EXCLUDED_SQL_LIST})
            UNION
            SELECT a.id FROM arguments a JOIN excluded e ON a.parent_argument_id = e.id
        )
        SELECT c.id, c.argument_id, c.source_id, c.quote, c.methode
        FROM citations c
        JOIN arguments a ON a.id = c.argument_id
        WHERE NOT a.vervangen AND a.id NOT IN (SELECT id FROM excluded)
        ORDER BY c.id""",  # noqa: S608 - constant list, no user input
    "sources": """
        SELECT id, title, source_type, publisher, date_published, reliability, onderwerp,
               cluster_key
        FROM sources ORDER BY id""",
    "source_locations": """
        SELECT id, source_id, location_type, location
        FROM source_locations ORDER BY id""",
}


def _read_decision_making_fields(connection: sqlite3.Connection, raw: PmRawData) -> None:
    """Uitbreiding C (Epic 15): entities.bestuurslaag, the Wikidata id (externe_ids) and
    relations.functie. Older databases without these columns/table give None."""

    def column(query: str) -> dict[int, Any]:
        try:
            return {row[0]: row[1] for row in connection.execute(query)}
        except sqlite3.OperationalError:
            return {}

    layer = column("SELECT id, bestuurslaag FROM entities WHERE bestuurslaag IS NOT NULL")
    wikidata = column(
        "SELECT entity_id, MIN(waarde) FROM externe_ids WHERE stelsel = 'wikidata' "
        "GROUP BY entity_id"
    )
    office = column("SELECT id, functie FROM relations WHERE functie IS NOT NULL")
    for entity in raw.entities:
        entity["bestuurslaag"] = layer.get(entity["id"])
        entity["wikidata"] = wikidata.get(entity["id"])
    for relation in raw.relations:
        relation["functie"] = office.get(relation["id"])


def read_pm_database(path: Path | str) -> PmRawData:
    """Read the rows needed for the sync (read-only connection, approved rows only)."""

    db_path = Path(path)
    if not db_path.exists():
        raise FileNotFoundError(f"Propaganda-model database not found: {db_path}")
    raw = PmRawData(
        release_version=latest_release_version(db_path.parent.parent / "releases"),
        db_mtime=db_fingerprint(db_path),
    )
    connection = connect_read_only(db_path)
    try:
        for name, query in _READ_QUERIES.items():
            setattr(raw, name, [dict(row) for row in connection.execute(query)])
        _read_decision_making_fields(connection, raw)
        try:
            raw.mechanism_filters = [
                dict(row)
                for row in connection.execute(
                    "SELECT mechanism_id, filter FROM mechanism_filters "
                    "ORDER BY mechanism_id, filter"
                )
            ]
        except sqlite3.OperationalError:  # older database without the link table
            raw.mechanism_filters = []
        try:
            raw.checks = [
                dict(row)
                for row in connection.execute(
                    "SELECT id, argument_id, bron_id, verdict, door, detail, created_at "
                    "FROM immuun_oordelen WHERE fase = 'herverificatie' ORDER BY created_at, id"
                )
            ]
        except sqlite3.OperationalError:  # older database without the immune system
            raw.checks = []
        try:
            raw.maintainers = {
                row[0]
                for row in connection.execute(
                    "SELECT username FROM users WHERE role = 'maintainer'"
                )
            }
        except sqlite3.OperationalError:  # no users table (synthetic database)
            raw.maintainers = set()
        try:
            raw.auto_approved = auto_approved_ids(
                dict(row)
                for row in connection.execute(
                    "SELECT id, table_name, record_id, changed_by, new_value FROM edit_log "
                    "WHERE table_name IN ('entities', 'relations') AND action = 'updated' "
                    "AND new_value LIKE '%status%' ORDER BY id"
                )
            )
        except sqlite3.OperationalError:  # no edit_log (synthetic database)
            raw.auto_approved = {}
    finally:
        connection.close()
    return raw


def auto_approved_ids(rows: Iterable[Mapping[str, Any]]) -> dict[str, set[int]]:
    """Entities/relations whose LATEST status change is an automatic approval.

    ``rows`` are edit_log rows (id, table_name, record_id, changed_by, new_value) in id order. A
    later human status change (e.g. withdrawing the approval) wins, so the flag disappears.
    """

    latest: dict[tuple[str, int], tuple[str | None, str | None]] = {}
    for row in rows:
        try:
            value = json.loads(row.get("new_value") or "{}")
        except (TypeError, ValueError):
            continue
        if not isinstance(value, dict) or "status" not in value:
            continue
        latest[(row["table_name"], int(row["record_id"]))] = (
            row.get("changed_by"),
            value.get("status"),
        )
    result: dict[str, set[int]] = {"entities": set(), "relations": set()}
    for (table, record_id), (changed_by, status) in latest.items():
        if changed_by in AUTO_APPROVER_ACCOUNTS and status == APPROVED_STATUS and table in result:
            result[table].add(record_id)
    return result


# --------------------------------------------------------------------------------------
# Scoring replication (scoring.py layer B)
# --------------------------------------------------------------------------------------


def _reliability_weight(reliability: str | None) -> float:
    return RELIABILITY_WEIGHT.get(reliability or "onbeoordeeld", RELIABILITY_WEIGHT["onbeoordeeld"])


def _source_factor(citations: Sequence[tuple[str | None, str, str | None, str | None]]) -> float:
    weights = [
        min(
            1.0,
            _reliability_weight(reliability)
            * RELEVANCE_FACTOR.get(topic or "onbepaald", 1.0)
            * (METHOD_FACTOR.get(method, 1.0) if method else 1.0),
        )
        for reliability, _cluster, topic, method in citations
    ]
    if not weights:
        return NO_CITATION_FACTOR
    return NO_CITATION_FACTOR + (1.0 - NO_CITATION_FACTOR) * max(weights)


def _dfquad(tau: float, supports: Iterable[float], attacks: Iterable[float]) -> float:
    support = attack = 1.0
    for value in supports:
        support *= 1.0 - value
    for value in attacks:
        attack *= 1.0 - value
    support, attack = 1.0 - support, 1.0 - attack
    if attack > support:
        return tau * (1.0 - (attack - support))
    if support > attack:
        return tau + (1.0 - tau) * (support - attack)
    return tau


@dataclass(slots=True)
class ArgumentScores:
    """Final strength sigma per argument plus the metadata the balance needs."""

    sigma: dict[int, float]
    meta: dict[int, dict[str, Any]]
    children: dict[int, list[int]]


def score_arguments(
    arguments: Sequence[Mapping[str, Any]],
    citations: Sequence[Mapping[str, Any]],
    sources: Mapping[int, Mapping[str, Any]],
    maintainers: set[str] | frozenset[str] = frozenset(),
) -> ArgumentScores:
    """tau per argument, DF-QuAD propagation (incl. admin veto) -> sigma per argument."""

    cites_by_arg: dict[int, list[tuple[str | None, str, str | None, str | None]]] = defaultdict(
        list
    )
    for citation in citations:
        source = sources.get(citation["source_id"])
        if source is None:
            continue
        cluster = source.get("cluster_key") or f"bron{source['id']}"
        cites_by_arg[citation["argument_id"]].append(
            (source.get("reliability"), cluster, source.get("onderwerp"), citation.get("methode"))
        )

    taus: dict[int, float] = {}
    parents: dict[int, int | None] = {}
    stances: dict[int, str] = {}
    meta: dict[int, dict[str, Any]] = {}
    neutralised: set[int] = set()
    active_objections: set[int] = set()
    authors: dict[int, str | None] = {}
    for argument in arguments:
        arg_id = argument["id"]
        status = argument.get("status")
        resolution = argument.get("bezwaar_resolutie")
        if resolution == "opgelost":
            neutralised.add(arg_id)
        authors[arg_id] = argument.get("contributed_by")
        parent = argument.get("parent_argument_id")
        if (
            parent is not None
            and argument.get("stance") == "contradicting"
            and status not in ("voorgesteld", "verworpen")
            and resolution != "opgelost"
        ):
            active_objections.add(arg_id)
        cites = cites_by_arg.get(arg_id, [])
        taus[arg_id] = STATUS_FACTOR.get(status, DEFAULT_STATUS_FACTOR) * _source_factor(cites)
        parents[arg_id] = parent
        stances[arg_id] = argument.get("stance") or ""
        real = [
            (_reliability_weight(reliability), cluster)
            for reliability, cluster, _topic, _method in cites
            if _reliability_weight(reliability) > 0
        ]
        meta[arg_id] = {
            "parent": parent,
            "relation_id": argument.get("relation_id"),
            "entity_id": argument.get("entity_id"),
            "property": argument.get("property"),
            "stance": argument.get("stance"),
            "status": status,
            "cluster": max(real)[1] if real else NO_SOURCE_CLUSTER,
            "n_citations": len(real),
            "smaad_hold": bool(argument.get("smaad_hold")),
            "contributed_by": argument.get("contributed_by"),
        }

    children: dict[int, list[int]] = defaultdict(list)
    for arg_id, parent in parents.items():
        if parent is not None:
            children[parent].append(arg_id)
    vetos = {
        arg_id
        for arg_id in active_objections
        if authors.get(arg_id) in maintainers
        and not any(child in active_objections for child in children.get(arg_id, ()))
    }

    sigma: dict[int, float] = {}

    def compute(arg_id: int, seen: set[int]) -> float:
        if arg_id in sigma:
            return sigma[arg_id]
        if arg_id in seen:  # cycle (should not exist): fall back to tau
            return taus[arg_id]
        seen.add(arg_id)
        supports: list[float] = []
        attacks: list[float] = []
        vetoed = False
        for child in children.get(arg_id, ()):
            child_sigma = compute(child, seen)
            if stances.get(child) == "supporting":
                supports.append(child_sigma)
            elif stances.get(child) == "contradicting" and child not in neutralised:
                attacks.append(child_sigma)
                vetoed = vetoed or child in vetos
        sigma[arg_id] = 0.0 if vetoed else _dfquad(taus[arg_id], supports, attacks)
        return sigma[arg_id]

    for arg_id in taus:
        compute(arg_id, set())
    return ArgumentScores(sigma=sigma, meta=meta, children=dict(children))


def _balance(roots: Sequence[Mapping[str, Any]], k: float) -> dict[str, Any]:
    per_cluster: dict[tuple[str, str], float] = {}
    n_for = n_against = 0
    opposed = False
    for root in roots:
        stance = root.get("stance")
        if stance not in ("supporting", "contradicting"):
            continue
        if stance == "supporting":
            n_for += 1
        else:
            n_against += 1
            if root.get("status") not in ("verworpen", "voorgesteld") and root.get("n_citations"):
                opposed = True
        key = (stance, root.get("cluster") or NO_SOURCE_CLUSTER)
        per_cluster[key] = max(per_cluster.get(key, 0.0), float(root.get("sigma") or 0.0))
    support = sum(value for (stance, _), value in per_cluster.items() if stance == "supporting")
    attack = sum(value for (stance, _), value in per_cluster.items() if stance == "contradicting")
    return {
        "score": None if not (n_for or n_against) else support / (support + attack + k),
        "support": support,
        "attack": attack,
        "n_support_clusters": sum(1 for (stance, _) in per_cluster if stance == "supporting"),
        "n_for": n_for,
        "n_against": n_against,
        "opposed": opposed,
    }


def instance_certainty(
    roots: Sequence[Mapping[str, Any]], prior: float | None = None
) -> dict[str, Any]:
    """Derived certainty of one relation (scoring.instance_detail without the interval)."""

    balance = _balance(roots, K_INSTANCE)
    if balance["score"] is None:
        score = float(prior) if prior is not None else 0.0
        basis = "prior" if prior is not None else "none"
    else:
        score = balance["score"]
        basis = "evidence"
    if not balance["opposed"] and score > CAP_UNOPPOSED:
        score = CAP_UNOPPOSED
    return {
        "score": round(score, 4),
        "basis": basis,
        "n_support_clusters": balance["n_support_clusters"],
        "opposed": balance["opposed"],
    }


def derived_influence(prior: float | None, roots: Sequence[Mapping[str, Any]]) -> float:
    """Derived influence (scoring.derived_influence): prior shifted by influence arguments."""

    balance = _balance(roots, K_INSTANCE)
    if balance["score"] is None:
        return round(float(prior or 0.0), 4)
    mass = balance["support"] + balance["attack"]
    weight = mass / (mass + K_INFLUENCE)
    basis = float(prior) if prior is not None else balance["score"]
    return round(basis * (1.0 - weight) + balance["score"] * weight, 4)


def certainty_label(detail: Mapping[str, Any]) -> str:
    """Qualitative label for a derived certainty (see the CERTAINTY_* thresholds)."""

    if detail.get("basis") != "evidence":
        return CERTAINTY_UNCERTAIN
    score = float(detail.get("score") or 0.0)
    if (
        score >= CERTAINTY_WELL_SUPPORTED_MIN
        and int(detail.get("n_support_clusters") or 0) >= CERTAINTY_WELL_SUPPORTED_MIN_CLUSTERS
    ):
        return CERTAINTY_WELL_SUPPORTED
    if score >= CERTAINTY_PLAUSIBLE_MIN:
        return CERTAINTY_PLAUSIBLE
    return CERTAINTY_UNCERTAIN


def _root_payloads(
    scores: ArgumentScores,
) -> tuple[dict[int, list[dict[str, Any]]], dict[int, list[dict[str, Any]]]]:
    """Root arguments per relation: certainty line and influence line."""

    certainty_roots: dict[int, list[dict[str, Any]]] = defaultdict(list)
    influence_roots: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for arg_id, meta in scores.meta.items():
        if meta["parent"] is not None or meta["status"] == "voorgesteld":
            continue
        relation_id = meta["relation_id"]
        if not relation_id:
            continue
        payload = {
            "stance": meta["stance"],
            "sigma": scores.sigma.get(arg_id, 0.0),
            "cluster": meta["cluster"],
            "n_citations": meta["n_citations"],
            "status": meta["status"],
        }
        if meta["property"] == "influence":
            influence_roots[relation_id].append(payload)
        elif meta["property"] not in ASPECT_PROPERTIES:
            certainty_roots[relation_id].append(payload)
    return certainty_roots, influence_roots


def compute_primary_filters(
    relations: Sequence[Mapping[str, Any]],
    mechanisms: Mapping[int, Mapping[str, Any]],
    certainty: Mapping[int, float],
    influence: Mapping[int, float],
) -> dict[int, str]:
    """scoring.entity_primary_filter: argmax Σ(certainty × influence), tegenmacht excluded."""

    accumulated: dict[int, dict[str, float]] = defaultdict(dict)
    for relation in relations:
        mechanism = mechanisms.get(relation.get("mechanism_id"))
        if mechanism is None or mechanism.get("vervangen") or not mechanism.get("filter"):
            continue
        flt = mechanism["filter"]
        contribution = certainty.get(relation["id"], 0.0) * influence.get(relation["id"], 0.0)
        ends = (
            (relation["source_id"], relation["target_id"])
            if relation.get("bidirectional")
            else (relation["source_id"],)
        )
        for entity_id in ends:
            accumulated[entity_id][flt] = accumulated[entity_id].get(flt, 0.0) + contribution
    result: dict[int, str] = {}
    for entity_id, scores in accumulated.items():
        colourable = [(flt, score) for flt, score in scores.items() if flt != "tegenmacht"]
        if colourable:
            result[entity_id] = max(colourable, key=lambda item: (item[1], item[0]))[0]
    return result


# --------------------------------------------------------------------------------------
# Sources and aliases
# --------------------------------------------------------------------------------------


def _source_url(locations: Sequence[Mapping[str, Any]]) -> str | None:
    by_type: dict[str, str] = {}
    for location in locations:
        kind = location.get("location_type")
        value = _as_text(location.get("location"))
        if not kind or not value or kind in by_type:
            continue
        by_type[kind] = value
    for kind in _LOCATION_PREFERENCE:
        value = by_type.get(kind)
        if not value:
            continue
        if kind in ("url", "archive_url"):
            if value.lower().startswith(("http://", "https://")):
                return value
            continue
        if value.lower().startswith(("http://", "https://")):
            return value
        return _LOCATION_PREFIX[kind] + value
    return None


def _supporting_existence_arguments(scores: ArgumentScores, owner_key: str) -> dict[int, list[int]]:
    """Per owner id: merged, supporting existence roots plus their supporting reply chains."""

    def usable(arg_id: int) -> bool:
        meta = scores.meta[arg_id]
        return (
            meta["stance"] == "supporting"
            and meta["status"] not in ("voorgesteld", "verworpen")
            and not meta["smaad_hold"]
            and scores.sigma.get(arg_id, 0.0) > 0.0
        )

    result: dict[int, list[int]] = defaultdict(list)
    for arg_id, meta in scores.meta.items():
        owner_id = meta.get(owner_key)
        if (
            not owner_id
            or meta["parent"] is not None
            or meta["property"] not in EXISTENCE_PROPERTIES
            or not usable(arg_id)
        ):
            continue
        stack = [arg_id]
        while stack:
            current = stack.pop()
            result[owner_id].append(current)
            stack.extend(child for child in scores.children.get(current, ()) if usable(child))
    return result


def _unreviewed_existence_arguments(
    scores: ArgumentScores,
    owner_key: str,
    owner_ids: set[int],
    contributors: frozenset[str],
) -> dict[int, list[int]]:
    """Per owner id: not-yet-merged supporting existence roots by the news research agent.

    Only for automatically approved owners: their evidence is shown as "nog niet gecontroleerd"
    until a human merges it. Arguments under the smaad hold never count.
    """

    result: dict[int, list[int]] = defaultdict(list)
    if not owner_ids or not contributors:
        return result
    for arg_id, meta in scores.meta.items():
        owner_id = meta.get(owner_key)
        if (
            owner_id in owner_ids
            and meta["parent"] is None
            and meta["property"] in EXISTENCE_PROPERTIES
            and meta["stance"] == "supporting"
            and meta["status"] == "voorgesteld"
            and not meta["smaad_hold"]
            and meta.get("contributed_by") in contributors
        ):
            result[owner_id].append(arg_id)
    return result


def collect_sources(
    owner_kind: str,
    owner_ids: Iterable[int],
    scores: ArgumentScores,
    citations: Sequence[Mapping[str, Any]],
    sources: Mapping[int, Mapping[str, Any]],
    locations: Mapping[int, Sequence[Mapping[str, Any]]],
    *,
    max_per_owner: int = MAX_SOURCES_PER_OWNER,
    unreviewed_owner_ids: Iterable[int] = (),
    unreviewed_contributors: frozenset[str] = AUTO_RESEARCH_CONTRIBUTORS,
) -> tuple[list[dict[str, Any]], dict[int, int]]:
    """Source rows supporting the existence of entities/relations (+ distinct count per owner).

    For ``unreviewed_owner_ids`` (automatically approved elements) the not-yet-merged evidence of
    the news research agent is added after the merged evidence, flagged ``unreviewed``.
    """

    owner_key = "relation_id" if owner_kind == "relation" else "entity_id"
    wanted = set(owner_ids)
    arguments_by_owner = _supporting_existence_arguments(scores, owner_key)
    unreviewed_by_owner = _unreviewed_existence_arguments(
        scores, owner_key, wanted & set(unreviewed_owner_ids), unreviewed_contributors
    )
    citations_by_arg: dict[int, list[Mapping[str, Any]]] = defaultdict(list)
    for citation in citations:
        citations_by_arg[citation["argument_id"]].append(citation)

    rows: list[dict[str, Any]] = []
    counts: dict[int, int] = {}
    for owner_id in sorted(wanted & (set(arguments_by_owner) | set(unreviewed_by_owner))):
        best: dict[int, dict[str, Any]] = {}
        candidates = [(arg_id, False) for arg_id in arguments_by_owner.get(owner_id, ())]
        candidates += [(arg_id, True) for arg_id in unreviewed_by_owner.get(owner_id, ())]
        for arg_id, unreviewed in candidates:
            verified = scores.meta[arg_id]["status"] == "geverifieerd"
            disputed = scores.meta[arg_id]["status"] == "betwist"
            for citation in citations_by_arg.get(arg_id, ()):
                source = sources.get(citation["source_id"])
                if source is None or _reliability_weight(source.get("reliability")) <= 0:
                    continue  # eigen_synthese: project material, never evidence
                title = _as_text(source.get("title"))
                quote = truncate_quote(citation.get("quote"))
                if EXCLUDED_TEXT_PATTERN.search(title or "") or EXCLUDED_TEXT_PATTERN.search(
                    quote or ""
                ):
                    continue
                candidate = {
                    "source_id": source["id"],
                    "status_rank": 3 if unreviewed else (0 if verified else (2 if disputed else 1)),
                    "unreviewed": unreviewed,
                    "weight": _reliability_weight(source.get("reliability")),
                    "title": title,
                    "url": _source_url(locations.get(source["id"], ())),
                    "publisher": _as_text(source.get("publisher")),
                    "published_at": _as_text(source.get("date_published")),
                    "quote": quote,
                }
                current = best.get(source["id"])
                if (
                    current is None
                    or candidate["status_rank"] < current["status_rank"]
                    or (not current["quote"] and candidate["quote"])
                ):
                    best[source["id"]] = candidate
        if not best:
            continue
        ordered = sorted(best.values(), key=lambda item: item["source_id"])
        ordered.sort(key=lambda item: _desc_text_key(item["published_at"]))
        ordered.sort(key=lambda item: -item["weight"])
        ordered.sort(key=lambda item: item["status_rank"])
        counts[owner_id] = len(ordered)
        for position, item in enumerate(ordered[:max_per_owner]):
            rows.append(
                {
                    "owner_kind": owner_kind,
                    "owner_id": owner_id,
                    "title": item["title"],
                    "url": item["url"],
                    "publisher": item["publisher"],
                    "published_at": item["published_at"],
                    "quote": item["quote"],
                    "position": position,
                    "unreviewed": item["unreviewed"],
                }
            )
    return rows, counts


def checked_sources(
    checks: Sequence[Mapping[str, Any]], arguments: Sequence[Mapping[str, Any]]
) -> dict[int, set[int | None]]:
    """Per argument the sources an independent re-read found to carry it: the newest A1 verdict
    is 'klopt' and came from another account than the author (the bronchecker of the automatic
    review, 2026-10-06, or the verification agent). ``None`` = the verdict named no source."""

    authors = {row["id"]: row.get("contributed_by") for row in arguments}
    newest: dict[int, Mapping[str, Any]] = {}
    for check in checks:  # oldest first: the last one wins
        newest[check["argument_id"]] = check
    return {
        arg_id: {check.get("bron_id")}
        for arg_id, check in newest.items()
        if check.get("verdict") == "klopt"
        and check.get("door")
        and check.get("door") != authors.get(arg_id)
    }


# What the bronchecker wrote when it read the source (its verdict detail): then 'twijfel' means
# the source carries the claim only in part; else the quote was not found or the check failed
SOURCE_READ_PATTERN = re.compile(r"(citaat (letterlijk|bijna letterlijk)|zonder citaat) gevonden")
QUOTE_MISSING_PATTERN = re.compile(r"citaat niet teruggevonden")


def source_doubts(
    checks: Sequence[Mapping[str, Any]], arguments: Sequence[Mapping[str, Any]]
) -> dict[int, dict[int | None, str]]:
    """Per argument what an independent re-read found when it did not confirm it: the newest
    A1 verdict (not by the author) is 'klopt-niet' ("draagt_niet"), or 'twijfel' after reading
    the source ("deels") or without finding the quote in it ("citaat_weg"). A technical failure
    says nothing. Keys are source ids (``None`` = the verdict named no source)."""

    authors = {row["id"]: row.get("contributed_by") for row in arguments}
    newest: dict[int, Mapping[str, Any]] = {}
    for check in checks:  # oldest first: the last one wins
        newest[check["argument_id"]] = check
    doubts: dict[int, dict[int | None, str]] = {}
    for arg_id, check in newest.items():
        if not check.get("door") or check.get("door") == authors.get(arg_id):
            continue
        detail = str(check.get("detail") or "")
        if check.get("verdict") == "klopt-niet":
            found = "draagt_niet"
        elif check.get("verdict") != "twijfel":
            continue
        elif SOURCE_READ_PATTERN.search(detail):
            found = "deels"
        elif QUOTE_MISSING_PATTERN.search(detail):
            found = "citaat_weg"
        else:
            continue
        doubts[arg_id] = {check.get("bron_id"): found}
    return doubts


def _argument_sources(
    citations: Sequence[Mapping[str, Any]],
    sources: Mapping[int, Mapping[str, Any]],
    locations: Mapping[int, Sequence[Mapping[str, Any]]],
    limit: int = MAX_SOURCES_PER_ARGUMENT,
    checked: set[int | None] | None = None,
    doubts: Mapping[int | None, str] | None = None,
) -> list[dict[str, Any]]:
    """The sources an argument cites (in citation order, once each, never project material).
    ``checked``: the sources an independent re-read confirmed (``None`` in it = all);
    ``doubts``: what it found for the sources it did not confirm (``None`` key = all)."""

    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    for citation in citations:
        source = sources.get(citation["source_id"])
        if source is None or source["id"] in seen:
            continue
        if _reliability_weight(source.get("reliability")) <= 0:
            continue  # eigen_synthese: project material, never evidence
        title = _as_text(source.get("title"))
        quote = truncate_quote(citation.get("quote"))
        if EXCLUDED_TEXT_PATTERN.search(title or "") or EXCLUDED_TEXT_PATTERN.search(quote or ""):
            continue
        seen.add(source["id"])
        row = {
            "title": title,
            "url": _source_url(locations.get(source["id"], ())),
            "publisher": _as_text(source.get("publisher")),
            "published_at": _as_text(source.get("date_published")),
            "kind": _as_text(source.get("source_type")),
            "quote": quote,
        }
        if checked and (None in checked or source["id"] in checked):
            row["checked"] = True
        elif doubts:
            found = doubts.get(source["id"]) or doubts.get(None)
            if found:
                row["check"] = found
        rows.append(row)
        if len(rows) >= limit:
            break
    return rows


def collect_arguments(
    owner_ids: Iterable[int],
    arguments: Sequence[Mapping[str, Any]],
    scores: ArgumentScores,
    citations: Sequence[Mapping[str, Any]],
    sources: Mapping[int, Mapping[str, Any]],
    locations: Mapping[int, Sequence[Mapping[str, Any]]],
    *,
    max_per_owner: int = MAX_ARGUMENTS_PER_OWNER,
    unreviewed_owner_ids: Iterable[int] = (),
    unreviewed_contributors: frozenset[str] = AUTO_RESEARCH_CONTRIBUTORS,
    checked: Mapping[int, set[int | None]] | None = None,
    doubts: Mapping[int, Mapping[int | None, str]] | None = None,
) -> list[dict[str, Any]]:
    """pm_arguments rows: what a reader may see of the discussion about each exported relation.

    For, against and nuance, each with its review status and cited sources: merged arguments of
    every status except rejected, and for automatically approved relations also the unmerged
    evidence of the news research agent (status ``voorgesteld``). Never arguments under the smaad
    hold, about the excluded layers or about classification (:data:`ARGUMENT_ASPECTS`). Replies
    follow their parent. Per relation: supporting, then nuance, then against; within a stance the
    best reviewed and strongest first.
    """

    wanted = set(owner_ids)
    unreviewed = wanted & set(unreviewed_owner_ids)
    claims = {row["id"]: row.get("claim") for row in arguments}
    citations_by_arg: dict[int, list[Mapping[str, Any]]] = defaultdict(list)
    for citation in citations:
        citations_by_arg[citation["argument_id"]].append(citation)

    def claim_of(arg_id: int) -> str | None:
        return truncate_quote(scrub_text(claims.get(arg_id)), MAX_CLAIM_LENGTH)

    def shown(arg_id: int, owner_id: int, root: bool) -> bool:
        meta = scores.meta[arg_id]
        if meta["smaad_hold"] or not claim_of(arg_id):
            return False
        if root and meta["property"] not in ARGUMENT_ASPECTS:
            return False
        status = meta["status"]
        return status in SHOWN_ARGUMENT_STATUSES or (
            status == "voorgesteld"
            and root
            and owner_id in unreviewed
            and meta.get("contributed_by") in unreviewed_contributors
        )

    roots: dict[int, list[int]] = defaultdict(list)
    for arg_id, meta in scores.meta.items():
        owner_id = meta.get("relation_id")
        if meta["parent"] is None and owner_id in wanted and shown(arg_id, owner_id, True):
            roots[owner_id].append(arg_id)

    rows: list[dict[str, Any]] = []
    for owner_id in sorted(roots):
        ordered = sorted(
            roots[owner_id],
            key=lambda arg_id: (
                STANCE_ORDER.get(scores.meta[arg_id]["stance"], 9),
                ARGUMENT_STATUS_ORDER.get(scores.meta[arg_id]["status"], 9),
                -scores.sigma.get(arg_id, 0.0),
                arg_id,
            ),
        )
        picked: list[tuple[int, int | None]] = []
        for root_id in ordered:
            stack: list[tuple[int, int | None]] = [(root_id, None)]
            while stack and len(picked) < max_per_owner:
                arg_id, parent = stack.pop()
                picked.append((arg_id, parent))
                replies = sorted(
                    (
                        child
                        for child in scores.children.get(arg_id, ())
                        if shown(child, owner_id, False)
                    ),
                    reverse=True,
                )
                stack.extend((child, arg_id) for child in replies)
        for position, (arg_id, parent) in enumerate(picked):
            meta = scores.meta[arg_id]
            rows.append(
                {
                    "id": arg_id,
                    "owner_kind": "relation",
                    "owner_id": owner_id,
                    "parent_id": parent,
                    "aspect": meta["property"] if meta["property"] != "existence" else None,
                    "stance": meta["stance"],
                    "status": meta["status"],
                    "claim": claim_of(arg_id),
                    "sources": _argument_sources(
                        citations_by_arg.get(arg_id, ()),
                        sources,
                        locations,
                        checked=(checked or {}).get(arg_id),
                        doubts=(doubts or {}).get(arg_id),
                    ),
                    "position": position,
                }
            )
    return rows


_IDENTIFIER = re.compile(r"`([a-z][a-z0-9_]*?)(?:_\*)?`")  # also `academische_*` (a family)
# The model's own cross-references: "(De financieringsband zelf is `denktank_financiering_bias`.)"
_CROSS_REFERENCE = re.compile(r"\s*\([^()]*`[a-z][a-z0-9_]*`[^()]*\)")


def _plain_mechanism_text(value: str | None) -> str | None:
    """Mechanism text for readers: no cross-references in brackets, ``expert_framing`` -> "expert
    framing" elsewhere (+ the scrub)."""

    text_value = scrub_text(value)
    if text_value is None:
        return None
    text_value = _CROSS_REFERENCE.sub("", text_value).strip()
    plain = _IDENTIFIER.sub(lambda match: (display_name(match[1]) or match[1]).lower(), text_value)
    return plain or None


def mechanism_rows(
    mechanisms: Mapping[int, Mapping[str, Any]], used_ids: Iterable[int | None]
) -> list[dict[str, Any]]:
    """pm_mechanisms rows: what the mechanisms of the exported relations mean, by display name."""

    rows: dict[str, dict[str, Any]] = {}
    for mechanism_id in sorted({value for value in used_ids if value is not None}):
        mechanism = mechanisms.get(mechanism_id)
        if mechanism is None or mechanism.get("vervangen"):
            continue
        name = display_name(mechanism.get("name"))
        if not name or name in rows:
            continue
        rows[name] = {
            "name": name,
            "filter": _as_text(mechanism.get("filter")),
            "description": _plain_mechanism_text(mechanism.get("description")),
            "effect": _plain_mechanism_text(mechanism.get("effect")),
        }
    return list(rows.values())


def _alias_parts(name: str) -> tuple[str, list[str]]:
    """Split ``"AIVD (Algemene ...)"`` into the outer name and the parenthetical parts."""

    match = _PARENTHETICAL.match(name)
    if not match:
        return name, []
    inner = [part.strip() for part in match["inner"].split("/") if part.strip()]
    return match["outer"].strip(), inner


def _is_acronym(value: str) -> bool:
    """``AIVD``, ``CvdM``, ``EDRi``, ``SBS6``: one token with >= 2 capitals/digits."""

    return bool(_ACRONYM.fullmatch(value)) and (
        sum(char.isupper() or char.isdigit() for char in value) >= 2
    )


def _derived_aliases(name: str, entity_type: str | None) -> list[str]:
    """Alias names derived from a parenthetical (see :func:`generate_aliases`)."""

    outer, inner_parts = _alias_parts(name)
    if not inner_parts:
        return []
    if entity_type in PERSON_TYPES:
        # "Attje Kuiken (PvdA)" -> "Attje Kuiken"; never the party, never a single token
        return [outer] if len(slugify(outer).split("-")) >= 2 else []
    derived = [outer]
    outer_is_acronym = _is_acronym(outer)
    for part in inner_parts:
        if _is_acronym(part) or (outer_is_acronym and part[:1].isupper()):
            derived.append(part)
    return derived


def generate_aliases(entities: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Alias rows (shared ``slugify``) for the exported entities.

    - every entity: slug(name)
    - a name with a parenthetical, ``"Outer (Inner)"``:
      - organisations: slug(Outer); slug(Inner) only when Inner is an acronym
        (``Center for ... (CFGSEC)``) or Outer is an acronym and Inner its expansion
        (``AIVD (Algemene Inlichtingen- en Veiligheidsdienst)`` -> ``aivd`` + the long form);
        qualifiers such as ``(Castricum)`` or ``(podcast)`` never become aliases
      - persons: slug(Outer) only when it is a full name (>= 2 tokens); never the parenthetical
        (``Attje Kuiken (PvdA)`` must not match the party)
      - derived aliases shorter than 3 characters, or equal to the full-name slug of another
        entity, are dropped
    - the curated feed aliases (:data:`CURATED_ALIASES`), guarded by the expected name
    - never surname-only aliases for persons (misattribution risk)
    """

    name_slugs: dict[str, set[int]] = defaultdict(set)
    for entity in entities:
        name_slugs[slugify(entity["name"])].add(entity["id"])

    pairs: set[tuple[str, int]] = set()
    for entity in entities:
        entity_id = entity["id"]
        full = slugify(entity["name"])
        if full:
            pairs.add((full, entity_id))
        for candidate in _derived_aliases(str(entity["name"]), entity.get("type")):
            alias = slugify(candidate)
            if not alias or len(alias) < MIN_DERIVED_ALIAS_LENGTH:
                continue
            if name_slugs.get(alias, {entity_id}) - {entity_id}:
                continue  # another entity is literally called that
            pairs.add((alias, entity_id))

    exported = {entity["id"]: entity for entity in entities}
    for entity_id, (expected, names) in CURATED_ALIASES.items():
        entity = exported.get(entity_id)
        if entity is None:
            continue
        if slugify(entity["name"]) != slugify(expected):
            logger.warning(
                "pm_curated_alias_name_mismatch",
                entity_id=entity_id,
                expected=expected,
                actual=entity["name"],
            )
            continue
        for alias_name in names:
            alias = slugify(alias_name)
            if alias:
                pairs.add((alias, entity_id))
    return [{"alias": alias, "entity_id": entity_id} for alias, entity_id in sorted(pairs)]


# --------------------------------------------------------------------------------------
# Transformer
# --------------------------------------------------------------------------------------


@dataclass(slots=True)
class PmSnapshot:
    """Rows for the pm_* tables (plus metadata), produced by :func:`transform`."""

    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    sources: list[dict[str, Any]]
    aliases: list[dict[str, Any]]
    meta: dict[str, str]
    synced_at: datetime
    arguments: list[dict[str, Any]] = field(default_factory=list)
    mechanisms: list[dict[str, Any]] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "entities": len(self.entities),
            "relations": len(self.relations),
            "sources": len(self.sources),
            "aliases": len(self.aliases),
            "arguments": len(self.arguments),
            "mechanisms": len(self.mechanisms),
        }

    def to_json(self) -> str:
        return json.dumps(
            {
                "entities": self.entities,
                "relations": self.relations,
                "sources": self.sources,
                "aliases": self.aliases,
                "arguments": self.arguments,
                "mechanisms": self.mechanisms,
                "meta": self.meta,
            },
            ensure_ascii=False,
            default=str,
        )


def register_only_relations(
    arguments: Iterable[Mapping[str, Any]],
    citations: Iterable[Mapping[str, Any]],
    sources: Mapping[int, Mapping[str, Any]],
) -> set[int]:
    """Relations whose every live supporting root argument cites only register sources
    (cluster_key 'register:…', the propaganda model's register pipeline, Uitbreiding C)."""

    register = {
        sid
        for sid, row in sources.items()
        if str(row.get("cluster_key") or "").startswith("register:")
    }
    cited: dict[int, list[int]] = defaultdict(list)
    for row in citations:
        cited[row["argument_id"]].append(row["source_id"])
    roots: dict[int, list[int]] = defaultdict(list)
    for row in arguments:
        if (
            row.get("relation_id")
            and row.get("parent_argument_id") is None
            and row.get("stance") == "supporting"
            and row.get("status") != "verworpen"
        ):
            roots[row["relation_id"]].append(row["id"])
    return {
        rid
        for rid, ids in roots.items()
        if all(cited.get(aid) and all(sid in register for sid in cited[aid]) for aid in ids)
    }


def is_bestuur_only(
    relation: Mapping[str, Any],
    mechanisms: Mapping[int, Mapping[str, Any]],
    mechanism_tags: Mapping[int, Sequence[str]],
    register_only: frozenset[int] | set[int] = frozenset(),
) -> bool:
    """Whether a relation belongs only to the decision-making layer (Uitbreiding C): a new
    relation type, a relation that rests only on register facts, or a mechanism whose
    categories include a decision-making one and none of the six media filters."""

    if relation.get("relation_type") in BESTUUR_RELATION_TYPES:
        return True
    if relation.get("id") in register_only:
        return True
    mechanism = mechanisms.get(relation.get("mechanism_id"))
    if mechanism is None:
        return False
    categories = set(mechanism_tags.get(mechanism["id"], ())) | {mechanism.get("filter")}
    return bool(categories & BESTUUR_CATEGORIES) and not categories & MEDIA_FILTERS


def transform(
    raw: PmRawData, *, synced_at: datetime | None = None, bestuur: bool = False
) -> PmSnapshot:
    """Turn raw pm rows into pm_* rows. Pure: no I/O.

    ``bestuur=False`` (default, PROPAGANDA_SYNC_BESTUUR off) leaves out the decision-making
    layer: relations for which :func:`is_bestuur_only` holds, and entities whose every approved
    relation is such a relation."""

    synced = synced_at or datetime.now(timezone.utc)
    roles = {row["id"]: row for row in raw.roles}
    mechanisms = {row["id"]: row for row in raw.mechanisms}
    mechanism_tags: dict[int, list[str]] = defaultdict(list)
    for row in raw.mechanism_filters:
        mechanism_tags[row["mechanism_id"]].append(row["filter"])
    sources = {row["id"]: row for row in raw.sources}
    locations: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for location in raw.source_locations:
        locations[location["source_id"]].append(location)
    arguments = [
        row
        for row in raw.arguments
        if not row.get("vervangen") and row.get("property") not in EXCLUDED_PROPERTIES
    ]
    exported_arg_ids = {row["id"] for row in arguments}
    citations = [row for row in raw.citations if row["argument_id"] in exported_arg_ids]

    entities = [row for row in raw.entities if _is_approved(row)]
    approved_relations = [row for row in raw.relations if _is_approved(row)]
    if not bestuur:
        register_only = register_only_relations(arguments, citations, sources)
        hidden = [
            row
            for row in approved_relations
            if is_bestuur_only(row, mechanisms, mechanism_tags, register_only)
        ]
        if hidden:
            hidden_ids = {row["id"] for row in hidden}
            approved_relations = [
                row for row in approved_relations if row["id"] not in hidden_ids
            ]
            kept_ends = {row["source_id"] for row in approved_relations} | {
                row["target_id"] for row in approved_relations
            }
            hidden_ends = {row["source_id"] for row in hidden} | {
                row["target_id"] for row in hidden
            }
            entities = [
                row
                for row in entities
                if row["id"] not in hidden_ends or row["id"] in kept_ends
            ]
    entity_ids = {row["id"] for row in entities}

    scores = score_arguments(arguments, citations, sources, raw.maintainers)
    certainty_roots, influence_roots = _root_payloads(scores)
    certainty_detail = {
        relation["id"]: instance_certainty(
            certainty_roots.get(relation["id"], []), relation.get("certainty")
        )
        for relation in approved_relations
    }
    influence = {
        relation["id"]: derived_influence(
            relation.get("influence"), influence_roots.get(relation["id"], [])
        )
        for relation in approved_relations
    }
    derived_filters = compute_primary_filters(
        approved_relations,
        mechanisms,
        {rid: detail["score"] for rid, detail in certainty_detail.items()},
        influence,
    )

    exported_relations = [
        relation
        for relation in approved_relations
        if relation["source_id"] in entity_ids and relation["target_id"] in entity_ids
    ]
    auto_entities = raw.auto_approved.get("entities", set())
    auto_relations = raw.auto_approved.get("relations", set())
    relation_source_rows, relation_source_counts = collect_sources(
        "relation",
        (relation["id"] for relation in exported_relations),
        scores,
        citations,
        sources,
        locations,
        unreviewed_owner_ids=auto_relations,
    )
    entity_source_rows, _ = collect_sources(
        "entity",
        entity_ids,
        scores,
        citations,
        sources,
        locations,
        unreviewed_owner_ids=auto_entities,
    )
    argument_rows = collect_arguments(
        (relation["id"] for relation in exported_relations),
        arguments,
        scores,
        citations,
        sources,
        locations,
        unreviewed_owner_ids=auto_relations,
        checked=checked_sources(raw.checks, raw.arguments),
        doubts=source_doubts(raw.checks, raw.arguments),
    )

    degree: dict[int, int] = defaultdict(int)
    relation_rows: list[dict[str, Any]] = []
    for relation in exported_relations:
        degree[relation["source_id"]] += 1
        if relation["target_id"] != relation["source_id"]:
            degree[relation["target_id"]] += 1
        mechanism = mechanisms.get(relation.get("mechanism_id"))
        if mechanism is not None and mechanism.get("vervangen"):
            mechanism = None
        mechanism_filter = mechanism.get("filter") if mechanism else None
        relation_rows.append(
            {
                "id": relation["id"],
                "source_id": relation["source_id"],
                "target_id": relation["target_id"],
                "relation_type": relation["relation_type"],
                "mechanism": display_name(mechanism.get("name")) if mechanism else None,
                "filter": mechanism_filter,
                "filters": relation_filters(
                    mechanism, mechanism_tags.get(mechanism["id"]) if mechanism else None
                ),
                "aard": (mechanism.get("aard") or "direct") if mechanism else None,
                "description": scrub_text(relation.get("description")),
                "certainty_label": certainty_label(certainty_detail[relation["id"]]),
                "active_from": _as_text(relation.get("active_from")),
                "active_until": _as_text(relation.get("active_until")),
                "bidirectional": bool(relation.get("bidirectional")),
                "source_count": relation_source_counts.get(relation["id"], 0),
                "auto_approved": relation["id"] in auto_relations,
                "functie": _as_text(relation.get("functie")),
            }
        )

    entity_rows: list[dict[str, Any]] = []
    for entity in entities:
        role = roles.get(entity.get("primary_role_id"))
        if role is not None and role.get("vervangen"):
            role = None
        primary = derived_filters.get(entity["id"]) or (role.get("category") if role else None)
        entity_rows.append(
            {
                "id": entity["id"],
                "name": str(entity["name"]),
                "slug": pm_slug(entity["id"], entity["name"]),
                "type": entity["type"],
                "role": display_name(role.get("name")) if role else None,
                "primary_filter": primary if primary in EXPORTED_FILTERS else None,
                "description": scrub_text(entity.get("description")),
                "active_from": _as_text(entity.get("active_from")),
                "active_until": _as_text(entity.get("active_until")),
                "degree": degree.get(entity["id"], 0),
                "auto_approved": entity["id"] in auto_entities,
                "bestuurslaag": entity.get("bestuurslaag"),
                "wikidata": entity.get("wikidata"),
            }
        )

    db_mtime = raw.db_mtime or ""
    meta = {
        "version": version_string(raw.release_version, raw.db_mtime),
        "synced_at": synced.isoformat(),
        "db_mtime": db_mtime,
        "entity_count": str(len(entity_rows)),
        "relation_count": str(len(relation_rows)),
        "format": SNAPSHOT_FORMAT,
    }
    return PmSnapshot(
        entities=entity_rows,
        relations=relation_rows,
        sources=entity_source_rows + relation_source_rows,
        aliases=generate_aliases(entity_rows),
        meta=meta,
        synced_at=synced,
        arguments=argument_rows,
        mechanisms=mechanism_rows(
            mechanisms, (relation.get("mechanism_id") for relation in exported_relations)
        ),
    )


def assert_no_excluded_layers(payload: str | PmSnapshot | Mapping[str, Any]) -> None:
    """Mechanical release check: the output must never mention the excluded layers."""

    if isinstance(payload, PmSnapshot):
        serialised = payload.to_json()
    elif isinstance(payload, str):
        serialised = payload
    else:
        serialised = json.dumps(payload, ensure_ascii=False, default=str)
    hits = EXCLUDED_LAYER_TERMS.findall(serialised)
    if hits:
        raise ExcludedLayerError(
            f"Excluded layer terms found in propaganda-model output: {sorted(set(hits))}"
        )


def load_snapshot(
    path: Path | str, *, synced_at: datetime | None = None, bestuur: bool = False
) -> PmSnapshot:
    """Read + transform + check (synchronous; run it in a thread from async code)."""

    snapshot = transform(read_pm_database(path), synced_at=synced_at, bestuur=bestuur)
    assert_no_excluded_layers(snapshot)
    return snapshot


# --------------------------------------------------------------------------------------
# Demo slice (scripts/export_pm_demo_slice.py)
# --------------------------------------------------------------------------------------

_SLICE_ENTITY_FIELDS = (
    "id",
    "name",
    "slug",
    "type",
    "role",
    "primary_filter",
    "description",
    "active_from",
    "active_until",
    "degree",
)
_SLICE_RELATION_FIELDS = (
    "id",
    "source_id",
    "target_id",
    "relation_type",
    "mechanism",
    "filter",
    "filters",
    "aard",
    "description",
    "certainty_label",
    "active_from",
    "active_until",
    "bidirectional",
    "source_count",
)
_SLICE_SOURCE_FIELDS = ("title", "url", "publisher", "published_at", "quote")
_SLICE_ARGUMENT_FIELDS = ("id", "parent_id", "aspect", "stance", "status", "claim", "sources")
_SLICE_MECHANISM_FIELDS = ("name", "description", "effect")


def build_demo_slice(
    snapshot: PmSnapshot,
    seed_ids: Sequence[int],
    *,
    max_entities: int = DEMO_MAX_ENTITIES,
    max_relations: int = DEMO_MAX_RELATIONS,
    max_sources_per_owner: int = MAX_SOURCES_PER_OWNER,
    per_filter: int = DEMO_PER_FILTER,
    max_arguments_per_owner: int = DEMO_MAX_ARGUMENTS,
    argument_focus: Iterable[int] = DEMO_ARGUMENT_FOCUS,
) -> dict[str, Any]:
    """Small slice of the graph for the Vercel demo (no Supabase).

    Seeds + their 1-hop neighbours; for owner entities (seeds that own/finance something, and
    entities that own/finance a seed) one more hop along eigendom/financiering edges. Tiers, until
    the caps are hit:

    1. per seed and per filter (:data:`FILTERS`) the first ``per_filter`` relations of the
       filtered neighbourhood (pm_neighborhood order, i.e. ``pm_neighborhood(seed, n, [filter])``),
       round-robin: rank 0 of every seed/filter first, then rank 1, ... - so every filter is
       represented around every seed;
    2. then, each in pm_neighborhood order (1-hop edges interleaved over the seeds): 1-hop
       ownership edges, owners of the owners, the remaining 1-hop edges, other holdings of the
       owners, and finally edges among the already selected entities.
    """

    entities_by_id = {entity["id"]: entity for entity in snapshot.entities}
    seeds = [seed for seed in dict.fromkeys(seed_ids) if seed in entities_by_id]
    seed_set = set(seeds)
    touching: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for relation in snapshot.relations:
        touching[relation["source_id"]].append(relation)
        if relation["target_id"] != relation["source_id"]:
            touching[relation["target_id"]].append(relation)

    # 1-hop relations, ranked per seed so the seeds alternate within a priority class
    per_seed_rank: dict[int, int] = {}
    for seed in seeds:
        for rank, relation in enumerate(sorted(touching[seed], key=relation_sort_key)):
            per_seed_rank[relation["id"]] = min(per_seed_rank.get(relation["id"], rank), rank)
    hop1 = {relation["id"]: relation for seed in seeds for relation in touching[seed]}

    owners = {
        seed
        for seed in seeds
        if any(
            relation["relation_type"] in OWNERSHIP_RELATION_TYPES and relation["source_id"] == seed
            for relation in touching[seed]
        )
    }
    owners |= {
        relation["source_id"]
        for relation in hop1.values()
        if relation["relation_type"] in OWNERSHIP_RELATION_TYPES
        and relation["target_id"] in seed_set
    }
    hop1_ownership = {
        rid: rel for rid, rel in hop1.items() if rel["relation_type"] in OWNERSHIP_RELATION_TYPES
    }
    # second hop for owners: who owns/finances the owner (up the chain) ...
    owners_of_owners = {
        relation["id"]: relation
        for owner in owners
        for relation in touching[owner]
        if relation["relation_type"] in OWNERSHIP_RELATION_TYPES
        and relation["target_id"] == owner
        and relation["id"] not in hop1
    }
    # ... and what else the owner owns/finances (sideways, lower priority)
    owner_holdings = {
        relation["id"]: relation
        for owner in owners
        for relation in touching[owner]
        if relation["relation_type"] in OWNERSHIP_RELATION_TYPES
        and relation["source_id"] == owner
        and relation["id"] not in hop1
        and relation["id"] not in owners_of_owners
    }

    def ranked(relations: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(
            relations,
            key=lambda rel: (
                relation_priority(rel["relation_type"]),
                per_seed_rank.get(rel["id"], 10**6),
                relation_sort_key(rel),
            ),
        )

    selected_entities: dict[int, None] = dict.fromkeys(seeds[:max_entities])
    selected_relations: dict[int, dict[str, Any]] = {}

    def try_add(relation: dict[str, Any]) -> None:
        if relation["id"] in selected_relations or len(selected_relations) >= max_relations:
            return
        new = {relation["source_id"], relation["target_id"]} - set(selected_entities)
        if len(selected_entities) + len(new) > max_entities:
            return
        selected_entities.update(dict.fromkeys(sorted(new)))
        selected_relations[relation["id"]] = relation

    # tier 1: per seed and per filter the head of the filtered neighbourhood, round-robin
    quota: list[tuple[tuple[int, int, int], dict[str, Any]]] = []
    for seed_index, seed in enumerate(seeds):
        ordered = sorted(touching[seed], key=relation_sort_key)
        for filter_index, flt in enumerate(FILTERS):
            head = [rel for rel in ordered if relation_matches(rel.get("filters"), (flt,))]
            head = head[:per_filter]
            quota.extend(((rank, seed_index, filter_index), rel) for rank, rel in enumerate(head))
    tiers = (
        [rel for _key, rel in sorted(quota, key=lambda item: item[0])],
        ranked(hop1_ownership.values()),
        ranked(owners_of_owners.values()),
        ranked(rel for rid, rel in hop1.items() if rid not in hop1_ownership),
        ranked(owner_holdings.values()),
    )
    for tier in tiers:
        for relation in tier:
            try_add(relation)
    induced = [
        relation
        for relation in snapshot.relations
        if relation["source_id"] in selected_entities
        and relation["target_id"] in selected_entities
        and relation["id"] not in selected_relations
    ]
    for relation in sorted(induced, key=relation_sort_key):
        try_add(relation)

    entity_ids = set(selected_entities)
    relation_ids = set(selected_relations)
    sources: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in sorted(
        snapshot.sources, key=lambda item: (item["owner_kind"], item["owner_id"], item["position"])
    ):
        owner_ids = entity_ids if row["owner_kind"] == "entity" else relation_ids
        if row["owner_id"] not in owner_ids:
            continue
        key = f"{row['owner_kind']}:{row['owner_id']}"
        if len(sources[key]) < max_sources_per_owner:
            sources[key].append({name: row.get(name) for name in _SLICE_SOURCE_FIELDS})
    # The discussion behind the relations of the focus entities (format 5): for, against, nuance
    focus = set(argument_focus)
    argued = {
        relation_id
        for relation_id, relation in selected_relations.items()
        if focus & {relation["source_id"], relation["target_id"]}
    }
    arguments: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in sorted(snapshot.arguments, key=lambda item: (item["owner_id"], item["position"])):
        if row["owner_kind"] != "relation" or row["owner_id"] not in argued:
            continue
        key = f"relation:{row['owner_id']}"
        if len(arguments[key]) < max_arguments_per_owner:
            arguments[key].append({name: row.get(name) for name in _SLICE_ARGUMENT_FIELDS})
    used_mechanisms = {selected_relations[relation_id].get("mechanism") for relation_id in argued}

    slice_data = {
        "meta": {
            "version": snapshot.meta.get("version"),
            "synced_at": snapshot.meta.get("synced_at"),
            "entity_count": int(snapshot.meta.get("entity_count", len(snapshot.entities))),
            "relation_count": int(snapshot.meta.get("relation_count", len(snapshot.relations))),
        },
        "entities": [
            {name: entities_by_id[entity_id].get(name) for name in _SLICE_ENTITY_FIELDS}
            for entity_id in sorted(entity_ids)
        ],
        "relations": [
            {name: selected_relations[relation_id].get(name) for name in _SLICE_RELATION_FIELDS}
            for relation_id in sorted(relation_ids)
        ],
        "sources": dict(sorted(sources.items(), key=lambda item: _owner_sort_key(item[0]))),
        "aliases": [row for row in snapshot.aliases if row["entity_id"] in entity_ids],
        "arguments": dict(sorted(arguments.items(), key=lambda item: _owner_sort_key(item[0]))),
        "mechanisms": [
            {name: row.get(name) for name in _SLICE_MECHANISM_FIELDS}
            for row in sorted(snapshot.mechanisms, key=lambda item: item["name"])
            if row["name"] in used_mechanisms
        ],
    }
    assert_no_excluded_layers(slice_data)
    return slice_data


def _owner_sort_key(key: str) -> tuple[str, int]:
    kind, _, owner_id = key.partition(":")
    return kind, int(owner_id)


def dump_demo_slice(slice_data: Mapping[str, Any]) -> str:
    """Stable JSON: one entity/relation/alias/source list per line (readable git diffs)."""

    def dumps(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def array(items: Sequence[Any]) -> str:
        if not items:
            return "[]"
        return "[\n" + ",\n".join(dumps(item) for item in items) + "\n]"

    def owners(key: str) -> str:
        rows = slice_data.get(key) or {}
        lines = ",\n".join(f"{dumps(owner)}:{dumps(value)}" for owner, value in rows.items())
        return f'"{key}":{{\n{lines}\n}}' if rows else f'"{key}":{{}}'

    parts = [
        f'"meta":{dumps(slice_data["meta"])}',
        f'"entities":{array(slice_data["entities"])}',
        f'"relations":{array(slice_data["relations"])}',
        owners("sources"),
        f'"aliases":{array(slice_data["aliases"])}',
    ]
    if "arguments" in slice_data:
        parts.append(owners("arguments"))
    if "mechanisms" in slice_data:
        parts.append(f'"mechanisms":{array(slice_data["mechanisms"])}')
    return "{\n" + ",\n".join(parts) + "\n}\n"


# --------------------------------------------------------------------------------------
# Writer
# --------------------------------------------------------------------------------------


async def verify_target_secured(session: AsyncSession) -> list[str]:
    """Problems that make the pm_* tables readable by anon (PostgreSQL only; [] = secure).

    Guards against filling the tables before migration 005 ran: ``create_all()`` creates them
    on backend start, and on Supabase new public tables are granted to anon without RLS.
    """

    if session.get_bind().dialect.name != "postgresql":
        return []
    problems: list[str] = []
    rows = (
        await session.execute(
            text(
                "SELECT c.relname, c.relrowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relname = ANY(:names)"
            ),
            {"names": list(PM_TABLES)},
        )
    ).all()
    rls = {name: bool(enabled) for name, enabled in rows}
    for table in PM_TABLES:
        if not rls.get(table):
            problems.append(f"row level security disabled on {table}")
    policies = (
        await session.execute(
            text(
                "SELECT count(*) FROM pg_policies "
                "WHERE schemaname = 'public' AND tablename = ANY(:names)"
            ),
            {"names": list(PM_TABLES)},
        )
    ).scalar_one()
    if policies:
        problems.append(f"{policies} policies on pm_* tables (expected none)")
    existing_roles = set(
        (
            await session.execute(
                text("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
            )
        ).scalars()
    )
    for role in sorted(existing_roles):
        for table in PM_TABLES:
            granted = (
                await session.execute(
                    text("SELECT has_table_privilege(:role, :table, 'SELECT')"),
                    {"role": role, "table": f"public.{table}"},
                )
            ).scalar_one()
            if granted:
                problems.append(f"{role} can SELECT {table}")
    return problems


async def write_snapshot(
    session: AsyncSession, snapshot: PmSnapshot, *, batch_size: int = 500
) -> dict[str, int]:
    """Full refresh in one transaction: delete pm_* then insert the snapshot in batches."""

    problems = await verify_target_secured(session)
    if problems:
        raise UnsecuredTargetError(
            "pm_* tables are not secured (run database/migrations/005_propagandamodel.sql and "
            "010_pm_argumenten.sql): " + "; ".join(problems)
        )
    try:
        for model in (PmSource, PmArgument, PmMechanism, PmAlias, PmRelation, PmEntity, PmMeta):
            await session.execute(delete(model))
        entity_rows = [{**row, "synced_at": snapshot.synced_at} for row in snapshot.entities]
        for model, rows in (
            (PmEntity, entity_rows),
            (PmRelation, snapshot.relations),
            (PmSource, snapshot.sources),
            (PmArgument, snapshot.arguments),
            (PmMechanism, snapshot.mechanisms),
            (PmAlias, snapshot.aliases),
            (PmMeta, [{"key": key, "value": value} for key, value in snapshot.meta.items()]),
        ):
            for start in range(0, len(rows), batch_size):
                await session.execute(insert(model), rows[start : start + batch_size])
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return snapshot.counts()


async def read_sync_meta(session: AsyncSession) -> dict[str, str]:
    """Contents of pm_meta ({} when the table is missing or empty)."""

    try:
        rows = (await session.execute(select(PmMeta.key, PmMeta.value))).all()
    except Exception as exc:  # table missing (before migration/create_all)
        logger.warning("pm_meta_unreadable", error=str(exc))
        await session.rollback()
        return {}
    return {key: value for key, value in rows}


async def table_counts(session: AsyncSession) -> dict[str, int]:
    """Row counts of the pm_* data tables."""

    counts: dict[str, int] = {}
    for model in (PmEntity, PmRelation, PmSource, PmAlias, PmArgument, PmMechanism):
        counts[model.__tablename__] = int(
            (await session.execute(select(func.count()).select_from(model))).scalar_one()
        )
    return counts


# --------------------------------------------------------------------------------------
# Service
# --------------------------------------------------------------------------------------


def _is_current(meta: Mapping[str, str], fingerprint: str) -> bool:
    """The synced rows match the database file AND the current row format."""

    return meta.get("db_mtime") == fingerprint and meta.get("format") == SNAPSHOT_FORMAT


def _default_write_factory() -> AbstractAsyncContextManager[AsyncSession]:
    from backend.app.db.session import get_sessionmaker

    return get_sessionmaker()()


class PropagandaModelSyncService:
    """Syncs the propaganda-model graph into pm_* when the database file changed."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        write_session_factory: SessionFactory | None = None,
        loader: Callable[[Path], PmSnapshot] | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._write = write_session_factory or _default_write_factory
        self._load = loader or (
            lambda path: load_snapshot(path, bestuur=bool(self.settings.propaganda_sync_bestuur))
        )
        self._lock = asyncio.Lock()
        self.last_run: dict[str, Any] | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.settings.propaganda_sync_enabled)

    @property
    def db_path(self) -> Path:
        return Path(self.settings.propaganda_db_path)

    def _record(self, started: float, started_at: datetime, **details: Any) -> None:
        self.last_run = {
            "started_at": started_at.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "duration_seconds": round(time.monotonic() - started, 3),
            **details,
        }

    async def sync(self, force: bool = False, correlation_id: str | None = None) -> dict[str, Any]:
        """Sync when the database changed since the last sync (or always with ``force``)."""

        base = {"db_path": str(self.db_path), "forced": force}
        if not self.enabled:
            return {"skipped": True, "reason": "disabled", **base}
        if not self.db_path.exists():
            logger.warning(
                "pm_sync_db_missing", db_path=str(self.db_path), correlation_id=correlation_id
            )
            return {"skipped": True, "reason": "db_missing", **base}

        started, started_at = time.monotonic(), datetime.now(timezone.utc)
        async with self._lock:
            fingerprint = db_fingerprint(self.db_path)
            if not force:
                async with self._write() as session:
                    synced = await read_sync_meta(session)
                if _is_current(synced, fingerprint):
                    outcome = {"skipped": True, "reason": "unchanged", "db_mtime": fingerprint}
                    self._record(started, started_at, success=True, **outcome)
                    return {**outcome, **base}
            try:
                snapshot = await asyncio.to_thread(self._load, self.db_path)
                async with self._write() as session:
                    counts = await write_snapshot(session, snapshot)
            except Exception as exc:
                self._record(started, started_at, success=False, error=str(exc))
                logger.error(
                    "pm_sync_failed", error=str(exc), correlation_id=correlation_id, **base
                )
                raise
        outcome = {
            "skipped": False,
            "reason": None,
            "version": snapshot.meta["version"],
            "db_mtime": snapshot.meta["db_mtime"],
            **counts,
        }
        self._record(started, started_at, success=True, **outcome)
        logger.info("pm_sync_completed", correlation_id=correlation_id, **outcome)
        return {**outcome, **base}

    async def status(self) -> dict[str, Any]:
        """Configuration, file state, last sync metadata, table counts and the last run."""

        exists = self.db_path.exists()
        current = db_fingerprint(self.db_path) if exists else None
        async with self._write() as session:
            meta = await read_sync_meta(session)
            try:
                counts = await table_counts(session)
            except Exception as exc:  # tables missing
                logger.warning("pm_counts_unreadable", error=str(exc))
                counts = {}
        return {
            "enabled": self.enabled,
            "db_path": str(self.db_path),
            "db_exists": exists,
            "db_mtime": current,
            "interval_minutes": self.settings.propaganda_sync_interval_minutes,
            "synced": meta,
            "up_to_date": bool(current and _is_current(meta, current)),
            "counts": counts,
            "last_run": self.last_run,
        }


_propaganda_sync_service: PropagandaModelSyncService | None = None


def get_propaganda_sync_service() -> PropagandaModelSyncService:
    """Singleton accessor (keeps the last-run record for the status endpoint)."""

    global _propaganda_sync_service
    if _propaganda_sync_service is None:
        _propaganda_sync_service = PropagandaModelSyncService()
    return _propaganda_sync_service


__all__ = [
    "CERTAINTY_PLAUSIBLE",
    "CERTAINTY_UNCERTAIN",
    "CERTAINTY_WELL_SUPPORTED",
    "CURATED_ALIASES",
    "DEMO_SEEDS",
    "FILTERS",
    "ExcludedLayerError",
    "PmRawData",
    "PmSnapshot",
    "PropagandaModelSyncService",
    "RELATION_TYPE_PRIORITY",
    "UnsecuredTargetError",
    "assert_no_excluded_layers",
    "build_demo_slice",
    "certainty_label",
    "checked_sources",
    "source_doubts",
    "collect_arguments",
    "collect_sources",
    "compute_primary_filters",
    "db_fingerprint",
    "dump_demo_slice",
    "generate_aliases",
    "get_propaganda_sync_service",
    "load_snapshot",
    "mechanism_rows",
    "pm_slug",
    "read_pm_database",
    "relation_filters",
    "relation_matches",
    "relation_sort_key",
    "scrub_text",
    "transform",
    "write_snapshot",
]
