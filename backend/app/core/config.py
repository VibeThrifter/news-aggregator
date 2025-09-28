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
        default="sentence-transformers/all-MiniLM-L6-v2",
        description="Name of the embedding model for article vectorization"
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

    # CORS Configuration
    frontend_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        description="Comma-separated list of allowed frontend origins"
    )

    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False
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