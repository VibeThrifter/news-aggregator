"""Helpers for the LLM-generated event title (first line of ``llm_insights.summary``).

Copyright rule: titles shown to users must be the LLM title, never article titles or
``events.description``.
"""

from __future__ import annotations

import re

_TITLE_WITHOUT_PUNCTUATION = re.compile(r"^([^\n.!?]+)\n\n")
_TITLE_WITH_PUNCTUATION = re.compile(r"^([^\n]+[.!?])\s*\n\n")
_MIN_TITLE_LENGTH = 5
_MAX_TITLE_LENGTH = 80


def extract_title_from_summary(summary: str | None) -> str | None:
    """Extract the title (first line) from an LLM-generated summary.

    The LLM generates summaries where the first line is a short title (max 60 chars)
    without punctuation, followed by a blank line and the actual content.

    Returns None if no valid title can be extracted.
    """
    if not summary:
        return None

    # Try to match: title\n\n (title without punctuation, followed by blank line)
    match = _TITLE_WITHOUT_PUNCTUATION.match(summary)
    if match:
        title = match.group(1).strip()
        # Validate: title should be reasonably short (max 80 chars to allow some flexibility)
        if _MIN_TITLE_LENGTH <= len(title) <= _MAX_TITLE_LENGTH:
            return title

    # Fallback: try title with punctuation followed by blank line
    match = _TITLE_WITH_PUNCTUATION.match(summary)
    if match:
        title = match.group(1).strip()
        if _MIN_TITLE_LENGTH <= len(title) <= _MAX_TITLE_LENGTH:
            return title

    return None


__all__ = ["extract_title_from_summary"]
