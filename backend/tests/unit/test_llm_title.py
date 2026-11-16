# ruff: noqa: S101
"""Tests for LLM title extraction (moved to backend.app.llm.title in Story 11.8)."""

from __future__ import annotations

import pytest

from backend.app.llm.title import extract_title_from_summary


@pytest.mark.parametrize(
    ("summary", "expected"),
    [
        (
            "Kabinet valt over asielbeleid\n\nHet kabinet is gevallen.",
            "Kabinet valt over asielbeleid",
        ),
        ("Kabinet valt!\n\nHet kabinet is gevallen.", "Kabinet valt!"),
        ("Kabinet valt.  \n\nTekst", "Kabinet valt."),
        ("Kort\n\nTekst", None),  # too short
        ("x" * 81 + "\n\nTekst", None),  # too long
        ("Geen lege regel na de titel\nTekst", None),
        ("", None),
        (None, None),
    ],
)
def test_extract_title_from_summary(summary: str | None, expected: str | None) -> None:
    assert extract_title_from_summary(summary) == expected


def test_twice_escaped_summary_gets_its_title_back() -> None:
    """The LLM sometimes escapes its JSON twice: backslash + n instead of a line break."""
    from backend.app.llm.schemas import FactualPayload

    raw = (
        "Ajax onderzoekt vuurwerkgooier bij Legends-duel\\n\\n**Harde knal in uitverkochte ArenA**\\n\\n"
        "Tijdens de wedstrijd is een zwaar stuk vuurwerk afgestoken. Een woordvoerder zegt: "
        '\\"We zoeken de dader.\\" Ajax bekijkt de camerabeelden van de F-Side.'
    )
    payload = FactualPayload(summary=raw)

    assert "\\" not in payload.summary
    assert payload.summary.startswith(
        "Ajax onderzoekt vuurwerkgooier bij Legends-duel\n\n**Harde knal in uitverkochte ArenA**\n\n"
    )
    assert 'zegt: "We zoeken de dader."' in payload.summary
    assert extract_title_from_summary(payload.summary) == "Ajax onderzoekt vuurwerkgooier bij Legends-duel"
