"""Event type classification for articles using LLM-based semantic analysis."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.app.llm.client import MistralClient

from backend.app.core.logging import get_logger

logger = get_logger(__name__)

# Valid event type categories
VALID_EVENT_TYPES = [
    "legal",
    "politics",
    "crime",
    "sports",
    "international",
    "business",
    "entertainment",
    "weather",
    "other",
]


async def classify_event_type_llm(
    title: str,
    content: str,
    llm_client: "MistralClient",
) -> str:
    """
    Classify article into event type using LLM semantic analysis.

    Args:
        title: Article title
        content: Article content (first 600 chars will be used)
        llm_client: Mistral LLM client instance

    Returns:
        Event type string from VALID_EVENT_TYPES (defaults to "other" on error)
    """
    # Truncate content to avoid excessive token usage
    content_excerpt = content[:600] if content else ""

    prompt = f"""Classify this Dutch news article into ONE category.

Categories: legal, politics, crime, sports, international, business, entertainment, weather, other

Title: {title}
Content: {content_excerpt}

Rules:
- legal: court cases, lawsuits, legal proceedings, judges (NOT crimes)
- crime: murders, robberies, violence, arrests, investigations
- politics: government, elections, ministers, parliament, parties
- sports: all sports, competitions, races, training, athletes
- entertainment: culture, celebrities, restaurants, arts, music, film, royal family
- international: foreign affairs, global events, international conflicts
- business: economy, companies, markets, stocks, banking
- weather: storms, forecasts, climate events, temperature
- other: if uncertain or doesn't fit categories above

Respond with ONLY the category name in lowercase, nothing else."""

    try:
        response = await llm_client.generate_text(
            prompt=prompt,
            temperature=0.1,  # Low temperature for consistent classification
            max_tokens=20,
        )

        classification = response.content.strip().lower()

        # Validate classification is one of the allowed types
        if classification in VALID_EVENT_TYPES:
            return classification

        logger.warning(
            "llm_classification_invalid",
            classification=classification,
            title=title[:100],
            note="Falling back to 'other'",
        )
        return "other"

    except Exception as e:
        logger.warning(
            "llm_classification_failed",
            error=str(e),
            title=title[:100],
            note="Falling back to 'other'",
        )
        return "other"


__all__ = ["classify_event_type_llm", "VALID_EVENT_TYPES"]
