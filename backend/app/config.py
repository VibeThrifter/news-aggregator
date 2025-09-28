from __future__ import annotations

import os
from functools import lru_cache
from typing import List, Optional

from pydantic import AnyHttpUrl, BaseModel, Field


class OpenAIConfig(BaseModel):
    api_key: str = Field(..., repr=False)
    model: str = Field(default="gpt-4o-mini")
    temperature: float = Field(default=0.3, ge=0.0, le=1.0)


class MistralConfig(BaseModel):
    api_key: str = Field(..., repr=False)
    model: str = Field(default="mistral-small-latest")
    temperature: float = Field(default=0.3, ge=0.0, le=1.0)


class TavilyConfig(BaseModel):
    api_key: str = Field(..., repr=False)
    search_depth: str = Field(default="advanced")
    max_results: int = Field(default=8, ge=1, le=20)


class AppSettings(BaseModel):
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    openai_temperature: Optional[float] = None
    mistral_api_key: Optional[str] = None
    mistral_model: Optional[str] = None
    mistral_temperature: Optional[float] = None
    tavily_api_key: Optional[str] = None
    tavily_search_depth: Optional[str] = None
    tavily_max_results: Optional[int] = None
    allow_origins: List[AnyHttpUrl] = Field(default_factory=list)

    @property
    def openai(self) -> OpenAIConfig:
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY ontbreekt. Voeg een sleutel toe aan .env of omgevingsvariabelen.")
        return OpenAIConfig(
            api_key=self.openai_api_key,
            model=self.openai_model or "gpt-4o-mini",
            temperature=self.openai_temperature or 0.3,
        )

    @property
    def mistral(self) -> MistralConfig:
        if not self.mistral_api_key:
            raise ValueError("MISTRAL_API_KEY ontbreekt. Voeg een sleutel toe aan .env of omgevingsvariabelen.")
        return MistralConfig(
            api_key=self.mistral_api_key,
            model=self.mistral_model or "mistral-small-latest",
            temperature=self.mistral_temperature or 0.3,
        )

    @property
    def has_openai(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def has_mistral(self) -> bool:
        return bool(self.mistral_api_key)

    @property
    def tavily(self) -> TavilyConfig:
        if not self.tavily_api_key:
            raise ValueError("TAVILY_API_KEY ontbreekt. Voeg een sleutel toe aan .env of omgevingsvariabelen.")
        return TavilyConfig(
            api_key=self.tavily_api_key,
            search_depth=self.tavily_search_depth or "advanced",
            max_results=self.tavily_max_results or 8,
        )


    @classmethod
    def from_env(cls) -> "AppSettings":
        origins_raw = os.getenv("FRONTEND_ORIGINS", "")
        origins_list = [origin.strip() for origin in origins_raw.split(",") if origin.strip()]
        data = {
            "openai_api_key": os.getenv("OPENAI_API_KEY"),
            "openai_model": os.getenv("OPENAI_MODEL"),
            "openai_temperature": float(os.getenv("OPENAI_TEMPERATURE", "0.3")),
            "mistral_api_key": os.getenv("MISTRAL_API_KEY"),
            "mistral_model": os.getenv("MISTRAL_MODEL"),
            "mistral_temperature": float(os.getenv("MISTRAL_TEMPERATURE", "0.3")),
            "tavily_api_key": os.getenv("TAVILY_API_KEY"),
            "tavily_search_depth": os.getenv("TAVILY_SEARCH_DEPTH"),
            "tavily_max_results": int(os.getenv("TAVILY_MAX_RESULTS", "8")),
            "allow_origins": origins_list,
        }
        return cls.model_validate(data)


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    return AppSettings.from_env()
