"""Service responsible for NLP enrichment of ingested articles."""

from __future__ import annotations

from array import array
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Sequence

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.logging import get_logger
from backend.app.db.dual_write import sync_entities_to_cache
from backend.app.db.models import Article, Event, EventArticle
from backend.app.db.session import get_sessionmaker
from backend.app.nlp.embeddings import EmbeddingService
from backend.app.nlp.ner import NamedEntityExtractor
from backend.app.nlp.preprocess import NormalizationResult, TextPreprocessor
from backend.app.nlp.tfidf import TfidfVectorizerManager
from backend.app.repositories import ArticleEnrichmentPayload, ArticleRepository

logger = get_logger(__name__)

# Articles are classified, embedded and stored a few at a time, so a poll or catch-up that times
# out (or a restart) keeps what is done. Stored all at once at the end, an interrupted cycle lost
# its work and the next one started at the same articles again: on 2026-10-08, 357 Dutch articles
# of three days were never enriched, so they were on no page
ENRICH_CHUNK_SIZE = 5


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
        llm_client = None,
    ) -> None:
        self.session_factory = session_factory or get_sessionmaker()
        self.preprocessor = preprocessor or TextPreprocessor()
        self.embedder = embedder or EmbeddingService()
        self.tfidf_manager = tfidf_manager or TfidfVectorizerManager()
        self.entity_extractor = entity_extractor or NamedEntityExtractor()
        # Import here to avoid circular dependency. The provider comes from llm_config
        # (provider_classification, else that of the factual analysis), never a fixed Mistral
        if llm_client is None:
            from backend.app.llm.providers import NEWS_PIPELINE_PRIORITY, StepLLMClient

            llm_client = StepLLMClient(
                "provider_classification",
                fallback_keys=("provider_factual",),
                priority=NEWS_PIPELINE_PRIORITY,
            )
        self.llm_client = llm_client
        self.log = logger.bind(component="ArticleEnrichmentService")

    async def enrich_pending(self, limit: int | None = 50, *, max_age_hours: float | None = None) -> Dict[str, int]:
        """Enrich Dutch articles that have not been processed yet (optionally only news published
        in the last hours), newest first: the latest news should not wait behind a backlog.

        Foreign articles are left alone: Google News gives only their headline, international
        enrichment attaches them to the news itself, and newest first they took all the turns of
        the catch-up (2026-10-08: 274 in 12 hours, while Dutch articles of that day waited).
        """

        published = func.coalesce(Article.published_at, Article.fetched_at)
        async with self.session_factory() as session:
            stmt = (
                select(Article)
                .where(Article.normalized_text.is_(None))
                .where(Article.is_international.is_(False))
                .order_by(published.desc(), Article.fetched_at.desc())
            )
            if max_age_hours is not None:
                cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
                stmt = stmt.where(published >= cutoff)
            if limit is not None:
                stmt = stmt.limit(limit)
            result = await session.execute(stmt)
            articles = result.scalars().all()
            stats = await self._process_articles(session, articles)
            return stats

    async def classify_pending(
        self, limit: int = 10, *, max_age_hours: float | None = None
    ) -> Dict[str, int]:
        """Ask again the type of enriched Dutch articles whose classification failed, newest first.

        Their news item gets the type too when it has none (an item takes the type of its first
        article). Stops at the first failure: the provider is still unavailable.
        """

        from backend.app.nlp.classify import classify_event_type_llm

        published = func.coalesce(Article.published_at, Article.fetched_at)
        stmt = (
            select(Article.id, Article.title, Article.content)
            .where(Article.enriched_at.is_not(None))
            .where(Article.event_type.is_(None))
            .where(Article.is_international.is_(False))
            .order_by(published.desc(), Article.fetched_at.desc())
            .limit(limit)
        )
        if max_age_hours is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
            stmt = stmt.where(published >= cutoff)
        async with self.session_factory() as session:
            rows = (await session.execute(stmt)).all()

        stats = {"unclassified": len(rows), "classified": 0}
        for article_id, title, content in rows:
            event_type = await classify_event_type_llm(title, content or "", self.llm_client)
            if event_type is None:
                break
            async with self.session_factory() as session:
                await session.execute(
                    update(Article).where(Article.id == article_id).values(event_type=event_type)
                )
                events = select(EventArticle.event_id).where(EventArticle.article_id == article_id)
                await session.execute(
                    update(Event)
                    .where(Event.id.in_(events))
                    .where(Event.event_type.is_(None))
                    .values(event_type=event_type)
                )
                await session.commit()
            stats["classified"] += 1
        if rows:
            self.log.info("articles_reclassified", **stats)
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

        from backend.app.nlp.classify import classify_event_type_llm

        repo = ArticleRepository(session)
        article_ids = [article.id for article in articles]
        existing_corpus = await self._load_existing_corpus(session, exclude_ids=article_ids)
        # No transaction stays open during the LLM calls below
        await session.commit()

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
            extracted_locations = self.entity_extractor.extract_locations(article.content, article.title)

            prepared.append(
                {
                    "article": article,
                    "normalization": normalization,
                    "entities": entities,
                    "extracted_dates": extracted_dates,
                    "extracted_locations": extracted_locations,
                }
            )

        if not prepared:
            return {"processed": 0, "skipped": skipped or len(articles)}

        corpus = existing_corpus + [item["normalization"].normalized_text for item in prepared]
        if corpus:
            self.tfidf_manager.fit(corpus)

        processed_count = 0
        for start in range(0, len(prepared), ENRICH_CHUNK_SIZE):
            chunk = prepared[start : start + ENRICH_CHUNK_SIZE]
            # Classify event type using LLM
            for item in chunk:
                article = item["article"]
                item["event_type"] = await classify_event_type_llm(
                    article.title, article.content, self.llm_client
                )

            normalized_texts = [item["normalization"].normalized_text for item in chunk]
            embeddings = await self.embedder.embed_many(normalized_texts)
            if len(embeddings) != len(chunk):  # pragma: no cover - defensive
                raise RuntimeError("Embedding batch size mismatch")
            timestamp = datetime.now(timezone.utc)

            enriched_articles: List[Article] = []  # Collect for SQLite cache sync
            for item, embedding in zip(chunk, embeddings):
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
                enriched_article = await repo.apply_enrichment(item["article"].id, payload)
                enriched_articles.append(enriched_article)

            await session.commit()
            # Sync enriched articles to SQLite cache (INFRA-1: dual-write)
            if enriched_articles:
                await sync_entities_to_cache(enriched_articles, "articles")
            processed_count += len(chunk)

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
