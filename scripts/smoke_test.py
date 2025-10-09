#!/usr/bin/env python3
"""
End-to-end smoke test for the news aggregator pipeline.

Tests the full flow: ingestion → enrichment → classification → clustering → insights → export

Usage:
    # With LLM (requires API keys)
    env PYTHONPATH=. .venv/bin/python scripts/smoke_test.py

    # Without LLM (offline mode)
    env PYTHONPATH=. .venv/bin/python scripts/smoke_test.py --skip-llm

    # Verbose output
    env PYTHONPATH=. .venv/bin/python scripts/smoke_test.py --verbose
"""

import argparse
import asyncio
import json
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, select, func
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from backend.app.db.models import Base, Article, Event, EventArticle, LLMInsight
from backend.app.db.session import get_sessionmaker
from backend.app.services.enrich_service import ArticleEnrichmentService
from backend.app.services.event_service import EventService
from backend.app.services.insight_service import InsightService
from backend.app.services.export_service import ExportService
from backend.app.services.vector_index import VectorIndexService
from backend.app.llm.client import MistralClient
from backend.app.nlp.classify import classify_event_type_llm
from backend.app.core.config import get_settings


# ANSI color codes for output
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


def print_header(text: str):
    """Print a formatted header."""
    print(f"\n{Colors.BOLD}{Colors.HEADER}{'=' * 80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}{text}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}{'=' * 80}{Colors.ENDC}\n")


def print_success(text: str):
    """Print success message."""
    print(f"{Colors.OKGREEN}✓{Colors.ENDC} {text}")


def print_error(text: str):
    """Print error message."""
    print(f"{Colors.FAIL}✗{Colors.ENDC} {text}")


def print_warning(text: str):
    """Print warning message."""
    print(f"{Colors.WARNING}⚠{Colors.ENDC}  {text}")


def print_info(text: str):
    """Print info message."""
    print(f"{Colors.OKCYAN}ℹ{Colors.ENDC}  {text}")


class MockLLMClient:
    """Mock LLM client for offline testing."""

    async def generate_insight(self, prompt: str, event_id: int = None) -> dict:
        """Return mock insight data."""
        return {
            "summary": "Mock summary for smoke test",
            "timeline": [
                {
                    "timestamp": "2025-10-06T10:00:00Z",
                    "description": "Mock timeline event 1",
                    "source_urls": []
                },
                {
                    "timestamp": "2025-10-07T15:00:00Z",
                    "description": "Mock timeline event 2",
                    "source_urls": []
                }
            ],
            "clusters": [
                {
                    "angle": "Algemeen perspectief",
                    "description": "Mock cluster beschrijving",
                    "spectrum": "mainstream",
                    "sources": []
                }
            ],
            "contradictions": [],
            "fallacies": []
        }


async def mock_classify_event_type(title: str, content: str) -> str:
    """Mock event type classification based on keywords."""
    text = (title + " " + content).lower()

    if any(word in text for word in ["inbraak", "diefstal", "gestolen", "politie onderzoek"]):
        return "crime"
    elif any(word in text for word in ["kabinet", "minister", "tweede kamer", "klimaat", "wet"]):
        return "politics"
    elif any(word in text for word in ["eu", "europese", "migratie", "akkoord"]):
        return "international"
    elif any(word in text for word in ["oranje", "elftal", "wedstrijd", "koeman", "voetbal"]):
        return "sports"
    else:
        return "other"


