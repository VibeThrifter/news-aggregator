from __future__ import annotations

from backend.app.nlp.tfidf import TfidfVectorizerManager


def test_tfidf_manager_fits_and_transforms(tmp_path):
    cache_path = tmp_path / "tfidf.joblib"
    manager = TfidfVectorizerManager(cache_path=cache_path, max_features=1000)

    corpus = ["demonstranten verzamelen zich", "politie sluit wegen af"]
    manager.fit(corpus)

    vector = manager.transform("demonstranten verzamelen zich vreedzaam")
    assert any(term.startswith("demonstranten") for term in vector.keys())
    assert cache_path.exists()
