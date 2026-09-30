# ruff: noqa: S101
"""Role triage and priority for names in the news (Epic 12, Story 12.6)."""

from __future__ import annotations

import pytest

from backend.app.services.entity_research import priority as prio
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
    MentionContext,
    assess_organisation,
    assess_person,
    classify_word,
    cue_from_before,
    cue_from_byline,
    cue_from_span,
    cues_from_after,
    cues_from_authority,
    fold,
    infer_kind,
)


def ctx(
    before: str = "", after: str = " zei het.", span: str = "Anouk Verbeek", **kw
) -> MentionContext:
    return MentionContext(before=before, after=after, span=span, **kw)


# ------------------------------------------------------------------ words
@pytest.mark.parametrize(
    ("word", "category"),
    [
        ("Wethouder", POLITICUS),
        ("VVD-Kamerlid", POLITICUS),
        ("oud-minister", POLITICUS),
        ("Amerika-correspondent", JOURNALIST),
        ("woordvoerster", WOORDVOERDER),
        ("CEO", BESTUURDER),
        ("directeur-generaal", BESTUURDER),
        ("hoogleraar", EXPERT),
        ("advocaat", OVERIG),
        ("patiënt", PRIVE),
        ("omwonende", PRIVE),
        ("fiets", None),
        ("", None),
    ],
)
def test_classify_word(word: str, category: str | None) -> None:
    assert classify_word(word) == category


def test_fold_removes_diacritics() -> None:
    assert fold("Oekraïense Yeşilgöz") == "oekraiense yesilgoz"


# ------------------------------------------------------------------ before the name
def test_title_before_name_is_domestic_politician() -> None:
    cue = cue_from_before(ctx("Het dorp moet door. Wethouder "))
    assert cue is not None
    assert (cue.category, cue.label, cue.domestic, cue.foreign) == (
        POLITICUS,
        "wethouder",
        True,
        False,
    )


def test_demonym_marks_a_foreign_politician() -> None:
    cue = cue_from_before(ctx("Volgens de Amerikaanse president ", span="Donald Trump"))
    assert cue is not None and cue.category == POLITICUS and cue.foreign is True


def test_president_without_demonym_is_foreign() -> None:
    cue = cue_from_before(ctx("Volgens president ", span="Trump"))
    assert cue is not None and cue.category == POLITICUS and cue.foreign is True
    span = cue_from_span(ctx(span="Kanselier Merz"))
    assert span is not None and span.foreign is True
    assert assess_person([ctx("zei president ", span="Trump")]).is_foreign is True
    # a Dutch organisation's president is an executive, not a foreign politician
    [cue] = cues_from_after(ctx(after=", president van De Nederlandsche Bank, zei"))
    assert cue.category == BESTUURDER and cue.foreign is False
    assert cue_from_before(ctx("zegt president-directeur ")).category == BESTUURDER


def test_specification_after_the_title() -> None:
    cue = cue_from_before(ctx("aldus hoogleraar economie ", span="Bas Jacobs"))
    assert cue is not None and cue.category == EXPERT and cue.label == "hoogleraar"


def test_party_compound_is_a_politician() -> None:
    cue = cue_from_before(ctx("zegt VVD-Kamerlid "))
    assert cue is not None
    assert cue.category == POLITICUS and cue.label == "VVD-kamerlid" and cue.domestic


def test_two_word_title() -> None:
    cue = cue_from_before(ctx("De politiek verslaggever "))
    assert cue is not None and cue.category == JOURNALIST


@pytest.mark.parametrize(
    "before",
    [
        "Ze sprak met de minister. ",  # sentence break
        "samen met Mark Rutte en ",  # another name
        "",
        "Volgens NordVind ",  # an organisation right before the name
    ],
)
def test_no_title_cue(before: str) -> None:
    assert cue_from_before(ctx(before)) is None


def test_title_inside_the_ner_span() -> None:
    cue = cue_from_span(ctx(span="Minister Hugo de Jonge"))
    assert cue is not None and cue.category == POLITICUS and cue.domestic is False
    assert cue_from_span(ctx(span="Hugo de Jonge")) is None
    assert cue_from_span(ctx(span="Bewoner Henk")) is None  # never a private cue from a span


# ------------------------------------------------------------------ after the name
def test_party_in_parentheses() -> None:
    [cue] = cues_from_after(ctx(after=" (D66) zei dat het kabinet"))
    assert cue.category == POLITICUS and cue.label == "politicus (D66)" and cue.domestic


