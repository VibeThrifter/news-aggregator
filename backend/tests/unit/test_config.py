"""
Unit tests for backend.app.core.config module.

Tests the Settings class and configuration loading according to Story 0.3
requirements and Architecture.md patterns.
"""

import os
import pytest
from pydantic import ValidationError
from unittest.mock import patch

from backend.app.core.config import Settings, get_settings


class TestSettings:
    """Test cases for the Settings class."""

    def test_settings_default_values(self, monkeypatch):
        """Test that Settings loads with default values when no env vars are set."""
        # Arrange - Clear all environment variables that might affect settings
        env_vars_to_clear = [
            "RSS_NOS_URL", "RSS_NUNL_URL", "SCHEDULER_INTERVAL_MINUTES",
            "DATABASE_URL", "EMBEDDING_MODEL_NAME", "LLM_PROVIDER",
            "MISTRAL_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY",
            "LOG_LEVEL", "FRONTEND_ORIGINS"
        ]
        for var in env_vars_to_clear:
            monkeypatch.delenv(var, raising=False)

        # Patch the model_config to disable .env file loading
        original_config = Settings.model_config.copy()
        test_config = original_config.copy()
        test_config['env_file'] = None

        with patch.object(Settings, 'model_config', test_config):
            # Act
            settings = Settings()

            # Assert
            assert settings.rss_nos_url == "https://feeds.nos.nl/nosnieuwsalgemeen"
            assert settings.rss_nunl_url == "https://www.nu.nl/rss/Algemeen"
            assert settings.scheduler_interval_minutes == 15
            assert settings.database_url == "sqlite+aiosqlite:///./data/db.sqlite"
            assert settings.embedding_model_name == "sentence-transformers/all-MiniLM-L6-v2"
            assert settings.llm_provider == "mistral"
            assert settings.log_level == "INFO"
            assert settings.frontend_origins == "http://localhost:3000,http://127.0.0.1:3000"

    def test_settings_with_environment_variables(self, monkeypatch):
        """Test that Settings loads custom values from environment variables."""
        # Arrange
        monkeypatch.setenv("RSS_NOS_URL", "https://custom-nos.nl/feed")
        monkeypatch.setenv("RSS_NUNL_URL", "https://custom-nu.nl/feed")
        monkeypatch.setenv("SCHEDULER_INTERVAL_MINUTES", "30")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("EMBEDDING_MODEL_NAME", "custom-model")
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("MISTRAL_API_KEY", "mistral-test-key")
        monkeypatch.setenv("OPENAI_API_KEY", "openai-test-key")
        monkeypatch.setenv("TAVILY_API_KEY", "tavily-test-key")
        monkeypatch.setenv("LOG_LEVEL", "DEBUG")
        monkeypatch.setenv("FRONTEND_ORIGINS", "http://localhost:8080,https://example.com")

        # Act
        settings = Settings()

        # Assert
        assert settings.rss_nos_url == "https://custom-nos.nl/feed"
        assert settings.rss_nunl_url == "https://custom-nu.nl/feed"
        assert settings.scheduler_interval_minutes == 30
        assert settings.database_url == "postgresql://user:pass@localhost/db"
        assert settings.embedding_model_name == "custom-model"
        assert settings.llm_provider == "openai"
        assert settings.mistral_api_key == "mistral-test-key"
        assert settings.openai_api_key == "openai-test-key"
        assert settings.tavily_api_key == "tavily-test-key"
        assert settings.log_level == "DEBUG"
        assert settings.frontend_origins == "http://localhost:8080,https://example.com"

    def test_settings_scheduler_interval_validation(self, monkeypatch):
        """Test validation of scheduler_interval_minutes field."""
        # Test minimum boundary
        monkeypatch.setenv("SCHEDULER_INTERVAL_MINUTES", "1")
        settings = Settings()
        assert settings.scheduler_interval_minutes == 1

        # Test maximum boundary
        monkeypatch.setenv("SCHEDULER_INTERVAL_MINUTES", "1440")
        settings = Settings()
        assert settings.scheduler_interval_minutes == 1440

        # Test invalid value (too low)
        monkeypatch.setenv("SCHEDULER_INTERVAL_MINUTES", "0")
        with pytest.raises(ValidationError) as exc_info:
            Settings()
        assert "greater than or equal to 1" in str(exc_info.value)

        # Test invalid value (too high)
        monkeypatch.setenv("SCHEDULER_INTERVAL_MINUTES", "1441")
        with pytest.raises(ValidationError) as exc_info:
            Settings()
        assert "less than or equal to 1440" in str(exc_info.value)

    def test_settings_case_insensitive_env_vars(self, monkeypatch):
        """Test that environment variables are case-insensitive."""
        # Arrange
        monkeypatch.setenv("rss_nos_url", "https://lowercase.nl/feed")
        monkeypatch.setenv("LOG_level", "DEBUG")

        # Act
        settings = Settings()

        # Assert
        assert settings.rss_nos_url == "https://lowercase.nl/feed"
        assert settings.log_level == "DEBUG"

    def test_allowed_origins_property(self):
        """Test the allowed_origins property parsing."""
        # Arrange & Act
        settings = Settings()

        # Assert
        expected_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
        assert settings.allowed_origins == expected_origins

    def test_allowed_origins_with_custom_values(self, monkeypatch):
        """Test allowed_origins with custom frontend_origins."""
        # Arrange
        monkeypatch.setenv("FRONTEND_ORIGINS", "http://localhost:8080, https://example.com ,http://test.com")

        # Act
        settings = Settings()

        # Assert
        expected_origins = ["http://localhost:8080", "https://example.com", "http://test.com"]
        assert settings.allowed_origins == expected_origins

    def test_api_key_properties(self, monkeypatch):
        """Test the API key availability properties."""
        # Clear all env vars first
        env_vars_to_clear = [
            "MISTRAL_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY"
        ]
        for var in env_vars_to_clear:
            monkeypatch.delenv(var, raising=False)

        # Test default (no keys set)
        test_config = Settings.model_config.copy()
        test_config['env_file'] = None
        with patch.object(Settings, 'model_config', test_config):
            settings = Settings()
            assert not settings.has_mistral_key
            assert not settings.has_openai_key
            assert not settings.has_tavily_key

        # Test with keys set
        monkeypatch.setenv("MISTRAL_API_KEY", "mistral-key")
        monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
        monkeypatch.setenv("TAVILY_API_KEY", "tavily-key")

        settings = Settings()
        assert settings.has_mistral_key
        assert settings.has_openai_key
        assert settings.has_tavily_key


