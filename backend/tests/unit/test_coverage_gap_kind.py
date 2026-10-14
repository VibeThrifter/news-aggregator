"""A missing voice or missing context (Story 14.24): the analysis marks each coverage gap."""

from backend.app.llm.schemas import CoverageGap

BASE = {"perspective": "Omwonenden", "description": "Niemand uit het dorp komt aan het woord.", "relevance": "Zij merken het het meest."}


def test_kind_is_kept():
    assert CoverageGap(**BASE, kind="stem").model_dump()["kind"] == "stem"
    assert CoverageGap(**BASE, kind="context").kind == "context"


def test_kind_is_normalized():
    assert CoverageGap(**BASE, kind=" Stem ").kind == "stem"
    assert CoverageGap(**BASE, kind="voice").kind == "stem"
    assert CoverageGap(**BASE, kind="context - feiten").kind == "context"


def test_unknown_or_missing_kind_never_fails_the_analysis():
    assert CoverageGap(**BASE).kind is None
    assert CoverageGap(**BASE, kind="beide").kind is None
    assert CoverageGap(**BASE, kind=None).kind is None
