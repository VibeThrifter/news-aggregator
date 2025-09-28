from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Iterable, List

import trafilatura

from backend.app.models import Article, TavilyArticle

_executor = ThreadPoolExecutor(max_workers=4)


def _extract_single(result: TavilyArticle) -> Article | None:
    downloaded = trafilatura.fetch_url(str(result.url))
    if not downloaded:
        return None
    text = trafilatura.extract(downloaded, favor_recall=True, include_images=False, include_tables=False)
    if not text:
        return None
    return Article(
        title=result.title,
        url=result.url,
        text=text,
        snippet=result.snippet,
        published_time=result.published_time,
    )


def extract_articles(results: Iterable[TavilyArticle]) -> List[Article]:
    futures = list(_executor.map(_extract_single, results))
    return [article for article in futures if article]
