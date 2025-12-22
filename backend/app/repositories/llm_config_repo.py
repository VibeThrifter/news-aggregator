"""Repository helpers for managing LLM configuration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.logging import get_logger
from backend.app.db.models import LlmConfig

logger = get_logger(__name__)


@dataclass
class ConfigPersistenceResult:
    """Describe the outcome of a config persistence operation."""

    config: LlmConfig
    created: bool


class LlmConfigRepository:
    """Encapsulates read/write operations for LLM configuration."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.log = logger.bind(component="LlmConfigRepository")

    async def get_all(self) -> List[LlmConfig]:
        """Get all LLM config entries."""
        stmt = select(LlmConfig).order_by(LlmConfig.config_type, LlmConfig.key)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_type(self, config_type: str) -> List[LlmConfig]:
        """Get all config entries of a specific type."""
        stmt = (
            select(LlmConfig)
            .where(LlmConfig.config_type == config_type)
            .order_by(LlmConfig.key)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_key(self, key: str) -> Optional[LlmConfig]:
        """Get a config entry by its key."""
        stmt = select(LlmConfig).where(LlmConfig.key == key)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_value(self, key: str, default: str | None = None) -> str | None:
        """Get just the value for a key, with optional default."""
        config = await self.get_by_key(key)
        if config:
            return config.value
        return default

    async def get_all_as_dict(self) -> Dict[str, str]:
        """Get all config entries as a key-value dictionary."""
        configs = await self.get_all()
        return {c.key: c.value for c in configs}

    async def upsert(
        self,
        *,
        key: str,
        value: str,
        config_type: str,
        description: str | None = None,
    ) -> ConfigPersistenceResult:
        """Create or update a config entry."""
        existing = await self.get_by_key(key)
        created = False

        if existing:
            existing.value = value
            existing.config_type = config_type
            if description is not None:
                existing.description = description
            config = existing
            self.log.info("config_updated", key=key)
        else:
            config = LlmConfig(
                key=key,
                value=value,
                config_type=config_type,
                description=description,
            )
            self.session.add(config)
            created = True
            self.log.info("config_created", key=key)

        await self.session.flush()
        return ConfigPersistenceResult(config=config, created=created)

    async def update_value(self, key: str, value: str) -> Optional[LlmConfig]:
        """Update just the value of an existing config entry."""
        config = await self.get_by_key(key)
        if config:
            config.value = value
            await self.session.flush()
            self.log.info("config_value_updated", key=key)
        return config

    async def delete(self, key: str) -> bool:
        """Delete a config entry by key."""
        config = await self.get_by_key(key)
        if config:
            await self.session.delete(config)
            await self.session.flush()
            self.log.info("config_deleted", key=key)
            return True
        return False

    async def bulk_upsert(
        self,
        configs: List[Dict[str, str]],
    ) -> int:
        """Bulk upsert multiple config entries.

        Each dict should have: key, value, config_type, and optionally description.
        """
        count = 0
        for cfg in configs:
            await self.upsert(
                key=cfg["key"],
                value=cfg["value"],
                config_type=cfg["config_type"],
                description=cfg.get("description"),
            )
            count += 1
        return count


__all__ = ["LlmConfigRepository", "ConfigPersistenceResult"]
