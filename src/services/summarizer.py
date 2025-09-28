from __future__ import annotations

from typing import Iterable, Sequence

from src.models import Article
from src.services.llm import ClusterLLMResult, MistralClient, derive_fallback_summary


class ClusterSummarizer:
    """Summarize and title clusters using Mistral when available."""

    def __init__(self, client: MistralClient | None = None):
        self.client = client or MistralClient()

    def summarize(
        self,
        *,
        topic: str,
        articles: Sequence[Article],
        key_terms: Iterable[str],
        clustering_method: str,
        mode: str,
    ) -> ClusterLLMResult:
        key_terms_list = list(key_terms)
        if self.client.available:
            try:
                llm_result = self.client.summarize_cluster(
                    topic=topic,
                    articles=articles,
                    key_terms=key_terms_list,
                    clustering_method=clustering_method,
                    mode=mode,
                )
                if llm_result:
                    cleaned_name = llm_result.name.replace("(", "").replace(")", "").strip()
                    cleaned_description = llm_result.description.replace("(", "").replace(")", "").strip()
                    return ClusterLLMResult(
                        name=cleaned_name,
                        description=cleaned_description,
                        raw=llm_result.raw,
                    )
            except RuntimeError as exc:
                return ClusterLLMResult(
                    name="",
                    description=str(exc),
                    raw=None,
                )
        return derive_fallback_summary(
            topic=topic,
            articles=articles,
            key_terms=key_terms_list,
            clustering_method=clustering_method,
            mode=mode,
        )
