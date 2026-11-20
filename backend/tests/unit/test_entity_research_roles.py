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
    clean_person_name,
    cue_from_before,
    cue_from_byline,
    cue_from_span,
    cues_from_after,
    cues_from_authority,
    fold,
    infer_kind,
    is_foreign_head,
    is_foreign_head_label,
    is_non_actor,
    name_defect,
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


def test_former_foreign_head_is_foreign() -> None:
    assert is_foreign_head("ex-president") and is_foreign_head("oud-president")
    assert not is_foreign_head("cornell-president") and not is_foreign_head("president-directeur")
    assert is_foreign_head_label("ex-president") and not is_foreign_head_label("burgemeester")
    assert assess_person([ctx("zei ex-president ", span="Bolsonaro")]).is_foreign is True


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
    assert result.category == POLITICUS
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
    assert result.category == PRIVE


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
    assert decision.decision == prio.RESEARCH and decision.auto
    assert decision.priority >= 60


def test_decide_not_needed_when_enough_relations() -> None:
    decision = _decide(pm_degree=5)
    assert decision.decision == prio.NOT_NEEDED and "5 verbanden" in decision.reason


def test_decide_private_persons_are_skipped_and_foreigners_come_after_dutch() -> None:
    assert _decide(category=PRIVE).decision == prio.SKIP
    # a foreigner can be tied to Dutch politics (owner 2026-11-18): researched, after Dutch names
    foreign = _decide(is_foreign=True)
    assert foreign.auto and foreign.priority < _decide().priority
    once = prio.Prominence(articles=1, outlets=1, events=1)
    assert _decide(is_foreign=True, prominence=once).decision == prio.ON_REQUEST
    assert _decide(prominence=once).auto
    org = _decide(kind="org", category=ORGANISATIE, is_foreign=True)
    assert org.decision == prio.ON_REQUEST and org.priority < 60


def test_only_entertainment_or_sport_news_is_on_request() -> None:
    presenter = _decide(category=JOURNALIST, leisure_only=True)
    assert presenter.decision == prio.ON_REQUEST and presenter.reason == prio.ONLY_LEISURE
    museum = _decide(kind="org", category=ORGANISATIE, leisure_only=True)
    assert museum.decision == prio.ON_REQUEST and museum.reason == prio.ONLY_LEISURE
    columnist = _decide(category=JOURNALIST, sport_only=True, leisure_only=True)
    assert columnist.reason == prio.ONLY_SPORT
    assert _decide(leisure_only=True).auto  # a politician in entertainment news
    assert _decide(category=JOURNALIST).auto


def test_an_organisation_name_that_is_no_name_is_on_request() -> None:
    word = _decide(kind="org", category=ORGANISATIE, not_a_name=prio.PLAIN_WORD)
    assert word.decision == prio.ON_REQUEST and word.reason == prio.PLAIN_WORD
    assert prio.PLAIN_WORD in prio.HELD_REASONS and prio.ONLY_LEISURE in prio.HELD_REASONS


def test_decide_single_name_person_is_skipped() -> None:
    decision = _decide(single_name=True)
    assert decision.decision == prio.SKIP and "voor- of achternaam" in decision.reason
    # organisations with one word are fine
    assert _decide(kind="org", category=ORGANISATIE, single_name=True).decision == prio.RESEARCH


def test_decide_unknown_role() -> None:
    wait = _decide(category=ONBEKEND, prominence=prio.Prominence(articles=1, outlets=1, events=1))
    assert wait.decision == prio.WAIT and not wait.auto
    prominent = _decide(
        category=ONBEKEND, prominence=prio.Prominence(articles=6, outlets=3, events=2)
    )
    assert prominent.decision == prio.ON_REQUEST and not prominent.auto


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


# ------------------------------------------------------------------ real-data fixes (2026-10-01)
def test_politiek_leider_is_a_politician_not_the_police() -> None:
    [cue] = cues_from_authority(
        {"authority": "Rob Jetten", "actual_role": "Politiek leider die een uitspraak doet"}
    )
    assert cue.category == POLITICUS
    [police] = cues_from_authority({"authority": "X", "authority_type": "politie"})
    assert police.category == BESTUURDER


