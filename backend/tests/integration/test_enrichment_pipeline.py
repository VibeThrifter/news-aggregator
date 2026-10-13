from __future__ import annotations

import asyncio
from array import array
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle
from backend.app.llm.client import BaseLLMClient, LLMResponse
from backend.app.nlp import classify
from backend.app.services.enrich_service import ArticleEnrichmentService
from backend.app.nlp.preprocess import TextPreprocessor
from backend.app.nlp.tfidf import TfidfVectorizerManager


class DummyToken:
    def __init__(self, text: str, stopwords: set[str]) -> None:
        self.text = text
        self.lemma_ = text.strip('.,').lower()
        self.is_space = text.strip() == ''
        self.is_punct = all(not char.isalnum() for char in text)
        self.is_digit = text.isdigit()
        self.like_num = self.is_digit
        self.is_stop = self.lemma_ in stopwords


class DummyDoc(list[DummyToken]):
    pass


class DummyModel:
    def __init__(self, stopwords: set[str]) -> None:
        self.stopwords = stopwords

    def __call__(self, text: str) -> DummyDoc:
        tokens = [DummyToken(chunk, self.stopwords) for chunk in text.split()]
        return DummyDoc(tokens)


@pytest.fixture
def session_factory(tmp_path) -> async_sessionmaker[AsyncSession]:
    import asyncio

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path/'enrich.db'}", future=True)

    async def setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return async_sessionmaker(engine, expire_on_commit=False)

    loop = asyncio.new_event_loop()
    try:
        factory = loop.run_until_complete(setup())
        yield factory
    finally:
        loop.run_until_complete(engine.dispose())
        loop.close()


class StubEmbeddingService:
    async def embed_many(self, texts):
        return [[0.1, 0.2, 0.3] for _ in texts]


class StubEntityExtractor:
    def extract(self, text: str):
        return [{"text": "Den Haag", "label": "LOC", "start": 28, "end": 36}]

    def extract_dates(self, text: str):
        return []

    def extract_locations(self, text: str, title: str = ""):
        return ["Den Haag"]


@pytest.mark.asyncio
async def test_enrichment_updates_article_fields(session_factory, tmp_path):
    async with session_factory() as session:
        article = Article(
            guid="guid-1",
            url="https://example.com/nieuws/1",
            title="Protesten op het Malieveld",
            summary="Samenvatting",
            content="De demonstranten verzamelden zich op het Malieveld in Den Haag.",
            source_name="Test",
            source_metadata={"name": "Test"},
            published_at=datetime.now(timezone.utc),
        )
        session.add(article)
        await session.commit()

    dummy_nlp = DummyModel(stopwords={"de", "het", "een"})
    preprocessor = TextPreprocessor(model=dummy_nlp)
    tfidf_manager = TfidfVectorizerManager(cache_path=tmp_path / "tfidf.joblib", max_features=500)

    service = ArticleEnrichmentService(
        session_factory=session_factory,
        preprocessor=preprocessor,
        embedder=StubEmbeddingService(),
        tfidf_manager=tfidf_manager,
        entity_extractor=StubEntityExtractor(),
    )

    stats = await service.enrich_pending()
    assert stats["processed"] == 1

    async with session_factory() as session:
        result = await session.execute(select(Article))
        stored = result.scalar_one()
        assert stored.normalized_text
        assert stored.normalized_tokens is None  # not stored: nothing reads it
        assert stored.embedding
        assert len(stored.embedding) == len(array('f', [0.1, 0.2, 0.3]).tobytes())
        assert stored.tfidf_vector
        assert stored.entities[0]["text"] == "Den Haag"
        assert stored.enriched_at is not None


class _Config:
    async def get_value(self, key, default=None):
        return None

    async def get_float(self, key, default=None):
        return default

    async def get_int(self, key, default=None):
        return default


class ScriptedLLM(BaseLLMClient):
    """Answers the classifications in turn; an exception in the script is raised instead."""

    provider = "stub"

    def __init__(self, *answers) -> None:
        self.answers = list(answers)
        self.calls = 0

    async def generate_text(self, prompt, *, temperature=None, max_tokens=None, correlation_id=None):
        answer = self.answers[min(self.calls, len(self.answers) - 1)]
        self.calls += 1
        if isinstance(answer, BaseException):
            raise answer
        return LLMResponse(provider="stub", model="stub", content=answer)


