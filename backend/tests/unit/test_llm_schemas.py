from __future__ import annotations

import pytest

from backend.app.llm.schemas import AuthorityAnalysis

BASE = {"authority": "Diyanet", "authority_type": "Turkse overheidsorganisatie", "claimed_expertise": "godsdienst"}


@pytest.mark.parametrize(
    ("answer", "kept"),
    [
        ("nee: Diyanet komt niet aan het woord; de organisatie wordt alleen beschreven.", "nee"),
        ("ja: Trouw citeert hem uitgebreid over het ontwerp.", "ja"),
        ("Ja", "ja"),
        (None, ""),
        ("onbekend", ""),
    ],
)
def test_speaks_keeps_only_yes_or_no(answer: str | None, kept: str) -> None:
    """Event 11671: Diyanet stood as a speaker of NieuwRechts; the model adds its reason to the answer."""
    assert AuthorityAnalysis(**BASE, speaks=answer).speaks == kept


def test_an_analysis_without_the_field_says_nothing() -> None:
    assert AuthorityAnalysis(**BASE).speaks == ""
    assert AuthorityAnalysis(**BASE).model_dump(mode="json")["speaks"] == ""
