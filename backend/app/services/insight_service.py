"""Service orchestrating prompt building, LLM calls, and insight persistence."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Event, LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.llm.client import (
    BaseLLMClient,
    DeepSeekClient,
    GeminiClient,
    LLMGenericResult,
    LLMQuotaExhaustedError,
    LLMRateLimitError,
    LLMResult,
    LLMTimeoutError,
    MistralClient,
)
from backend.app.llm.prompt_builder import PromptBuilder, PromptGenerationResult
from backend.app.llm.schemas import (
    CriticalPayload,
    FactualPayload,
    InsightsPayload,
    KeywordExtractionPayload,
)
from backend.app.repositories import InsightRepository
from backend.app.services.llm_config_service import get_llm_config_service

logger = get_logger(__name__).bind(component="InsightService")


def _extract_title_from_summary(summary: str) -> str | None:
    """Extract the title (first line) from an LLM-generated summary.

    The LLM generates summaries where the first line is a short title (max 60 chars)
    without punctuation, followed by a blank line and the actual content.

    Returns None if no valid title can be extracted.
    """
    if not summary:
        return None

    # Try to match: title\n\n (title without punctuation, followed by blank line)
    match = re.match(r"^([^\n.!?]+)\n\n", summary)
    if match:
        title = match.group(1).strip()
        # Validate: title should be reasonably short (max 80 chars to allow some flexibility)
        if 5 <= len(title) <= 80:
            return title

    # Fallback: try title with punctuation followed by blank line
    match = re.match(r"^([^\n]+[.!?])\s*\n\n", summary)
    if match:
        title = match.group(1).strip()
        if 5 <= len(title) <= 80:
            return title

    return None


@dataclass(slots=True)
class InsightGenerationOutcome:
    """Return type describing stored insights and associated payload."""

    insight: LLMInsight
    created: bool
    payload: InsightsPayload
    llm_result: LLMResult


class InsightService:
    """Generate LLM insights for events and persist them."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        prompt_builder: PromptBuilder | None = None,
        client: BaseLLMClient | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.session_factory = session_factory or get_sessionmaker()
        self.prompt_builder = prompt_builder or PromptBuilder(settings=self.settings)
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

    async def _get_client_for_phase(self, phase: str) -> BaseLLMClient:
        """Get the configured LLM client for a specific phase (factual/critical)."""
        config_service = get_llm_config_service()
        provider = await config_service.get_value(f"provider_{phase}", default="mistral")
        return self._build_client(provider)

    async def _call_with_fallback(
        self,
        client: BaseLLMClient,
        prompt: str,
        schema_class: type,
        *,
        phase: str,
        correlation_id: str | None = None,
    ) -> LLMGenericResult:
        """Call LLM with automatic Mistral fallback on rate limit or quota errors.

        If the primary provider fails due to rate limits, quota exhaustion, or
        timeouts after all retries, automatically falls back to Mistral.
        """
        try:
            return await client.generate_json(prompt, schema_class, correlation_id=correlation_id)
        except (LLMRateLimitError, LLMQuotaExhaustedError, LLMTimeoutError) as exc:
            # Don't fallback if already using Mistral
            if client.provider == "mistral":
                raise

            logger.warning(
                "llm_fallback_triggered",
                phase=phase,
                original_provider=client.provider,
                fallback_provider="mistral",
                error_type=type(exc).__name__,
                error=str(exc),
                correlation_id=correlation_id,
            )

            # Create Mistral client as fallback
            fallback_client = MistralClient(settings=self.settings)
            return await fallback_client.generate_json(
                prompt, schema_class, correlation_id=correlation_id
            )

    async def _extract_keywords_and_enrich(
        self,
        event_id: int,
        *,
        correlation_id: str | None = None,
    ) -> int:
        """Extract keywords via small LLM call and fetch international articles.

        This is Phase 0 of the efficient insight generation flow:
        1. Build lightweight keyword extraction prompt (no full articles)
        2. Call LLM to get search keywords + involved countries
        3. Store countries on event
        4. Call international enrichment service synchronously
        5. Return number of articles added

        Returns:
            Number of international articles added (0 if none or error)
        """
        log = logger.bind(event_id=event_id, correlation_id=correlation_id)

        try:
            # Build lightweight keyword extraction prompt
            keyword_prompt_result = await self.prompt_builder.build_keyword_extraction_prompt(event_id)

            log.info(
                "keyword_extraction_start",
                prompt_length=keyword_prompt_result.prompt_length,
            )

            # Use a fast/cheap provider for keyword extraction (Mistral is good for this)
            keyword_client = await self._get_client_for_phase("factual")  # Reuse factual provider

            keyword_result = await self._call_with_fallback(
                keyword_client,
                keyword_prompt_result.prompt,
                KeywordExtractionPayload,
                phase="keyword_extraction",
                correlation_id=correlation_id,
            )
            keyword_payload: KeywordExtractionPayload = keyword_result.payload

            log.info(
                "keyword_extraction_complete",
                keywords=keyword_payload.search_keywords,
                countries=[c.iso_code for c in keyword_payload.involved_countries],
            )

            # If no countries detected, skip enrichment
            if not keyword_payload.involved_countries:
                log.info("no_countries_detected_skipping_enrichment")
                return 0

            # Store countries on event for enrichment service
            async with self.session_factory() as session:
                event = await session.get(Event, event_id)
                if event:
                    event.detected_countries = [
                        c.iso_code for c in keyword_payload.involved_countries
                    ]
                    await session.commit()
                    log.info(
                        "countries_stored_on_event",
                        countries=event.detected_countries,
                    )

            # Import here to avoid circular imports
            from backend.app.services.international_enrichment import (
                get_international_enrichment_service,
            )

            enrichment_service = get_international_enrichment_service()

            # Pass extracted keywords directly to enrichment service
            result = await enrichment_service.enrich_event(
                event_id,
                search_keywords=keyword_payload.search_keywords,
                correlation_id=correlation_id,
            )

            log.info(
                "international_enrichment_complete",
                articles_added=result.articles_added,
                countries_fetched=result.countries_fetched,
            )

            return result.articles_added

        except Exception as exc:
            log.warning(
                "keyword_extraction_or_enrichment_failed",
                error=str(exc),
                error_type=type(exc).__name__,
            )
            # Don't fail the whole insight generation if enrichment fails
            return 0

    async def generate_for_event(
        self,
        event_id: int,
        *,
        correlation_id: str | None = None,
        skip_international_enrichment: bool = False,
    ) -> InsightGenerationOutcome:
        """Generate and persist insights for a specific event using 3-phase LLM calls.

        New efficient flow (Epic 9 optimization):
        1. Keyword extraction (small LLM call) - get search keywords + countries
        2. International enrichment (synchronous) - fetch articles from Google News
        3. Factual + Critical analysis (with all sources including international)

        Args:
            event_id: The event to generate insights for
            correlation_id: Optional correlation ID for logging
            skip_international_enrichment: Skip enrichment (used by scheduled jobs to avoid loops)
        """
        # Phase 0: Keyword extraction (lightweight LLM call for international search)
        international_added = 0
        if not skip_international_enrichment:
            international_added = await self._extract_keywords_and_enrich(
                event_id, correlation_id=correlation_id
            )

        # Get clients for each phase (may be different providers)
        factual_client = await self._get_client_for_phase("factual")
        critical_client = await self._get_client_for_phase("critical")

        # Phase 1: Factual analysis (now includes international articles if any were added)
        factual_package = await self.prompt_builder.build_factual_prompt_package(event_id, max_articles=None)
        prompt_metadata = self._build_prompt_metadata(factual_package)
        prompt_metadata["phase"] = "three_phase" if international_added > 0 else "two_phase"
        prompt_metadata["international_articles_added"] = international_added

        logger.info(
            "insight_generation_phase1_start",
            event_id=event_id,
            provider=factual_client.provider,
            international_articles=international_added,
            correlation_id=correlation_id,
        )
        factual_result = await self._call_with_fallback(
            factual_client,
            factual_package.prompt,
            FactualPayload,
            phase="factual",
            correlation_id=correlation_id,
        )
        factual_payload: FactualPayload = factual_result.payload

        logger.info(
            "insight_generation_phase1_complete",
            event_id=event_id,
            provider=factual_client.provider,
            summary_length=len(factual_payload.summary),
            correlation_id=correlation_id,
        )

        # Phase 2: Critical analysis (receives summary from phase 1)
        critical_package = await self.prompt_builder.build_critical_prompt_package(
            event_id,
            factual_summary=factual_payload.summary,
            max_articles=None,
        )

        logger.info(
            "insight_generation_phase2_start",
            event_id=event_id,
            provider=critical_client.provider,
            correlation_id=correlation_id,
        )
        critical_result = await self._call_with_fallback(
            critical_client,
            critical_package.prompt,
            CriticalPayload,
            phase="critical",
            correlation_id=correlation_id,
        )
        critical_payload: CriticalPayload = critical_result.payload

        logger.info(
            "insight_generation_phase2_complete",
            event_id=event_id,
            provider=critical_client.provider,
            authority_count=len(critical_payload.authority_analysis),
            correlation_id=correlation_id,
        )

        # Merge both payloads
        merged_payload = InsightsPayload.from_phases(factual_payload, critical_payload)
        payload_dict = merged_payload.model_dump(mode="json")

        # Update metadata with both phases (include provider info)
        prompt_metadata["factual_provider"] = factual_client.provider
        prompt_metadata["factual_model"] = factual_result.model
        prompt_metadata["critical_provider"] = critical_client.provider
        prompt_metadata["critical_model"] = critical_result.model
        prompt_metadata["model"] = critical_result.model  # backwards compat
        prompt_metadata["factual_prompt_length"] = factual_package.prompt_length
        prompt_metadata["critical_prompt_length"] = critical_package.prompt_length
        total_usage: dict[str, Any] = {}
        if factual_result.usage:
            for k, v in factual_result.usage.items():
                total_usage[f"factual_{k}"] = v
        if critical_result.usage:
            for k, v in critical_result.usage.items():
                total_usage[f"critical_{k}"] = v
        if total_usage:
            prompt_metadata["usage"] = total_usage

        # Create a synthetic LLMResult for backward compatibility
        llm_result = LLMResult(
            provider=critical_result.provider,
            model=critical_result.model,
            payload=merged_payload,
            raw_content=f"FACTUAL:\n{factual_result.raw_content}\n\nCRITICAL:\n{critical_result.raw_content}",
            usage=total_usage if total_usage else None,
        )

        # Store search_keywords in prompt_metadata BEFORE upsert (Epic 9)
        if merged_payload.search_keywords:
            prompt_metadata["search_keywords"] = merged_payload.search_keywords
            logger.info(
                "search_keywords_generated",
                event_id=event_id,
                keywords=merged_payload.search_keywords,
                correlation_id=correlation_id,
            )

        async with self.session_factory() as session:
            repo = InsightRepository(session)
            persistence = await repo.upsert_insight(
                event_id=event_id,
                provider=llm_result.provider,
                model=llm_result.model,
                prompt_metadata=prompt_metadata,
                summary=payload_dict.get("summary"),
                timeline=payload_dict.get("timeline", []),
                clusters=payload_dict.get("clusters", []),
                contradictions=payload_dict.get("contradictions", []),
                involved_countries=payload_dict.get("involved_countries", []),
                fallacies=payload_dict.get("fallacies", []),
                frames=payload_dict.get("frames", []),
                coverage_gaps=payload_dict.get("coverage_gaps", []),
                # Kritische analyse velden
                unsubstantiated_claims=payload_dict.get("unsubstantiated_claims", []),
                authority_analysis=payload_dict.get("authority_analysis", []),
                media_analysis=payload_dict.get("media_analysis", []),
                statistical_issues=payload_dict.get("statistical_issues", []),
                timing_analysis=payload_dict.get("timing_analysis"),
                scientific_plurality=payload_dict.get("scientific_plurality"),
                raw_response=llm_result.raw_content,
            )

            # Verify the saved insight matches the event_id
            if persistence.insight.event_id != event_id:
                await session.rollback()
                raise RuntimeError(
                    f"Data integrity error: insight was saved for event {persistence.insight.event_id} "
                    f"but should be for event {event_id}"
                )

            # Update event fields from LLM insights
            event = await session.get(Event, event_id)
            if event:
                # Update title with LLM-generated title (first line of summary)
                llm_title = _extract_title_from_summary(merged_payload.summary)
                if llm_title:
                    old_title = event.title
                    event.title = llm_title
                    logger.info(
                        "event_title_updated",
                        event_id=event_id,
                        old_title=old_title,
                        new_title=llm_title,
                        correlation_id=correlation_id,
                    )

                # Store detected countries for international enrichment (Epic 9)
                if merged_payload.involved_countries:
                    event.detected_countries = [
                        c.iso_code for c in merged_payload.involved_countries
                    ]
                    logger.info(
                        "event_countries_detected",
                        event_id=event_id,
                        countries=event.detected_countries,
                        correlation_id=correlation_id,
                    )

            await session.commit()

        logger.info(
            "insight_generation_completed",
            event_id=event_id,
            provider=llm_result.provider,
            model=llm_result.model,
            created=persistence.created,
            phases=2,
            correlation_id=correlation_id,
        )
        return InsightGenerationOutcome(
            insight=persistence.insight,
            created=persistence.created,
            payload=merged_payload,
            llm_result=llm_result,
        )

    @staticmethod
    def _build_prompt_metadata(package: PromptGenerationResult) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "selected_article_ids": package.selected_article_ids,
            "selected_count": package.selected_count,
            "total_articles": package.total_articles,
            "prompt_length": package.prompt_length,
        }
        return metadata

    async def backfill_missing_insights(
        self,
        *,
        limit: int = 10,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        """Generate insights for events that are missing them.

        This method is designed to be called periodically by a scheduler job
        to catch up on events that didn't get insights due to server restarts
        or other failures.

        Args:
            limit: Maximum number of events to process per run (rate limiting)
            correlation_id: Optional correlation ID for logging

        Returns:
            Statistics about the backfill run
        """
        log = logger.bind(correlation_id=correlation_id, component="backfill")

        # Find active events without insights, ordered by most recently updated first
        async with self.session_factory() as session:
            # Subquery to find event_ids that have insights
            insight_subq = select(LLMInsight.event_id).distinct().subquery()

            # Select active events without insights
            stmt = (
                select(Event.id)
                .outerjoin(insight_subq, Event.id == insight_subq.c.event_id)
                .where(
                    Event.archived_at.is_(None),  # Only active events
                    insight_subq.c.event_id.is_(None),  # No insight exists
                )
                .order_by(Event.last_updated_at.desc())  # Most recent first
                .limit(limit)
            )
            result = await session.execute(stmt)
            event_ids: list[int] = [row[0] for row in result.fetchall()]

        if not event_ids:
            log.info("backfill_no_events_needed")
            return {
                "events_found": 0,
                "events_processed": 0,
                "events_failed": 0,
            }

        log.info("backfill_starting", events_to_process=len(event_ids))

        processed = 0
        failed = 0
        failed_ids: list[int] = []

        for event_id in event_ids:
            try:
                await self.generate_for_event(event_id, correlation_id=correlation_id)
                processed += 1
                log.info("backfill_event_completed", event_id=event_id)
            except Exception as exc:
                failed += 1
                failed_ids.append(event_id)
                log.warning(
                    "backfill_event_failed",
                    event_id=event_id,
                    error=str(exc),
                )

        log.info(
            "backfill_completed",
            events_found=len(event_ids),
            events_processed=processed,
            events_failed=failed,
        )

        return {
            "events_found": len(event_ids),
            "events_processed": processed,
            "events_failed": failed,
            "failed_event_ids": failed_ids if failed_ids else None,
        }


__all__ = ["InsightGenerationOutcome", "InsightService"]