def test_age_in_parentheses_is_a_private_person() -> None:
    [cue] = cues_from_after(ctx(after=" (61) uit Dijkerhoven is boos.", span="Henk de Boer"))
    assert cue.category == PRIVE


def test_apposition_with_organisation() -> None:
    [cue] = cues_from_after(ctx(after=", woordvoerder van Shell, zegt dat"))
    assert cue.category == WOORDVOERDER
    assert cue.label == "woordvoerder van Shell" and cue.org == "Shell"


def test_apposition_with_multi_word_organisation() -> None:
    [cue] = cues_from_after(ctx(after=", directeur van De Nederlandsche Bank, zei gisteren"))
    assert cue.category == BESTUURDER and cue.org == "De Nederlandsche Bank"


def test_apposition_without_role_word_gives_nothing() -> None:
    assert cues_from_after(ctx(after=", die al dertig jaar in het dorp woont, zegt")) == []


# ------------------------------------------------------------------ byline
def test_nos_byline_is_a_journalist() -> None:
    cue = cue_from_byline(
        ctx(span="Pomme Rademaker", line_start=True, next_line="redacteur Economie", outlet="NOS")
    )
    assert cue is not None
    assert (
        cue.category == JOURNALIST and cue.label == "redacteur Economie (NOS)" and cue.org == "NOS"
    )


@pytest.mark.parametrize(
    ("line_start", "next_line"),
    [
        (False, "redacteur Economie"),
        (True, None),
        (True, "Alleenstaande starters kopen vaker"),
        (True, "redacteur " + "x" * 80),
    ],
)
def test_no_byline(line_start: bool, next_line: str | None) -> None:
    assert cue_from_byline(ctx(line_start=line_start, next_line=next_line)) is None


# ------------------------------------------------------------------ LLM authorities
def test_authority_role_text() -> None:
    [cue] = cues_from_authority(
        {
            "authority": "Anouk Verbeek",
            "authority_type": "politicus",
            "actual_role": "Wethouder van Dijkerhoven",
        }
    )
    assert cue.category == POLITICUS and cue.domestic


def test_authority_type_hint() -> None:
    [cue] = cues_from_authority({"authority": "X", "authority_type": "belangengroep van bewoners"})
    assert cue.category == PRIVE
    assert cues_from_authority({"authority": "X", "authority_type": "", "actual_role": ""}) == []
    assert cues_from_authority({"authority": "X", "authority_type": "iets anders"}) == []


# ------------------------------------------------------------------ assessment
def test_assess_politician_with_evidence() -> None:
    result = assess_person(
        [ctx("Het dorp. Wethouder "), ctx("zei ", after=" (VVD) tegen de krant.")],
        [{"authority": "Anouk Verbeek", "actual_role": "Wethouder van Dijkerhoven"}],
    )
    assert result.category == POLITICUS and result.is_public
    assert result.label == "politicus (VVD)"
    assert result.is_foreign is False
    assert 1 <= len(result.evidence) <= 3
    assert result.confidence == 1.0


def test_public_role_beats_private_cue() -> None:
    result = assess_person(
        [ctx("Buurvrouw ", span="Karin Smit"), ctx(after=", woordvoerder van de gemeente, zei")]
    )
    assert result.category == WOORDVOERDER


def test_only_private_cues() -> None:
    result = assess_person([ctx(span="Henk", after=" (61) woont er al lang.")])
    assert result.category == PRIVE and not result.is_public


def test_no_cues_is_unknown() -> None:
    result = assess_person([ctx("Ze zei tegen ")])
    assert result.category == ONBEKEND and result.label is None and result.confidence == 0.0


def test_foreign_politician_unless_domestic_cue() -> None:
    foreign = assess_person(
        [
            ctx("de Russische president ", span="Poetin"),
            ctx("De Russische president ", span="Poetin"),
        ]
    )
    assert foreign.is_foreign is True
    mixed = assess_person([ctx("de Belgische premier "), ctx("zegt ", after=" (CDA) vandaag")])
    assert mixed.is_foreign is False


def test_journalist_organisation_is_kept() -> None:
    result = assess_person(
        [ctx(span="Pomme Rademaker", line_start=True, next_line="redacteur Economie", outlet="NOS")]
    )
    assert result.category == JOURNALIST and result.organisations == ["NOS"]


