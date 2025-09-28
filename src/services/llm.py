from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Iterable, Sequence

import requests

from src.models import Article


DEFAULT_MISTRAL_MODEL = os.getenv("MISTRAL_MODEL", "mistral-small-latest")


@dataclass
class ClusterLLMResult:
    name: str
    description: str
    raw: str | None = None


class MistralClient:
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or os.getenv("MISTRAL_API_KEY")
        self.model = model or DEFAULT_MISTRAL_MODEL

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def _build_prompt(
        self,
        *,
        topic: str,
        articles: Sequence[Article],
        key_terms: Iterable[str],
        clustering_method: str,
        mode: str,
    ) -> str:
        lines = [
            "Je bent een media-analist die clusters van Nederlandse nieuwsbronnen samenvat.",
            "Vat de gedeelde invalshoek in een vloeiende alinea samen, benoem bronsoorten en politieke kleur.",
            "Geef een korte naam voor het cluster (maximaal 6 woorden) zonder haakjes en schrijf een beschrijving van maximaal 80 woorden.",
            "Vermijd het opsommen van losse woorden en gebruik geen haakjes.",
            "Gebruik de input, maar hallucineer geen feiten.",
            "",
            f"Onderwerp: {topic}",
            f"Clustering-methode: {clustering_method} | Modus: {mode}",
        ]
        if key_terms:
            terms = ", ".join(key_terms)
            lines.append(f"Belangrijkste termen: {terms}")
        lines.append("Bronnen:")
        for article in articles:
            lines.append(
                "- {source} ({medium}, {spectrum}): {title} — {summary}".format(
                    source=article.source_name,
                    medium=article.medium,
                    spectrum=article.political_spectrum,
                    title=article.title,
                    summary=article.summary,
                )
            )
        lines.append(
            "Antwoord als JSON met sleutels 'name' en 'description', zonder extra tekst."
        )
        return "\n".join(lines)

    def summarize_cluster(
        self,
        *,
        topic: str,
        articles: Sequence[Article],
        key_terms: Iterable[str],
        clustering_method: str,
        mode: str,
    ) -> ClusterLLMResult | None:
        if not self.available:
            return None
        prompt = self._build_prompt(
            topic=topic,
            articles=articles,
            key_terms=key_terms,
            clustering_method=clustering_method,
            mode=mode,
        )
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "Je bent een behulpzame assistent."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.4,
        }
        try:
            response = requests.post(
                "https://api.mistral.ai/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover
            detail = ""
            try:
                detail = f" (status {response.status_code}: {response.text})"
            except Exception:
                pass
            raise RuntimeError(f"Mistral API gaf een fout terug{detail}") from exc
        except requests.RequestException as exc:  # pragma: no cover
            raise RuntimeError("Kon Mistral API niet bereiken") from exc
        try:
            data = response.json()
            content = data["choices"][0]["message"]["content"]

            # Handle markdown-wrapped JSON responses
            if content.strip().startswith("```json") and content.strip().endswith("```"):
                # Extract JSON from markdown code block
                json_start = content.find("```json") + 7
                json_end = content.rfind("```")
                json_content = content[json_start:json_end].strip()
            else:
                json_content = content.strip()

            parsed = json.loads(json_content)
            name = parsed.get("name", "")
            description = parsed.get("description", "")
            if not name or not description:
                return None
            return ClusterLLMResult(name=name.strip(), description=description.strip(), raw=content)
        except Exception:  # pragma: no cover - malformed response
            return None


def derive_fallback_summary(
    *,
    topic: str,
    articles: Sequence[Article],
    key_terms: Iterable[str],
    clustering_method: str,
    mode: str,
) -> ClusterLLMResult:
    from collections import Counter

    return ClusterLLMResult(
        name="",
        description=(
            "Mistral-samenvatting niet beschikbaar. Controleer je netwerkverbinding of API-sleutel. "
            "Een geldige MISTRAL_API_KEY in je .env levert automatisch de beschrijvingen op."
        ),
    )
