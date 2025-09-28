"""
Structured logging configuration for News Aggregator backend.

This module provides structured logging setup using structlog according to Story 0.3
requirements. It configures correlation IDs, JSON formatting, and proper exception
handling as specified in Architecture.md Error Handling Strategy.
"""

from __future__ import annotations

import logging
import logging.config
import sys
import uuid
from typing import Any, Dict, Optional

import structlog
from structlog.types import EventDict, WrappedLogger


def add_correlation_id(logger: WrappedLogger, method_name: str, event_dict: EventDict) -> EventDict:
    """
    Add correlation ID to log events if not already present.

    This processor ensures all log events have a correlation_id for request tracing
    as specified in Architecture.md Error Handling Strategy.
    """
    if "correlation_id" not in event_dict:
        event_dict["correlation_id"] = str(uuid.uuid4())
    return event_dict


def add_timestamp(logger: WrappedLogger, method_name: str, event_dict: EventDict) -> EventDict:
    """Add timestamp to log events."""
    if "timestamp" not in event_dict:
        event_dict["timestamp"] = structlog.stdlib.add_log_level(logger, method_name, event_dict)
    return event_dict


def configure_logging(log_level: str = "INFO", json_format: bool = True) -> None:
    """
    Configure structured logging for the application.

    This function sets up structlog with proper processors, formatters, and correlation
    ID support as required by Story 0.3 and Architecture.md patterns.

    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        json_format: Whether to use JSON formatting (True for production, False for dev)
    """
    # Convert string log level to logging constant
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)

    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=numeric_level,
    )

    # Configure structlog processors
    processors = [
        # Add log level and timestamp
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        # Add correlation ID for request tracing
        add_correlation_id,
        # Handle stack info and exceptions
        structlog.processors.StackInfoRenderer(),
        structlog.dev.set_exc_info,
    ]

    if json_format:
        # Production: JSON formatting for structured logging
        processors.extend([
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer()
        ])
    else:
        # Development: Human-readable formatting
        processors.extend([
            structlog.dev.ConsoleRenderer(colors=True)
        ])

    # Configure structlog
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        context_class=dict,
        cache_logger_on_first_use=True,
    )


def get_logger(name: str, correlation_id: Optional[str] = None) -> structlog.stdlib.BoundLogger:
    """
    Get a structured logger instance with optional correlation ID.

    Args:
        name: Logger name (typically __name__)
        correlation_id: Optional correlation ID for request tracing

    Returns:
        structlog.stdlib.BoundLogger: Configured logger instance
    """
    logger = structlog.get_logger(name)

    # Bind correlation ID if provided
    if correlation_id:
        logger = logger.bind(correlation_id=correlation_id)

    return logger


def with_correlation_id(correlation_id: str) -> structlog.stdlib.BoundLogger:
    """
    Create a logger bound with a specific correlation ID.

    This is useful for request-scoped logging where you want all log entries
    within a request to share the same correlation ID.

    Args:
        correlation_id: Correlation ID for request tracing

    Returns:
        structlog.stdlib.BoundLogger: Logger bound with correlation ID
    """
    return structlog.get_logger().bind(correlation_id=correlation_id)


def generate_correlation_id() -> str:
    """
    Generate a new correlation ID for request tracing.

    Returns:
        str: New UUID-based correlation ID
    """
    return str(uuid.uuid4())


class CorrelationIDMiddleware:
    """
    Middleware to add correlation ID to all log events within a request context.

    This middleware can be used with FastAPI to ensure all logs within a request
    share the same correlation ID for easier debugging and tracing.
    """

    def __init__(self, app: Any, header_name: str = "X-Correlation-ID"):
        self.app = app
        self.header_name = header_name

    async def __call__(self, scope: Dict[str, Any], receive: Any, send: Any) -> None:
        """ASGI middleware implementation."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Extract or generate correlation ID
        headers = dict(scope.get("headers", []))
        correlation_id = None

        # Look for correlation ID in headers
        for name, value in headers.items():
            if name.decode().lower() == self.header_name.lower():
                correlation_id = value.decode()
                break

        # Generate new correlation ID if not found
        if not correlation_id:
            correlation_id = generate_correlation_id()

        # Bind correlation ID to structlog context
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(correlation_id=correlation_id)

        # Add correlation ID to response headers
        async def send_with_correlation_id(message: Dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((
                    self.header_name.encode(),
                    correlation_id.encode()
                ))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_correlation_id)


# Convenience functions for common logging patterns
def log_exception(logger: structlog.stdlib.BoundLogger, exception: Exception, context: Optional[Dict[str, Any]] = None) -> None:
    """
    Log an exception with proper context and correlation ID.

    Args:
        logger: Structured logger instance
        exception: Exception to log
        context: Additional context to include in log
    """
    log_context = {"exc_info": exception}
    if context:
        log_context.update(context)

    logger.error(
        "Exception occurred",
        exception_type=type(exception).__name__,
        exception_message=str(exception),
        **log_context
    )


def log_request_start(logger: structlog.stdlib.BoundLogger, method: str, path: str, **kwargs: Any) -> None:
    """Log the start of a request with correlation ID."""
    logger.info(
        "Request started",
        http_method=method,
        path=path,
        **kwargs
    )


def log_request_end(logger: structlog.stdlib.BoundLogger, method: str, path: str, status_code: int, duration_ms: float, **kwargs: Any) -> None:
    """Log the end of a request with timing and status."""
    logger.info(
        "Request completed",
        http_method=method,
        path=path,
        status_code=status_code,
        duration_ms=duration_ms,
        **kwargs
    )