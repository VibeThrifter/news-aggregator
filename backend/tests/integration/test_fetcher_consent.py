from __future__ import annotations

import httpx
import pytest

from backend.app.ingestion.fetcher import fetch_article_html
from backend.app.ingestion.profiles import ConsentConfig, SourceProfile, load_persisted_cookies


@pytest.mark.asyncio
async def test_fetch_article_html_consent_flow(tmp_path):
    article_url = "https://www.example.com/article"
    consent_endpoint = "https://www.example.com/privacy/accept"

    profile = SourceProfile(
        id="example",
        feed_url=article_url,
        fetch_strategy="consent_cookie",
        user_agent="TestAgent/1.0",
        parser="trafilatura",
        cookie_ttl_minutes=120,
        consent=ConsentConfig(
            endpoint=consent_endpoint,
            method="GET",
            params={"redirectUri": "{article_url}"},
        ),
    )

    state = {"stage": 0, "seen_cookies": [], "accept_called": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url == httpx.URL(article_url):
            if state["stage"] == 0:
                state["stage"] = 1
                return httpx.Response(302, headers={"Location": "https://consent.example.com/consent"})
            cookies = request.headers.get("cookie", "")
            state["seen_cookies"].append(cookies)
            return httpx.Response(200, text="<html><body>Full Article</body></html>")

        if request.url == httpx.URL("https://consent.example.com/consent"):
            return httpx.Response(200, headers={"Set-Cookie": "dpgConsent=1; Domain=.example.com; Path=/"})

        if request.url.host == "www.example.com" and request.url.path == "/privacy/accept":
            state["accept_called"] = True
            params = dict(request.url.params)
            assert params["redirectUri"] == article_url
            return httpx.Response(200, headers={"Set-Cookie": "session=accepted; Domain=.example.com; Path=/"})

        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, follow_redirects=False) as client:
        content = await fetch_article_html(
            article_url,
            profile=profile,
            client=client,
            cookies_dir=tmp_path,
        )
    assert "Full Article" in content

    payload = load_persisted_cookies("example", base_dir=tmp_path)
    assert payload is not None
    assert payload["cookies"]
    assert state["accept_called"]
    assert any(c["name"] == "session" for c in payload["cookies"])
    assert any("session=accepted" in entry for entry in state["seen_cookies"]) or not state["seen_cookies"]

    # Second run should reuse persisted cookie, no consent flow triggered
    def second_handler(request: httpx.Request) -> httpx.Response:
        if request.url == httpx.URL(article_url):
            cookies = request.headers.get("cookie", "")
            assert "session=accepted" in cookies
            return httpx.Response(200, text="<html><body>Cached Article</body></html>")
        return httpx.Response(404)

    transport2 = httpx.MockTransport(second_handler)
    async with httpx.AsyncClient(transport=transport2, follow_redirects=False) as client:
        content_again = await fetch_article_html(
            article_url,
            profile=profile,
            client=client,
            cookies_dir=tmp_path,
        )
    assert "Cached Article" in content_again
