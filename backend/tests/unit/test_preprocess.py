from __future__ import annotations

from backend.app.nlp.preprocess import TextPreprocessor


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


def test_preprocessor_removes_stopwords_and_normalizes():
    stopwords = {"de", "het", "een"}
    dummy_model = DummyModel(stopwords)

    preprocessor = TextPreprocessor(model=dummy_model)
    result = preprocessor.normalize("De demonstranten waren druk in Den Haag.")

    assert "de" not in result.tokens
    assert "demonstranten" in result.tokens
    assert result.normalized_text.startswith("demonstranten")
    assert all(token.islower() for token in result.tokens)
