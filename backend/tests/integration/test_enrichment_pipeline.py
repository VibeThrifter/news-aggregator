from __future__ import annotations

from array import array
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base
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
        assert stored.normalized_tokens
        assert stored.embedding
        assert len(stored.embedding) == len(array('f', [0.1, 0.2, 0.3]).tobytes())
        assert stored.tfidf_vector
        assert stored.entities[0]["text"] == "Den Haag"
        assert stored.enriched_at is not None
