"""Koppen die veranderen (Story 14.32): an outlet gives an article another headline later.

A feed lists its articles for a day or so, and every poll downloads it anyway. For an article that
is already stored, the poll compares the headline in the feed with the stored one. Measured on
2026-11-15: of 376 articles fetched at most six hours earlier, 18 had another headline; 9 of 16 a
new headline above the same article (Trouw: "Ook VVD zocht steun bij Denk rond belastingplan"
became "Coalitie praat maandag verder op Catshuis"), 3 a spelling fix and 4 a live blog.

- A **new headline** goes into ``source_metadata.title_history`` (the earlier headline and when the
  new one was first seen) and becomes the article's title.
- A **small fix** (spelling, a word added, a soft hyphen) only becomes the title.
- A **live blog** keeps its first headline: its headline follows the newest post, the stored text
  is the one of the first fetch.

No AI: a comparison of two strings.
"""

from __future__ import annotations

import difflib
import html
import re
import unicodedata
from datetime import datetime
from typing import Any, Literal

# At most this many earlier headlines per article
TITLE_HISTORY_LIMIT = 10
# From this similarity (difflib ratio of the normalized headlines) a change is a small fix
MINOR_RATIO = 0.9

ChangeKind = Literal["headline", "minor", "live"]

# "LIVE | …", "LIVE interlandvoetbal | …", "Liveblog: …", "live: …"
_LIVE = re.compile(r"^\s*(?:live(?:blog)?\b|\[live\])", re.IGNORECASE)
_INVISIBLE = re.compile("[­​‌‍⁠﻿]")
_QUOTES = str.maketrans(
    {"‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "«": '"', "»": '"'}
)


def normalize_headline(value: str | None) -> str:
    """The headline as a reader sees it: entities decoded, soft hyphens gone, one kind of quote."""

    text = unicodedata.normalize("NFKC", html.unescape(value or ""))
    text = _INVISIBLE.sub("", text).translate(_QUOTES)
    return " ".join(text.split())


def is_live(value: str | None) -> bool:
    return bool(_LIVE.match(normalize_headline(value)))


def headline_change(stored: str | None, current: str | None) -> ChangeKind | None:
    """What kind of change ``current`` (the feed now) is of ``stored``; None when it is the same."""

    old, new = normalize_headline(stored), normalize_headline(current)
    if not new or old == new:
        return None
    if is_live(old) or is_live(new):
        return "live"
    letters = lambda value: re.sub(r"[\W_]", "", value.lower())  # noqa: E731
    if letters(old) == letters(new):
        return "minor"
    if difflib.SequenceMatcher(None, old.lower(), new.lower()).ratio() >= MINOR_RATIO:
        return "minor"
    return "headline"


def with_title_change(
    metadata: dict[str, Any] | None, stored_title: str, seen_at: datetime
) -> dict[str, Any]:
    """``source_metadata`` with the stored headline added to ``title_history`` (newest last)."""

    meta = dict(metadata or {})
    history = [entry for entry in meta.get("title_history") or [] if isinstance(entry, dict)]
    history.append({"title": stored_title, "until": seen_at.isoformat()})
    meta["title_history"] = history[-TITLE_HISTORY_LIMIT:]
    return meta