@pytest.mark.parametrize(
    ("name", "cleaned"),
    [
        ("Heinen van Financiën", "Heinen"),
        ("Defensie Katz", "Katz"),
        ("Eelco Heinen", "Eelco Heinen"),
        ("Hanneke van Buitenlandse Zaken", "Hanneke"),
    ],
)
def test_clean_person_name(name: str, cleaned: str) -> None:
    assert clean_person_name(name) == cleaned


def test_non_actor_names() -> None:
    assert is_non_actor("Wikimedia Commons") and is_non_actor("Getty Images")
    assert not is_non_actor("ANP") and not is_non_actor("NordVind")
    # loose words and names without a capital are no actor either
    assert is_non_actor("KIJK OOK") and is_non_actor("Gisteren") and is_non_actor("Wij")
    assert is_non_actor("bond") and is_non_actor("senaat")
    assert not is_non_actor("Ook Dit BV") and not is_non_actor("de Volkskrant")
    decision = _decide(kind="org", category=ORGANISATIE, non_actor=True)
    assert decision.decision == prio.SKIP and "Geen actor" in decision.reason


# ------------------------------------------------------------ no place in the network (2026-10-16)
@pytest.mark.parametrize(
    ("word", "category"),
    [
        ("schilder", OVERIG),
        ("kunstschilder", OVERIG),
        ("oud-voetballer", OVERIG),
        ("Twente-trainer", OVERIG),
        ("volksvertegenwoordiger", POLITICUS),
    ],
)
def test_new_title_words(word: str, category: str) -> None:
    assert classify_word(word) == category


def test_painter_in_the_text_has_no_place_in_the_network() -> None:
    """Kandinsky: "de Russisch-Franse schilder Wassily Kandinsky" (NU.nl, 2026-10-15)."""

    result = assess_person(
        [ctx("Das bunte Leben van de Russisch-Franse schilder ", span="Wassily Kandinsky")]
    )
    assert result.category == OVERIG and result.label == "schilder"
    assert result.no_network_role == "Kunstenaar"


def test_athlete_from_the_analysis_ignores_negated_words() -> None:
    result = assess_person(
        [],
        [
            {
                "authority": "Jay Bothroyd",
                "actual_role": "Oud-voetballer (voormalig spits), geen medisch deskundige",
            }
        ],
    )
    assert result.category == OVERIG and result.no_network_role == "Sporter"


def test_any_other_role_keeps_the_person() -> None:
    # a presenter, a board seat or a party is a place in the network
    presenter = assess_person(
        [],
        [{"authority": "Paul de Leeuw", "actual_role": "Zanger, songwriter en presentator"}],
    )
    assert presenter.no_network_role is None
    board = assess_person(
        [
            ctx("bondscoach ", span="Jan Jansen"),
            ctx(span="Jan Jansen", after=", voorzitter van de KNVB, zei"),
        ]
    )
    assert board.no_network_role is None
    # the analysis names her a critic; "de acteur" in her role is Tom Cruise (2026-10-16)
    critic = assess_person(
        [],
        [
            {
                "authority": "Floortje Smit",
                "authority_type": "Filmrecensent en columnist van de Volkskrant",
                "actual_role": "Ze interpreteert de motieven van de acteur.",
            }
        ],
    )
    assert critic.no_network_role is None
    tv = assess_person(
        [ctx("televisiepresentator en voormalig voetballer ", span="René van der Gijp")]
    )
    assert tv.no_network_role is None
    party = assess_person([ctx("zanger ", span="Jan Jansen"), ctx(after=" (VVD) tegen de krant.")])
    assert party.no_network_role is None
    assert assess_person([ctx("Ze zei tegen ")]).no_network_role is None


def test_betrokken_partij_is_no_politician() -> None:
    """The analysis calls anyone with a stake "partij": Tom Pidcock, Coco Gauff (2026-10-16)."""

    [cue] = cues_from_authority(
        {"authority": "Tom Pidcock", "actual_role": "Renner en belanghebbende partij"}
    )
    assert cue.category == OVERIG and cue.words == ("renner",)
    assert cues_from_authority({"authority": "X", "authority_type": "betrokken partij"}) == []
    [opponent] = cues_from_authority(
        {"authority": "Lord Massey", "actual_role": "Partijpolitieke opposant van de regering"}
    )
    assert opponent.category == POLITICUS


