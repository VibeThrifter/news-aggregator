# ruff: noqa: S101
"""Dutch gist of foreign articles ("Wat schreef …?"): fetch, summarise, store, select, endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker

from backend.app.db.models import Article, Event, EventArticle
from backend.app.llm.client import LLMGenericResult, LLMRateLimitError, LLMResponseError
from backend.app.llm.schemas import ArticleDigestPayload
from backend.app.routers import admin
from backend.app.services import article_digest as digest_module
from backend.app.services.article_digest import (
    MAX_FAILURES,
    PROMPT_TEMPLATE_PATH,
    ArticleDigestService,
    build_digest_prompt,
)
from backend.tests.unit._exploration_fixtures import make_session_factory, make_settings

TEXT = "NordVind bouwt na Duitsland en Vlaanderen nu ook in Nederland. " * 20
TEMPLATE = "BRON: {source_name}\nKOP: {title}\n{text_block}\nJSON"


class FakeClient:
    """Records prompts and answers with a fixed gist (or fails)."""

    provider = "mistral"

    def __init__(self, *, fail: bool = False, error: Exception | None = None) -> None:
        self.prompts: list[str] = []
        self.error = error or (RuntimeError("LLM kapot") if fail else None)

    async def generate_json(
        self, prompt: str, schema_class: type, *, correlation_id: str | None = None
    ):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        payload = schema_class(
            kern="  NordVind  wil in Nederland groeien;\nDijkerhoven is het eerste park. "
        )
        return LLMGenericResult(
            provider="mistral", model="mistral-small-latest", payload=payload, raw_content="{}"
        )


@pytest.fixture(autouse=True)
def no_cache_sync(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """Never write to the developer's SQLite cache."""

    sync = AsyncMock(return_value=0)
    monkeypatch.setattr(digest_module, "sync_entities_to_cache", sync)
    return sync


async def add_article(
    factory: async_sessionmaker,
    *,
    international: bool = True,
    archived: bool = False,
    linked: bool = True,
    metadata: dict[str, Any] | None = None,
    age_hours: float = 1,
) -> int:
    created = datetime.now(timezone.utc) - timedelta(hours=age_hours)
    async with factory() as session:
        article = Article(
            guid=f"gnews:{created.timestamp()}:{international}:{archived}:{linked}",
            url=f"https://www.dw.com/en/a-{created.timestamp()}",
            title="German wind developer NordVind expands in the Netherlands",
            content="German wind developer NordVind expands in the Netherlands  DW",
            source_name="DW",
            source_metadata=(
                metadata
                if metadata is not None
                else {"google_news_url": "https://news.google.com/x"}
            ),
            is_international=international,
            created_at=created,
        )
        session.add(article)
        await session.flush()
        if linked:
            event = Event(slug=f"e-{article.id}", archived_at=created if archived else None)
            session.add(event)
            await session.flush()
            session.add(EventArticle(event_id=event.id, article_id=article.id))
        await session.commit()
        return article.id


async def stored_metadata(factory: async_sessionmaker, article_id: int) -> dict[str, Any]:
    async with factory() as session:
        article = await session.get(Article, article_id)
        return dict(article.source_metadata or {})


def make_service(
    factory: async_sessionmaker,
    *,
    client: FakeClient | None = None,
    text: str | None = TEXT,
    **kwargs: Any,
):
    return ArticleDigestService(
        session_factory=factory,
        client=client or FakeClient(),
        settings=make_settings(mistral_api_key="test", **kwargs),
        fetch_text=lambda url: text,
        prompt_template=TEMPLATE,
    )


def test_prompt_puts_the_text_last_and_says_when_there_is_only_a_headline() -> None:
    with_text = build_digest_prompt(
        TEMPLATE, source_name="DW", title="Kop met {text_block}", text="Tekst met {title}"
    )
    assert "BRON: DW" in with_text
    # The article text is not searched for placeholders
    assert "TEKST (mogelijk ingekort):\nTekst met {title}" in with_text
    without = build_digest_prompt(TEMPLATE, source_name="DW", title="Kop", text=None)
    assert "alleen een kop" in without
    # The shipped template has all placeholders
    template = PROMPT_TEMPLATE_PATH.read_text(encoding="utf-8")
    assert all(key in template for key in ("{source_name}", "{title}", "{text_block}"))


