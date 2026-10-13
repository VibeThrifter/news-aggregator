"""Source profile loader for consent-aware article fetching."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

import yaml
from pydantic import BaseModel, Field, HttpUrl, ValidationError, field_validator

PROFILE_FILE = Path(__file__).resolve().parents[3] / "source_profiles.yaml"


class ConsentConfig(BaseModel):
    """Configuration for consent/cookie negotiation."""

    endpoint: HttpUrl
    method: str = Field(default="GET", pattern="^(GET|POST)$")
    params: Dict[str, str] = Field(default_factory=dict)
    headers: Dict[str, str] = Field(default_factory=dict)


class SourceProfile(BaseModel):
    """Defines how content should be fetched for a given source."""

    id: Optional[str] = None
    feed_url: Optional[HttpUrl] = None
    probe_url: Optional[HttpUrl] = None
    fetch_strategy: str = Field(default="simple")
    user_agent: Optional[str] = None
    headers: Dict[str, str] = Field(default_factory=dict)
    parser: str = Field(default="trafilatura")
    requires_js: bool = False
    # Playwright: playwright-stealth hides the headless browser, but it breaks some sites
    # (NieuwRechts' Angular app then never renders the article)
    stealth: bool = True
    cookie_ttl_minutes: Optional[int] = 180
    consent: Optional[ConsentConfig] = None
    # Items that are no news (cartoons, recipes, horoscopes, quizzes, ...): regular expressions,
    # case-insensitive, searched in the item's URL and title. They are skipped before their page is
    # fetched; otherwise each became a news item of its own and cost an analysis
    skip_urls: List[str] = Field(default_factory=list)
    skip_titles: List[str] = Field(default_factory=list)

    @field_validator("skip_urls", "skip_titles")
    @classmethod
    def _patterns_compile(cls, patterns: List[str]) -> List[str]:
        for pattern in patterns:
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f"Invalid skip pattern {pattern!r}: {exc}") from exc
        return patterns

    def has_consent_flow(self) -> bool:
        return self.fetch_strategy == "consent_cookie" and self.consent is not None

    def skip_rule(self, *, url: Optional[str], title: Optional[str]) -> Optional[str]:
        """The pattern that marks this item as no news, or None."""

        for pattern in self.skip_urls:
            if url and re.search(pattern, url, re.IGNORECASE):
                return pattern
        for pattern in self.skip_titles:
            if title and re.search(pattern, title.strip(), re.IGNORECASE):
                return pattern
        return None


class SourceProfiles(BaseModel):
    sources: Dict[str, SourceProfile]

    def with_identifiers(self) -> Dict[str, SourceProfile]:
        enriched: Dict[str, SourceProfile] = {}
        for key, profile in self.sources.items():
            data = profile.model_dump()
            if not data.get("id"):
                data["id"] = key
            enriched[key] = SourceProfile.model_validate(data)
        return enriched


@lru_cache(maxsize=1)
def load_source_profiles(path: Path = PROFILE_FILE) -> Dict[str, SourceProfile]:
    """Load source profiles from YAML with validation."""

    if not path.exists():
        return {}

    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:  # pragma: no cover - configuration error
        raise ValueError(f"Invalid YAML in {path}: {exc}") from exc

    try:
        profiles = SourceProfiles(**raw)
    except ValidationError as exc:
        raise ValueError(f"Invalid source profile configuration: {exc}") from exc

    return profiles.with_identifiers()


def cookies_path_for(source_id: str, base_dir: Optional[Path] = None) -> Path:
    base = base_dir or Path("data") / "cookies"
    return base / f"{source_id}.json"


def load_persisted_cookies(source_id: str, *, base_dir: Optional[Path] = None) -> Optional[dict]:
    path = cookies_path_for(source_id, base_dir)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:  # pragma: no cover - defensive
        return None


def persist_cookies(source_id: str, payload: dict, *, base_dir: Optional[Path] = None) -> None:
    path = cookies_path_for(source_id, base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = [
    "load_source_profiles",
    "SourceProfile",
    "ConsentConfig",
    "load_persisted_cookies",
    "persist_cookies",
    "cookies_path_for",
]
