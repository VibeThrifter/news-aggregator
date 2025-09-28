#!/usr/bin/env python3
"""Prime consent cookies for a given source by executing the fetch pipeline."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Ensure repo root on path
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.ingestion import (
    fetch_article_html,
    load_source_profiles,
)

from backend.app.core.logging import configure_logging


async def prime(source_id: str, article_url: str) -> None:
    profiles = load_source_profiles()
    profile = profiles.get(source_id)
    if profile is None:
        raise SystemExit(f"Source '{source_id}' not defined in source_profiles.yaml")

    configure_logging(json_format=False)
    html = await fetch_article_html(article_url, profile=profile)
    snippet = html[:200].replace("\n", " ")
    print(f"Fetched article ({len(html)} characters). Snippet:\n{snippet}...")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prime consent cookies by fetching an article.")
    parser.add_argument("source", help="Source ID as defined in source_profiles.yaml")
    parser.add_argument("article_url", help="Article URL to fetch (post-consent)")
    args = parser.parse_args(argv)

    asyncio.run(prime(args.source, args.article_url))
    print("Consent cookies saved under data/cookies/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
