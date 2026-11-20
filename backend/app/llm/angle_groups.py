"""A simple division of the angles of a news item: at most a few groups (Story 14.41).

The factual analysis groups the Dutch articles by angle. With many outlets it sometimes gives five
or six groups, some of them nearly the same (event 12055: "te weinig bereikt voor ondernemers"
twice, plus a reader poll as an angle of its own). A reader wants a simple division.

Which angles look alike is a judgment about meaning. Measured: the embedding model cannot make it
(all angles of one news item share its words; for event 12055 it joined the neutral report with
the right-wing criticism), so the model that wrote the angles merges them, in one small call. What
comes back is checked here: every angle exactly once, at most `limit` groups. An answer that fails
the check is not used.
"""

from __future__ import annotations

from collections.abc import Sequence
from urllib.parse import urlparse

from pydantic import BaseModel, Field

from backend.app.llm.schemas import InsightCluster, InsightClusterSource


class AngleGroup(BaseModel):
    """One group of the simple division: the angles (by number) it holds."""

    label: str = Field(default="")
    summary: str = Field(default="")
    members: list[int] = Field(default_factory=list)


class AngleDivision(BaseModel):
    """The model's answer: the angles divided over at most `limit` groups."""

    groups: list[AngleGroup] = Field(default_factory=list)


def _outlet(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def simple_division_prompt(clusters: Sequence[InsightCluster], *, limit: int) -> str:
    """Ask the model to merge the angles that look most alike until at most `limit` are left."""

    lines: list[str] = []
    for number, cluster in enumerate(clusters, start=1):
        lines.append(f"{number}. {cluster.label} | {cluster.summary}")
        for source in cluster.sources:
            lines.append(f"   - {_outlet(str(source.url))}: {source.stance or source.title}")
    angles = "\n".join(lines)
    return (
        f"An analysis found {len(clusters)} angles (invalshoeken) in the Dutch coverage of one "
        f"news item. A reader wants a simple division: at most {limit} groups.\n\n"
        f"Merge the angles that look most alike until at most {limit} groups are left.\n"
        "- Angles look alike when their sources stress the same thing or give the same side "
        "the weight.\n"
        "- A difference in tone or genre (news report, opinion, satire, column, reader poll, "
        "live blog) is no reason to keep angles apart.\n"
        "- Keep an angle apart when it stresses something no other angle does.\n"
        "- Put groups that look alike next to each other.\n\n"
        f"The angles, each with its sources and what they stress:\n{angles}\n\n"
        "Answer with JSON only:\n"
        '{"groups": [{"label": "Dutch: the angle these sources share, never the name of an '
        'outlet", "summary": "one or two Dutch sentences", "members": [1, 2]}]}\n'
        '"members" holds the numbers of the angles in the group. Every number from 1 to '
        f"{len(clusters)} stands in exactly one group. A group with one member keeps the label "
        "and summary of that angle."
    )


def apply_division(
    clusters: Sequence[InsightCluster], division: AngleDivision, *, limit: int
) -> list[InsightCluster] | None:
    """The clusters merged as the division says, or None when the division is not a valid one.

    Valid: one to `limit` groups, and every cluster in exactly one of them. A group of one keeps
    its cluster as it was; a merged group takes the model's label and summary and all sources of
    its members.
    """

    groups = division.groups
    if not 1 <= len(groups) <= limit:
        return None
    members = [number for group in groups for number in group.members]
    if sorted(members) != list(range(1, len(clusters) + 1)):
        return None

    merged: list[InsightCluster] = []
    for group in groups:
        parts = [clusters[number - 1] for number in group.members]
        if len(parts) == 1:
            merged.append(parts[0])
            continue
        label = group.label.strip()
        summary = group.summary.strip()
        if not label or not summary:
            return None
        # The spectrum of the angle with most sources (the first of equals)
        lead = max(parts, key=lambda part: len(part.sources))
        sources: list[InsightClusterSource] = []
        seen: set[str] = set()
        for part in parts:
            for source in part.sources:
                if str(source.url) not in seen:
                    seen.add(str(source.url))
                    sources.append(source)
        merged.append(
            InsightCluster(
                label=label,
                spectrum=lead.spectrum,
                source_types=list(
                    dict.fromkeys(kind for part in parts for kind in part.source_types)
                ),
                summary=summary,
                characteristics=list(
                    dict.fromkeys(item for part in parts for item in part.characteristics)
                ),
                sources=sources,
            )
        )
    return merged


__all__ = ["AngleDivision", "AngleGroup", "apply_division", "simple_division_prompt"]
