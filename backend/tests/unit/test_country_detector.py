"""Unit tests for CountryMapper service."""

import pytest

from backend.app.services.country_detector import (
    Country,
    CountryMapper,
    CountryMapping,
    GoogleNewsParams,
    load_country_mapping,
    get_country_mapper,
)


class TestLoadCountryMapping:
    """Tests for loading country mapping from YAML."""

    def test_load_country_mapping_success(self):
        """Test that country mapping loads correctly."""
        mapping = load_country_mapping()

        # Should have 20+ countries
        assert len(mapping.countries) >= 20

        # Check a known country
        assert "israel" in mapping.countries
        israel = mapping.countries["israel"]
        assert israel.name == "Israel"
        assert israel.iso_code == "IL"
        assert israel.google_news_primary.gl == "IL"
        assert israel.google_news_primary.hl == "en"

    def test_iso_to_country_index_built(self):
        """Test that ISO to country index is built correctly."""
        mapping = load_country_mapping()

        # Check ISO code lookup
        assert "IL" in mapping.iso_to_country
        assert mapping.iso_to_country["IL"].name == "Israel"

        assert "RU" in mapping.iso_to_country
        assert mapping.iso_to_country["RU"].name == "Russia"

        assert "UA" in mapping.iso_to_country
        assert mapping.iso_to_country["UA"].name == "Ukraine"

    def test_excluded_countries_loaded(self):
        """Test that excluded countries are loaded."""
        mapping = load_country_mapping()

        assert "NL" in mapping.excluded_countries
        # BE is NOT excluded - we want Belgian perspectives too

    def test_country_with_native_language(self):
        """Test countries with native language config."""
        mapping = load_country_mapping()

        russia = mapping.countries["russia"]
        assert russia.google_news_native is not None
        assert russia.google_news_native.hl == "ru"

    def test_country_without_native_language(self):
        """Test countries without native language config."""
        mapping = load_country_mapping()

        us = mapping.countries["united_states"]
        assert us.google_news_native is None


class TestCountryMapper:
    """Tests for CountryMapper."""

    @pytest.fixture
    def mapper(self):
        """Create a CountryMapper instance."""
        return CountryMapper()

    def test_get_country_by_code_found(self, mapper):
        """Test getting country by ISO code."""
        country = mapper.get_country_by_code("IL")
        assert country is not None
        assert country.name == "Israel"
        assert country.iso_code == "IL"

    def test_get_country_by_code_case_insensitive(self, mapper):
        """Test that ISO code lookup is case insensitive."""
        country1 = mapper.get_country_by_code("il")
        country2 = mapper.get_country_by_code("IL")
        country3 = mapper.get_country_by_code("Il")

        assert country1 == country2 == country3
        assert country1.name == "Israel"

    def test_get_country_by_code_not_found(self, mapper):
        """Test getting unknown country returns None."""
        country = mapper.get_country_by_code("XX")
        assert country is None

    def test_get_countries_by_codes(self, mapper):
        """Test getting multiple countries by codes."""
        countries = mapper.get_countries_by_codes(["IL", "RU", "UA", "XX"])

        assert len(countries) == 3  # XX not found
        names = {c.name for c in countries}
        assert "Israel" in names
        assert "Russia" in names
        assert "Ukraine" in names

    def test_get_countries_by_codes_empty(self, mapper):
        """Test getting countries with empty list."""
        countries = mapper.get_countries_by_codes([])
        assert countries == []

    def test_get_country_by_key(self, mapper):
        """Test getting country by internal key."""
        country = mapper.get_country_by_key("russia")
        assert country is not None
        assert country.iso_code == "RU"

        country = mapper.get_country_by_key("nonexistent")
        assert country is None

    def test_is_excluded(self, mapper):
        """Test checking if country is excluded."""
        assert mapper.is_excluded("NL") is True
        assert mapper.is_excluded("nl") is True  # case insensitive
        assert mapper.is_excluded("BE") is False  # Belgium is NOT excluded
        assert mapper.is_excluded("US") is False
        assert mapper.is_excluded("IL") is False

    def test_is_supported(self, mapper):
        """Test checking if country is supported."""
        assert mapper.is_supported("IL") is True
        assert mapper.is_supported("RU") is True
        assert mapper.is_supported("XX") is False

    def test_list_supported_countries(self, mapper):
        """Test listing all supported countries."""
        countries = mapper.list_supported_countries()

        assert len(countries) >= 20
        names = {c.name for c in countries}
        assert "Israel" in names
        assert "Russia" in names
        assert "Ukraine" in names
        assert "United States" in names


class TestCountryDataClass:
    """Tests for Country dataclass."""

    def test_country_hash_by_iso_code(self):
        """Test that countries are hashed by ISO code."""
        params = GoogleNewsParams(gl="IL", hl="en", ceid="IL:en")
        country1 = Country(
            key="israel",
            name="Israel",
            iso_code="IL",
            google_news_primary=params,
        )
        country2 = Country(
            key="israel_dup",
            name="Israel Duplicate",
            iso_code="IL",
            google_news_primary=params,
        )

        # Same ISO code = same hash
        assert hash(country1) == hash(country2)

        # Can be used in sets
        country_set = {country1, country2}
        assert len(country_set) == 1

    def test_country_equality(self):
        """Test country equality comparison."""
        params = GoogleNewsParams(gl="IL", hl="en", ceid="IL:en")
        country1 = Country(
            key="israel",
            name="Israel",
            iso_code="IL",
            google_news_primary=params,
        )
        country2 = Country(
            key="israel_dup",
            name="Israel Duplicate",
            iso_code="IL",
            google_news_primary=params,
        )
        country3 = Country(
            key="russia",
            name="Russia",
            iso_code="RU",
            google_news_primary=params,
        )

        assert country1 == country2  # Same ISO code
        assert country1 != country3  # Different ISO code
        assert country1 != "IL"  # Different type


class TestGoogleNewsParams:
    """Tests for GoogleNewsParams dataclass."""

    def test_params_creation(self):
        """Test creating Google News params."""
        params = GoogleNewsParams(gl="IL", hl="en", ceid="IL:en")

        assert params.gl == "IL"
        assert params.hl == "en"
        assert params.ceid == "IL:en"

    def test_country_has_params(self):
        """Test that countries have proper Google News params."""
        mapper = CountryMapper()

        israel = mapper.get_country_by_code("IL")
        assert israel.google_news_primary.gl == "IL"
        assert israel.google_news_primary.hl == "en"
        assert israel.google_news_primary.ceid == "IL:en"


class TestSingleton:
    """Tests for singleton pattern."""

    def test_get_country_mapper_singleton(self):
        """Test that get_country_mapper returns same instance."""
        # Clear singleton for test
        import backend.app.services.country_detector as module
        module._mapper = None

        mapper1 = get_country_mapper()
        mapper2 = get_country_mapper()

        assert mapper1 is mapper2
