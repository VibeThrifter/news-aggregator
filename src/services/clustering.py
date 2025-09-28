from __future__ import annotations

from collections import Counter, defaultdict
from typing import Iterable, List, Sequence

from src.models import Article, Cluster
from src.services.summarizer import ClusterSummarizer

try:
    from sklearn.cluster import KMeans
    from sklearn.feature_extraction.text import TfidfVectorizer
except ImportError:  # pragma: no cover
    KMeans = None  # type: ignore
    TfidfVectorizer = None  # type: ignore


DUTCH_STOPWORDS = [
    # Minimal lijst om typische signaalwoorden te dempen zonder externe packages
    "de",
    "het",
    "een",
    "en",
    "of",
    "dat",
    "die",
    "voor",
    "met",
    "van",
    "op",
    "te",
    "aan",
    "in",
    "uit",
    "bij",
    "als",
    "maar",
    "om",
    "niet",
    "wel",
    "kan",
    "wordt",
    "nog",
    "heeft",
    "hebben",
    "dit",
    "ook",
    "zijn",
    "over",
    "naar",
    "meer",
    "geen",
    "al",
    "door",
    "zoals",
    "dan",
    "we",
    "ze",
    "hun",
]


def _clean_token(token: str) -> str:
    cleaned = "".join(ch for ch in token if ch.isalnum() or ch == "-")
    return cleaned.strip("-")


def _extract_tokens(*texts: str) -> List[str]:
    tokens: List[str] = []
    for text in texts:
        for raw in text.lower().split():
            cleaned = _clean_token(raw)
            if cleaned and cleaned not in DUTCH_STOPWORDS and len(cleaned) > 2:
                tokens.append(cleaned)
    return tokens


def _vectorize(articles: Sequence[Article]):
    if not TfidfVectorizer:
        return None, None
    texts = [article.title + " " + article.summary for article in articles]
    vectorizer = TfidfVectorizer(stop_words=DUTCH_STOPWORDS)
    matrix = vectorizer.fit_transform(texts)
    return matrix, vectorizer


def _choose_cluster_count(count: int) -> int:
    if count <= 3:
        return count
    if count <= 6:
        return 3
    return min(5, count // 2)


def cluster_articles(
    articles: Sequence[Article],
    query: str,
    summarizer: ClusterSummarizer | None = None,
    mode: str = "algorithm",
) -> List[Cluster]:
    summarizer = summarizer or ClusterSummarizer()
    if not articles:
        return []

    clusters: dict[int | str, List[Article]] = defaultdict(list)
    cluster_keywords: dict[int | str, List[str]] = defaultdict(list)
    method = "kmeans"
    fallback_mode = False

    if mode == "medium":
        method = "medium-groups"
        for article in articles:
            clusters[article.medium].append(article)
            tokens = _extract_tokens(article.title, article.summary)
            cluster_keywords[article.medium].extend(tokens[:8])
    else:
        matrix, vectorizer = _vectorize(articles)
        if matrix is not None and KMeans is not None:
            cluster_count = _choose_cluster_count(len(articles))
            model = KMeans(n_clusters=cluster_count, n_init="auto", random_state=13)
            labels = model.fit_predict(matrix)
            terms = vectorizer.get_feature_names_out()
            centroids = model.cluster_centers_
            top_indices = centroids.argsort(axis=1)[:, -6:][:, ::-1]
            for cluster_id, indices in enumerate(top_indices):
                keyword_list: List[str] = []
                for rank, idx in enumerate(indices, start=1):
                    term = terms[idx]
                    weight = len(indices) - rank + 1
                    keyword_list.extend([term] * weight)
                cluster_keywords[cluster_id] = keyword_list
            for article, label in zip(articles, labels):
                clusters[label].append(article)
        else:
            fallback_mode = True
            method = "spectrum-fallback"
            for article in articles:
                key = article.political_spectrum
                clusters[key].append(article)
                tokens = _extract_tokens(article.title, article.summary)
                cluster_keywords[key].extend(tokens[:8])

    cluster_objects: List[Cluster] = []
    for idx, (label, items) in enumerate(clusters.items(), start=1):
        key_terms_raw = cluster_keywords.get(label, [])
        term_counts = Counter(key_terms_raw)
        key_terms = [term for term, _ in term_counts.most_common(10)]
        spectrum_counter = Counter(article.political_spectrum for article in items)
        dominant_spectrum = spectrum_counter.most_common(2)
        spectrum_description = ", ".join(f"{name} ({count})" for name, count in dominant_spectrum)
        medium_counter = Counter(article.medium for article in items)
        dominant_medium = None
        if medium_counter:
            dominant_medium = medium_counter.most_common(1)[0][0]
        summary = summarizer.summarize(
            topic=query,
            articles=items,
            key_terms=key_terms,
            clustering_method=method,
            mode=mode,
        )
        description = summary.description
        if fallback_mode:
            description += " (Fallback: geclusterd op politieke duiding omdat ML-modules ontbreken.)"
        base_label = f"Cluster {idx}"
        if mode == "medium":
            base_label = f"Medium: {label}" if isinstance(label, str) else base_label
        elif fallback_mode:
            base_label = f"Spectrum: {label}" if isinstance(label, str) else base_label
        cluster_label = summary.name or base_label
        cluster_objects.append(
            Cluster(
                label=cluster_label,
                description=description,
                political_mix=spectrum_description,
                sources=sorted(items, key=lambda x: x.source_name),
                dominant_medium=dominant_medium,
                method=method,
                keywords=term_counts.most_common(12),
            )
        )
    return cluster_objects
