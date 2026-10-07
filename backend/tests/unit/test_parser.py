"""Article text extraction: page code (a paywall as JSON) is not an article."""

from pathlib import Path

import pytest

from backend.app.ingestion import ArticleParseError
from backend.app.ingestion.parser import looks_like_code, parse_article_html

PAYWALL_JSON = (
    '","textAlignment":"center","textColor":{"light":"#000000","dark":"#000000"},'
    '"linkColor":{"light":"#27509a","dark":"#27509a"},"font":"default","size":"sm",'
    '"showTrackingData":"{\\"eventaction\\":\\"show\\",\\"eventlabel\\":\\"paywall\\"}"'
)


def test_paywall_json_looks_like_code():
    assert looks_like_code(PAYWALL_JSON)


def test_article_with_quotes_is_not_code():
    text = (
        'De politie heeft vanavond in Hoogeveen zes mensen aangehouden, meldt de NOS. '
        '"We grijpen hard in", zegt de burgemeester. Het is al dagen onrustig in de wijk.'
    )
    assert not looks_like_code(text)


def test_empty_text_is_not_code():
    assert not looks_like_code("")


def test_page_code_is_a_parse_failure():
    html = f"<html><body><article><p>{PAYWALL_JSON * 20}</p></article></body></html>"
    with pytest.raises(ArticleParseError):
        parse_article_html(html, url="https://example.com/premium")


def test_normal_article_still_parses():
    html = Path("backend/tests/fixtures/html/article_simple.html").read_text(encoding="utf-8")
    assert parse_article_html(html, url="https://example.com/artikel/1").text
