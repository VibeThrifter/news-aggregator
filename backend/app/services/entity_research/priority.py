"""Priority and research decision per named entity (Epic 12 "Wie is dit?", Story 12.6).

The user's order of importance: politicians and media figures (journalists, presenters,
columnists, opinion makers) first, then spokespersons and executives ("hoge piefen"), then
organisations and experts; other public persons only on request; private persons never, nor
artists and athletes without a place in the network (the pm agent skips them too). Prominence in
the news, the gap in the propaganda model and a tap in the app raise the priority. Foreign persons
come after Dutch ones (owner 2026-11-18: "buitenlanders kunnen ook politiek verbonden zijn met wat
er in Nederland gebeurt"; until then they were never researched).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from backend.app.services.entity_research.roles import (
    BESTUURDER,
    EXPERT,
    JOURNALIST,
    ONBEKEND,
    ORGANISATIE,
    OVERIG,
    POLITICUS,
    PRIVE,
    WOORDVOERDER,
)

BASE_PRIORITY: dict[str, float] = {
    POLITICUS: 100.0,
    # media figures count as much as politicians (owner 2026-11-17: "media figuren moeten ook
    # voorrang krijgen"; 95 until then): the model is about media, and LinkedIn, 10 lookups a
    # day in order of priority, shows a media career that no register holds
    JOURNALIST: 100.0,
    WOORDVOERDER: 90.0,
    BESTUURDER: 90.0,
    ORGANISATIE: 85.0,
    EXPERT: 70.0,
    OVERIG: 40.0,
    ONBEKEND: 0.0,
    PRIVE: 0.0,
}
# Unknown role but clearly present in the news: may be researched on request (the agent first
# establishes the public role and skips private persons).
PROMINENT_UNKNOWN_BASE = 55.0
REQUEST_BONUS = 25.0
# Dutch names first: a foreign politician goes by itself only when the news is full of them
# (three outlets), else on request
FOREIGN_FACTOR = 0.8
THIN_COVERAGE_FACTOR = 0.8

# An organisation without a role in the analysis is researched by itself from this many articles
MIN_ORG_ARTICLES = 2
NAMED_ONCE = "Eén keer genoemd, zonder rol in de analyse"
ONLY_SPORT = "Alleen in sportnieuws"
ONLY_LEISURE = "Alleen in amusement- of sportnieuws"
PLAIN_WORD = "Gewoon woord, geen naam van een organisatie"
PERSON_NAME = "Achternaam van een persoon in hetzelfde artikel"
# Reasons a name waits for a tap, a second article or other news; a target queued under older
# rules is taken back for them
HELD_REASONS: frozenset[str] = frozenset(
    {NAMED_ONCE, ONLY_SPORT, ONLY_LEISURE, PLAIN_WORD, PERSON_NAME}
)

# Decisions
RESEARCH = "research"  # eligible for the automatic queue
ON_REQUEST = "on_request"  # only when someone tapped the name
NOT_NEEDED = "not_needed"  # already enough connections in the propaganda model
SKIP = "skip"  # never (private person, no actor)
WAIT = "wait"  # role unknown: re-assessed when more news arrives


@dataclass(frozen=True, slots=True)
class Prominence:
    articles: int = 0
    outlets: int = 0
    events: int = 0
    mentions: int = 0

    @property
    def score(self) -> float:
        """0..1: ~0.3 for one article, ~0.6 for 5 articles/3 outlets, 1 for broad coverage."""

        raw = self.articles + self.outlets + 2 * max(0, self.events - 1)
        return round(min(1.0, math.log2(1 + raw) / 5.0), 3)

    @property
    def is_prominent(self) -> bool:
        return self.outlets >= 3 or self.events >= 2


@dataclass(frozen=True, slots=True)
class Decision:
    decision: str
    priority: float
    reason: str | None = None

    @property
    def auto(self) -> bool:
        return self.decision == RESEARCH


def coverage_factor(pm_degree: int | None, min_relations: int) -> float:
    """1.0 unknown in the model, 0.8 too few relations, 0.0 enough relations."""

    if pm_degree is None:
        return 1.0
    return THIN_COVERAGE_FACTOR if pm_degree < min_relations else 0.0


def decide(
    *,
    kind: str,
    category: str,
    prominence: Prominence,
    pm_degree: int | None,
    is_foreign: bool = False,
    single_name: bool = False,
    non_actor: bool = False,
    not_in_network: str | None = None,
    requested: bool = False,
    has_role: bool = True,
    sport_only: bool = False,
    leisure_only: bool = False,
    not_a_name: str | None = None,
    min_relations: int = 3,
    auto_threshold: float = 60.0,
) -> Decision:
    """Decide whether (and how urgently) an entity should be researched.

    An organisation goes by itself only when the news gives a reason: the analysis names its role
    (``has_role``) or two articles name it; one mention is on request (2026-11-17: 370 names a
    day qualified, 82 % of them an organisation named once, against 12 research targets a day).
    An organisation that is only in sport news (``sport_only``: clubs, leagues) is on request too.
    So is whoever is only in entertainment or sport news (``leisure_only``), except a politician:
    the pm agent skipped presenters of game shows, museums, festivals and prizes (2026-11-18: half
    of what it got, it skipped). ``not_a_name`` is the reason an organisation's name is no name
    (an ordinary word, a person's surname).

    ``not_in_network`` is the reason a person has no place in the network ("Sporter zonder rol in
    het netwerk", "Verzonnen personage (Wikidata)"), from the role cues or from Wikidata."""

    coverage = coverage_factor(pm_degree, min_relations)
    if coverage == 0.0:
        return Decision(
            NOT_NEEDED, 0.0, f"Staat al in het propagandamodel met {pm_degree} verbanden"
        )
    if category == PRIVE:
        return Decision(SKIP, 0.0, "Privépersoon — wordt niet uitgezocht")
    if non_actor:
        return Decision(
            SKIP,
            0.0,
            "Geen actor (zinsdeel, opmaakrest, fotocredit of los woord) — wordt niet uitgezocht",
        )
    if kind == "person" and single_name:
        return Decision(
            SKIP, 0.0, "Alleen een voor- of achternaam — te onduidelijk om uit te zoeken"
        )
    if kind == "person" and not_in_network:
        return Decision(SKIP, 0.0, f"{not_in_network} — wordt niet uitgezocht")

    base = BASE_PRIORITY.get(category, 0.0)
    if category == ONBEKEND:
        if not prominence.is_prominent:
            return Decision(WAIT, 0.0, "Rol nog onbekend")
        base = PROMINENT_UNKNOWN_BASE
    priority = base * (0.6 + 0.4 * prominence.score) * coverage
    if is_foreign:
        priority *= FOREIGN_FACTOR
    if requested:
        priority += REQUEST_BONUS
    priority = round(priority, 2)

    if category in (OVERIG, ONBEKEND):
        return Decision(ON_REQUEST, priority, "Alleen op verzoek")
    if (sport_only or leisure_only) and (kind != "person" or category != POLITICUS):
        return Decision(ON_REQUEST, priority, ONLY_SPORT if sport_only else ONLY_LEISURE)
    if category == ORGANISATIE and kind != "person":
        if not_a_name:
            return Decision(ON_REQUEST, priority, not_a_name)
        if not has_role and prominence.articles < MIN_ORG_ARTICLES:
            return Decision(ON_REQUEST, priority, NAMED_ONCE)
    if priority - (REQUEST_BONUS if requested else 0.0) >= auto_threshold:
        return Decision(RESEARCH, priority)
    return Decision(ON_REQUEST, priority, "Lage prioriteit")


__all__ = [
    "BASE_PRIORITY",
    "Decision",
    "HELD_REASONS",
    "MIN_ORG_ARTICLES",
    "NAMED_ONCE",
    "NOT_NEEDED",
    "ON_REQUEST",
    "ONLY_LEISURE",
    "ONLY_SPORT",
    "PERSON_NAME",
    "PLAIN_WORD",
    "Prominence",
    "RESEARCH",
    "SKIP",
    "WAIT",
    "coverage_factor",
    "decide",
]
