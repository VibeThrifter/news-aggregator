"""Ingestion helpers for fetching and parsing article content."""

from .fetcher import fetch_article_html, ArticleFetchError
from .parser import parse_article_html, ArticleParseResult, ArticleParseError, naive_extract_text
from .profiles import (
    load_source_profiles,
    SourceProfile,
    ConsentConfig,
    load_persisted_cookies,
    persist_cookies,
    cookies_path_for,
)

__all__ = [
    "fetch_article_html",
    "ArticleFetchError",
    "parse_article_html",
    "ArticleParseResult",
    "ArticleParseError",
    "naive_extract_text",
    "load_source_profiles",
    "SourceProfile",
    "ConsentConfig",
    "load_persisted_cookies",
    "persist_cookies",
    "cookies_path_for",
]
