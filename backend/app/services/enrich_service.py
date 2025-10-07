"""Service responsible for NLP enrichment of ingested articles."""

from __future__ import annotations

from array import array
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.logging import get_logger
from backend.app.db.models import Article
from backend.app.db.session import get_sessionmaker
from backend.app.nlp.embeddings import EmbeddingService
from backend.app.nlp.ner import NamedEntityExtractor
from backend.app.nlp.preprocess import NormalizationResult, TextPreprocessor
from backend.app.nlp.tfidf import TfidfVectorizerManager
from backend.app.repositories import ArticleEnrichmentPayload, ArticleRepository

logger = get_logger(__name__)


def _serialize_embedding(vector: Sequence[float]) -> bytes:
    if not vector:
        return b""
    data = array("f", vector)
    return data.tobytes()


class ArticleEnrichmentService:
    """Coordinate preprocessing, embeddings, TF-IDF, and entity extraction."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        preprocessor: TextPreprocessor | None = None,
        embedder: EmbeddingService | None = None,
        tfidf_manager: TfidfVectorizerManager | None = None,
        entity_extractor: NamedEntityExtractor | None = None,
    ) -> None:
        self.session_factory = session_factory or get_sessionmaker()
        self.preprocessor = preprocessor or TextPreprocessor()
        self.embedder = embedder or EmbeddingService()
        self.tfidf_manager = tfidf_manager or TfidfVectorizerManager()
        self.entity_extractor = entity_extractor or NamedEntityExtractor()
        self.log = logger.bind(component="ArticleEnrichmentService")

    async def enrich_pending(self, limit: int | None = 50) -> Dict[str, int]:
        """Enrich articles that have not been processed yet."""

        async with self.session_factory() as session:
            stmt = select(Article).where(Article.normalized_text.is_(None)).order_by(Article.fetched_at.asc())
            if limit is not None:
                stmt = stmt.limit(limit)
            result = await session.execute(stmt)
            articles = result.scalars().all()
            stats = await self._process_articles(session, articles)
            return stats

    async def enrich_by_ids(self, article_ids: Sequence[int]) -> Dict[str, int]:
        """Enrich a specific set of articles by primary key."""

        if not article_ids:
            return {"processed": 0, "skipped": 0}

        async with self.session_factory() as session:
            stmt = select(Article).where(Article.id.in_(article_ids))
            result = await session.execute(stmt)
            articles = result.scalars().all()
            stats = await self._process_articles(session, articles)
            return stats

    async def _process_articles(self, session: AsyncSession, articles: Sequence[Article]) -> Dict[str, int]:
        if not articles:
            return {"processed": 0, "skipped": 0}

        repo = ArticleRepository(session)
        article_ids = [article.id for article in articles]
        existing_corpus = await self._load_existing_corpus(session, exclude_ids=article_ids)

        prepared: List[Dict[str, object]] = []
        skipped = 0
        for article in articles:
            normalization = self.preprocessor.normalize(article.content)
            if not normalization.normalized_text:
                self.log.warning("article_normalization_empty", article_id=article.id, url=article.url)
                skipped += 1
                continue
            # Extract entities and enhanced features
            entities = self.entity_extractor.extract(article.content)
            extracted_dates = self.entity_extractor.extract_dates(article.content)
            extracted_locations = self.entity_extractor.extract_locations(article.content)

            # Classify event type
            from backend.app.nlp.classify import classify_event_type
            event_type = classify_event_type(article.title, article.content, entities)

            prepared.append(
                {
                    "article": article,
                    "normalization": normalization,
                    "entities": entities,
                    "extracted_dates": extracted_dates,
                    "extracted_locations": extracted_locations,
                    "event_type": event_type,
                }
            )

        if not prepared:
            await session.rollback()
            return {"processed": 0, "skipped": skipped or len(articles)}

        corpus = existing_corpus + [item["normalization"].normalized_text for item in prepared]
        if corpus:
            self.tfidf_manager.fit(corpus)

        normalized_texts = [item["normalization"].normalized_text for item in prepared]
        embeddings = await self.embedder.embed_many(normalized_texts)
        if len(embeddings) != len(prepared):  # pragma: no cover - defensive
            raise RuntimeError("Embedding batch size mismatch")
        timestamp = datetime.now(timezone.utc)

        for item, embedding in zip(prepared, embeddings):
            normalization: NormalizationResult = item["normalization"]  # type: ignore[assignment]
            tfidf_vector = self.tfidf_manager.transform(normalization.normalized_text)
            payload = ArticleEnrichmentPayload(
                normalized_text=normalization.normalized_text,
                normalized_tokens=normalization.tokens,
                embedding=_serialize_embedding(embedding),
                tfidf_vector=tfidf_vector,
                entities=item["entities"],
                extracted_dates=item["extracted_dates"],
                extracted_locations=item["extracted_locations"],
                event_type=item["event_type"],
                enriched_at=timestamp,
            )
            await repo.apply_enrichment(item["article"].id, payload)

        await session.commit()
        processed_count = len(prepared)
        self.log.info(
            "articles_enriched",
            processed=processed_count,
            skipped=skipped,
            article_ids=article_ids,
        )
        return {"processed": processed_count, "skipped": skipped}

    async def _load_existing_corpus(
        self,
        session: AsyncSession,
        *,
        exclude_ids: Iterable[int] | None = None,
    ) -> List[str]:
        stmt = select(Article.normalized_text).where(Article.normalized_text.is_not(None))
        exclude_list = list(exclude_ids or [])
        if exclude_list:
            stmt = stmt.where(~Article.id.in_(exclude_list))
        result = await session.execute(stmt)
        return [row[0] for row in result.all() if row[0]]