def _service(session_factory, tmp_path, llm) -> ArticleEnrichmentService:
    return ArticleEnrichmentService(
        session_factory=session_factory,
        preprocessor=TextPreprocessor(model=DummyModel(stopwords={"de", "het", "een"})),
        embedder=StubEmbeddingService(),
        tfidf_manager=TfidfVectorizerManager(cache_path=tmp_path / "tfidf.joblib", max_features=500),
        entity_extractor=StubEntityExtractor(),
        llm_client=llm,
    )


async def _add_articles(session_factory, count: int) -> list[int]:
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        articles = [
            Article(
                guid=f"guid-{index}",
                url=f"https://example.com/nieuws/{index}",
                title=f"Nieuws {index}",
                content=f"De demonstranten verzamelden zich op het Malieveld {index}.",
                source_name="NOS",
                source_metadata={"name": "NOS"},
                published_at=now,
                fetched_at=now - timedelta(minutes=index),
            )
            for index in range(count)
        ]
        session.add_all(articles)
        await session.commit()
        return [article.id for article in articles]


@pytest.mark.asyncio
async def test_pending_enrichment_takes_only_dutch_news_of_the_window(session_factory, tmp_path, monkeypatch):
    """Newest first, foreign articles (Google News gives only their headline) took every turn of
    the catch-up; and an article fetched today with news of yesterday is old news. Only Dutch
    articles published within the window are enriched."""
    monkeypatch.setattr(classify, "get_llm_config_service", lambda: _Config())
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        session.add_all(
            [
                Article(
                    guid=guid,
                    url=f"https://example.com/{guid}",
                    title="Protesten op het Malieveld",
                    content="De demonstranten verzamelden zich op het Malieveld in Den Haag.",
                    source_name="Test",
                    source_metadata={"name": "Test"},
                    published_at=now - published_ago,
                    fetched_at=now - timedelta(minutes=30),
                    is_international=international,
                )
                for guid, published_ago, international in (
                    ("vandaag", timedelta(hours=2), False),
                    ("buitenland", timedelta(hours=1), True),
                    ("gisteren", timedelta(hours=30), False),
                )
            ]
        )
        await session.commit()

    stats = await _service(session_factory, tmp_path, ScriptedLLM("politics")).enrich_pending(max_age_hours=24)

    assert stats["processed"] == 1
    async with session_factory() as session:
        enriched = (await session.execute(select(Article.guid).where(Article.enriched_at.is_not(None)))).scalars().all()
    assert enriched == ["vandaag"]


@pytest.mark.asyncio
async def test_an_interrupted_batch_keeps_the_articles_it_finished(session_factory, tmp_path, monkeypatch):
    """A poll that times out cancels the enrichment halfway: the first five are stored already
    (before, nothing was, and the next cycle started again at the same articles)."""
    monkeypatch.setattr(classify, "get_llm_config_service", lambda: _Config())
    article_ids = await _add_articles(session_factory, 7)
    llm = ScriptedLLM(*(["politics"] * 6), asyncio.CancelledError())

    with pytest.raises(asyncio.CancelledError):
        await _service(session_factory, tmp_path, llm).enrich_pending()

    async with session_factory() as session:
        enriched = (await session.execute(select(Article.id).where(Article.enriched_at.is_not(None)))).scalars().all()
    # Newest first: the five most recently fetched
    assert sorted(enriched) == sorted(article_ids[:5])


@pytest.mark.asyncio
async def test_a_failed_classification_is_asked_again_and_gives_the_event_its_type(
    session_factory, tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(classify, "get_llm_config_service", lambda: _Config())
    [article_id] = await _add_articles(session_factory, 1)

    session_limit = RuntimeError("Claude Code faalde: You've hit your session limit")
    await _service(session_factory, tmp_path, ScriptedLLM(session_limit)).enrich_pending()

    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        article = await session.get(Article, article_id)
        assert article.enriched_at is not None
        assert article.event_type is None
        event = Event(slug="malieveld", title="Malieveld", first_seen_at=now, last_updated_at=now, article_count=1)
        session.add(event)
        await session.flush()
        session.add(EventArticle(event_id=event.id, article_id=article_id, similarity_score=1.0, linked_at=now))
        await session.commit()
        event_id = event.id

    # Still failing: it stops at the first article instead of trying them all
    still_down = ScriptedLLM(session_limit)
    stats = await _service(session_factory, tmp_path, still_down).classify_pending()
    assert stats == {"unclassified": 1, "classified": 0}

    stats = await _service(session_factory, tmp_path, ScriptedLLM("politics")).classify_pending()
    assert stats == {"unclassified": 1, "classified": 1}
    async with session_factory() as session:
        assert (await session.get(Article, article_id)).event_type == "politics"
        assert (await session.get(Event, event_id)).event_type == "politics"
