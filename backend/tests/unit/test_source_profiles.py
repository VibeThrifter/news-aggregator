from __future__ import annotations

from datetime import datetime, timedelta, timezone
from backend.app.ingestion import load_source_profiles
from backend.app.ingestion.profiles import (
    ConsentConfig,
    SourceProfile,
    load_persisted_cookies,
    persist_cookies,
)


def test_load_source_profiles(tmp_path, monkeypatch):
    yaml_content = """
    sources:
      sample:
        feed_url: https://example.com/rss
        fetch_strategy: consent_cookie
        user_agent: TestAgent/1.0
        consent:
          endpoint: https://example.com/privacy/accept
          method: GET
          params:
            redirectUri: "{article_url}"
    """
    profile_path = tmp_path / "profiles.yaml"
    profile_path.write_text(yaml_content)

    # ensure cache cleared
    load_source_profiles.cache_clear()
    profiles = load_source_profiles(profile_path)

    assert "sample" in profiles
    profile = profiles["sample"]
    assert isinstance(profile, SourceProfile)
    assert profile.fetch_strategy == "consent_cookie"
    assert isinstance(profile.consent, ConsentConfig)
    assert profile.consent.params["redirectUri"] == "{article_url}"


def test_cookie_persistence_roundtrip(tmp_path):
    payload = {
        "stored_at": datetime.now(timezone.utc).isoformat(),
        "ttl_minutes": 60,
        "cookies": [
            {
                "name": "session",
                "value": "abc",
                "domain": ".example.com",
                "path": "/",
                "expires": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
            }
        ],
    }

    persist_cookies("sample", payload, base_dir=tmp_path)
    loaded = load_persisted_cookies("sample", base_dir=tmp_path)

    assert loaded is not None
    assert loaded["cookies"][0]["name"] == "session"
    assert loaded["cookies"][0]["value"] == "abc"
