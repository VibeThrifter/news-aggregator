"""Service for managing LLM configuration with caching."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib import resources
from typing import Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.logging import get_logger
from backend.app.db.dual_write import get_read_session
from backend.app.db.models import LlmConfig
from backend.app.db.session import get_sessionmaker
from backend.app.repositories.llm_config_repo import LlmConfigRepository

logger = get_logger(__name__)

# Cache TTL in seconds (5 minutes)
CACHE_TTL_SECONDS = 300


@dataclass
class CachedConfig:
    """Cached configuration with timestamp."""

    data: Dict[str, str]
    fetched_at: datetime


# Module-level cache
_config_cache: Optional[CachedConfig] = None
_cache_lock = asyncio.Lock()


def _load_default_template(filename: str) -> str:
    """Load a default prompt template from package resources."""
    try:
        template_path = resources.files("backend.app.llm.templates").joinpath(filename)
        return template_path.read_text(encoding="utf-8")
    except Exception:
        return ""


# Default configuration values
DEFAULT_CONFIGS: List[Dict[str, str]] = [
    # Prompts
    {
        "key": "prompt_factual",
        "value": "",  # Will be loaded from file
        "config_type": "prompt",
        "description": "Fase 1 prompt: feitelijke analyse (samenvatting, timeline, clusters, contradictions)",
    },
    {
        "key": "prompt_critical",
        "value": "",  # Will be loaded from file
        "config_type": "prompt",
        "description": "Fase 2 prompt: kritische analyse (frames, fallacies, autoriteit, media)",
    },
    {
        "key": "prompt_classification",
        "value": """Classify this Dutch news article into ONE category.

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

