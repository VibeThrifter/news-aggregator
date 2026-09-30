"""Priority and research decision per named entity (Epic 12 "Wie is dit?", Story 12.6).

The user's order of importance: politicians, journalists, spokespersons and executives ("hoge
piefen") first, then organisations and experts; other public persons only on request; private
persons never. Prominence in the news, the gap in the propaganda model and a tap in the app raise
the priority; foreign actors are outside the Dutch model.
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
    JOURNALIST: 95.0,
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
FOREIGN_FACTOR = 0.3
THIN_COVERAGE_FACTOR = 0.8

# Decisions
RESEARCH = "research"  # eligible for the automatic queue
ON_REQUEST = "on_request"  # only when someone tapped the name
NOT_NEEDED = "not_needed"  # already enough connections in the propaganda model
SKIP = "skip"  # never (private person, foreign person)
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

    @property
    def allowed_on_request(self) -> bool:
        return self.decision in (RESEARCH, ON_REQUEST)


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
    requested: bool = False,
    min_relations: int = 3,
    auto_threshold: float = 60.0,
) -> Decision:
    """Decide whether (and how urgently) an entity should be researched."""

    coverage = coverage_factor(pm_degree, min_relations)
    if coverage == 0.0:
        return Decision(
            NOT_NEEDED, 0.0, f"Staat al in het propagandamodel met {pm_degree} verbanden"
        )
    if category == PRIVE:
        return Decision(SKIP, 0.0, "Privépersoon — wordt niet uitgezocht")
    if kind == "person" and single_name:
        return Decision(
            SKIP, 0.0, "Alleen een voor- of achternaam — te onduidelijk om uit te zoeken"
        )
    if kind == "person" and is_foreign:
        return Decision(
            SKIP, 0.0, "Buitenlandse persoon — valt buiten het Nederlandse propagandamodel"
        )

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
    if priority - (REQUEST_BONUS if requested else 0.0) >= auto_threshold:
        return Decision(RESEARCH, priority)
    return Decision(ON_REQUEST, priority, "Lage prioriteit")


__all__ = [
    "BASE_PRIORITY",
    "Decision",
    "NOT_NEEDED",
    "ON_REQUEST",
    "Prominence",
    "RESEARCH",
    "SKIP",
    "WAIT",
    "coverage_factor",
    "decide",
]