class TestGetSettings:
    """Test cases for the get_settings function."""

    def test_get_settings_success(self):
        """Test that get_settings returns a valid Settings instance."""
        # Act
        settings = get_settings()

        # Assert
        assert isinstance(settings, Settings)
        assert settings.scheduler_interval_minutes == 15  # Default value

    @patch('backend.app.core.config.Settings')
    def test_get_settings_validation_error(self, mock_settings):
        """Test that get_settings properly handles ValidationError."""
        # Arrange
        error_detail = [{"type": "missing", "loc": ("test_field",), "msg": "Field required"}]
        mock_settings.side_effect = ValidationError.from_exception_data("Settings", error_detail)

        # Act & Assert
        with pytest.raises(ValidationError):
            get_settings()


class TestEnvironmentValidation:
    """Test cases for environment variable validation patterns."""

    def test_missing_optional_keys_do_not_raise_errors(self, monkeypatch):
        """Test that missing optional API keys don't cause validation errors."""
        # Clear all env vars
        env_vars_to_clear = [
            "MISTRAL_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY"
        ]
        for var in env_vars_to_clear:
            monkeypatch.delenv(var, raising=False)

        # This should not raise any errors since API keys are optional
        test_config = Settings.model_config.copy()
        test_config['env_file'] = None
        with patch.object(Settings, 'model_config', test_config):
            settings = Settings()
            assert settings.mistral_api_key is None
            assert settings.openai_api_key is None
            assert settings.tavily_api_key is None

    def test_invalid_scheduler_interval_type(self, monkeypatch):
        """Test validation with invalid scheduler interval type."""
        # Arrange
        monkeypatch.setenv("SCHEDULER_INTERVAL_MINUTES", "not-a-number")

        # Act & Assert
        with pytest.raises(ValidationError) as exc_info:
            Settings()
        assert "Input should be a valid integer" in str(exc_info.value)

    def test_empty_string_environment_variables(self, monkeypatch):
        """Test behavior with empty string environment variables."""
        # Arrange
        monkeypatch.setenv("MISTRAL_API_KEY", "")
        monkeypatch.setenv("LOG_LEVEL", "")

        # Act
        settings = Settings()

        # Assert
        # Empty strings should be treated as None/default
        assert not settings.has_mistral_key  # Empty string should be falsy
        assert settings.log_level == ""  # Empty string should be preserved for log_level