Respond with ONLY the category name in lowercase, nothing else.""",
        "config_type": "prompt",
        "description": "Prompt voor artikel classificatie naar event type",
    },
    # LLM Parameters
    {
        "key": "llm_temperature",
        "value": "0.2",
        "config_type": "parameter",
        "description": "Sampling temperature voor LLM (0.0-1.0, lager = deterministischer)",
    },
    {
        "key": "llm_model_name",
        "value": "mistral-small-latest",
        "config_type": "parameter",
        "description": "Model naam voor insight generatie",
    },
    {
        "key": "llm_prompt_article_cap",
        "value": "8",
        "config_type": "parameter",
        "description": "Maximum aantal artikelen in een LLM prompt",
    },
    {
        "key": "llm_prompt_max_characters",
        "value": "20000",
        "config_type": "parameter",
        "description": "Maximum karakters voor gegenereerde prompts",
    },
    {
        "key": "classification_temperature",
        "value": "0.1",
        "config_type": "parameter",
        "description": "Temperature voor classificatie (laag voor consistentie)",
    },
    {
        "key": "classification_max_tokens",
        "value": "20",
        "config_type": "parameter",
        "description": "Max tokens voor classificatie response",
    },
    # Event Scoring Parameters
    {
        "key": "event_score_weight_embedding",
        "value": "0.50",
        "config_type": "scoring",
        "description": "Gewicht voor embedding cosine similarity (0.0-1.0)",
    },
    {
        "key": "event_score_weight_tfidf",
        "value": "0.25",
        "config_type": "scoring",
        "description": "Gewicht voor TF-IDF cosine similarity (0.0-1.0)",
    },
    {
        "key": "event_score_weight_entities",
        "value": "0.25",
        "config_type": "scoring",
        "description": "Gewicht voor entity overlap (0.0-1.0)",
    },
    {
        "key": "event_score_threshold",
        "value": "0.60",
        "config_type": "scoring",
        "description": "Minimum score om artikel aan event te koppelen",
    },
    {
        "key": "event_llm_enabled",
        "value": "true",
        "config_type": "scoring",
        "description": "LLM-gebaseerde finale beslissing voor event toewijzing",
    },
    {
        "key": "event_llm_top_n",
        "value": "2",
        "config_type": "scoring",
        "description": "Aantal top kandidaten voor LLM beslissing",
    },
    {
        "key": "event_llm_min_score",
        "value": "0.55",
        "config_type": "scoring",
        "description": "Minimum score voor LLM kandidaat overweging",
    },
    # Provider Selection (per prompt type)
    {
        "key": "provider_classification",
        "value": "mistral",
        "config_type": "provider",
        "description": "LLM provider voor event type classificatie (mistral|deepseek|gemini)",
    },
    {
        "key": "provider_factual",
        "value": "mistral",
        "config_type": "provider",
        "description": "LLM provider voor fase 1: feitelijke analyse (mistral|deepseek|gemini)",
    },
    {
        "key": "provider_critical",
        "value": "deepseek",
        "config_type": "provider",
        "description": "LLM provider voor fase 2: kritische analyse (mistral|deepseek|gemini)",
    },
    {
        "key": "deepseek_use_reasoner",
        "value": "false",
        "config_type": "provider",
        "description": "Gebruik DeepSeek Reasoner model (R1) voor diepere analyse (langzamer maar beter)",
    },
]


def _get_defaults_with_templates() -> List[Dict[str, str]]:
    """Get default configs with prompt templates loaded from files."""
    configs = []
    for cfg in DEFAULT_CONFIGS:
        cfg_copy = cfg.copy()
        if cfg["key"] == "prompt_factual":
            cfg_copy["value"] = _load_default_template("factual_prompt.txt")
        elif cfg["key"] == "prompt_critical":
            cfg_copy["value"] = _load_default_template("critical_prompt.txt")
        configs.append(cfg_copy)
    return configs


class LlmConfigService:
    """Service for managing LLM configuration with caching."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        self.session_factory = session_factory or get_sessionmaker()
        self.log = logger.bind(component="LlmConfigService")

    async def get_all_config(self, use_cache: bool = True) -> Dict[str, str]:
        """Get all config as a dictionary, with caching."""
        global _config_cache

        if use_cache and _config_cache is not None:
            age = (datetime.now(timezone.utc) - _config_cache.fetched_at).total_seconds()
            if age < CACHE_TTL_SECONDS:
                return _config_cache.data

        async with _cache_lock:
            # Double-check after acquiring lock
            if use_cache and _config_cache is not None:
                age = (datetime.now(timezone.utc) - _config_cache.fetched_at).total_seconds()
                if age < CACHE_TTL_SECONDS:
                    return _config_cache.data

            # Use get_read_session() for SQLite cache support (INFRA-1)
            async with get_read_session() as session:
                repo = LlmConfigRepository(session)
                config_dict = await repo.get_all_as_dict()

                _config_cache = CachedConfig(
                    data=config_dict,
                    fetched_at=datetime.now(timezone.utc),
                )
                self.log.debug("config_cache_refreshed", count=len(config_dict))
                return config_dict

    async def get_value(
        self,
        key: str,
        default: str | None = None,
        use_cache: bool = True,
    ) -> str | None:
        """Get a single config value."""
        config = await self.get_all_config(use_cache=use_cache)
        return config.get(key, default)

    async def get_float(
        self,
        key: str,
        default: float = 0.0,
        use_cache: bool = True,
    ) -> float:
        """Get a config value as float."""
        value = await self.get_value(key, use_cache=use_cache)
        if value is None:
            return default
        try:
            return float(value)
        except ValueError:
            return default

    async def get_int(
        self,
        key: str,
        default: int = 0,
        use_cache: bool = True,
    ) -> int:
        """Get a config value as int."""
        value = await self.get_value(key, use_cache=use_cache)
        if value is None:
            return default
        try:
            return int(value)
        except ValueError:
            return default

    async def get_bool(
        self,
        key: str,
        default: bool = False,
        use_cache: bool = True,
    ) -> bool:
        """Get a config value as bool."""
        value = await self.get_value(key, use_cache=use_cache)
        if value is None:
            return default
        return value.lower() in ("true", "1", "yes", "on")

    async def get_prompt(self, prompt_key: str) -> str | None:
        """Get a prompt template by key."""
        return await self.get_value(f"prompt_{prompt_key}")

    async def list_all(self) -> List[LlmConfig]:
        """Get all config entries as model objects."""
        # Use get_read_session() for SQLite cache support (INFRA-1)
        async with get_read_session() as session:
            repo = LlmConfigRepository(session)
            return await repo.get_all()

    async def list_by_type(self, config_type: str) -> List[LlmConfig]:
        """Get all config entries of a specific type."""
        # Use get_read_session() for SQLite cache support (INFRA-1)
        async with get_read_session() as session:
            repo = LlmConfigRepository(session)
            return await repo.get_by_type(config_type)

    async def update_config(
        self,
        key: str,
        value: str,
        config_type: str | None = None,
        description: str | None = None,
    ) -> LlmConfig | None:
        """Update a config entry and invalidate cache."""
        global _config_cache

        async with self.session_factory() as session:
            repo = LlmConfigRepository(session)

            if config_type:
                result = await repo.upsert(
                    key=key,
                    value=value,
                    config_type=config_type,
                    description=description,
                )
                config = result.config
            else:
                config = await repo.update_value(key, value)

            await session.commit()

            # Invalidate cache
            async with _cache_lock:
                _config_cache = None

            self.log.info("config_updated_cache_invalidated", key=key)
            return config

    async def seed_defaults(self, overwrite: bool = False) -> Dict[str, int]:
        """Seed default configuration values.

        Args:
            overwrite: If True, overwrite existing values. If False, only create missing.

        Returns:
            Dict with counts: created, updated, skipped
        """
        global _config_cache

        defaults = _get_defaults_with_templates()
        created = 0
        updated = 0
        skipped = 0

        async with self.session_factory() as session:
            repo = LlmConfigRepository(session)

            for cfg in defaults:
                existing = await repo.get_by_key(cfg["key"])

                if existing and not overwrite:
                    skipped += 1
                    continue

                result = await repo.upsert(
                    key=cfg["key"],
                    value=cfg["value"],
                    config_type=cfg["config_type"],
                    description=cfg.get("description"),
                )

                if result.created:
                    created += 1
                else:
                    updated += 1

            await session.commit()

        # Invalidate cache
        async with _cache_lock:
            _config_cache = None

        self.log.info(
            "defaults_seeded",
            created=created,
            updated=updated,
            skipped=skipped,
        )
        return {"created": created, "updated": updated, "skipped": skipped}

    def invalidate_cache(self) -> None:
        """Manually invalidate the config cache."""
        global _config_cache
        _config_cache = None
        self.log.info("config_cache_invalidated")


# Singleton instance for convenience
_service_instance: Optional[LlmConfigService] = None


def get_llm_config_service() -> LlmConfigService:
    """Get or create the singleton LlmConfigService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = LlmConfigService()
    return _service_instance


__all__ = ["LlmConfigService", "get_llm_config_service", "DEFAULT_CONFIGS"]
