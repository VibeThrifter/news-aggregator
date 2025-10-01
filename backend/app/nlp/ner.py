"""Named entity extraction helpers."""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from spacy.language import Language
else:  # pragma: no cover
    Language = object  # type: ignore[assignment]

from backend.app.nlp import get_spacy_model


class NamedEntityExtractor:
    """Extract named entities from Dutch news articles."""

    def __init__(
        self,
        *,
        model: "Language" | None = None,
        include_labels: Optional[Sequence[str]] = None,
    ) -> None:
        self._model = model
        self.include_labels = set(include_labels) if include_labels else None

    @property
    def nlp(self) -> "Language":
        if self._model is None:
            self._model = get_spacy_model()
        return self._model

    def extract(self, text: str) -> List[Dict[str, object]]:
        if not text:
            return []

        doc = self.nlp(text)
        entities: List[Dict[str, object]] = []
        for ent in doc.ents:
            if self.include_labels and ent.label_ not in self.include_labels:
                continue
            entities.append(
                {
                    "text": ent.text,
                    "label": ent.label_,
                    "start": ent.start_char,
                    "end": ent.end_char,
                }
            )
        return entities


def extract_entities(text: str) -> List[Dict[str, object]]:
    """Convenience wrapper using default extractor."""

    return NamedEntityExtractor().extract(text)
