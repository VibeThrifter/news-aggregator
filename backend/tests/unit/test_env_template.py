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
    "LLM_PROVIDER",
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
