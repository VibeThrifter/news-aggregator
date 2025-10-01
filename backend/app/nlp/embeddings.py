"""Sentence embedding utilities built on sentence-transformers."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Iterable, List, Sequence

try:  # pragma: no cover - import guard for optional dependency
    from sentence_transformers import SentenceTransformer
except ImportError:  # pragma: no cover - handled at runtime
    SentenceTransformer = None  # type: ignore[assignment]

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger

logger = get_logger(__name__)


class EmbeddingService:
    """Lazily loads and serves sentence-transformer embeddings."""

    def __init__(
        self,
        *,
        model_name: str | None = None,
        cache_dir: str | Path | None = None,
    ) -> None:
        settings = get_settings()
        self.model_name = model_name or settings.embedding_model_name
        default_cache = Path(settings.model_cache_dir)
        self.cache_dir = Path(cache_dir) if cache_dir else default_cache
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._model: SentenceTransformer | None = None

    def _load_model(self) -> SentenceTransformer:
        if self._model is None:
            if SentenceTransformer is None:  # pragma: no cover - runtime guard
                raise RuntimeError(
                    "sentence-transformers is not installed. Run 'pip install sentence-transformers' first."
                )
            logger.info("loading_embedding_model", model=self.model_name, cache=str(self.cache_dir))
            self._model = SentenceTransformer(self.model_name, cache_folder=str(self.cache_dir))
        return self._model

    async def embed(self, text: str) -> List[float]:
        """Encode a single text into a normalized embedding."""

        if not text:
            return []

        model = self._load_model()

        def _encode_single() -> List[float]:
            vector = model.encode(text, normalize_embeddings=True)
            return vector.tolist()

        return await asyncio.to_thread(_encode_single)

    async def embed_many(self, texts: Sequence[str]) -> List[List[float]]:
        """Encode multiple texts in one batch for efficiency."""

        filtered_texts = list(texts)
        if not filtered_texts:
            return []

        model = self._load_model()

        def _encode_many() -> List[List[float]]:
            vectors = model.encode(
                filtered_texts,
                normalize_embeddings=True,
                convert_to_numpy=False,
                show_progress_bar=False,
            )
            if isinstance(vectors, list):
                return [vector.tolist() if hasattr(vector, "tolist") else list(vector) for vector in vectors]
            return vectors.tolist()  # type: ignore[return-value]

        return await asyncio.to_thread(_encode_many)
