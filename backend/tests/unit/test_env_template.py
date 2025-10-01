"""Tests for the environment template configuration."""

from pathlib import Path
from dotenv import dotenv_values


REQUIRED_KEYS: tuple[str, ...] = (
    "MISTRAL_API_KEY",
    "RSS_NOS_URL",
    "RSS_NUNL_URL",
    "SCHEDULER_INTERVAL_MINUTES",
    "DATABASE_URL",
    "EMBEDDING_MODEL_NAME",
    "EMBEDDING_DIMENSION",
    "MODEL_CACHE_DIR",
    "TFIDF_CACHE_PATH",
    "TFIDF_MAX_FEATURES",
    "SPACY_MODEL_NAME",
    "LLM_PROVIDER",
    "VECTOR_INDEX_PATH",
    "VECTOR_INDEX_METADATA_PATH",
    "VECTOR_INDEX_MAX_ELEMENTS",
    "VECTOR_INDEX_M",
    "VECTOR_INDEX_EF_CONSTRUCTION",
    "VECTOR_INDEX_EF_SEARCH",
    "EVENT_CANDIDATE_TOP_K",
    "EVENT_CANDIDATE_TIME_WINDOW_DAYS",
    "EVENT_RETENTION_DAYS",
    "EVENT_MAINTENANCE_INTERVAL_HOURS",
    "EVENT_INDEX_REBUILD_ON_DRIFT",
    "EVENT_SCORE_WEIGHT_EMBEDDING",
    "EVENT_SCORE_WEIGHT_TFIDF",
    "EVENT_SCORE_WEIGHT_ENTITIES",
    "EVENT_SCORE_THRESHOLD",
    "EVENT_SCORE_TIME_DECAY_HALF_LIFE_HOURS",
    "EVENT_SCORE_TIME_DECAY_FLOOR",
    "LOG_LEVEL",
)


def test_env_example_contains_required_keys() -> None:
    """Ensure `.env.example` defines all required keys with placeholder values."""
    # Arrange
    project_root = Path(__file__).resolve().parents[3]
    env_path = project_root / ".env.example"

    # Act
    values: dict[str, str | None] = dotenv_values(str(env_path))
    missing_keys = {key for key in REQUIRED_KEYS if key not in values}
    empty_keys = {
        key
        for key in REQUIRED_KEYS
        if not (values.get(key) or "").strip()
    }

    # Assert
    assert env_path.exists(), "The `.env.example` template is missing at the repository root."
    assert not missing_keys, (
        "The environment template is missing required keys: "
        f"{', '.join(sorted(missing_keys))}."
    )
    assert not empty_keys, (
        "The environment template contains empty placeholders for: "
        f"{', '.join(sorted(empty_keys))}."
    )
