"""
Configuration module for News Aggregator backend.

This module provides the Settings class that loads and validates environment variables
according to the Story 0.3 requirements. It uses Pydantic BaseSettings for type validation
and default value handling.
"""

from __future__ import annotations

import sys
from typing import Optional

from pydantic import Field, ValidationError, ConfigDict
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    This class follows the Architecture.md patterns for configuration management
    and provides type-safe access to all required application settings.
    """

    # RSS Feed Configuration
    rss_nos_url: str = Field(
        default="https://feeds.nos.nl/nosnieuwsalgemeen",
        description="RSS feed URL for NOS news"
    )
    rss_nunl_url: str = Field(
        default="https://www.nu.nl/rss/Algemeen",
        description="RSS feed URL for NU.nl news"
    )

    # Scheduler Configuration
    scheduler_interval_minutes: int = Field(
        default=15,
        ge=1,
        le=1440,
        description="Interval in minutes for RSS feed polling"
    )

    # Database Configuration
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/db.sqlite",
        description="SQLAlchemy database URL"
    )

    # ML and AI Configuration
    embedding_model_name: str = Field(
        default="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        description="Name of the embedding model for article vectorization"
    )
    embedding_dimension: int = Field(
        default=384,
        ge=64,
        le=2048,
        description="Dimensionality of article embeddings used throughout event detection",
    )
    model_cache_dir: str = Field(
        default="data/models",
        description="Directory where ML models and caches are stored",
    )
    tfidf_cache_path: str = Field(
        default="data/models/tfidf_vectorizer.joblib",
        description="File path for persisted TF-IDF vectorizer",
    )
    tfidf_max_features: int = Field(
        default=6000,
        ge=500,
        le=20000,
        description="Maximum features retained by the TF-IDF vectorizer",
    )
    spacy_model_name: str = Field(
        default="nl_core_news_lg",
        description="spaCy model used for Dutch NLP tasks",
    )

    # LLM Provider Configuration
    llm_provider: str = Field(
        default="mistral",
        description="Primary LLM provider (mistral, openai)"
    )

    # API Keys (optional, will be validated when needed)
    mistral_api_key: Optional[str] = Field(
        default=None,
        description="Mistral API key for LLM services"
    )
    openai_api_key: Optional[str] = Field(
        default=None,
        description="OpenAI API key for LLM services"
    )
    tavily_api_key: Optional[str] = Field(
        default=None,
        description="Tavily API key for web search"
    )

    # Logging Configuration
    log_level: str = Field(
        default="INFO",
        description="Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)"
    )

    # Event Detection / Vector Index Configuration
    vector_index_path: str = Field(
        default="data/vector_index.bin",
        description="Filesystem path to the persisted hnswlib index",
    )
    vector_index_metadata_path: str = Field(
        default="data/vector_index.meta.json",
        description="Path for JSON metadata describing the vector index",
    )
    vector_index_max_elements: int = Field(
        default=20000,
        ge=1024,
        le=200000,
        description="Initial capacity for the vector index graph",
    )
    vector_index_m: int = Field(
        default=16,
        ge=4,
        le=64,
        description="hnswlib M parameter controlling graph connectivity",
    )
    vector_index_ef_construction: int = Field(
        default=200,
        ge=32,
        le=800,
        description="hnswlib ef_construction parameter for build accuracy",
    )
    vector_index_ef_search: int = Field(
        default=64,
        ge=16,
        le=512,
        description="hnswlib ef_search parameter balancing latency and recall",
    )
    event_candidate_top_k: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Maximum number of candidate events returned per query",
    )
    event_candidate_time_window_days: int = Field(
        default=7,
        ge=1,
        le=60,
        description="Only events updated within this window are considered active",
    )
    event_score_weight_embedding: float = Field(
        default=0.6,
        ge=0.0,
        le=1.0,
        description="Weight applied to embedding cosine similarity when scoring events",
    )
    event_score_weight_tfidf: float = Field(
        default=0.3,
        ge=0.0,
        le=1.0,
        description="Weight applied to TF-IDF cosine similarity when scoring events",
    )
    event_score_weight_entities: float = Field(
        default=0.1,
        ge=0.0,
        le=1.0,
        description="Weight applied to entity overlap when scoring events",
    )
    event_score_threshold: float = Field(
        default=0.82,
        ge=0.0,
        le=1.0,
        description="Minimum hybrid score required to link an article to an existing event",
    )
    event_score_time_decay_half_life_hours: float = Field(
        default=48.0,
        ge=0.0,
        le=168.0,
        description="Half-life in hours for time decay applied to stale events (0 disables)",
    )
    event_score_time_decay_floor: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="Lower bound for the time decay multiplier to prevent scores dropping to zero",
    )

    # CORS Configuration
    frontend_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        description="Comma-separated list of allowed frontend origins"
    )

    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        protected_namespaces=("settings_",),
    )

    @property
    def allowed_origins(self) -> list[str]:
        """Parse frontend_origins into a list of allowed CORS origins."""
        return [origin.strip() for origin in self.frontend_origins.split(",") if origin.strip()]

    @property
    def has_mistral_key(self) -> bool:
        """Check if Mistral API key is available."""
        return bool(self.mistral_api_key)

    @property
    def has_openai_key(self) -> bool:
        """Check if OpenAI API key is available."""
        return bool(self.openai_api_key)

    @property
    def has_tavily_key(self) -> bool:
        """Check if Tavily API key is available."""
        return bool(self.tavily_api_key)


def get_settings() -> Settings:
    """
    Get application settings instance.

    This function instantiates the Settings class and handles validation errors
    according to the Architecture.md Error Handling Strategy.

    Returns:
        Settings: Validated application settings

    Raises:
        ValidationError: If required environment variables are missing or invalid
    """
    try:
        return Settings()
    except ValidationError as e:
        # Log validation error details for debugging
        print(f"Configuration validation error: {e}", file=sys.stderr)
        raise


def validate_env_cli() -> None:
    """
    CLI command to validate environment configuration.

    This function can be called via: python -m backend.app.core.config --check
    """
    try:
        settings = get_settings()
        print("✅ Environment configuration is valid")
        print(f"Database URL: {settings.database_url}")
        print(f"RSS polling interval: {settings.scheduler_interval_minutes} minutes")
        print(f"LLM provider: {settings.llm_provider}")
        print(f"Mistral API key: {'✅ Set' if settings.has_mistral_key else '❌ Not set'}")
        print(f"OpenAI API key: {'✅ Set' if settings.has_openai_key else '❌ Not set'}")
        print(f"Tavily API key: {'✅ Set' if settings.has_tavily_key else '❌ Not set'}")
        print(f"Log level: {settings.log_level}")
    except ValidationError as e:
        print("❌ Environment configuration is invalid:")
        for error in e.errors():
            field = ".".join(str(loc) for loc in error["loc"])
            print(f"  - {field}: {error['msg']}")
        sys.exit(1)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Configuration validation utility")
    parser.add_argument("--check", action="store_true", help="Validate environment configuration")

    args = parser.parse_args()

    if args.check:
        validate_env_cli()
    else:
        parser.print_help()
