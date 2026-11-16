"""Onderzoek in opdracht van (Story 14.36): sentences found in October 2026."""

import pytest

from backend.app.nlp.sponsored_research import sponsored_research


@pytest.mark.parametrize(
    ("text", "sponsor", "researcher", "self_"),
    [
        (
            "Onderzoek van Ecorys in opdracht van MantelzorgNL raamt de kosten op 11 miljard euro.",
            "MantelzorgNL",
            "Ecorys",
            False,
        ),
        (
            "Veel kosten worden niet berekend, becijferde onderzoeksbureau Arcadis in opdracht van Natuur & Milieu.",
            "Natuur & Milieu",
            "Arcadis",
            False,
        ),
        (
            "Een onderzoek van adviesbureau Sira in opdracht van het kabinet raamt de kosten op 39,4 miljoen.",
            "het kabinet",
            "Sira",
            False,
        ),
        (
            "Dat blijkt uit onderzoek van Panel Inzicht onder duizend Nederlanders, in opdracht van deze site.",
            "deze site",
            "Panel Inzicht",
            True,
        ),
        (
            "Het rapport is opgesteld in opdracht van onder meer het Rijk, VNG en Aedes.",
            "het Rijk, VNG en Aedes",
            None,
            False,
        ),
        (
            "De enquête is uitgevoerd door Q&A in opdracht van Independer.",
            "Independer",
            "Q&A",
            False,
        ),
        (
            "Het rapport werd opgesteld in opdracht van de Canadese overheid als onderdeel van een commissie.",
            "de Canadese overheid",
            None,
            False,
        ),
        (
            "Uit onderzoek in opdracht van het ministerie van Volksgezondheid, Welzijn en Sport blijkt dat.",
            "het ministerie van Volksgezondheid, Welzijn en Sport",
            None,
            False,
        ),
        (
            "Het onderzoek in opdracht van de Jagersvereniging verrichtte een bureau.",
            "de Jagersvereniging",
            None,
            False,
        ),
        (
            "Volgens onderzoek van The Hague Centre for Strategic Studies in opdracht van het ministerie van Defensie is dat zo.",
            "het ministerie van Defensie",
            "The Hague Centre for Strategic Studies",
            False,
        ),
        (
            "Het rapport werd geschreven in opdracht van de toenmalige staatssecretaris.",
            "de toenmalige staatssecretaris",
            None,
            False,
        ),
    ],
)
def test_sponsor_and_researcher(text, sponsor, researcher, self_):
    [found] = sponsored_research(text)
    assert found["sponsor"] == sponsor
    assert found["researcher"] == researcher
    assert found["self"] is self_
    assert found["sentence"].startswith(text[:20])


def test_no_research_no_sponsor():
    assert sponsored_research("Hij bouwde de brug in opdracht van zijn baas.") == []
    assert sponsored_research("") == []
    assert sponsored_research(None) == []


def test_each_sponsor_once_and_at_most_three():
    text = " ".join(f"Onderzoek in opdracht van Fonds{i} toont het aan." for i in range(5))
    found = sponsored_research(text + " Onderzoek in opdracht van Fonds0 nog eens.")
    assert [entry["sponsor"] for entry in found] == ["Fonds0", "Fonds1", "Fonds2"]


def test_an_unnamed_sponsor_is_no_sponsor():
    text = (
        "Uit onderzoek blijkt dat een medewerker het werk in opdracht van een onbekende door een "
        "koerier liet brengen."
    )
    assert sponsored_research(text) == []
