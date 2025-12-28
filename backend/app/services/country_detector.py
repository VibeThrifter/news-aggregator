"""Country mapping service for international news perspectives.

Country detection is now handled by the LLM as part of insight generation.
This module provides the mapping from ISO codes to Google News parameters.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

import structlog
import yaml

logger = structlog.get_logger(__name__)


@dataclass
class GoogleNewsParams:
    """Google News RSS parameters for a country."""

    gl: str  # Country code for Google
    hl: str  # Language code
    ceid: str  # Combined country:language


@dataclass
class Country:
    """Represents a country with its Google News configuration."""

    key: str  # Internal key (e.g., "israel")
    name: str  # Display name (e.g., "Israel")
    iso_code: str  # ISO 3166-1 alpha-2 (e.g., "IL")
    google_news_primary: GoogleNewsParams
    google_news_native: Optional[GoogleNewsParams] = None
    aliases: list[str] = field(default_factory=list)

    def __hash__(self) -> int:
        return hash(self.iso_code)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Country):
            return NotImplemented
        return self.iso_code == other.iso_code


@dataclass
class CountryMapping:
    """Container for country mapping data."""

    countries: dict[str, Country]
    excluded_countries: list[str]
    iso_to_country: dict[str, Country]


@lru_cache(maxsize=1)
def load_country_mapping() -> CountryMapping:
    """Load country mapping from YAML file (cached)."""
    yaml_path = Path(__file__).parent.parent / "data" / "country_mapping.yaml"

    if not yaml_path.exists():
        raise FileNotFoundError(f"Country mapping file not found: {yaml_path}")

    with open(yaml_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    countries: dict[str, Country] = {}
    iso_to_country: dict[str, Country] = {}

    for key, config in data.get("countries", {}).items():
        # Parse Google News params
        primary_config = config.get("google_news", {}).get("primary", {})
        primary_params = GoogleNewsParams(
            gl=primary_config.get("gl", ""),
            hl=primary_config.get("hl", "en"),
            ceid=primary_config.get("ceid", ""),
        )

        native_params = None
        native_config = config.get("google_news", {}).get("native")
        if native_config:
            native_params = GoogleNewsParams(
                gl=native_config.get("gl", ""),
                hl=native_config.get("hl", ""),
                ceid=native_config.get("ceid", ""),
            )

        country = Country(
            key=key,
            name=config.get("name", key.title()),
            iso_code=config.get("iso_code", ""),
            google_news_primary=primary_params,
            google_news_native=native_params,
            aliases=config.get("aliases", []),
        )

        countries[key] = country
        iso_to_country[country.iso_code] = country

    excluded = data.get("excluded_countries", [])

    logger.info(
        "country_mapping_loaded",
        countries_count=len(countries),
        excluded_count=len(excluded),
    )

    return CountryMapping(
        countries=countries,
        excluded_countries=excluded,
        iso_to_country=iso_to_country,
    )


class CountryMapper:
    """Maps ISO country codes to Country objects with Google News parameters.

    Country detection is handled by the LLM during insight generation.
    This class converts the LLM's ISO codes to our Country objects
    that contain Google News RSS parameters for fetching.
    """

    def __init__(self) -> None:
        self.mapping = load_country_mapping()

    def get_country_by_code(self, iso_code: str) -> Optional[Country]:
        """Get a country by its ISO code.

        Args:
            iso_code: ISO 3166-1 alpha-2 code (e.g., "US", "IL", "RU")

        Returns:
            Country object if found and supported, None otherwise
        """
        return self.mapping.iso_to_country.get(iso_code.upper())

    def get_countries_by_codes(self, iso_codes: list[str]) -> list[Country]:
        """Get multiple countries by their ISO codes.

        Args:
            iso_codes: List of ISO codes

        Returns:
            List of Country objects for supported countries
        """
        countries = []
        for code in iso_codes:
            country = self.get_country_by_code(code)
            if country:
                countries.append(country)
        return countries

    def get_country_by_key(self, key: str) -> Optional[Country]:
        """Get a country by its internal key (e.g., "israel", "russia")."""
        return self.mapping.countries.get(key)

    def is_excluded(self, iso_code: str) -> bool:
        """Check if a country is in the excluded list (NL, BE)."""
        return iso_code.upper() in self.mapping.excluded_countries

    def is_supported(self, iso_code: str) -> bool:
        """Check if we have Google News parameters for this country."""
        return iso_code.upper() in self.mapping.iso_to_country

    def list_supported_countries(self) -> list[Country]:
        """List all supported countries."""
        return list(self.mapping.countries.values())


# Singleton instance
_mapper: Optional[CountryMapper] = None


def get_country_mapper() -> CountryMapper:
    """Get the singleton CountryMapper instance."""
    global _mapper
    if _mapper is None:
        _mapper = CountryMapper()
    return _mapper


# Backwards compatibility alias
CountryDetector = CountryMapper
get_country_detector = get_country_mapper
