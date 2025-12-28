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
    rss_ad_url: str = Field(
        default="https://www.ad.nl/home/rss.xml",
        description="RSS feed URL for AD.nl news"
    )
    rss_rtl_url: str = Field(
        default="https://www.rtl.nl/rss.xml",
        description="RSS feed URL for RTL Nieuws"
    )
    rss_telegraaf_url: str = Field(
        default="https://www.telegraaf.nl/rss",
        description="RSS feed URL for De Telegraaf"
    )
    rss_volkskrant_url: str = Field(
        default="https://www.volkskrant.nl/voorpagina/rss.xml",
        description="RSS feed URL for de Volkskrant"
    )
    rss_parool_url: str = Field(
        default="https://www.parool.nl/voorpagina/rss.xml",
        description="RSS feed URL for Het Parool"
    )
    rss_anderekrant_url: str = Field(
        default="https://deanderekrant.nl/feed/",
        description="RSS feed URL for De Andere Krant"
    )
    rss_trouw_url: str = Field(
        default="https://www.trouw.nl/voorpagina/rss.xml",
        description="RSS feed URL for Trouw"
    )
    rss_geenstijl_url: str = Field(
        default="https://www.geenstijl.nl/feeds/recent.atom",
        description="Atom feed URL for GeenStijl"
    )
    rss_nieuwrechts_url: str = Field(
        default="https://nieuwrechts.nl/rss",
        description="RSS feed URL for NieuwRechts"
    )
    rss_ninefornews_url: str = Field(
        default="https://www.ninefornews.nl/feed/",
        description="RSS feed URL for NineForNews"
    )
    rss_eenblikopdenos_url: str = Field(
        default="https://xcancel.com/eenblikopdenos/rss",
        description="RSS feed URL for @eenblikopdenos via xcancel.com (fallback, requires whitelisting)"
    )

    # Twitter API Configuration (for @eenblikopdenos)
    twitter_api_key: str | None = Field(
        default=None,
        description="Twitter API Key (Consumer Key)"
    )
    twitter_api_secret: str | None = Field(
        default=None,
        description="Twitter API Secret (Consumer Secret)"
    )
    twitter_bearer_token: str | None = Field(
        default=None,
        description="Twitter API v2 Bearer Token for fetching tweets"
    )
    twitter_access_token: str | None = Field(
        default=None,
        description="Twitter Access Token (for user-level auth)"
    )
    twitter_access_secret: str | None = Field(
        default=None,
        description="Twitter Access Token Secret"
    )
    twitter_eenblikopdenos_user_id: str = Field(
        default="1636133602575499266",
        description="Twitter user ID for @eenblikopdenos account"
    )

    # Scheduler Configuration
    scheduler_interval_minutes: int = Field(
        default=15,
        ge=1,
        le=1440,
        description="Interval in minutes for RSS feed polling"
    )
    insight_backfill_interval_minutes: int = Field(
        default=15,
        ge=5,
        le=1440,
        description="Interval in minutes for backfilling missing LLM insights"
    )
    insight_backfill_batch_size: int = Field(
        default=30,
        ge=1,
        le=100,
        description="Maximum number of events to process per backfill run"
    )
    international_enrichment_interval_hours: int = Field(
        default=2,
        ge=1,
        le=24,
        description="Interval in hours for automatic international enrichment"
    )
    international_enrichment_batch_size: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Maximum number of events to enrich per scheduled run"
    )
    international_enrichment_max_per_country: int = Field(
        default=5,
        ge=1,
        le=10,
        description="Maximum articles to fetch per country during enrichment"
    )

    # Database Configuration
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/db.sqlite",
        description="SQLAlchemy database URL"
    )

    # ML and AI Configuration
    embedding_model_name: str = Field(
        default="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        description="Embedding model for article vectorization",
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
    llm_prompt_article_cap: int = Field(
        default=8,
        ge=3,
        le=20,
        description="Maximum number of articles included in an LLM prompt",
    )
    llm_prompt_max_characters: int = Field(
        default=20000,
        ge=2000,
        le=25000,
        description="Hard cap on character length for generated LLM prompts",
    )
    llm_model_name: str = Field(
        default="mistral-small-latest",
        description="Default model used for LLM insight generation",
    )
    llm_temperature: float = Field(
        default=0.2,
        ge=0.0,
        le=1.0,
        description="Sampling temperature applied to LLM requests",
    )
    llm_api_base_url: str = Field(
        default="https://api.mistral.ai/v1",
        description="Base URL for the configured LLM provider API",
    )
    llm_api_timeout_seconds: float = Field(
        default=120.0,
        ge=1.0,
        le=300.0,
        description="Request timeout (in seconds) for LLM API calls",
    )
    llm_api_max_retries: int = Field(
        default=3,
        ge=0,
        le=6,
        description="Maximum retry attempts for transient LLM API failures",
    )
    llm_api_retry_backoff_seconds: float = Field(
        default=2.0,
        ge=0.0,
        le=30.0,
        description="Base backoff delay (seconds) between LLM retry attempts",
    )

    # API Keys (optional, will be validated when needed)
    mistral_api_key: Optional[str] = Field(
        default=None,
        description="Mistral API key for LLM services"
    )
    deepseek_api_key: Optional[str] = Field(
        default=None,
        description="DeepSeek API key for critical analysis (higher quality reasoning)"
    )
    openai_api_key: Optional[str] = Field(
        default=None,
        description="OpenAI API key for LLM services"
    )
    tavily_api_key: Optional[str] = Field(
        default=None,
        description="Tavily API key for web search"
    )

    # DeepSeek Configuration
    deepseek_model_name: str = Field(
        default="deepseek-chat",
        description="DeepSeek model name"
    )
    deepseek_reasoner_model_name: str = Field(
        default="deepseek-reasoner",
        description="DeepSeek Reasoner model (R1) for deeper analysis"
    )
    deepseek_api_base_url: str = Field(
        default="https://api.deepseek.com/v1",
        description="Base URL for DeepSeek API"
    )
    deepseek_timeout_seconds: float = Field(
        default=300.0,
        ge=30.0,
        le=600.0,
        description="Request timeout for DeepSeek API (longer than default, DeepSeek is slow)"
    )

    # Gemini Configuration
    gemini_api_key: Optional[str] = Field(
        default=None,
        description="Google Gemini API key (free tier: 1500 requests/day)"
    )
    gemini_model_name: str = Field(
        default="gemini-2.5-flash",
        description="Gemini model name (gemini-2.5-flash for free tier)"
    )

    # Per-prompt LLM provider selection (toggle between mistral/deepseek)
    llm_provider_classification: str = Field(
        default="mistral",
        description="LLM provider for event type classification (mistral|deepseek)"
    )
    llm_provider_factual: str = Field(
        default="mistral",
        description="LLM provider for factual analysis phase (mistral|deepseek)"
    )
    llm_provider_critical: str = Field(
        default="deepseek",
        description="LLM provider for critical analysis phase (mistral|deepseek)"
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
    event_retention_days: int = Field(
        default=14,
        ge=1,
        le=90,
        description="Archive events that have been inactive beyond this many days",
    )
    event_maintenance_interval_hours: int = Field(
        default=24,
        ge=1,
        le=168,
        description="Interval in hours for periodic event maintenance tasks",
    )
    event_index_rebuild_on_drift: bool = Field(
        default=True,
        description="Trigger a full vector index rebuild when drift is detected",
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
    event_llm_enabled: bool = Field(
        default=True,
        description="Enable LLM-based final decision for event assignment from top candidates",
    )
    event_llm_top_n: int = Field(
        default=3,
        ge=1,
        le=10,
        description="Number of top-scoring candidates to present to LLM for final decision",
    )
    event_llm_min_score: float = Field(
        default=0.40,
        ge=0.0,
        le=1.0,
        description="Minimum score required for a candidate to be considered by LLM",
    )
    event_min_entity_overlap: float = Field(
        default=0.05,
        ge=0.0,
        le=1.0,
        description="Minimum entity overlap required to cluster articles (below this, force NEW_EVENT)",
    )
    event_low_entity_llm_threshold: float = Field(
        default=0.15,
        ge=0.0,
        le=1.0,
        description="Entity overlap below this always triggers LLM verification",
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
    def has_deepseek_key(self) -> bool:
        """Check if DeepSeek API key is available."""
        return bool(self.deepseek_api_key)

    @property
    def has_openai_key(self) -> bool:
        """Check if OpenAI API key is available."""
        return bool(self.openai_api_key)

    @property
    def has_tavily_key(self) -> bool:
        """Check if Tavily API key is available."""
        return bool(self.tavily_api_key)

    @property
    def has_gemini_key(self) -> bool:
        """Check if Gemini API key is available."""
        return bool(self.gemini_api_key)


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
