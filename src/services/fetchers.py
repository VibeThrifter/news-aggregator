from __future__ import annotations

import re
from typing import Iterable, List

from data.sample_articles import SAMPLE_ARTICLES
from src.models import Article


def fetch_articles_for_query(query: str) -> List[Article]:
    pattern = re.compile(r"\b" + re.escape(query.lower()) + r"\b")
    matches = [
        article
        for article in SAMPLE_ARTICLES
        if pattern.search((article["title"] + " " + article["summary"]).lower())
    ]
    if len(matches) < 3:
        matches = list(SAMPLE_ARTICLES)
    return [Article(**item) for item in matches]