def test_decide_skips_persons_without_a_place_in_the_network() -> None:
    decision = _decide(category=OVERIG, not_in_network="Sporter zonder rol in het netwerk")
    assert decision.decision == prio.SKIP
    assert decision.reason == "Sporter zonder rol in het netwerk — wordt niet uitgezocht"
    # a tap does not change it; enough relations in the model come first
    assert _decide(category=OVERIG, not_in_network="x", requested=True).decision == prio.SKIP
    assert _decide(not_in_network="x", pm_degree=5).decision == prio.NOT_NEEDED
    # organisations never
    org = _decide(kind="org", category=ORGANISATIE, not_in_network="x")
    assert org.decision == prio.RESEARCH


# ------------------------------------------------------- names that are no names (2026-11-17)
@pytest.mark.parametrize(
    ("name", "defect"),
    [
        ("bdquo;alle middelen&rdquo", "opmaakrest"),
        ("offici&euml;le&nbsp;website", "opmaakrest"),
        ('maken."\nFC Groningen', "opmaakrest"),
        ("VS\nEen", "opmaakrest"),
        ("Google-favorietMemphis Depay", "tekst van de pagina"),
        ("RTL je Google-favorietOlympisch", "tekst van de pagina"),
        ("2-4-zege", "uitslag"),
        ("VVD voted against it", "zinsdeel"),
        ("Turnsters gaan de afgelopen", "zinsdeel"),
        ("Talpa gewoon zegt", "zinsdeel"),
        ("ministerie van Defensie gaat het om een missie met een defensief doel", "zinsdeel"),
        ("Artsen waarschuwen voor groene knolamani", "zinsdeel"),
    ],
)
def test_name_defect(name: str, defect: str) -> None:
    assert name_defect(name) == defect
    assert is_non_actor(name)


@pytest.mark.parametrize(
    "name",
    [
        "Islamitische Stichting Nederland",
        "Raad voor de rechtspraak",
        "Raad voor de leefomgeving en infrastructuur",
        "Ministerie van Volksgezondheid, Welzijn en Sport",
        "Artsen zonder Grenzen",
        "Partij voor de Dieren",
        "Die Linke",
        "Het Parool",
        "Ernst & Young",
        "C&A",
        "D66",
        "50PLUS",
        "Hayat Tahrir al-Sham",
        "ondernemersvereniging Deltalinqs",
        "Wageningen University & Research",
    ],
)
def test_names_are_no_defect(name: str) -> None:
    assert name_defect(name) is None
    assert not is_non_actor(name)


def test_cut_off_club_is_no_actor() -> None:
    assert is_non_actor("FC") and not is_non_actor("FC Groningen")


def test_organisation_named_once_is_on_request() -> None:
    once = prio.Prominence(articles=1, outlets=1, events=1)
    twice = prio.Prominence(articles=2, outlets=1, events=1)
    decision = _decide(kind="org", category=ORGANISATIE, prominence=once, has_role=False)
    assert decision.decision == prio.ON_REQUEST and decision.reason == prio.NAMED_ONCE
    assert decision.priority > 0  # a tap still sends it
    # a role in the analysis or a second article is a reason
    assert _decide(kind="org", category=ORGANISATIE, prominence=once).auto
    assert _decide(kind="org", category=ORGANISATIE, prominence=twice, has_role=False).auto
    # persons are judged on their role, not on this rule
    assert _decide(prominence=once, has_role=False).auto


def test_media_figures_count_as_much_as_politicians() -> None:
    assert prio.BASE_PRIORITY[JOURNALIST] == prio.BASE_PRIORITY[POLITICUS]
    for word in ("columnist", "presentator", "opiniemaker", "talkshowhost", "hoofdredacteur"):
        assert classify_word(word) == JOURNALIST
    # a following alone is on request: reality stars came out above politicians
    for word in ("influencer", "vlogger", "podcastmaker", "blogger"):
        assert classify_word(word) == OVERIG
    assert _decide(category=JOURNALIST).priority == _decide(category=POLITICUS).priority
    assert _decide(category=OVERIG).decision == prio.ON_REQUEST


def test_organisation_only_in_sport_news_is_on_request() -> None:
    decision = _decide(kind="org", category=ORGANISATIE, sport_only=True)
    assert decision.decision == prio.ON_REQUEST and decision.reason == prio.ONLY_SPORT
    assert _decide(sport_only=True).auto  # a politician in sport news