def test_payload_collapses_whitespace() -> None:
    assert ArticleDigestPayload(kern="  een \n twee  ").kern == "een twee"


async def test_digest_from_the_fetched_text_is_stored_in_the_metadata(
    no_cache_sync: AsyncMock,
) -> None:
    factory, engine = await make_session_factory()
    try:
        article_id = await add_article(
            factory, metadata={"google_news_url": "g", "digest_failures": 1}
        )
        client = FakeClient()
        outcome = await make_service(
            factory, client=client, article_digest_text_chars=500
        ).digest_article(article_id)

        assert (
            outcome.digest["nl"]
            == "NordVind wil in Nederland groeien; Dijkerhoven is het eerste park."
        )
        assert outcome.digest["basis"] == "text"
        assert outcome.digest["model"] == "mistral-small-latest"
        # Only the first article_digest_text_chars characters go to the LLM
        assert TEXT[:500] in client.prompts[0] and TEXT[:501] not in client.prompts[0]

        metadata = await stored_metadata(factory, article_id)
        assert metadata["google_news_url"] == "g"
        assert metadata["digest"]["nl"] == outcome.digest["nl"]
        assert "digest_failures" not in metadata
        no_cache_sync.assert_awaited_once()
    finally:
        await engine.dispose()


@pytest.mark.parametrize("text", [None, "Accept cookies to continue."])
async def test_without_article_text_the_gist_is_based_on_the_headline(text: str | None) -> None:
    factory, engine = await make_session_factory()
    try:
        article_id = await add_article(factory)
        client = FakeClient()
        outcome = await make_service(factory, client=client, text=text).digest_article(article_id)
        assert outcome.digest["basis"] == "title"
        assert "alleen een kop" in client.prompts[0]
    finally:
        await engine.dispose()


async def test_a_failed_llm_call_is_counted_and_raised() -> None:
    factory, engine = await make_session_factory()
    try:
        article_id = await add_article(factory)
        with pytest.raises(RuntimeError):
            await make_service(factory, client=FakeClient(fail=True)).digest_article(article_id)
        metadata = await stored_metadata(factory, article_id)
        assert metadata["digest_failures"] == 1
        assert "digest" not in metadata
    finally:
        await engine.dispose()


async def test_pending_articles_are_foreign_in_active_news_without_digest_newest_first() -> None:
    factory, engine = await make_session_factory()
    try:
        older = await add_article(factory, age_hours=10)
        newest = await add_article(factory, age_hours=1)
        old = await add_article(factory, age_hours=100)
        await add_article(factory, international=False)
        await add_article(factory, archived=True)
        await add_article(factory, linked=False)
        await add_article(factory, metadata={"digest": {"nl": "Al gedaan", "basis": "text"}})
        await add_article(factory, metadata={"digest_failures": MAX_FAILURES})
        failed_once = await add_article(factory, metadata={"digest_failures": 1}, age_hours=20)

        service = make_service(factory)
        assert await service.pending_article_ids(limit=10, max_age_hours=72) == [
            newest,
            older,
            failed_once,
        ]
        assert await service.pending_article_ids(limit=10) == [newest, older, failed_once, old]
        assert await service.pending_article_ids(limit=1) == [newest]
        assert await service.count_pending(max_age_hours=72) == 3
    finally:
        await engine.dispose()


async def test_a_batch_digests_pending_articles_and_reports_what_is_left() -> None:
    factory, engine = await make_session_factory()
    try:
        for hours in (1, 2, 3):
            await add_article(factory, age_hours=hours)
        stats = await make_service(factory).digest_batch(limit=2, max_age_hours=72)
        assert stats == {
            "articles_found": 2,
            "articles_digested": 2,
            "from_text": 2,
            "from_title": 0,
            "articles_failed": 0,
            "failed_article_ids": None,
            "stopped": None,
            "pending": 1,
        }

        failing = await make_service(factory, client=FakeClient(fail=True)).digest_batch(limit=5)
        assert failing["articles_failed"] == 1 and failing["failed_article_ids"]
        assert failing["pending"] == 1  # one failure: still pending, retried next time
    finally:
        await engine.dispose()


