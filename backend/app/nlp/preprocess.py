"""Text normalization utilities for article enrichment."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, List, Tuple, TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from spacy.language import Language
else:  # pragma: no cover - runtime fallback
    Language = object  # type: ignore[assignment]

from backend.app.nlp import get_spacy_model

TOKEN_RE = re.compile(r"[\w'-]+", flags=re.UNICODE)


@dataclass(slots=True)
class NormalizationResult:
    """Structured result of the normalization step."""

    normalized_text: str
    tokens: List[str]


class TextPreprocessor:
    """Normalize article text via basic cleaning and spaCy token rules."""

    def __init__(
        self,
        *,
        model: "Language" | None = None,
        remove_stopwords: bool = True,
        lemmatize: bool = True,
    ) -> None:
        self._model = model
        self.remove_stopwords = remove_stopwords
        self.lemmatize = lemmatize

    @property
    def nlp(self) -> "Language":
        if self._model is None:
            self._model = get_spacy_model()
        return self._model

    def normalize(self, text: str) -> NormalizationResult:
        """Normalize text returning processed string and token list."""

        if not text:
            return NormalizationResult(normalized_text="", tokens=[])

        cleaned = self._basic_clean(text)
        doc = self.nlp(cleaned)

        tokens: List[str] = []
        for token in doc:
            if token.is_space or token.is_punct or token.is_digit:
                continue
            if self.remove_stopwords and token.is_stop:
                continue
            if token.like_num:
                continue

            value = token.lemma_ if self.lemmatize else token.text
            value = value.strip().lower()
            if not value:
                continue
            if not TOKEN_RE.fullmatch(value):
                continue
            tokens.append(value)

        normalized = " ".join(tokens)
        return NormalizationResult(normalized_text=normalized, tokens=tokens)

    @staticmethod
    def _basic_clean(text: str) -> str:
        """Apply light-weight normalization prior to spaCy processing."""

        normalized = unicodedata.normalize("NFKC", text)
        normalized = normalized.replace("\u00A0", " ")
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized.strip()


def normalize_text(text: str) -> NormalizationResult:
    """Convenience function using default preprocessor singleton."""

    return TextPreprocessor().normalize(text)