def test_assess_organisation_label() -> None:
    result = assess_organisation(
        [
            {
                "authority": "NordVind",
                "authority_type": "bedrijf",
                "actual_role": "Ontwikkelaar van het park",
            }
        ]
    )
    assert result.category == ORGANISATIE and result.label == "Ontwikkelaar van het park"
    assert assess_organisation().label is None


@pytest.mark.parametrize(
    ("name", "authority_type", "kind"),
    [
        ("Nationale Adviesraad Windenergie", "adviesorgaan", "org"),
        ("Stichting Stille Polder", None, "org"),
        ("NAVO", None, "org"),
        ("Anouk Verbeek", "politicus", "person"),
        ("Hans van der Berg", None, "person"),
        ("ongewone naam", None, "person"),
    ],
)
def test_infer_kind(name: str, authority_type: str | None, kind: str) -> None:
    assert infer_kind(name, authority_type) == kind


# ------------------------------------------------------------------ priority
def test_prominence_score_grows_with_coverage() -> None:
    one = prio.Prominence(articles=1, outlets=1, events=1)
    broad = prio.Prominence(articles=20, outlets=8, events=4)
    assert 0 < one.score < broad.score <= 1.0
    assert not one.is_prominent and broad.is_prominent
    assert prio.Prominence().score == 0.0


def test_coverage_factor() -> None:
    assert prio.coverage_factor(None, 3) == 1.0
    assert prio.coverage_factor(2, 3) == prio.THIN_COVERAGE_FACTOR
    assert prio.coverage_factor(3, 3) == 0.0


def _decide(**kw):
    base = {
        "kind": "person",
        "category": POLITICUS,
        "prominence": prio.Prominence(articles=4, outlets=3, events=1),
        "pm_degree": None,
    }
    base.update(kw)
    return prio.decide(**base)


def test_decide_politician_is_researched_automatically() -> None:
    decision = _decide()
    assert decision.decision == prio.RESEARCH and decision.auto and decision.allowed_on_request
    assert decision.priority >= 60


def test_decide_not_needed_when_enough_relations() -> None:
    decision = _decide(pm_degree=5)
    assert decision.decision == prio.NOT_NEEDED and "5 verbanden" in decision.reason


def test_decide_private_and_foreign_persons_are_skipped() -> None:
    assert _decide(category=PRIVE).decision == prio.SKIP
    assert _decide(is_foreign=True).decision == prio.SKIP
    # foreign organisations are not skipped, only lower priority
    org = _decide(kind="org", category=ORGANISATIE, is_foreign=True)
    assert org.decision == prio.ON_REQUEST and org.priority < 60


def test_decide_single_name_person_is_skipped() -> None:
    decision = _decide(single_name=True)
    assert decision.decision == prio.SKIP and "voor- of achternaam" in decision.reason
    # organisations with one word are fine
    assert _decide(kind="org", category=ORGANISATIE, single_name=True).decision == prio.RESEARCH


def test_decide_unknown_role() -> None:
    wait = _decide(category=ONBEKEND, prominence=prio.Prominence(articles=1, outlets=1, events=1))
    assert wait.decision == prio.WAIT and not wait.allowed_on_request
    prominent = _decide(
        category=ONBEKEND, prominence=prio.Prominence(articles=6, outlets=3, events=2)
    )
    assert prominent.decision == prio.ON_REQUEST and prominent.allowed_on_request


def test_decide_other_public_persons_only_on_request() -> None:
    assert _decide(category=OVERIG).decision == prio.ON_REQUEST


def test_decide_low_priority_expert() -> None:
    decision = _decide(
        category=EXPERT, prominence=prio.Prominence(articles=1, outlets=1, events=1), pm_degree=1
    )
    assert decision.decision == prio.ON_REQUEST and decision.reason == "Lage prioriteit"


def test_request_bonus_does_not_make_it_automatic() -> None:
    plain = _decide(
        category=EXPERT, prominence=prio.Prominence(articles=1, outlets=1, events=1), pm_degree=1
    )
    requested = _decide(
        category=EXPERT,
        prominence=prio.Prominence(articles=1, outlets=1, events=1),
        pm_degree=1,
        requested=True,
    )
    assert requested.priority == pytest.approx(plain.priority + prio.REQUEST_BONUS)
    assert requested.decision == prio.ON_REQUEST


def test_thin_coverage_lowers_priority() -> None:
    assert _decide(pm_degree=1).priority < _decide().priority
