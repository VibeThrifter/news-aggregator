from __future__ import annotations

from typing import List, Optional

import httpx

from backend.app.config import get_settings
from backend.app.models import TavilyArticle


class TavilyService:
    def __init__(self) -> None:
        self._settings = get_settings().tavily
        self._client = httpx.AsyncClient(
            base_url="https://api.tavily.com",
            timeout=httpx.Timeout(20.0, read=20.0),
        )

    async def search(self, query: str, max_results: Optional[int] = None) -> List[TavilyArticle]:
        payload = {
            "api_key": self._settings.api_key,
            "query": query,
            "max_results": max_results or self._settings.max_results,
            "search_depth": self._settings.search_depth,
        }
        response = await self._client.post("/search", json=payload)
        response.raise_for_status()
        data = response.json()
        articles: List[TavilyArticle] = []
        for item in data.get("results", []):
            try:
                articles.append(
                    TavilyArticle(
                        title=item.get("title") or "Onbekende titel",
                        url=item["url"],
                        snippet=item.get("snippet"),
                        published_time=item.get("published_time"),
                    )
                )
            except Exception:
                continue
        return articles

    async def aclose(self) -> None:
        await self._client.aclose()
