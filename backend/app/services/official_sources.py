"""Official Sources (Stories 14.33 and 14.34): Kamervragen, votes and press releases about the news.

One scheduled job, three steps, all open data without a key and without an LLM call:

1. new Kamervragen on officielebekendmakingen.nl that link to an article of the news
   (``parliament_citations``);
2. the Kamer's votes on the motions and amendments in the Tijdlijn (``parliament_citations``);
3. new news releases of the Rijksoverheid, compared word for word with the articles around them
   (``press_releases``).

What a step finds goes into ``event_documents`` (published); the Tijdlijn shows it. A step that
fails (a site down) does not stop the others; the next run tries again.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

from ..core.config import get_settings
from .parliament_citations import ParliamentCitationsService
from .press_releases import PressReleasesService

logger = structlog.get_logger(__name__)

USER_AGENT = "News360/0.1 (officiele bronnen bij nieuws)"


class OfficialSourcesService:
    def __init__(
        self,
        *,
        parliament: ParliamentCitationsService | None = None,
        press: PressReleasesService | None = None,
    ) -> None:
        self.parliament = parliament or ParliamentCitationsService()
        self.press = press or PressReleasesService()
        self.last_run: dict[str, Any] | None = None

    async def run(
        self, *, days: int | None = None, steps: tuple[str, ...] = ("kamervragen", "persberichten")
    ) -> dict[str, Any]:
        """Run the steps; ``days`` widens the window (a backfill), else the configured one."""

        settings = get_settings()
        window = days or settings.official_sources_window_days
        started = time.monotonic()
        result: dict[str, Any] = {}
        async with httpx.AsyncClient(
            timeout=30.0, headers={"User-Agent": USER_AGENT}, follow_redirects=True
        ) as client:
            if "kamervragen" in steps:
                try:
                    result["kamervragen"] = await self.parliament.run(client, days=window)
                except (httpx.HTTPError, ValueError) as exc:
                    result["kamervragen"] = {"error": str(exc)[:300]}
                    logger.warning("official_sources_kamervragen_failed", error=str(exc)[:200])
            if "persberichten" in steps:
                try:
                    result["persberichten"] = await self.press.run(client, days=window)
                except (httpx.HTTPError, ValueError) as exc:
                    result["persberichten"] = {"error": str(exc)[:300]}
                    logger.warning("official_sources_press_failed", error=str(exc)[:200])
        result["seconds"] = round(time.monotonic() - started, 2)
        self.last_run = {"at": datetime.now(timezone.utc).isoformat(), **result}
        logger.info("official_sources_run", **result)
        return result


_service: OfficialSourcesService | None = None


def get_official_sources_service() -> OfficialSourcesService:
    global _service
    if _service is None:
        _service = OfficialSourcesService()
    return _service
