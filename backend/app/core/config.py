"""
Configuration module for News Aggregator backend.

This module provides the Settings class that loads and validates environment variables
according to the Story 0.3 requirements. It uses Pydantic BaseSettings for type validation
and default value handling.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from pydantic import Field, ValidationError, ConfigDict, field_validator
from pydantic_settings import BaseSettings

# Repository root (backend/app/core/config.py -> parents[3]).
REPO_ROOT = Path(__file__).resolve().parents[3]
# Story 11.17: the propaganda-model project lives next to this repository.
DEFAULT_PROPAGANDA_DB_PATH = REPO_ROOT.parent / "propaganda-model" / "data" / "propaganda_model.db"


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

    # Bias Analysis Scheduler Configuration (Epic 10)
    bias_analysis_scheduler_enabled: bool = Field(
        default=False,
        description="Enable scheduled bias analysis job (default disabled to save LLM costs)"
    )
    bias_analysis_interval_hours: int = Field(
        default=6,
        ge=1,
        le=24,
        description="Interval in hours for scheduled bias analysis"
    )
    bias_analysis_batch_size: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Maximum number of articles to analyze per scheduled run"
    )

    # Foreign article digest (Epic 11, "Wat schreef …?"): Google News only gives the headline,
    # so the text is fetched from the publisher and the LLM stores a Dutch gist
    article_digest_enabled: bool = Field(
        default=True,
        description="Scheduled job that fetches foreign article texts and stores a Dutch LLM gist"
    )
    article_digest_interval_minutes: int = Field(
        default=15,
        ge=5,
        le=1440,
        description="Interval in minutes for the article digest job"
    )
    article_digest_batch_size: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Maximum number of foreign articles to digest per scheduled run"
    )
    article_digest_max_age_hours: int = Field(
        default=72,
        ge=1,
        le=720,
        description="The scheduled job only digests foreign articles added in the last N hours "
        "(older ones via POST /admin/trigger/article-digests)"
    )
    article_digest_text_chars: int = Field(
        default=6000,
        ge=500,
        le=20000,
        description="Characters of article text sent to the LLM"
    )

    # Stemmen zoeken (Epic 14, Story 14.10): AI search for a voice that is missing, queued by the
    # admin in the app (table voice_searches, migration 009)
    voice_search_enabled: bool = Field(
        default=True,
        description="Scheduled job that runs the AI searches for missing voices queued in the app"
    )
    voice_search_interval_minutes: int = Field(
        default=1,
        ge=1,
        le=60,
        description="Interval in minutes for the voice search job (it only works when a search is queued)"
    )
    voice_search_batch_size: int = Field(
        default=2,
        ge=1,
        le=10,
        description="Maximum number of queued searches per scheduled run"
    )

    # Database Configuration
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/db.sqlite",
        description="SQLAlchemy database URL (Supabase PostgreSQL in production)"
    )

    # Local SQLite Cache Configuration (Story INFRA-1: Egress Optimization)
    backend_read_source: str = Field(
        default="supabase",
        description="Where backend reads data from: 'sqlite' (local cache) or 'supabase' (cloud)"
    )
    sqlite_cache_path: str = Field(
        default="data/local_cache.db",
        description="Path to local SQLite cache database for backend reads"
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

    # Exploration / Onderzoeksmodus (Epic 11, Story 11.8)
    exploration_enabled: bool = Field(
        default=True,
        description="Precompute event entities and related events for the exploration UI",
    )
    exploration_entities_max_per_event: int = Field(
        default=40,
        ge=1,
        le=200,
        description="Maximum number of canonical entities stored per event",
    )
    related_events_top_k: int = Field(
        default=12,
        ge=1,
        le=50,
        description="Maximum number of related events stored per event",
    )
    related_events_min_score: float = Field(
        default=0.30,
        ge=0.0,
        le=1.0,
        description="Minimum relation score for a related event to be stored",
    )
    related_events_weight_embedding: float = Field(
        default=0.55,
        ge=0.0,
        le=1.0,
        description="Weight of centroid cosine similarity in the relation score",
    )
    related_events_weight_entities: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="Weight of idf-weighted entity overlap in the relation score",
    )
    related_events_weight_countries: float = Field(
        default=0.10,
        ge=0.0,
        le=1.0,
        description="Weight of detected-country Jaccard overlap in the relation score",
    )
    exploration_refresh_timeout_seconds: int = Field(
        default=300,
        ge=10,
        le=3600,
        description="Timeout for the exploration refresh that runs after event maintenance",
    )

    # Propagandamodel-koppeling (Epic 11, Story 11.17)
    propaganda_db_path: str = Field(
        default=str(DEFAULT_PROPAGANDA_DB_PATH),
        description=(
            "Path to the propaganda-model SQLite database (opened read-only). Relative paths "
            "are resolved from the repository root; empty means the sibling default."
        ),
    )
    propaganda_sync_enabled: bool = Field(
        default=True,
        description="Sync the approved propaganda-model graph to the pm_* tables",
    )
    propaganda_sync_interval_minutes: int = Field(
        default=60,
        ge=5,
        le=1440,
        description="Interval of the propaganda-model sync job (only syncs when the file changed)",
    )

    # Wie is dit? (Epic 12): research of named entities by the propaganda-model agents
    entity_research_enabled: bool = Field(
        default=True,
        description="Triage names in the news and queue research targets in the propaganda model",
    )
    entity_research_interval_minutes: int = Field(
        default=15,
        ge=5,
        le=1440,
        description="Interval of the entity research job (triage, queue, status, rounds)",
    )
    entity_research_lookback_days: int = Field(
        default=7,
        ge=1,
        le=90,
        description="Only names of events updated within this many days are triaged automatically",
    )
    entity_research_min_pm_relations: int = Field(
        default=3,
        ge=1,
        le=50,
        description="Names with fewer approved propaganda-model relations are researched",
    )
    entity_research_auto_threshold: float = Field(
        default=60.0,
        ge=0.0,
        le=200.0,
        description="Minimum priority for automatic research (without a tap in the app)",
    )
    entity_research_daily_targets: int = Field(
        default=12,
        ge=0,
        le=500,
        description="Maximum automatic research targets queued per day",
    )
    entity_research_daily_requests: int = Field(
        default=30,
        ge=0,
        le=500,
        description="Maximum research targets per day that come from taps in the app",
    )
    entity_research_cooldown_days: int = Field(
        default=30,
        ge=1,
        le=365,
        description="Days after which a name with still too few relations may be researched again",
    )
    entity_research_max_articles: int = Field(
        default=4,
        ge=1,
        le=20,
        description="Articles read per person for role cues (only the first 6000 characters)",
    )
    entity_research_triage_batch: int = Field(
        default=200,
        ge=10,
        le=5000,
        description="Maximum names triaged per run",
    )
    pm_api_base_url: str = Field(
        # 127.0.0.1, not localhost: on macOS "localhost" may resolve to ::1 first, where port 5000
        # belongs to the AirPlay receiver (httpx then hangs); the pm server listens on IPv4
        default="http://127.0.0.1:5000",
        description="Base URL of the local propaganda-model server (REST API)",
    )
    pm_agent_token_path: str = Field(
        default="",
        description=(
            "Token file of the propaganda-model account nieuws-agent; empty means "
            "<propaganda-model>/data/tokens/nieuws-agent.token"
        ),
    )
    nieuws_scout_enabled: bool = Field(
        default=True,
        description="Start research rounds of the propaganda-model agent nieuws-scout",
    )
    nieuws_scout_max_rounds_per_day: int = Field(
        default=4,
        ge=0,
        le=48,
        description="Maximum research rounds per day (each round is a Claude session)",
    )
    nieuws_scout_min_minutes_between_rounds: int = Field(
        default=30,
        ge=5,
        le=1440,
        description="Minimum minutes between two research rounds",
    )
    nieuws_scout_active_start_hour: int = Field(
        default=8, ge=0, le=23, description="Research rounds only from this local hour"
    )
    nieuws_scout_active_end_hour: int = Field(
        default=22, ge=1, le=24, description="Research rounds only until this local hour"
    )
    nieuws_scout_model: str = Field(default="opus", description="Model of the research agent")
    nieuws_scout_effort: str = Field(default="high", description="Effort of the research agent")
    nieuws_scout_timeout_seconds: int = Field(
        default=2700, ge=300, le=14400, description="Hard timeout of one research round"
    )
    nieuws_scout_python: str = Field(
        default="python3", description="Python used to run the propaganda-model scripts"
    )
    nieuws_scout_claude_bin: str = Field(
        default="claude", description="Claude CLI used by the propaganda-model agent runner"
    )
    pm_autokeur_enabled: bool = Field(
        default=True,
        description=(
            "Run the propaganda-model auto-approval after a research round (owner decision "
            "2026-09-30; the propaganda model enforces its own gates and kill switch)"
        ),
    )

    # Dun bewijs (Epic 14, Story 14.13): evidence research for thin propaganda-model links
    evidence_research_enabled: bool = Field(
        default=True,
        description=(
            "Queue thin links that readers see under 'Wie zit erachter?' as research targets in "
            "the propaganda model and pull the outcome (requires migration 011)"
        ),
    )
    evidence_research_interval_minutes: int = Field(
        default=15,
        ge=5,
        le=1440,
        description="Interval of the evidence research job (status, queue, rounds)",
    )
    evidence_research_daily_targets: int = Field(
        default=6,
        ge=0,
        le=200,
        description="Maximum links queued for evidence research per day",
    )
    evidence_research_request_window_days: int = Field(
        default=7,
        ge=1,
        le=90,
        description="Only links requested by the app within this many days are queued",
    )
    evidence_research_cooldown_days: int = Field(
        default=30,
        ge=1,
        le=365,
        description="Days after which a link that is still thin may be researched again",
    )
    nieuws_bewijs_enabled: bool = Field(
        default=False,
        description=(
            "Start rounds of the propaganda-model agent nieuws-bewijs (each round is a Claude "
            "session); off until the owner switches it on"
        ),
    )
    nieuws_bewijs_max_rounds_per_day: int = Field(
        default=2,
        ge=0,
        le=24,
        description="Maximum evidence research rounds per day (each round is a Claude session)",
    )
    nieuws_bewijs_min_minutes_between_rounds: int = Field(
        default=60,
        ge=5,
        le=1440,
        description="Minimum minutes between two evidence research rounds",
    )
    nieuws_bewijs_model: str = Field(default="opus", description="Model of the evidence agent")
    nieuws_bewijs_effort: str = Field(default="high", description="Effort of the evidence agent")
    nieuws_bewijs_timeout_seconds: int = Field(
        default=2700, ge=300, le=14400, description="Hard timeout of one evidence research round"
    )

    @field_validator("propaganda_db_path", mode="before")
    @classmethod
    def _resolve_propaganda_db_path(cls, value: object) -> str:
        """Empty -> sibling default; relative -> resolved from the repository root."""

        raw = str(value).strip() if value is not None else ""
        if not raw:
            return str(DEFAULT_PROPAGANDA_DB_PATH)
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = (REPO_ROOT / path).resolve()
        return str(path)

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
    def propaganda_project_dir(self) -> Path:
        """Root of the propaganda-model project (<root>/data/propaganda_model.db)."""
        return Path(self.propaganda_db_path).parent.parent

    @property
    def pm_agent_token_file(self) -> Path:
        """Token file of the propaganda-model account nieuws-agent."""
        raw = self.pm_agent_token_path.strip()
        if raw:
            path = Path(raw).expanduser()
            return path if path.is_absolute() else (REPO_ROOT / path).resolve()
        return self.propaganda_project_dir / "data" / "tokens" / "nieuws-agent.token"

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

    @property
    def use_sqlite_cache(self) -> bool:
        """Check if backend should read from local SQLite cache."""
        return self.backend_read_source.lower() == "sqlite"


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
