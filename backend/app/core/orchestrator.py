from __future__ import annotations

from datetime import datetime
from typing import Any

from backend.app.models import AggregationResponse, AggregateRequest
from backend.app.services.extractor import extract_articles
from backend.app.services.summarizer import summarize
from backend.app.services.tavily_client import TavilyService


async def build_aggregation(payload: AggregateRequest) -> AggregationResponse:
    query = payload.query.strip()
    if not query:
        raise ValueError("Query mag niet leeg zijn.")

    tavily = TavilyService()
    try:
        search_results = await tavily.search(query=query, max_results=payload.max_results)
    finally:
        await tavily.aclose()

    articles = extract_articles(search_results)
    if not articles:
        raise RuntimeError("Geen artikelen gevonden of extractie mislukt. Controleer de zoekterm en probeer opnieuw.")

    aggregation = summarize(query=query, articles=articles)
    aggregation.generated_at = datetime.utcnow()
    return aggregation
