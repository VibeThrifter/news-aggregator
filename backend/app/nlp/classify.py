"""Event type classification for articles using LLM-based semantic analysis."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.app.llm.client import MistralClient

from backend.app.core.logging import get_logger
from backend.app.services.llm_config_service import get_llm_config_service

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


DEFAULT_CLASSIFICATION_PROMPT = """Classify this Dutch news article into ONE category.

Categories: legal, politics, crime, sports, international, business, entertainment, weather, other

Title: {title}
Content: {content}

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


async def _get_classification_prompt() -> str:
    """Load classification prompt from database, with fallback to default."""
    try:
        config_service = get_llm_config_service()
        db_value = await config_service.get_value("prompt_classification")
        if db_value and db_value.strip():
            return db_value
    except Exception as e:
        logger.warning("classification_prompt_db_load_failed", error=str(e))
    return DEFAULT_CLASSIFICATION_PROMPT


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

    # Load prompt template from database
    prompt_template = await _get_classification_prompt()
    prompt = prompt_template.replace("{title}", title).replace("{content}", content_excerpt)

    # Get temperature and max_tokens from config
    config_service = get_llm_config_service()
    temperature = await config_service.get_float("classification_temperature", default=0.1)
    max_tokens = await config_service.get_int("classification_max_tokens", default=20)

    try:
        response = await llm_client.generate_text(
            prompt=prompt,
            temperature=temperature,
            max_tokens=max_tokens,
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
