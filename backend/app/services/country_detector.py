"""Country mapping service for international news perspectives.

Country detection is now handled by the LLM as part of insight generation.
This module provides the mapping from ISO codes to Google News parameters.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import structlog
import yaml

logger = structlog.get_logger(__name__)


# TLD to ISO country code mapping
# Only includes country-code TLDs (ccTLDs) - generic TLDs like .com are not mapped
TLD_TO_COUNTRY: dict[str, str] = {
    # Middle East
    "sa": "SA",  # Saudi Arabia
    "ae": "AE",  # UAE
    "il": "IL",  # Israel
    "ps": "PS",  # Palestine
    "ir": "IR",  # Iran
    "iq": "IQ",  # Iraq
    "jo": "JO",  # Jordan
    "lb": "LB",  # Lebanon
    "sy": "SY",  # Syria
    "ye": "YE",  # Yemen
    "om": "OM",  # Oman
    "qa": "QA",  # Qatar
    "kw": "KW",  # Kuwait
    "bh": "BH",  # Bahrain
    # Europe - Western
    "uk": "GB",  # United Kingdom
    "de": "DE",  # Germany
    "fr": "FR",  # France
    "nl": "NL",  # Netherlands
    "be": "BE",  # Belgium
    "lu": "LU",  # Luxembourg
    "at": "AT",  # Austria
    "ch": "CH",  # Switzerland
    "ie": "IE",  # Ireland
    "mt": "MT",  # Malta
    "cy": "CY",  # Cyprus
    "is": "IS",  # Iceland
    # Europe - Southern
    "it": "IT",  # Italy
    "es": "ES",  # Spain
    "pt": "PT",  # Portugal
    "gr": "GR",  # Greece
    # Europe - Northern
    "se": "SE",  # Sweden
    "no": "NO",  # Norway
    "dk": "DK",  # Denmark
    "fi": "FI",  # Finland
    # Europe - Central/Eastern
    "pl": "PL",  # Poland
    "cz": "CZ",  # Czech Republic
    "hu": "HU",  # Hungary
    "sk": "SK",  # Slovakia
    "ro": "RO",  # Romania
    "bg": "BG",  # Bulgaria
    "si": "SI",  # Slovenia
    "hr": "HR",  # Croatia
    "rs": "RS",  # Serbia
    "ba": "BA",  # Bosnia and Herzegovina
    "me": "ME",  # Montenegro
    "mk": "MK",  # North Macedonia
    "al": "AL",  # Albania
    "xk": "XK",  # Kosovo
    # Europe - Baltic
    "lt": "LT",  # Lithuania
    "lv": "LV",  # Latvia
    "ee": "EE",  # Estonia
    # Europe - Eastern/Caucasus
    "ru": "RU",  # Russia
    "ua": "UA",  # Ukraine
    "by": "BY",  # Belarus
    "md": "MD",  # Moldova
    "ge": "GE",  # Georgia
    "am": "AM",  # Armenia
    "az": "AZ",  # Azerbaijan
    # Asia - East
    "cn": "CN",  # China
    "jp": "JP",  # Japan
    "kr": "KR",  # South Korea
    "kp": "KP",  # North Korea
    "tw": "TW",  # Taiwan
    "hk": "HK",  # Hong Kong
    "mn": "MN",  # Mongolia
    # Asia - Southeast
    "id": "ID",  # Indonesia
    "my": "MY",  # Malaysia
    "sg": "SG",  # Singapore
    "ph": "PH",  # Philippines
    "th": "TH",  # Thailand
    "vn": "VN",  # Vietnam
    "mm": "MM",  # Myanmar
    "kh": "KH",  # Cambodia
    "la": "LA",  # Laos
    "bn": "BN",  # Brunei
    # Asia - South
    "in": "IN",  # India
    "pk": "PK",  # Pakistan
    "bd": "BD",  # Bangladesh
    "lk": "LK",  # Sri Lanka
    "np": "NP",  # Nepal
    "bt": "BT",  # Bhutan
    "mv": "MV",  # Maldives
    # Asia - Central
    "kz": "KZ",  # Kazakhstan
    "uz": "UZ",  # Uzbekistan
    "tm": "TM",  # Turkmenistan
    "kg": "KG",  # Kyrgyzstan
    "tj": "TJ",  # Tajikistan
    "af": "AF",  # Afghanistan
    # Turkey
    "tr": "TR",  # Turkey
    # Africa - North
    "eg": "EG",  # Egypt
    "ly": "LY",  # Libya
    "tn": "TN",  # Tunisia
    "dz": "DZ",  # Algeria
    "ma": "MA",  # Morocco
    "sd": "SD",  # Sudan
    # Africa - West
    "ng": "NG",  # Nigeria
    "gh": "GH",  # Ghana
    "sn": "SN",  # Senegal
    "ci": "CI",  # Ivory Coast
    "ml": "ML",  # Mali
    "bf": "BF",  # Burkina Faso
    "ne": "NE",  # Niger
    "tg": "TG",  # Togo
    "bj": "BJ",  # Benin
    "cm": "CM",  # Cameroon
    # Africa - East
    "ke": "KE",  # Kenya
    "et": "ET",  # Ethiopia
    "tz": "TZ",  # Tanzania
    "ug": "UG",  # Uganda
    "rw": "RW",  # Rwanda
    "so": "SO",  # Somalia
    # Africa - Central
    "cd": "CD",  # Democratic Republic of Congo
    "cg": "CG",  # Republic of Congo
    "ga": "GA",  # Gabon
    "td": "TD",  # Chad
    # Africa - Southern
    "za": "ZA",  # South Africa
    "zw": "ZW",  # Zimbabwe
    "zm": "ZM",  # Zambia
    "mw": "MW",  # Malawi
    "mz": "MZ",  # Mozambique
    "ao": "AO",  # Angola
    "na": "NA",  # Namibia
    "bw": "BW",  # Botswana
    "mg": "MG",  # Madagascar
    "mu": "MU",  # Mauritius
    # Americas - North
    "us": "US",  # United States (rarely used)
    "ca": "CA",  # Canada
    "mx": "MX",  # Mexico
    # Americas - Central
    "gt": "GT",  # Guatemala
    "hn": "HN",  # Honduras
    "sv": "SV",  # El Salvador
    "ni": "NI",  # Nicaragua
    "cr": "CR",  # Costa Rica
    "pa": "PA",  # Panama
    # Americas - Caribbean
    "cu": "CU",  # Cuba
    "jm": "JM",  # Jamaica
    "ht": "HT",  # Haiti
    "do": "DO",  # Dominican Republic
    "pr": "PR",  # Puerto Rico
    "tt": "TT",  # Trinidad and Tobago
    "bs": "BS",  # Bahamas
    "bb": "BB",  # Barbados
    # Americas - South
    "br": "BR",  # Brazil
    "ar": "AR",  # Argentina
    "co": "CO",  # Colombia
    "cl": "CL",  # Chile
    "pe": "PE",  # Peru
    "ve": "VE",  # Venezuela
    "ec": "EC",  # Ecuador
    "bo": "BO",  # Bolivia
    "py": "PY",  # Paraguay
    "uy": "UY",  # Uruguay
    "gy": "GY",  # Guyana
    "sr": "SR",  # Suriname
    # Oceania
    "au": "AU",  # Australia
    "nz": "NZ",  # New Zealand
    "fj": "FJ",  # Fiji
    "pg": "PG",  # Papua New Guinea
}


def get_country_from_url(url: str) -> str | None:
    """Extract country ISO code from URL based on TLD.

    Only returns a country code if the domain has a recognizable
    country-code TLD (ccTLD). Generic TLDs like .com, .org, .net
    return None.

    Args:
        url: Full URL to analyze

    Returns:
        ISO 3166-1 alpha-2 country code if ccTLD found, None otherwise

    Examples:
        >>> get_country_from_url("https://arabnews.com.sa/article")
        'SA'
        >>> get_country_from_url("https://nypost.com/article")
        None
        >>> get_country_from_url("https://bbc.co.uk/news")
        'GB'
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()

        if not hostname:
            return None

        # Remove www. prefix if present
        if hostname.startswith("www."):
            hostname = hostname[4:]

        # Split by dots to get TLD parts
        parts = hostname.split(".")

        if len(parts) < 2:
            return None

        # Check for compound TLDs like .co.uk, .com.au, .com.sa
        if len(parts) >= 3:
            # Check second-level + TLD (e.g., "co.uk", "com.sa")
            second_level = parts[-2]
            tld = parts[-1]

            # If second level is generic (.co, .com, .org, .net, .gov, .ac, .edu)
            # then the real country is in the TLD
            if second_level in ("co", "com", "org", "net", "gov", "ac", "edu", "or", "ne"):
                if tld in TLD_TO_COUNTRY:
                    return TLD_TO_COUNTRY[tld]

        # Check simple TLD
        tld = parts[-1]
        if tld in TLD_TO_COUNTRY:
            return TLD_TO_COUNTRY[tld]

        return None

    except Exception:
        return None


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
