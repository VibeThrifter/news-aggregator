"""Service for per-sentence bias detection on individual articles (Epic 10)."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Article, ArticleBiasAnalysis
from backend.app.db.session import get_sessionmaker
from backend.app.llm.client import (
    BaseLLMClient,
    DeepSeekClient,
    GeminiClient,
    LLMGenericResult,
    LLMQuotaExhaustedError,
    LLMRateLimitError,
    LLMTimeoutError,
    MistralClient,
)
from backend.app.llm.schemas import BiasAnalysisPayload
from backend.app.repositories.bias_repo import BiasRepository
from backend.app.services.llm_config_service import get_llm_config_service

logger = get_logger(__name__).bind(component="BiasDetectionService")


@dataclass(slots=True)
class BiasAnalysisOutcome:
    """Return type describing stored bias analysis and associated payload."""

    analysis: ArticleBiasAnalysis
    created: bool
    payload: BiasAnalysisPayload


class BiasDetectionService:
    """Detect per-sentence bias in articles using LLM analysis."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        client: BaseLLMClient | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.session_factory = session_factory or get_sessionmaker()
        self.client = client or self._build_client()

    def _build_client(self, provider: str | None = None) -> BaseLLMClient:
        """Build an LLM client for the specified provider."""
        provider = (provider or self.settings.llm_provider or "mistral").lower()
        if provider == "mistral":
            return MistralClient(settings=self.settings)
        if provider == "deepseek":
            return DeepSeekClient(settings=self.settings, use_reasoner=False)
        if provider == "deepseek-r1":
            return DeepSeekClient(settings=self.settings, use_reasoner=True)
        if provider == "gemini":
            return GeminiClient(settings=self.settings)
        raise ValueError(f"LLM provider '{provider}' wordt nog niet ondersteund")

    async def _get_client_for_bias(self) -> BaseLLMClient:
        """Get the configured LLM client for bias detection."""
        config_service = get_llm_config_service()
        provider = await config_service.get_value("provider_bias", default="mistral")
        return self._build_client(provider)

    async def _get_prompt_template(self) -> str:
        """Get the bias detection prompt template from config."""
        config_service = get_llm_config_service()
        prompt = await config_service.get_value("prompt_bias_detection")
        if not prompt:
            raise ValueError("Bias detection prompt not found in llm_config")
        return prompt

    async def _call_with_fallback(
        self,
        client: BaseLLMClient,
        prompt: str,
        *,
        correlation_id: str | None = None,
    ) -> LLMGenericResult:
        """Call LLM with automatic Mistral fallback on rate limit or quota errors."""
        try:
            return await client.generate_json(
                prompt, BiasAnalysisPayload, correlation_id=correlation_id
            )
        except (LLMRateLimitError, LLMQuotaExhaustedError, LLMTimeoutError) as exc:
            if client.provider == "mistral":
                raise

            logger.warning(
                "llm_fallback_triggered",
                phase="bias_detection",
                original_provider=client.provider,
                fallback_provider="mistral",
                error_type=type(exc).__name__,
                error=str(exc),
                correlation_id=correlation_id,
            )

            fallback_client = MistralClient(settings=self.settings)
            return await fallback_client.generate_json(
                prompt, BiasAnalysisPayload, correlation_id=correlation_id
            )

    def _compute_summary_stats(
        self, payload: BiasAnalysisPayload
    ) -> dict[str, Any]:
        """Compute summary statistics from the bias analysis payload."""
        journalist_biases = payload.journalist_biases or []
        quote_biases = payload.quote_biases or []
        total = payload.total_sentences

        journalist_count = len(journalist_biases)
        quote_count = len(quote_biases)

        # Percentage of sentences with journalist bias
        journalist_percentage = (journalist_count / total * 100) if total > 0 else 0.0

        # Most frequent journalist bias type
        most_frequent_bias: str | None = None
        most_frequent_count: int | None = None
        if journalist_biases:
            bias_types = [b.bias_type for b in journalist_biases]
            counter = Counter(bias_types)
            most_common = counter.most_common(1)
            if most_common:
                most_frequent_bias, most_frequent_count = most_common[0]

        # Average journalist bias strength
        avg_strength: float | None = None
        if journalist_biases:
            avg_strength = sum(b.score for b in journalist_biases) / journalist_count

        # Overall rating: combines percentage and average strength
        # Lower score = more objective (0 = perfectly objective, 1 = heavily biased)
        if journalist_biases and avg_strength is not None:
            # Weight: 60% percentage-based, 40% strength-based
            pct_factor = min(journalist_percentage / 100, 1.0)  # Cap at 100%
            overall_rating = 0.6 * pct_factor + 0.4 * avg_strength
        else:
            overall_rating = 0.0

        return {
            "journalist_bias_count": journalist_count,
            "quote_bias_count": quote_count,
            "journalist_bias_percentage": round(journalist_percentage, 2),
            "most_frequent_bias": most_frequent_bias,
            "most_frequent_count": most_frequent_count,
            "average_bias_strength": round(avg_strength, 3) if avg_strength else None,
            "overall_rating": round(overall_rating, 3),
        }

    async def analyze_article(
        self,
        article_id: int,
        *,
        correlation_id: str | None = None,
    ) -> BiasAnalysisOutcome:
        """Analyze a single article for per-sentence bias.

        Args:
            article_id: The article to analyze
            correlation_id: Optional correlation ID for logging

        Returns:
            BiasAnalysisOutcome with the persisted analysis

        Raises:
            ValueError: If article not found or has no content
        """
        log = logger.bind(article_id=article_id, correlation_id=correlation_id)

        # Fetch article content
        async with self.session_factory() as session:
            article = await session.get(Article, article_id)
            if not article:
                raise ValueError(f"Article {article_id} not found")
            if not article.content or not article.content.strip():
                raise ValueError(f"Article {article_id} has no content")

            article_content = article.content

        log.info("bias_analysis_start", content_length=len(article_content))

        # Get client and prompt
        client = await self._get_client_for_bias()
        prompt_template = await self._get_prompt_template()

        # Build the prompt
        prompt = prompt_template.replace("{article_content}", article_content)

        log.info(
            "bias_analysis_calling_llm",
            provider=client.provider,
            prompt_length=len(prompt),
        )

        # Call LLM
        result = await self._call_with_fallback(
            client, prompt, correlation_id=correlation_id
        )
        payload: BiasAnalysisPayload = result.payload

        log.info(
            "bias_analysis_llm_complete",
            provider=result.provider,
            model=result.model,
            total_sentences=payload.total_sentences,
            journalist_biases=len(payload.journalist_biases),
            quote_biases=len(payload.quote_biases),
        )

        # Compute summary statistics
        stats = self._compute_summary_stats(payload)

        # Persist to database
        async with self.session_factory() as session:
            repo = BiasRepository(session)
            persistence = await repo.upsert_analysis(
                article_id=article_id,
                provider=result.provider,
                model=result.model,
                total_sentences=payload.total_sentences,
                journalist_bias_count=stats["journalist_bias_count"],
                quote_bias_count=stats["quote_bias_count"],
                journalist_bias_percentage=stats["journalist_bias_percentage"],
                most_frequent_bias=stats["most_frequent_bias"],
                most_frequent_count=stats["most_frequent_count"],
                average_bias_strength=stats["average_bias_strength"],
                overall_rating=stats["overall_rating"],
                journalist_biases=[b.model_dump(mode="json") for b in payload.journalist_biases],
                quote_biases=[b.model_dump(mode="json") for b in payload.quote_biases],
                raw_response=result.raw_content,
            )
            await session.commit()

        log.info(
            "bias_analysis_completed",
            article_id=article_id,
            provider=result.provider,
            created=persistence.created,
            overall_rating=stats["overall_rating"],
            journalist_biases=stats["journalist_bias_count"],
        )

        return BiasAnalysisOutcome(
            analysis=persistence.analysis,
            created=persistence.created,
            payload=payload,
        )

    async def analyze_batch(
        self,
        *,
        limit: int = 10,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        """Analyze articles that don't have bias analysis yet.

        Args:
            limit: Maximum number of articles to analyze
            correlation_id: Optional correlation ID for logging

        Returns:
            Statistics about the batch run
        """
        log = logger.bind(correlation_id=correlation_id, component="batch")

        # Find articles without analysis
        async with self.session_factory() as session:
            repo = BiasRepository(session)
            article_ids = await repo.get_articles_without_analysis(limit=limit)

        if not article_ids:
            log.info("batch_no_articles_needed")
            return {
                "articles_found": 0,
                "articles_analyzed": 0,
                "articles_failed": 0,
            }

        log.info("batch_starting", articles_to_analyze=len(article_ids))

        analyzed = 0
        failed = 0
        failed_ids: list[int] = []

        for article_id in article_ids:
            try:
                await self.analyze_article(article_id, correlation_id=correlation_id)
                analyzed += 1
                log.info("batch_article_completed", article_id=article_id)
            except Exception as exc:
                failed += 1
                failed_ids.append(article_id)
                log.warning(
                    "batch_article_failed",
                    article_id=article_id,
                    error=str(exc),
                )

        log.info(
            "batch_completed",
            articles_found=len(article_ids),
            articles_analyzed=analyzed,
            articles_failed=failed,
        )

        return {
            "articles_found": len(article_ids),
            "articles_analyzed": analyzed,
            "articles_failed": failed,
            "failed_article_ids": failed_ids if failed_ids else None,
        }


# Singleton instance
_service_instance: BiasDetectionService | None = None


def get_bias_detection_service() -> BiasDetectionService:
    """Get or create the singleton BiasDetectionService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = BiasDetectionService()
    return _service_instance


__all__ = ["BiasAnalysisOutcome", "BiasDetectionService", "get_bias_detection_service"]
