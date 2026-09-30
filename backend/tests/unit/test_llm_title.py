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