@pytest.mark.parametrize(
    "error",
    [
        LLMResponseError("Mistral gaf status 429", retryable=True),
        LLMRateLimitError("limiet", provider="mistral"),
    ],
)
async def test_a_provider_problem_stops_the_batch_without_blaming_the_article(
    error: Exception,
) -> None:
    factory, engine = await make_session_factory()
    try:
        first = await add_article(factory, age_hours=1)
        await add_article(factory, age_hours=2)
        client = FakeClient(error=error)
        stats = await make_service(factory, client=client).digest_batch(limit=5)
        # One call, then stop: no hammering of a rate-limited API
        assert len(client.prompts) == 1
        assert stats["stopped"] and stats["articles_failed"] == 0 and stats["pending"] == 2
        assert "digest_failures" not in await stored_metadata(factory, first)
    finally:
        await engine.dispose()


async def test_an_unusable_answer_counts_against_the_article() -> None:
    factory, engine = await make_session_factory()
    try:
        article_id = await add_article(factory)
        bad_json = LLMResponseError("JSON-respons kon niet worden gevalideerd", retryable=False)
        stats = await make_service(factory, client=FakeClient(error=bad_json)).digest_batch(limit=5)
        assert stats["articles_failed"] == 1 and stats["stopped"] is None
        assert (await stored_metadata(factory, article_id))["digest_failures"] == 1
    finally:
        await engine.dispose()


class _StubDigestService:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def digest_article(self, article_id: int):
        if article_id == 404:
            raise ValueError("Article 404 not found")
        return digest_module.DigestOutcome(
            article_id=article_id, digest={"nl": "Kern", "basis": "text"}
        )

    async def digest_batch(self, *, limit: int, max_age_hours: int | None):
        self.calls.append({"limit": limit, "max_age_hours": max_age_hours})
        return {
            "articles_found": 1,
            "articles_digested": 1,
            "from_text": 0,
            "from_title": 1,
            "articles_failed": 0,
            "failed_article_ids": None,
            "stopped": None,
            "pending": 4,
        }


async def test_admin_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _StubDigestService()
    monkeypatch.setattr(admin, "get_article_digest_service", lambda: stub)

    single = await admin.trigger_article_digest(7)
    assert single.article_id == 7 and single.digest["nl"] == "Kern"
    with pytest.raises(HTTPException) as missing:
        await admin.trigger_article_digest(404)
    assert missing.value.status_code == 404

    batch = await admin.trigger_article_digests(limit=5)
    assert batch.pending == 4 and batch.from_title == 1
    # Without max_age_hours: backfill all foreign articles of active news
    assert stub.calls == [{"limit": 5, "max_age_hours": None}]
    for bad in ({"limit": 0}, {"limit": 51}, {"limit": 5, "max_age_hours": 0}):
        with pytest.raises(HTTPException) as error:
            await admin.trigger_article_digests(**bad)
        assert error.value.status_code == 400


def test_provider_names_map_to_clients() -> None:
    settings = make_settings(mistral_api_key="test")
    assert digest_module.build_llm_client("deepseek", settings).provider == "deepseek"
    assert digest_module.build_llm_client(" Mistral ", settings).provider == "mistral"
    assert digest_module.build_llm_client(None, settings).provider == "mistral"


async def test_without_injected_client_the_provider_comes_from_llm_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Config:
        def __init__(self, values: dict[str, str]) -> None:
            self.values = values

        async def get_value(self, key: str, default: str | None = None) -> str | None:
            return self.values.get(key, default)

    service = ArticleDigestService(
        session_factory=AsyncMock(), settings=make_settings(mistral_api_key="test")
    )
    # The provider of the factual analysis, unless provider_digest says otherwise
    monkeypatch.setattr(
        digest_module, "get_llm_config_service", lambda: Config({"provider_factual": "deepseek"})
    )
    assert (await service._llm_client()).provider == "deepseek"
    monkeypatch.setattr(
        digest_module,
        "get_llm_config_service",
        lambda: Config({"provider_factual": "deepseek", "provider_digest": "mistral"}),
    )
    assert (await service._llm_client()).provider == "mistral"
