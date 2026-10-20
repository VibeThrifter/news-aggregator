from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

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


def test_skip_rule_searches_url_and_title_without_case():
    profile = SourceProfile(skip_urls=["/cartoons/"], skip_titles=["^praat mee:"])

    assert profile.skip_rule(url="https://www.trouw.nl/cartoons/vonk~b60348c7/", title="Vonk") == "/cartoons/"
    assert profile.skip_rule(url="https://www.ad.nl/praat-mee/x~a1/", title="Praat mee: Messi") == "^praat mee:"
    assert profile.skip_rule(url="https://www.trouw.nl/politiek/x~b1/", title="Kabinet valt") is None


def test_a_skip_pattern_that_is_no_regular_expression_is_refused():
    with pytest.raises(ValidationError):
        SourceProfile(skip_titles=["(unclosed"])


@pytest.mark.parametrize(
    ("source", "url", "title", "skipped"),
    [
        # Items from the feeds of 2026-10-07 and 2026-10-08
        ("trouw_rss", "https://www.trouw.nl/cartoons/vonk~b60348c7/", "Vonk", True),
        ("trouw_rss", "https://www.trouw.nl/recepten/cachupa-pobre~b5c84b0b/", "Cachupa pobre", True),
        (
            "trouw_rss",
            "https://www.trouw.nl/wetenschap/recept-voor-asymmetrische-moleculen-is-goed-voor-de-nobelprijs~b1617fe5/",
            "Recept voor asymmetrische moleculen is goed voor de Nobelprijs voor Scheikunde 2026",
            False,
        ),
        ("parool_rss", "https://www.parool.nl/cartoons/dirkjan~bfa4f06b/", "Dirkjan", True),
        ("parool_rss", "https://www.parool.nl/strips-en-puzzels/pukkels~b2/", "Pukkels", True),
        (
            "parool_rss",
            "https://www.parool.nl/ps/zoek-de-verschillen-havenmeestersbrug-in-1967-en-2025~b8a5da04/",
            "Zoek de verschillen: Havenmeestersbrug in 1967 en 2025",
            True,
        ),
        (
            "parool_rss",
            "https://www.parool.nl/ps/vu-hoogleraar-wint-groene-nobelprijs~b3/",
            "VU-hoogleraar wint ‘groene Nobelprijs’ voor baanbrekend onderzoek naar schimmels",
            False,
        ),
        (
            "telegraaf_rss",
            "https://www.telegraaf.nl/vrouw/psyche/daghoroscoop-8-oktober/162316609.html",
            "Daghoroscoop 8 oktober: Wat je ook onderneemt, zorg dat je er plezier aan beleeft",
            True,
        ),
        (
            "telegraaf_rss",
            "https://www.telegraaf.nl/wat-u-zegt/stelling-verplichte-hybride-warmtepomp/162697407.html",
            "Stelling: Verplichte hybride warmtepomp goede maatregel",
            True,
        ),
        ("telegraaf_rss", "https://www.telegraaf.nl/financieel/deurbel/1.html", "Apple stort zich op slimme deurbel", False),
        (
            "ad_rss",
            "https://www.ad.nl/quiz/alleen-de-echte-nieuwsjunk-maakt-deze-wekelijkse-quiz-foutloos~a1e97e15/",
            "Alleen de echte nieuwsjunk maakt deze wekelijkse quiz foutloos",
            True,
        ),
        (
            "ad_rss",
            "https://www.ad.nl/muziek/maak-kans-op-2-tickets-voor-niall-horan~a01b9884/",
            "Maak kans op 2 tickets voor Niall Horan in de Ziggo Dome!",
            True,
        ),
        ("ad_rss", "https://www.ad.nl/praat-mee/opinie-boetes~a2/", "Opinie: ‘Verhogen boetes maakt problemen juist groter’", False),
        (
            "nunl_rss",
            "https://www.nu.nl/nujij/6411595/ben-jij-gevangenismedewerker-dan-zoeken-we-jou.html",
            "Oproep | Ben jij gevangenismedewerker? Dan zoeken we jou",
            True,
        ),
        (
            "volkskrant_rss",
            "https://www.volkskrant.nl/sport/daar-is-ie-weer-de-jaarlijkse-voetbalquiz~bcfe2c137/",
            "Daar is-ie weer: de jaarlijkse voetbalquiz van de Volkskrant",
            True,
        ),
        ("geenstijl_atom", "https://www.geenstijl.nl/5192297/inshallah-het-stamcafe/", "Inshallah het StamCafé", True),
        (
            "geenstijl_atom",
            "https://www.geenstijl.nl/5189480/eerste-kamer-asielwetten/",
            "LIVE. Eerste Kamer stemt over asielwetten",
            False,
        ),
        (
            "ninefornews_rss",
            "https://www.ninefornews.nl/stop-met-focussen-op-btc/",
            "Stop met focussen op BTC: XRP-houders verdienen $8.600 per dag aan passief inkomen via ETCMining",
            True,
        ),
        (
            "ninefornews_rss",
            "https://www.ninefornews.nl/de-cryptomarkt-is-turbulent-geen-paniek/",
            "De cryptomarkt is turbulent – geen paniek. Dagelijks wordt een stabiel bedrag van $4.190 verdiend",
            True,
        ),
        ("anderekrant_rss", "https://deanderekrant.nl/2025-uitgave-48/", "2025 – Uitgave 48", True),
        (
            "anderekrant_rss",
            "https://deanderekrant.nl/nieuwe-defensiewet/",
            "“Nieuwe Defensiewet is militaire staatsgreep”",
            False,
        ),
    ],
)
def test_the_profiles_skip_what_is_no_news(source, url, title, skipped):
    load_source_profiles.cache_clear()
    profile = load_source_profiles()[source]

    assert (profile.skip_rule(url=url, title=title) is not None) is skipped


def test_the_profiles_fetch_nieuwrechts_without_stealth_and_een_blik_op_de_nos_from_youtube():
    load_source_profiles.cache_clear()
    profiles = load_source_profiles()

    assert profiles["nieuwrechts_rss"].stealth is False
    assert profiles["ad_rss"].stealth is True
    assert "youtube.com/feeds/videos.xml" in str(profiles["eenblikopdenos_rss"].feed_url)
    assert profiles["eenblikopdenos_rss"].parser == "rss_only"


def test_the_profile_takes_indepen_from_its_feed_and_never_fetches_the_page():
    """The feed holds the full text; trafilatura on the page also took the comments (2026-10-20)."""
    load_source_profiles.cache_clear()
    profile = load_source_profiles()["indepen_rss"]

    assert str(profile.feed_url) == "https://indepen.eu/feed/"
    assert profile.parser == "rss_only"