class SmokeTestRunner:
    """Orchestrates the end-to-end smoke test."""

    def __init__(self, skip_llm: bool = False, verbose: bool = False):
        self.skip_llm = skip_llm
        self.verbose = verbose
        self.start_time = time.time()
        self.metrics = {
            "articles_loaded": 0,
            "articles_enriched": 0,
            "articles_classified": 0,
            "events_created": 0,
            "articles_clustered": 0,
            "insights_generated": 0,
            "errors": []
        }

        # Create temp database
        self.db_path = Path(tempfile.gettempdir()) / f"smoke_test_{int(time.time())}.db"
        self.db_url = f"sqlite+aiosqlite:///{self.db_path}"
        self.engine = None
        self.session_factory = None

        # Services
        self.enrich_service = None
        self.event_service = None
        self.insight_service = None
        self.export_service = None
        self.llm_client = None

    async def setup(self):
        """Set up database and services."""
        if self.verbose:
            print_info(f"Creating temporary database: {self.db_path}")

        # Create async engine and session factory
        self.engine = create_async_engine(self.db_url, echo=False)
        self.session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False
        )

        # Create tables
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # Initialize services
        self.enrich_service = ArticleEnrichmentService(session_factory=self.session_factory)
        self.event_service = EventService(session_factory=self.session_factory)
        self.export_service = ExportService(session_factory=self.session_factory)

        if self.skip_llm:
            self.llm_client = MockLLMClient()
            self.insight_service = None  # Will use mock
        else:
            try:
                self.llm_client = MistralClient()
                self.insight_service = InsightService(session_factory=self.session_factory)
            except Exception as e:
                print_warning(f"Failed to initialize LLM client: {e}")
                print_warning("Falling back to mock mode")
                self.skip_llm = True
                self.llm_client = MockLLMClient()
                self.insight_service = None

        print_success("Test environment initialized")

    async def load_fixtures(self) -> List[Dict]:
        """Load sample articles from fixtures."""
        fixtures_path = Path(__file__).parent.parent / "backend/tests/fixtures/smoke/sample_articles.json"

        if not fixtures_path.exists():
            raise FileNotFoundError(f"Fixtures not found: {fixtures_path}")

        with open(fixtures_path) as f:
            articles = json.load(f)

        self.metrics["articles_loaded"] = len(articles)
        print_success(f"Loaded {len(articles)} sample articles from fixtures")
        return articles

    async def ingest_articles(self, fixture_articles: List[Dict]):
        """Ingest articles into database."""
        print_info("Ingesting articles...")

        for article_data in fixture_articles:
            try:
                article = Article(
                    guid=article_data["url"],  # Using URL as GUID for smoke test
                    title=article_data["title"],
                    url=article_data["url"],
                    published_at=datetime.fromisoformat(article_data["published_at"].replace('Z', '+00:00')),
                    source_name=article_data["source_name"],
                    source_metadata={
                        "spectrum": article_data["source_spectrum"],
                        "expected_type": article_data.get("expected_type")
                    },
                    content=article_data["content"],
                    summary=article_data["content"][:200] + "...",
                )

                async with self.session_factory() as session:
                    session.add(article)
                    await session.commit()

                if self.verbose:
                    print_info(f"  Ingested: {article.title[:60]}...")

            except Exception as e:
                error_msg = f"Failed to ingest article: {e}"
                self.metrics["errors"].append(error_msg)
                print_error(error_msg)

        print_success(f"Ingested {self.metrics['articles_loaded']} articles")

    async def enrich_articles(self):
        """Run NLP enrichment on articles."""
        print_info("Running NLP enrichment (embeddings, entities, TF-IDF)...")

        async with self.session_factory() as session:
            result = await session.execute(select(Article))
            articles = list(result.scalars().all())

        # Enrich all articles by IDs
        article_ids = [a.id for a in articles]
        try:
            result = await self.enrich_service.enrich_by_ids(article_ids)
            enriched_count = result.get("processed", 0)

            if self.verbose:
                print_info(f"  Enriched {enriched_count} articles")

        except Exception as e:
            error_msg = f"Failed to enrich articles: {e}"
            self.metrics["errors"].append(error_msg)
            print_error(error_msg)
            enriched_count = 0

        self.metrics["articles_enriched"] = enriched_count
        print_success(f"Enriched {enriched_count}/{len(articles)} articles")

    async def classify_articles(self):
        """Classify articles using LLM or mock."""
        print_info(f"Classifying article event types {'(mock mode)' if self.skip_llm else '(LLM)'}...")

        async with self.session_factory() as session:
            result = await session.execute(
                select(Article).where(Article.embedding.isnot(None))
            )
            articles = list(result.scalars().all())

        classified_count = 0
        type_distribution = {}

        for article in articles:
            try:
                if self.skip_llm:
                    event_type = await mock_classify_event_type(article.title, article.content)
                else:
                    event_type = await classify_event_type_llm(
                        article.title,
                        article.content,
                        self.llm_client
                    )

                # Update article with event type
                async with self.session_factory() as session:
                    result = await session.execute(
                        select(Article).where(Article.id == article.id)
                    )
                    art = result.scalar_one()
                    art.event_type = event_type
                    await session.commit()

                classified_count += 1
                type_distribution[event_type] = type_distribution.get(event_type, 0) + 1

                if self.verbose:
                    print_info(f"  Classified as {event_type}: {article.title[:50]}...")

            except Exception as e:
                error_msg = f"Failed to classify article {article.id}: {e}"
                self.metrics["errors"].append(error_msg)
                print_error(error_msg)

        self.metrics["articles_classified"] = classified_count
        self.metrics["type_distribution"] = type_distribution

        print_success(f"Classified {classified_count} articles")
        print_info(f"Type distribution: {type_distribution}")

    async def cluster_events(self):
        """Cluster articles into events."""
        print_info("Clustering articles into events...")

        async with self.session_factory() as session:
            result = await session.execute(
                select(Article)
                .where(Article.embedding.isnot(None))
                .where(Article.event_type.isnot(None))
            )
            articles = list(result.scalars().all())

        clustered_count = 0
        for article in articles:
            try:
                result = await self.event_service.assign_article(article.id)

                if result.event_id:
                    clustered_count += 1
                    if self.verbose:
                        print_info(f"  Assigned to event {result.event_id}: {article.title[:50]}...")

            except Exception as e:
                error_msg = f"Failed to cluster article {article.id}: {e}"
                self.metrics["errors"].append(error_msg)
                print_error(error_msg)

        # Count events and get clustering stats
        async with self.session_factory() as session:
            events_count = await session.scalar(select(func.count(Event.id)))

            # Count multi-article events
            stmt = (
                select(Event.id, func.count(EventArticle.article_id).label('size'))
                .join(EventArticle)
                .group_by(Event.id)
            )
            result = await session.execute(stmt)
            event_sizes = list(result.all())

            multi_article_events = sum(1 for _, size in event_sizes if size >= 2)
            total_in_clusters = sum(size for _, size in event_sizes if size >= 2)

        self.metrics["events_created"] = events_count
        self.metrics["articles_clustered"] = total_in_clusters
        self.metrics["multi_article_events"] = multi_article_events

        clustering_rate = (total_in_clusters / len(articles) * 100) if articles else 0

        print_success(f"Created {events_count} events")
        print_info(f"Multi-article events: {multi_article_events}")
        print_info(f"Articles in clusters: {total_in_clusters}/{len(articles)} ({clustering_rate:.1f}%)")

    async def generate_insights(self):
        """Generate LLM insights for events."""
        if self.skip_llm:
            print_info("Generating insights (mock mode)...")

            async with self.session_factory() as session:
                stmt = select(Event).where(Event.article_count > 0)
                result = await session.execute(stmt)
                events = list(result.scalars().all())

            for event in events:
                try:
                    mock_data = await self.llm_client.generate_insight("", event.id)

                    insight = LLMInsight(
                        event_id=event.id,
                        provider="mock",
                        model="mock-model-v1",
                        summary=mock_data["summary"],
                        timeline=mock_data["timeline"],
                        clusters=mock_data["clusters"],
                        contradictions=mock_data["contradictions"],
                        fallacies=mock_data["fallacies"]
                    )

                    async with self.session_factory() as session:
                        session.add(insight)
                        await session.commit()

                    self.metrics["insights_generated"] += 1

                    if self.verbose:
                        print_info(f"  Generated mock insight for event {event.id}")

                except Exception as e:
                    error_msg = f"Failed to generate mock insight for event {event.id}: {e}"
                    self.metrics["errors"].append(error_msg)
                    print_error(error_msg)

            print_success(f"Generated {self.metrics['insights_generated']} mock insights")

        else:
            print_info("Generating insights with LLM...")

            async with self.session_factory() as session:
                stmt = select(Event).where(Event.article_count > 0)
                result = await session.execute(stmt)
                events = list(result.scalars().all())

            for event in events:
                try:
                    result = await self.insight_service.generate_for_event(
                        event.id,
                        correlation_id=f"smoke-test-{event.id}"
                    )

                    if result:
                        self.metrics["insights_generated"] += 1

                        if self.verbose:
                            print_info(f"  Generated insight for event {event.id}")

                except Exception as e:
                    error_msg = f"Failed to generate insight for event {event.id}: {e}"
                    self.metrics["errors"].append(error_msg)
                    print_error(error_msg)

            print_success(f"Generated {self.metrics['insights_generated']} insights")

    async def export_csv(self) -> Optional[Path]:
        """Export events to CSV."""
        print_info("Exporting events to CSV...")

        try:
            # Export events (service writes the file and returns the path)
            csv_path = await self.export_service.generate_events_csv()

            print_success(f"Exported CSV: {csv_path}")
            return csv_path

        except Exception as e:
            error_msg = f"Failed to export CSV: {e}"
            self.metrics["errors"].append(error_msg)
            print_error(error_msg)
            return None

    def print_summary(self, csv_path: Optional[Path] = None):
        """Print final test summary."""
        elapsed = time.time() - self.start_time

        print_header("🎉 SMOKE TEST SUMMARY")

        print(f"{Colors.BOLD}Test Configuration:{Colors.ENDC}")
        print(f"  • Mode: {'Mock LLM (offline)' if self.skip_llm else 'Real LLM'}")
        print(f"  • Database: {self.db_path}")
        print(f"  • Duration: {elapsed:.2f}s")
        print()

        print(f"{Colors.BOLD}Pipeline Results:{Colors.ENDC}")
        print(f"  • Articles loaded: {self.metrics['articles_loaded']}")
        print(f"  • Articles enriched: {self.metrics['articles_enriched']}")
        print(f"  • Articles classified: {self.metrics['articles_classified']}")
        print(f"  • Events created: {self.metrics['events_created']}")
        print(f"  • Multi-article events: {self.metrics.get('multi_article_events', 0)}")
        print(f"  • Articles in clusters: {self.metrics['articles_clustered']}")

        if self.metrics['articles_loaded'] > 0:
            clustering_rate = (self.metrics['articles_clustered'] / self.metrics['articles_loaded']) * 100
            print(f"  • Clustering rate: {clustering_rate:.1f}%")

        print(f"  • Insights generated: {self.metrics['insights_generated']}")
        print()

        if "type_distribution" in self.metrics:
            print(f"{Colors.BOLD}Event Type Distribution:{Colors.ENDC}")
            for event_type, count in sorted(self.metrics["type_distribution"].items()):
                print(f"  • {event_type}: {count}")
            print()

        if csv_path:
            print(f"{Colors.BOLD}Export:{Colors.ENDC}")
            print(f"  • CSV file: {csv_path}")
            print()

        if self.metrics["errors"]:
            print(f"{Colors.BOLD}{Colors.FAIL}Errors ({len(self.metrics['errors'])}):{Colors.ENDC}")
            for error in self.metrics["errors"][:5]:  # Show first 5 errors
                print(f"  • {error}")
            if len(self.metrics["errors"]) > 5:
                print(f"  • ... and {len(self.metrics['errors']) - 5} more")
            print()

        # Overall status
        if self.metrics["errors"]:
            print_warning(f"Test completed with {len(self.metrics['errors'])} errors")
        else:
            print_success("All pipeline stages completed successfully!")

    async def cleanup(self):
        """Clean up resources."""
        if self.engine:
            await self.engine.dispose()

        if self.verbose and self.db_path.exists():
            print_info(f"Temporary database kept at: {self.db_path}")
            print_info("Delete manually if not needed for inspection")

    async def run(self):
        """Run the complete smoke test."""
        try:
            print_header("🔥 NEWS AGGREGATOR SMOKE TEST")

            # Setup
            await self.setup()

            # Load fixtures
            fixture_articles = await self.load_fixtures()

            # Pipeline stages
            await self.ingest_articles(fixture_articles)
            await self.enrich_articles()
            await self.classify_articles()
            await self.cluster_events()
            await self.generate_insights()

            # Export
            csv_path = await self.export_csv()

            # Summary
            self.print_summary(csv_path)

            # Cleanup
            await self.cleanup()

            # Exit code
            return 0 if not self.metrics["errors"] else 1

        except Exception as e:
            print_error(f"Smoke test failed: {e}")
            import traceback
            traceback.print_exc()
            return 1


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="End-to-end smoke test for news aggregator pipeline"
    )
    parser.add_argument(
        "--skip-llm",
        action="store_true",
        help="Skip LLM calls (use mock data for offline testing)"
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Verbose output"
    )

    args = parser.parse_args()

    runner = SmokeTestRunner(skip_llm=args.skip_llm, verbose=args.verbose)
    exit_code = await runner.run()

    sys.exit(exit_code)


if __name__ == "__main__":
    asyncio.run(main())
