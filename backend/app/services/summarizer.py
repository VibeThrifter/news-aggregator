from __future__ import annotations

import json
from datetime import datetime
from typing import Iterable, Sequence

import requests

from backend.app.config import get_settings
from backend.app.models import (
    AggregationResponse,
    Article,
    Cluster,
    ClusterSource,
    Contradiction,
    Fallacy,
    TimelineEvent,
)

_SYSTEM_PROMPT = (
    "Je bent een onderzoeksjournalist die pluriforme nieuwsduiding levert. "
    "Je krijgt artikelen over één gebeurtenis in Nederland. Analyseer ze en presenteer een neutrale tijdlijn, "
    "cluster meningen per invalshoek (mainstream, links, rechts, alternatief, overheid, sociale media), markeer tegenstrijdige claims en identificeer expliciete drogredeneringen. "
    "Reageer uitsluitend met geldig JSON volgens het opgegeven schema."
)

_TEMPLATE = """
Gebruikersvraag: {query}

Artikelen:
{articles}

Let op:
- Benoem alleen drogredeneringen als ze expliciet te onderbouwen zijn op basis van de bron en vermeld de bron(nen).
- Als je geen duidelijke drogredeneringen vindt, gebruik een lege lijst.
- Vermeld bij tegenstrijdige claims voor zowel bron A als bron B de titel en URL van het artikel waar de claim in staat.

Verplicht format:
{{
  "timeline": [{{"time": "HH:MM", "event": "..."}}],
  "clusters": [{{"angle": "...", "summary": "...", "sources": [{{"title": "...", "url": "..."}}]}}],
  "fallacies": [{{"type": "...", "claim": "...", "explanation": "...", "sources": [{{"title": "...", "url": "..."}}]}}],
  "contradictions": [{{"topic": "...", "claim_A": "...", "claim_B": "...", "status": "tegenstrijdig", "source_A": {{"title": "...", "url": "..."}}, "source_B": {{"title": "...", "url": "..."}}}}]
}}
"""


def _format_articles(articles: Sequence[Article], limit: int = 8, max_chars: int = 2000) -> str:
    blocks: list[str] = []
    for idx, article in enumerate(articles[:limit], start=1):
        text = article.text[:max_chars]
        blocks.append(
            f"[{idx}] {article.title} ({article.url})\nSnippet: {article.snippet or 'n.v.t.'}\nTekst: {text}"
        )
    return "\n\n".join(blocks)


def _call_openai(query: str, articles: Sequence[Article]) -> dict:
    settings = get_settings()
    openai = settings.openai
    payload = {
        "model": openai.model,
        "temperature": openai.temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _TEMPLATE.format(query=query, articles=_format_articles(articles)),
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {openai.api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        json=payload,
        headers=headers,
        timeout=45,
    )
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(f"OpenAI API-fout: {response.text}") from exc

    raw_content = response.json()["choices"][0]["message"]["content"]
    return _parse_json_response(raw_content, provider="openai")


def _call_mistral(query: str, articles: Sequence[Article]) -> dict:
    settings = get_settings()
    mistral = settings.mistral
    payload = {
        "model": mistral.model,
        "temperature": mistral.temperature,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _TEMPLATE.format(query=query, articles=_format_articles(articles)),
            },
        ],
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {mistral.api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(
        "https://api.mistral.ai/v1/chat/completions",
        json=payload,
        headers=headers,
        timeout=45,
    )
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(f"Mistral API-fout: {response.text}") from exc

    raw_content = response.json()["choices"][0]["message"]["content"]
    return _parse_json_response(raw_content, provider="mistral")


def _parse_json_response(raw_content: str, provider: str) -> dict:
    content = raw_content.strip()
    if content.startswith("```json") and content.endswith("```"):
        content = content[7:-3].strip()
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"{provider.capitalize()} antwoordde niet met geldig JSON. Controleer prompt of model."
        ) from exc
    data["__provider"] = provider
    return data


def _build_response(query: str, data: dict) -> AggregationResponse:
    timeline = [TimelineEvent(**event) for event in data.get("timeline", [])]
    clusters = [
        Cluster(
            angle=cluster.get("angle", "Onbekend"),
            summary=cluster.get("summary", ""),
            sources=[ClusterSource(**src) for src in cluster.get("sources", [])],
        )
        for cluster in data.get("clusters", [])
    ]
    fallacies = [
        Fallacy(
            type=item.get("type", "Onbekend"),
            claim=item.get("claim", ""),
            explanation=item.get("explanation", ""),
            sources=[ClusterSource(**src) for src in item.get("sources", [])],
        )
        for item in data.get("fallacies", [])
    ]
    contradictions = [
        Contradiction.model_validate(ct)
        for ct in data.get("contradictions", [])
    ]

    return AggregationResponse(
        query=query,
        generated_at=datetime.utcnow(),
        llm_provider=data.get("__provider"),
        timeline=timeline,
        clusters=clusters,
        fallacies=fallacies,
        contradictions=contradictions,
    )


def summarize(query: str, articles: Sequence[Article]) -> AggregationResponse:
    settings = get_settings()
    errors: list[str] = []

    if settings.has_openai:
        try:
            data = _call_openai(query, articles)
            return _build_response(query, data)
        except RuntimeError as exc:
            errors.append(str(exc))

    if settings.has_mistral:
        try:
            data = _call_mistral(query, articles)
            return _build_response(query, data)
        except RuntimeError as exc:
            errors.append(str(exc))

    if errors:
        raise RuntimeError("LLM-samenvatting mislukt: " + " | ".join(errors))

    raise RuntimeError(
        "Geen LLM-sleutel gevonden. Stel OPENAI_API_KEY of MISTRAL_API_KEY in en probeer opnieuw."
    )
