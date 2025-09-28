from __future__ import annotations

from typing import List

from src.models import Cluster
from src.services.clustering import cluster_articles
from src.services.fetchers import fetch_articles_for_query
from src.services.summarizer import ClusterSummarizer


def run_aggregation(query: str, mode: str = "algorithm") -> List[Cluster]:
    articles = fetch_articles_for_query(query)
    summarizer = ClusterSummarizer()
    clusters = cluster_articles(articles, query=query, summarizer=summarizer, mode=mode)
    return clusters
