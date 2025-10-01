from __future__ import annotations

from typing import List

import pytest

from backend.app.nlp.embeddings import EmbeddingService


import numpy as np


class DummySentenceTransformer:
    def __init__(self, *args, **kwargs):
        self.calls: List[List[str]] = []

    def encode(self, texts, normalize_embeddings=True, convert_to_numpy=False, show_progress_bar=False):
        if isinstance(texts, list):
            self.calls.append(texts)
            return np.array([[float(index + 1) for index in range(3)] for _ in texts])
        self.calls.append([texts])
        return np.array([0.1, 0.2, 0.3])


@pytest.mark.asyncio
async def test_embedding_service_uses_cached_model(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "backend.app.nlp.embeddings.SentenceTransformer",
        lambda *args, **kwargs: DummySentenceTransformer(),
    )

    service = EmbeddingService(model_name="dummy", cache_dir=tmp_path)

    vector_single = await service.embed("test tekst")
    vector_many = await service.embed_many(["eerste", "tweede"])

    assert len(vector_single) == 3
    assert len(vector_many) == 2
    assert all(len(vec) == 3 for vec in vector_many)
