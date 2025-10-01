"""Shared utilities for NLP components."""

from __future__ import annotations

from functools import lru_cache
from typing import Optional, TYPE_CHECKING

from backend.app.core.config import get_settings

if TYPE_CHECKING:  # pragma: no cover - type checking only
    from spacy.language import Language
else:  # pragma: no cover - runtime fallback typing
    Language = object  # type: ignore[assignment]


@lru_cache(maxsize=1)
def get_spacy_model(name: Optional[str] = None) -> "Language":
    """Return a cached spaCy language model, loading it lazily on first use."""

    try:
        import spacy  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - environment specific
        raise RuntimeError(
            "spaCy is not installed. Add 'spacy' to requirements and run 'pip install -r requirements.txt'."
        ) from exc

    settings = get_settings()
    model_name = name or settings.spacy_model_name
    try:
        return spacy.load(model_name)  # type: ignore[no-any-return]
    except OSError as exc:  # pragma: no cover - depends on local setup
        raise RuntimeError(
            f"spaCy model '{model_name}' is not available. Run 'python -m spacy download {model_name}' first."
        ) from exc
