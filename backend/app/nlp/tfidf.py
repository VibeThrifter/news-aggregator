"""TF-IDF vectorizer management with on-disk persistence."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger

logger = get_logger(__name__)


class TfidfVectorizerManager:
    """Manage a shared TF-IDF vectorizer persisted to disk."""

    def __init__(
        self,
        *,
        cache_path: str | Path | None = None,
        max_features: int | None = None,
    ) -> None:
        settings = get_settings()
        self.cache_path = Path(cache_path) if cache_path else Path(settings.tfidf_cache_path)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.max_features = max_features or settings.tfidf_max_features
        self.vectorizer: TfidfVectorizer | None = None
        self._load()

    def _load(self) -> None:
        if self.cache_path.exists():
            try:
                self.vectorizer = joblib.load(self.cache_path)
                logger.info("loaded_tfidf_vectorizer", path=str(self.cache_path))
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("failed_to_load_tfidf", error=str(exc), path=str(self.cache_path))
                self.vectorizer = None

    def _persist(self) -> None:
        if self.vectorizer is None:
            return
        joblib.dump(self.vectorizer, self.cache_path)
        logger.info("persisted_tfidf_vectorizer", path=str(self.cache_path))

    def fit(self, corpus: Sequence[str]) -> None:
        """Fit vectorizer on provided corpus; overwrites previous model."""

        documents = [doc for doc in corpus if doc]
        if not documents:
            return
        vectorizer = TfidfVectorizer(
            max_features=self.max_features,
            ngram_range=(1, 2),
            min_df=1,
        )
        vectorizer.fit(documents)
        self.vectorizer = vectorizer
        self._persist()

    def transform(self, text: str) -> Dict[str, float]:
        """Convert text to sparse TF-IDF representation as a feature dict."""

        if not text:
            return {}

        if self.vectorizer is None:
            self.fit([text])

        if self.vectorizer is None:
            return {}

        matrix = self.vectorizer.transform([text])
        feature_names = self.vectorizer.get_feature_names_out()
        indices = matrix.indices
        data = matrix.data
        return {feature_names[idx]: float(weight) for idx, weight in zip(indices, data)}

    def fit_and_transform(self, corpus: Sequence[str]) -> List[Dict[str, float]]:
        """Convenience helper that re-fits on corpus and returns vectors."""

        self.fit(corpus)
        return [self.transform(doc) for doc in corpus]
