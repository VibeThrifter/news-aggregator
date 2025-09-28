from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple


@dataclass
class Article:
    id: str
    title: str
    summary: str
    url: str
    source_name: str
    source_type: str
    political_spectrum: str
    medium: str


@dataclass
class Cluster:
    label: str
    description: str
    political_mix: str
    sources: List[Article] = field(default_factory=list)
    dominant_medium: str | None = None
    method: str = "kmeans"
    keywords: List[Tuple[str, int]] = field(default_factory=list)
