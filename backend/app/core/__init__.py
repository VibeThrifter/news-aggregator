"""
Core utilities for News Aggregator backend.

This module provides the foundation for configuration management and structured
logging across the application, as defined in Story 0.3.
"""

from .config import Settings, get_settings, validate_env_cli
from .logging import (
    configure_logging,
    get_logger,
    with_correlation_id,
    generate_correlation_id,
    CorrelationIDMiddleware,
    log_exception,
    log_request_start,
    log_request_end,
)

__all__ = [
    # Configuration
    "Settings",
    "get_settings",
    "validate_env_cli",
    # Logging
    "configure_logging",
    "get_logger",
    "with_correlation_id",
    "generate_correlation_id",
    "CorrelationIDMiddleware",
    "log_exception",
    "log_request_start",
    "log_request_end",
]