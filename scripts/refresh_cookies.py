#!/usr/bin/env python3
"""Refresh consent cookies for RSS sources by fetching a representative article."""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Iterable, Optional

import feedparser

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.core.logging import configure_logging
from backend.app.ingestion import fetch_article_html, load_source_profiles, SourceProfile


def _resolve_probe_url(profile: SourceProfile, fallback_feed_url: Optional[str]) -> str:
    if getattr(profile, "probe_url", None):
        return str(profile.probe_url)
    if fallback_feed_url:
        feed = feedparser.parse(str(fallback_feed_url))
        for entry in feed.entries:
            link = entry.get("link")
            if link:
                return link
    raise RuntimeError(
        f"Unable to determine probe article for source '{profile.id}'."
    )


async def _refresh_single(source_id: str, profile: SourceProfile) -> bool:
    cookies_needed = profile.fetch_strategy in {"consent_cookie", "dynamic_render"}
    if not cookies_needed:
        return False

    probe_url = _resolve_probe_url(profile, str(profile.feed_url) if profile.feed_url else None)
    await fetch_article_html(probe_url, profile=profile)
    return True


async def refresh_cookies(source_ids: Optional[Iterable[str]]) -> None:
    configure_logging(json_format=False)
    profiles = load_source_profiles()

    if source_ids:
        to_process = {sid: profiles[sid] for sid in source_ids if sid in profiles}
    else:
        to_process = profiles

    if not to_process:
        print("No matching sources found in source_profiles.yaml")
        return

    for source_id, profile in to_process.items():
        try:
            refreshed = await _refresh_single(source_id, profile)
            if refreshed:
                print(f"[✓] Refreshed cookies for {source_id}")
            else:
                print(f"[=] {source_id}: no consent handling required")
        except Exception as exc:  # pragma: no cover - CLI robustness
            print(f"[!] Failed to refresh {source_id}: {exc}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Refresh consent cookies for RSS sources.")
    parser.add_argument(
        "--source",
        action="append",
        dest="sources",
        help="Specific source ID(s) to refresh. Defaults to all consent-aware sources.",
    )
    args = parser.parse_args(argv)

    asyncio.run(refresh_cookies(args.sources))
    print("Done. Updated cookies stored under data/cookies/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
