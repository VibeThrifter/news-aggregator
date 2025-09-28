# Implementation Stories

> Hulpscripts voor manuele checks staan in `/scripts` (bv. `test_rss_feeds.py` voor RSS-verificatie).

## Completion Tracker

| Story ID | Status | Completed On | Notes |
| --- | --- | --- | --- |
| 0.1 | Done | 2025-09-28 | pytest installed locally; env template test green |
| 0.2 | Done | 2025-09-28 | Backend + frontend tooling bootstrap completed |
| 0.3 | Done | 2025-09-28 | Configuration loader and structured logging implemented |
| 1.1 | Done | 2025-09-28 | RSS Feed Plugin Framework implemented with NOS & NU.nl readers |
| 1.2 | Done | 2025-09-28 | Article Fetching, Extraction, and Normalization Pipeline implemented |
| 1.3 |  |  |  |
| 2.1 |  |  |  |
| 2.2 |  |  |  |
| 2.3 |  |  |  |
| 3.1 |  |  |  |
| 3.2 |  |  |  |
| 3.3 |  |  |  |
| 4.1 |  |  |  |
| 4.2 |  |  |  |
| 4.3 |  |  |  |
| 5.1 |  |  |  |
| 5.2 |  |  |  |
| 5.3 |  |  |  |

---
**Story ID:** 0.1
**Epic ID:** Epic 0 – Provisioning & Ops Setup
**Title:** Establish Environment Template and Secrets Guidance
**Objective:** Provide a canonical environment template and documentation so developers can configure credentials and runtime parameters consistently before running the stack.
**Background/Context:**
- Source: docs/PRD.md (Epic 0 – Story 0.1 requirement for `.env` setup).
- Reference: docs/architecture.md (Initial Project Setup – Steps 1-3; Patterns and Standards – Coding Standards).
- Target Paths: `.env.example`, `README.md` (setup section), `backend/tests/unit/test_env_template.py`.
- Ensure placeholder values cover RSS feeds, scheduler cadence, database URL, LLM config, embedding model, and logging level.
**Acceptance Criteria (AC):**
- Given the repository when a developer opens `.env.example`, then it lists all required variables with descriptive placeholder values and inline comments for NOS/NU RSS URLs, scheduler interval, SQLite path, embedding model, and Mistral credentials.
- Given `.env.example` when parsed in the unit test with `dotenv_values`, then the test confirms every required key exists and placeholder values are non-empty strings.
- Given `README.md` when a new developer follows the environment setup instructions, then they can copy `.env.example` to `.env` and understand which secrets they must obtain manually.
**Subtask Checklist:**
- [x] Create `.env.example` at the repo root with documented placeholders for `MISTRAL_API_KEY`, `RSS_NOS_URL`, `RSS_NUNL_URL`, `SCHEDULER_INTERVAL_MINUTES`, `DATABASE_URL`, `EMBEDDING_MODEL_NAME`, `LLM_PROVIDER`, `LOG_LEVEL`.
- [x] Update `README.md` setup section with explicit copy instructions and a link back to docs/architecture.md Initial Project Setup.
- [x] Add `backend/tests/unit/test_env_template.py` verifying `.env.example` contains the required keys using `dotenv_values` from `python-dotenv`.
- [x] Ensure unit test imports adhere to Architecture.md Patterns and Standards – Coding Standards (type hints, snake_case, AAA pattern).
- [x] Run `pytest backend/tests/unit/test_env_template.py` and confirm it passes.
- [x] Stage updated files.
- [x] MANUAL STEP: Copy `.env.example` to `.env` locally and populate secrets (Mistral API key, optional overrides) before running the stack.
**Testing Requirements:**
- Unit Tests via `pytest` (≥80% coverage target applies overall; this story adds the new test to the suite).
- Definition of Done: all ACs satisfied, unit test passing.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** OpenAI GPT-5 Codex (CLI)
- **Agent Credit or Cost:** N/A (local execution)
- **Date/Time Completed:** 2025-09-28T14:25:02Z
- **Commit Hash:** _pending user commit_
- **Change Log:** Added `.env.example`, updated `README.md` setup, and created env template pytest guard.

---
**Story ID:** 0.2
**Epic ID:** Epic 0 – Provisioning & Ops Setup
**Title:** Bootstrap Backend & Frontend Tooling
**Objective:** Deliver reproducible dependency management and helper scripts so contributors can spin up the backend and frontend toolchains consistently.
**Background/Context:**
- Source: docs/PRD.md (Epic 0 – Story 0.2).
- Reference: docs/architecture.md (Technology Table; Initial Project Setup; Testing Requirements and Framework).
- Target Paths: `requirements.txt`, `Makefile`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/tailwind.config.ts`, documentation updates.
- Align commands with Architecture.md (use venv + pip for backend, Node 20+ with Next.js for frontend).
**Acceptance Criteria (AC):**
- Given a clean clone when a developer runs `make setup` (or documented equivalent), then backend virtual environment and frontend npm packages install without errors.
- Given the backend project when `source .venv/bin/activate && python --version` runs, then it reports Python 3.12 and all imports work correctly.
- Given the frontend when `npm run lint` executes, then ESLint runs using the configured Next.js preset without fatal errors.
**Subtask Checklist:**
- [x] Maintain `requirements.txt` with backend dependencies listed in docs/architecture.md Technology Table (FastAPI, SQLAlchemy, etc.).
- [x] Add a root `Makefile` with targets `setup`, `backend-install`, `frontend-install`, `test`, delegating to venv/pip and npm scripts.
- [x] Ensure `Makefile` commands respect Architecture.md Patterns and Standards – Coding Standards (naming, logging).
- [x] Update/initialize `frontend/package.json` with Next.js 14, Tailwind 3.4, ESLint config, scripts (`dev`, `build`, `lint`, `test`).
- [x] Commit `frontend/package-lock.json` (Node 20).
- [x] Document the `make setup` workflow in `README.md` with fallback commands.
- [x] Validate backend install via `source .venv/bin/activate && pip install -r requirements.txt`.
- [x] Validate frontend install via `npm install` inside `frontend/`.
- MANUAL STEP: Install Python 3.12 and Node.js ≥20 on the local machine before running `make setup`.
**Testing Requirements:**
- Manual verification: run `make setup`, `make validate`, and `npm run lint` without errors.
- Definition of Done: ACs satisfied, install commands confirmed locally.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** Claude Sonnet 4 (claude-sonnet-4-20250514)
- **Agent Credit or Cost:** N/A (local execution)
- **Date/Time Completed:** 2025-09-28T16:00:00Z
- **Commit Hash:** _pending user commit_
- **Change Log:** Completed backend + frontend tooling bootstrap:
  - Updated architecture from Poetry to venv + pip approach (Python 3.12)
  - Created comprehensive Makefile with all development targets
  - Updated frontend package.json with Next.js 14.2.33, React 18.2, Tailwind 3.4
  - Added ESLint configuration for frontend linting
  - Updated README.md with make setup workflow and manual fallback commands
  - All tests passing: make validate ✅, npm run lint ✅
  - Ready for Story 0.3 (Configuration Loader implementation)

---
**Story ID:** 0.3
**Epic ID:** Epic 0 – Provisioning & Ops Setup
**Title:** Implement Configuration Loader and Structured Logging Foundation
**Objective:** Provide reusable configuration and logging utilities that load environment variables, validate them, and emit structured logs used across the backend services.
**Background/Context:**
- Source: docs/PRD.md (Epic 0 – Story 0.3).
- Reference: docs/architecture.md (Project Structure – `backend/app/core/config.py`, `backend/app/core/logging.py`; Patterns and Standards – Error Handling Strategy; Technology Table – structlog, Pydantic).
- Target Paths: `backend/app/core/config.py`, `backend/app/core/logging.py`, `backend/app/core/__init__.py`, `backend/tests/unit/test_config.py`, `backend/tests/unit/test_logging.py`.
**Acceptance Criteria (AC):**
- Given a populated `.env` when `Settings()` from `backend.app.core.config` is instantiated, then all required fields (RSS URLs, scheduler interval, database URL, embedding model, LLM settings) are validated with correct types and defaults.
- Given a missing required variable when `Settings()` loads, then a `ValidationError` is raised and the logger records a clear error per the Architecture.md Error Handling Strategy.
- Given `structlog` configured when `logger.bind(correlation_id=...)` is used in any module, then log output includes JSON-formatted records with shared context (timestamp, level, name, correlation_id).
**Subtask Checklist:**
- [x] Implement `Settings` class in `backend/app/core/config.py` using `pydantic_settings.BaseSettings` pulling values from environment with defaults where appropriate (e.g., `DATABASE_URL=sqlite+aiosqlite:///./data/db.sqlite`).
- [x] Provide helper functions to return typed settings and an env validation CLI (`python -m backend.app.core.config --check`).
- [x] Implement `configure_logging()` in `backend/app/core/logging.py` using `structlog` and standard library logging integration.
- [x] Ensure logging setup respects Architecture.md Patterns – Error Handling (correlation IDs, exception rendering).
- [x] Call `configure_logging()` during FastAPI startup hook placeholder (e.g., in `backend/app/api/main.py`).
- [x] Write `backend/tests/unit/test_config.py` covering happy path, missing variables, default overrides (use `monkeypatch`).
- [x] Write `backend/tests/unit/test_logging.py` ensuring structured logs include bound context fields.
- [x] Update `Makefile` `test` target to include unit tests.
- [x] Run `pytest backend/tests/unit/test_config.py backend/tests/unit/test_logging.py` and ensure success.
**Testing Requirements:**
- Unit Tests via `pytest` (maintain ≥80% coverage for `backend/app/core`).
- Definition of Done: All ACs met, unit tests passing, linting per project standards.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** Claude Sonnet 4 (claude-sonnet-4-20250514)
- **Agent Credit or Cost:** N/A (local execution)
- **Date/Time Completed:** 2025-09-28T18:30:00Z
- **Commit Hash:** _pending user commit_
- **Change Log:** Completed configuration loader and structured logging foundation:
  - Implemented Settings class with Pydantic BaseSettings for environment variable management
  - Added comprehensive configuration validation with CLI tool (python -m backend.app.core.config --check)
  - Implemented structured logging with structlog and correlation ID support
  - Created JSON and console formatters for development and production environments
  - Added correlation ID middleware for request tracing
  - Created comprehensive unit test suites (27 tests) covering all functionality
  - Updated requirements.txt with new dependencies (pydantic-settings, structlog, pytest)
  - All tests passing: make test ✅, make validate ✅
  - Ready for Story 1.1 (RSS Feed Plugin Framework)

---
**Story ID:** 1.1
**Epic ID:** Epic 1 – Ingest & Preprocessing Backbone
**Title:** Implement RSS Feed Plugin Framework with NOS & NU.nl Readers
**Objective:** Create a pluggable feed reader layer that polls NOS and NU.nl RSS feeds, normalizes entries, and exposes them to the ingest pipeline.
**Background/Context:**
- Source: docs/PRD.md (Epic 1 – Story 1.1).
- Reference: docs/architecture.md (Project Structure – `backend/app/feeds`; Component View – Feed Reader Plugins; Technology Table – feedparser; Patterns and Standards – Strategy Pattern for feed readers).
- Target Paths: `backend/app/feeds/base.py`, `backend/app/feeds/nos.py`, `backend/app/feeds/nunl.py`, `backend/app/services/ingest_service.py` (registration), `backend/tests/unit/test_feeds.py`, fixtures under `backend/tests/fixtures/rss/`.
**Acceptance Criteria (AC):**
- Given a registered feed reader when APScheduler triggers `poll_feeds`, then each active reader fetches entries and returns normalized `FeedItem` objects with source metadata and ISO timestamps.
- Given the NOS and NU.nl feeds when the reader encounters duplicate `guid` or URLs, then duplicates are filtered before returning.
- Given a network or parsing failure when fetching a feed, then the reader logs the error with context and retries once using exponential backoff without crashing the scheduler job.
**Subtask Checklist:**
- [x] Define an abstract `FeedReader` base class in `backend/app/feeds/base.py` with methods `id`, `source_metadata`, and `fetch()`.
- [x] Implement `NosRssReader` and `NuRssReader` using `feedparser` with HTTPX fallback, normalizing to a shared dataclass or Pydantic model.
- [x] Register available readers in `backend/app/services/ingest_service.py` and expose a `poll_feeds()` orchestration method.
- [x] Add retry logic (e.g., `tenacity`) per Architecture.md Error Handling Strategy.
- [x] Create sample RSS fixtures in `backend/tests/fixtures/rss/` and unit tests covering parsing, dedupe, error logging.
- [x] Update scheduler stub in `backend/app/core/scheduler.py` to call `poll_feeds()`.
- [x] Run unit tests `pytest backend/tests/unit/test_feeds.py`.
**Testing Requirements:**
- Unit Tests via `pytest` (mock HTTP requests, use fixtures).
- Definition of Done: ACs met, tests passing, logging verified via assertions.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** Claude Sonnet 4 (claude-sonnet-4-20250514)
- **Agent Credit or Cost:** N/A (local execution)
- **Date/Time Completed:** 2025-09-28T18:45:00Z
- **Commit Hash:** _pending user commit_
- **Change Log:** Completed RSS Feed Plugin Framework implementation:
  - Created abstract FeedReader base class with FeedItem data model and error handling
  - Implemented NosRssReader and NuRssReader with feedparser and HTTPX
  - Added tenacity retry logic with exponential backoff for network errors
  - Created IngestService for orchestrating feed polling across multiple sources
  - Built NewsAggregatorScheduler with APScheduler integration
  - Added comprehensive unit tests (20 tests) covering all functionality
  - Created RSS fixtures for testing with sample NOS and NU.nl feeds
  - All tests passing: pytest backend/tests/unit/test_feeds.py ✅
  - Dependencies added: feedparser, tenacity, python-dateutil, apscheduler, pytest-asyncio
  - Ready for Story 1.2 (Article Fetching, Extraction, and Normalization Pipeline)

---
**Story ID:** 1.2
**Epic ID:** Epic 1 – Ingest & Preprocessing Backbone
**Title:** Build Article Fetching, Extraction, and Normalization Pipeline
**Objective:** Download article HTML, extract readable text, deduplicate by URL, and persist normalized article records in the database.
**Background/Context:**
- Source: docs/PRD.md (Epic 1 – Story 1.2).
- Reference: docs/architecture.md (Project Structure – `backend/app/ingestion`, `backend/app/repositories/article_repo.py`; Data Model – `articles` table).
- Target Paths: `backend/app/ingestion/fetcher.py`, `backend/app/ingestion/parser.py`, `backend/app/services/ingest_service.py`, `backend/app/repositories/article_repo.py`, `backend/tests/integration/test_article_ingestion.py`, fixture HTML under `backend/tests/fixtures/html/`.
**Acceptance Criteria (AC):**
- Given a new feed item when the ingest service fetches its URL, then the normalized article stored in the database includes clean text (no HTML tags), summary/snippet, publication timestamp, and source metadata.
- Given a duplicate URL already stored when the ingest pipeline executes, then the repository skips insertion and logs a dedupe notice without raising an exception.
- Given an article fetch that fails (timeout, 404), then the pipeline records the failure in logs and returns a recoverable error that does not halt other items.
**Subtask Checklist:**
- [x] Implement `fetch_article_html` in `backend/app/ingestion/fetcher.py` using async HTTPX with timeout and retries, respecting Architecture.md Error Handling Strategy.
- [x] Implement `parse_article_html` in `backend/app/ingestion/parser.py` using Trafilatura, returning normalized text and summary.
- [x] Extend `article_repo.py` with `upsert_from_feed_item` that enforces URL uniqueness and stores metadata/summary/content.
- [x] Orchestrate ingest in `services/ingest_service.py` to fetch → parse → persist, integrating with Story 1.1 output.
- [x] Create integration test `backend/tests/integration/test_article_ingestion.py` using temporary SQLite database (via fixtures) and sample HTML to verify dedupe and error handling.
- [x] Update logging to include `correlation_id` from scheduler context.
- [x] Run `PYTHONPATH=. .venv/bin/pytest backend/tests/integration/test_article_ingestion.py`.
**Testing Requirements:**
- Integration Tests via `pytest` (temporary SQLite, fixture HTML).
- Definition of Done: ACs satisfied, tests passing, linting & mypy clean.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** Claude Sonnet 4 (claude-sonnet-4-20250514)
- **Agent Credit or Cost:** N/A (local execution)
- **Date/Time Completed:** 2025-09-28T21:20:00Z
- **Commit Hash:** 08a28bb
- **Change Log:** Story 1.2 was already implemented as part of Story 1.1 completion:
  - Async article fetching with HTTPX, tenacity retry logic, and structured logging
  - Trafilatura-based HTML parsing with clean text extraction and fallback summaries
  - ArticleRepository with URL-based deduplication and comprehensive persistence logic
  - IngestService orchestration integrating RSS feeds → article fetch → parse → persist pipeline
  - Integration tests covering successful ingestion, duplicate handling, and error resilience
  - All acceptance criteria met: clean text storage, URL deduplication, graceful error handling
  - Tests passing: 3/3 integration tests ✅

---
**Story ID:** 1.3
**Epic ID:** Epic 1 – Ingest & Preprocessing Backbone
**Title:** Implement NLP Enrichment Pipeline (Normalization, Embeddings, TF-IDF, NER)
**Objective:** Transform stored articles into enriched records with normalized text, sentence embeddings, TF-IDF vectors, and named entities ready for event detection.
**Background/Context:**
- Source: docs/PRD.md (Epic 1 – Story 1.3).
- Reference: docs/architecture.md (Project Structure – `backend/app/nlp`; Technology Table – sentence-transformers, spaCy, scikit-learn; Data Model – `articles` enrichment columns).
- Target Paths: `backend/app/nlp/preprocess.py`, `backend/app/nlp/embeddings.py`, `backend/app/nlp/tfidf.py`, `backend/app/nlp/ner.py`, `backend/app/services/enrich_service.py`, `backend/tests/unit/test_preprocess.py`, `backend/tests/unit/test_embeddings.py`, `backend/tests/integration/test_enrichment_pipeline.py`, data cache folder `data/models/`.
**Acceptance Criteria (AC):**
- Given a stored article when the enrichment service runs, then the article row is updated with normalized tokens, embedding vector (serialized), TF-IDF vector, and extracted entities as JSON.
- Given repeated enrichment runs when the TF-IDF model has been persisted, then it reuses the cached vectorizer to avoid recomputation and completes within the target <1s per article.
- Given the spaCy model missing during initialization, then enrichment aborts with a descriptive error prompting the manual download step (Story 0.1 manual instructions).
**Subtask Checklist:**
- [ ] Implement text normalization utilities (lowercase, stopword removal, lemmatization hooks) in `preprocess.py`.
- [ ] Wrap sentence-transformers model loading with lazy singleton in `embeddings.py`, allowing model name override from settings.
- [ ] Build TF-IDF vectorizer module with joblib persistence to `data/models/tfidf.pkl` and helper to update vocabulary incrementally.
- [ ] Implement spaCy NER wrapper in `ner.py` using `nl_core_news_lg`, returning entities with type labels.
- [ ] Create `enrich_service.py` orchestrating the sequence (load article → preprocess → embed → tfidf → NER → persist via repository layer).
- [ ] Add unit tests for preprocessing normalization and embedding output shape (mock actual model).
- [ ] Add integration test using in-memory SQLite verifying article enrichment end-to-end.
- [ ] Update Makefile to include `source .venv/bin/activate && python -m spacy download nl_core_news_lg` in setup docs reference.
- MANUAL STEP: Ensure the spaCy model `nl_core_news_lg` is downloaded (`source .venv/bin/activate && python -m spacy download nl_core_news_lg`).
**Testing Requirements:**
- Unit & Integration Tests via `pytest` (mock heavy models where possible to keep runtime acceptable; maintain coverage target).
- Definition of Done: ACs met, tests passing, persisted vectorizer verified.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 2.1
**Epic ID:** Epic 2 – Event Detection Service
**Title:** Initialize Vector Index and Candidate Retrieval Service
**Objective:** Provide a persistent hnswlib vector index for event centroids and expose retrieval APIs to fetch top-k candidate events constrained by recency.
**Background/Context:**
- Source: docs/PRD.md (Epic 2 – Story 2.1).
- Reference: docs/architecture.md (Project Structure – `backend/app/services/vector_index.py`; Data Models – events centroids; context-events.md algorithm: Event Candidate Search).
- Target Paths: `backend/app/services/vector_index.py`, `backend/app/events/__init__.py`, `backend/tests/unit/test_vector_index.py`, storage path `data/vector_index.bin`.
**Acceptance Criteria (AC):**
- Given existing events with centroid embeddings when the index service builds the index, then it persists `vector_index.bin` (with metadata) and supports reload on process restart.
- Given a new article embedding and timestamp when `query_candidates` is invoked, then it returns up to top-k event IDs filtered to those active within the configured time window (default 7 days).
- Given the index has no entries or the query timestamp is older than the retention window, then the service returns an empty list without raising errors.
**Subtask Checklist:**
- [ ] Implement `VectorIndexService` encapsulating hnswlib index management (build, upsert, delete, query) with settings from `config.py`.
- [ ] Store index metadata (dimension, ef, m) in adjacent JSON to support validation on load.
- [ ] Integrate with repositories to rebuild index from DB when missing or corrupted.
- [ ] Provide async-safe locking (file lock) when writing the index file.
- [ ] Write unit tests using small-dimensional sample embeddings to validate build/load/query/empty states.
- [ ] Document index path and parameters in `README.md` and Architecture change log if necessary.
- [ ] Run `pytest backend/tests/unit/test_vector_index.py`.
**Testing Requirements:**
- Unit Tests via `pytest` (mock filesystem using tmp_path fixtures).
- Definition of Done: ACs met, tests pass, lint/type checks clean.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 2.2
**Epic ID:** Epic 2 – Event Detection Service
**Title:** Implement Hybrid Event Scoring and Assignment Engine
**Objective:** Calculate the combined similarity score for article-event pairs and decide whether to append to an existing event or create a new one based on thresholds.
**Background/Context:**
- Source: docs/PRD.md (Epic 2 – Story 2.2).
- Reference: docs/context-events.md (Scoring Step, Decision Step); docs/architecture.md (Project Structure – `backend/app/events/scoring.py`, `backend/app/services/event_service.py`; Data Models – events & event_articles).
- Target Paths: `backend/app/events/scoring.py`, `backend/app/services/event_service.py`, `backend/tests/unit/test_scoring.py`, `backend/tests/integration/test_event_assignment.py`.
**Acceptance Criteria (AC):**
- Given article and event features when `compute_hybrid_score` executes, then it returns `0.6*embedding + 0.3*tfidf + 0.1*entity_overlap` with optional time decay applied per configuration.
- Given the highest score ≥ configured threshold when assignment runs, then the article is linked to the existing event, `event_articles` row inserted, and event metadata (`last_updated_at`, `article_count`) updated.
- Given all candidate scores < threshold, then a new event is created with centroids initialized from the article and persisted in the database and vector index.
**Subtask Checklist:**
- [ ] Implement score calculation with configurable weights/thresholds in `scoring.py`, including optional time decay factor (settings-driven).
- [ ] Extend `event_service.py` to orchestrate candidate retrieval → scoring → decision → persistence (with repository layer).
- [ ] Update repositories to support creating events with slug generation and linking articles.
- [ ] Ensure service emits structured logs for each assignment decision (include scores, threshold, chosen branch).
- [ ] Write unit tests covering scoring math edge cases (perfect match, zero overlap, time decay effect).
- [ ] Write integration test using in-memory SQLite verifying link vs new event flows and vector index upserts (mock index if needed).
- [ ] Run `pytest backend/tests/unit/test_scoring.py backend/tests/integration/test_event_assignment.py`.
**Testing Requirements:**
- Unit & Integration Tests via `pytest`; maintain ≥80% coverage in `backend/app/events` package.
- Definition of Done: ACs satisfied, tests green, logs inspected for structure.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 2.3
**Epic ID:** Epic 2 – Event Detection Service
**Title:** Deliver Event Maintenance and Lifecycle Management
**Objective:** Keep event centroids fresh, rebuild the vector index when necessary, and archive stale events beyond the retention window.
**Background/Context:**
- Source: docs/PRD.md (Epic 2 – Story 2.3).
- Reference: docs/context-events.md (Event Update Step, Efficiency & Schaalbaarheid); docs/architecture.md (Project Structure – `backend/app/events/maintenance.py`; Storage Layer description).
- Target Paths: `backend/app/events/maintenance.py`, scheduler job wiring in `backend/app/core/scheduler.py`, `backend/tests/unit/test_event_maintenance.py`, `backend/tests/integration/test_event_maintenance.py`.
**Acceptance Criteria (AC):**
- Given an event with multiple articles when maintenance runs, then centroid embeddings/TF-IDF/entities are recalculated using all linked articles and persisted without data loss.
- Given events older than 14 days with no new articles when maintenance executes, then they are marked archived/closed and excluded from future candidate queries.
- Given the maintenance job detects index drift (missing events, checksum mismatch), then it triggers a full index rebuild and persists the refreshed index files.
**Subtask Checklist:**
- [ ] Implement maintenance utilities for centroid recomputation and stale event detection in `maintenance.py`.
- [ ] Add scheduler job (daily) calling maintenance + rebuild functions with logging and metrics.
- [ ] Update repositories to support archiving events (e.g., `status` column or timestamp field) and filtering archived events in queries.
- [ ] Write unit tests covering centroid recompute math and archiving logic (use fixtures with multiple articles).
- [ ] Write integration test verifying scheduler job flow with temporary DB and mock vector index service.
- [ ] Document retention settings in `README.md` configuration table.
- [ ] Run `pytest backend/tests/unit/test_event_maintenance.py backend/tests/integration/test_event_maintenance.py`.
**Testing Requirements:**
- Unit & Integration Tests via `pytest`.
- Definition of Done: ACs met, tests passing, scheduler job registered.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 3.1
**Epic ID:** Epic 3 – LLM Insights Pipeline
**Title:** Construct Prompt Builder for Pluriform Event Insights
**Objective:** Generate deterministic prompts that guide the LLM to produce timeline, viewpoint clusters, fallacies, and contradictions with source references.
**Background/Context:**
- Source: docs/PRD.md (Epic 3 – Story 3.1); UI requires timeline and clusters by spectrum.
- Reference: docs/architecture.md (Project Structure – `backend/app/llm/prompt_builder.py`; Patterns – Strategy for LLM adapter); docs/context-events.md (event representation feeding LLM).
- Target Paths: `backend/app/llm/prompt_builder.py`, `backend/app/llm/templates/`, `backend/tests/unit/test_prompt_builder.py`.
**Acceptance Criteria (AC):**
- Given an event with associated articles when `build_prompt(event_id)` executes, then the prompt includes summarized article bullets (title, source spectrum, key sentences) and explicit instructions to output JSON with fields `timeline`, `clusters`, `contradictions`, `fallacies`.
- Given more than N articles (configurable cap) when building a prompt, then the builder selects a balanced subset prioritizing recency and spectrum diversity, logging selection rationale.
- Given missing article content or malformed data, then the builder raises a clear exception with guidance to rerun enrichment rather than emitting an incomplete prompt.
**Subtask Checklist:**
- [ ] Design prompt template strings with placeholders for event metadata, spectrum distribution, and instructions (store under `backend/app/llm/templates/` if desired).
- [ ] Implement prompt builder functions that fetch articles from repositories, chunk content, and ensure token limits (approx via tiktoken or heuristic).
- [ ] Include JSON schema snippet in the prompt to force deterministic output structure per Architecture.md API standards.
- [ ] Add logging to capture article selection and prompt length.
- [ ] Write unit tests verifying prompt content, subset selection logic, and error cases using stub data.
- [ ] Run `pytest backend/tests/unit/test_prompt_builder.py`.
**Testing Requirements:**
- Unit Tests via `pytest` (string assertions, token length checks via heuristic).
- Definition of Done: ACs fulfilled, tests pass, lint/type checks clean.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 3.2
**Epic ID:** Epic 3 – LLM Insights Pipeline
**Title:** Integrate Mistral API via Provider-Agnostic LLM Client
**Objective:** Implement the LLM client adapter that sends prompts to Mistral, handles retries/timeouts, validates JSON responses, and stores insights.
**Background/Context:**
- Source: docs/PRD.md (Epic 3 – Story 3.2).
- Reference: docs/architecture.md (Project Structure – `backend/app/llm/client.py`, `backend/app/llm/schemas.py`, `backend/app/repositories/insight_repo.py`; Technology Table – Mistral API, Pydantic).
- Target Paths: `backend/app/llm/client.py`, `backend/app/llm/schemas.py`, `backend/app/services/insight_service.py`, `backend/tests/unit/test_llm_client.py`, `backend/tests/integration/test_insight_pipeline.py`.
**Acceptance Criteria (AC):**
- Given a prompt from Story 3.1 when `MistralClient.generate_insights(prompt)` is called, then it sends a chat completion request with configured timeout and exponential backoff (max retries 3) using API key from settings.
- Given a successful LLM response when the client receives JSON text, then the result is parsed into Pydantic models validating timeline items, clusters (with spectrum metadata), contradictions, and stored via repository with provider + timestamp.
- Given the API returns malformed JSON or a timeout occurs, then the client raises a domain-specific exception (`LLMResponseError` or `LLMTimeoutError`) and logs structured error details without corrupting stored state.
**Subtask Checklist:**
- [ ] Implement provider-agnostic client interface with Mistral implementation using `httpx.AsyncClient`.
- [ ] Define Pydantic models in `schemas.py` matching required output schema; include validation for URLs and spectrum labels.
- [ ] Create `insight_service.py` to orchestrate prompt build → LLM call → validation → persistence.
- [ ] Add repository methods to upsert insights (avoid duplicates per event/provider).
- [ ] Write unit tests mocking HTTP responses for success, malformed JSON, timeout scenarios.
- [ ] Write integration test using mocked HTTP server verifying repository persistence path.
- [ ] Update `.env.example` (Story 0.1) if new variables needed (e.g., `LLM_TIMEOUT_SECONDS`).
- [ ] Run `pytest backend/tests/unit/test_llm_client.py backend/tests/integration/test_insight_pipeline.py`.
**Testing Requirements:**
- Unit & Integration Tests via `pytest` (async tests using `pytest-asyncio`).
- Definition of Done: ACs met, tests passing, error handling verified.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 3.3
**Epic ID:** Epic 3 – LLM Insights Pipeline
**Title:** Provide CSV Export Layer for Events and Insights
**Objective:** Expose services and API endpoints that assemble combined CSV exports for event lists and individual event details, satisfying PRD reporting needs.
**Background/Context:**
- Source: docs/PRD.md (Epic 3 – Story 3.3, CSV export requirement).
- Reference: docs/architecture.md (Project Structure – `backend/app/services/export_service.py`, `backend/app/api/routers/exports.py`; Storage Layer – CSV exports in `data/exports/`).
- Target Paths: `backend/app/services/export_service.py`, `backend/app/api/routers/exports.py`, `backend/tests/integration/test_exports_api.py`, docs update for column definitions.
**Acceptance Criteria (AC):**
- Given existing events and insights when `export_service.generate_events_csv()` runs, then it creates/overwrites a CSV file in `data/exports/` containing event metadata, article counts, and spectrum distribution with header row documented in the architecture.
- Given an API request to `/api/v1/exports/events/{event_id}` when the event exists, then the response streams a CSV attachment for that event with timeline, cluster summaries, and source URLs.
- Given an API request for a missing event ID, then the endpoint returns HTTP 404 with structured error payload per Architecture.md API standards.
**Subtask Checklist:**
- [ ] Implement export service functions to produce aggregated datasets via SQLAlchemy queries.
- [ ] Ensure CSV files are written with UTF-8 BOM (for Excel compatibility) and stored under `data/exports/` (create directory if missing).
- [ ] Implement FastAPI router endpoints for full feed and per-event exports with streaming responses.
- [ ] Document CSV column definitions in `docs/architecture.md` change log or new section if needed.
- [ ] Add integration tests using FastAPI TestClient verifying CSV content and headers.
- [ ] Update frontend download URLs (to be consumed in Epic 4 stories) if necessary documentation.
- [ ] Run `pytest backend/tests/integration/test_exports_api.py`.
**Testing Requirements:**
- Integration Tests via `pytest` (FastAPI TestClient).
- Definition of Done: ACs satisfied, tests passing, lint/type checks clean.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 4.1
**Epic ID:** Epic 4 – Frontend (Basic UI)
**Title:** Bootstrap Next.js + Tailwind Frontend Shell
**Objective:** Initialize the Next.js app with Tailwind styling, global layout, and API configuration scaffolding to support subsequent UI stories.
**Background/Context:**
- Source: docs/PRD.md (Epic 4 – Story 4.1).
- Reference: docs/architecture.md (Project Structure – `frontend/`; UI/UX Overview; Technology Table – Next.js, Tailwind, ESLint, Playwright).
- Target Paths: `frontend/app/layout.tsx`, `frontend/app/page.tsx` (placeholder), `frontend/styles/globals.css`, `frontend/tailwind.config.ts`, `.eslintrc.json`, `frontend/lib/api.ts`, `frontend/tests/` setup.
**Acceptance Criteria (AC):**
- Given `npm run dev` when the app starts, then it renders a base layout with header, status banner placeholder, and viewport meta tags, using Tailwind utilities.
- Given the environment variable `NEXT_PUBLIC_API_BASE_URL` when `frontend/lib/api.ts` constructs fetch clients, then the value is read from `process.env` with fallback warning if missing.
- Given ESLint runs via `npm run lint`, then the project passes with Next.js + TypeScript strict configuration.
**Subtask Checklist:**
- [ ] Initialize Tailwind per Next.js docs (postcss config, Tailwind config, CSS imports) with design tokens aligning to PRD minimalistic UI.
- [ ] Implement `layout.tsx` with global metadata (lang=nl), default theme, and `<main>` container.
- [ ] Stub homepage `page.tsx` showing placeholder copy and verifying layout.
- [ ] Create `frontend/lib/api.ts` with typed fetch helper referencing backend endpoints, including error handling stub aligning with Architecture.md API standards.
- [ ] Configure ESLint + Prettier scripts and ensure `package.json` commands exist.
- [ ] Set up Playwright config stub for future tests.
- [ ] Run `npm run lint` and `npm run test` (if configured) to ensure baseline passes.
- MANUAL STEP: Create `.env.local` in `frontend/` and set `NEXT_PUBLIC_API_BASE_URL` pointing to backend dev server.
**Testing Requirements:**
- Frontend lint/test scripts: `npm run lint`; if tests present, `npm run test` (Jest/React Testing Library stub acceptable).
- Definition of Done: ACs met, scripts succeed, UI renders base shell.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 4.2
**Epic ID:** Epic 4 – Frontend (Basic UI)
**Title:** Build Event Feed View with Cards and CSV Actions
**Objective:** Implement the homepage event feed showing latest events, CTA buttons, and responsive design conforming to PRD UI guidelines.
**Background/Context:**
- Source: docs/PRD.md (Epic 4 – Story 4.2, Event Feed requirements).
- Reference: docs/architecture.md (UI/UX Overview – Event Feed Page; API design for `/api/v1/events`); dependencies from Story 3.3 for CSV endpoints.
- Target Paths: `frontend/app/page.tsx`, `frontend/components/EventCard.tsx`, `frontend/components/StatusBanner.tsx`, `frontend/lib/api.ts`, CSS modules or Tailwind classes, tests under `frontend/tests/event-feed.spec.ts`.
**Acceptance Criteria (AC):**
- Given the backend returns a list of events sorted by newest article when the homepage loads, then cards display title, dominant timeframe, article count, source distribution badges, and buttons “Bekijk event” and “Download CSV”.
- Given the API call fails or returns empty when the page loads, then the UI shows an error state or empty placeholder with retry action per UX guidelines.
- Given the viewport width is ≤768px when viewing the page, then cards stack vertically with accessible spacing, preserving CTA usability.
**Subtask Checklist:**
- [ ] Implement API fetching with SWR or React `use` (App Router) to call `/api/v1/events`.
- [ ] Create `EventCard` component with props typed, Tailwind styling, and CTA buttons linking to detail route and CSV endpoint from Story 3.3.
- [ ] Add `StatusBanner` showing last updated timestamp and active LLM provider (data from API metadata).
- [ ] Handle loading, empty, and error states per PRD.
- [ ] Ensure accessibility (aria labels, focus outlines) as per coding standards.
- [ ] Add frontend tests: unit tests for rendering states (Jest/React Testing Library) and Playwright E2E stub verifying cards render given mocked API.
- [ ] Update `README.md` with screenshot placeholder or description of feed view.
- [ ] Run `npm run lint`, `npm run test`, and Playwright smoke `npx playwright test --config=frontend/playwright.config.ts --project=chromium --grep @event-feed`.
**Testing Requirements:**
- Frontend unit tests (Jest/React Testing Library) and Playwright E2E (tagged scenario for event feed).
- Definition of Done: ACs met, tests/lint pass, responsive behaviour verified via dev tools.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 4.3
**Epic ID:** Epic 4 – Frontend (Basic UI)
**Title:** Implement Event Detail Page with Pluriform Insights
**Objective:** Render detailed event information including timeline, viewpoint clusters, fallacies, contradictions, article list, and CSV download per event.
**Background/Context:**
- Source: docs/PRD.md (Epic 4 – Story 4.3); Architecture UI/UX Overview – Event Detail Page; dependencies on Story 3.3 exports and Story 3.2 insights.
- Reference: docs/architecture.md (Project Structure – `frontend/app/event/[id]/page.tsx`, components `Timeline`, `ClusterGrid`, `SpectrumBadge`).
- Target Paths: `frontend/app/event/[id]/page.tsx`, `frontend/components/Timeline.tsx`, `frontend/components/ClusterGrid.tsx`, `frontend/components/FallacyList.tsx`, `frontend/components/ContradictionList.tsx`, tests under `frontend/tests/event-detail.spec.ts`.
**Acceptance Criteria (AC):**
- Given an event with insights when navigating to `/event/{id}`, then the page displays hero section with title/timeframe, spectrum distribution, timeline entries, clustered viewpoints (with media spectrum labels and source links), fallacies, contradictions, and article list.
- Given insights data is missing or stale (no LLM result yet), then the page surfaces a warning banner and fallback messaging prompting manual refresh.
- Given the user taps “Download CSV” on the detail page, then the browser initiates download from `/api/v1/exports/events/{id}` without navigating away.
**Subtask Checklist:**
- [ ] Implement detail page fetching using Next.js dynamic segment with `fetch`/SWR pointing to `/api/v1/events/{id}` and `/api/v1/insights/{id}`.
- [ ] Create reusable components: `Timeline`, `ClusterGrid` (group by angle with chip listing sources), `FallacyList`, `ContradictionList`, `ArticleList`.
- [ ] Ensure components match Tailwind design tokens and responsive behavior per PRD.
- [ ] Add empty-state treatment when insights missing; include CTA to trigger backend refresh endpoint (if available) or display hint.
- [ ] Wire CSV download button (anchor with `download` attribute) to export endpoint.
- [ ] Write unit tests for component rendering with mocked data and Playwright spec validating timeline/cluster elements.
- [ ] Document event detail layout in README or design notes.
- [ ] Run `npm run lint`, `npm run test`, `npx playwright test --grep @event-detail`.
**Testing Requirements:**
- Frontend unit tests (Jest/React Testing Library) plus Playwright E2E for event detail page.
- Definition of Done: ACs satisfied, tests/lint pass, responsive and accessibility checks complete.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 5.1
**Epic ID:** Epic 5 – Monitoring & QA
**Title:** Configure Structured Logging, Metrics Hooks, and Health Endpoint
**Objective:** Ensure observability basics: structured logs across services, optional metrics hooks, and a FastAPI health endpoint exposing component status.
**Background/Context:**
- Source: docs/PRD.md (Epic 5 – Story 5.1).
- Reference: docs/architecture.md (Error Handling Strategy; API Layer – routers; Sequence Diagram logging expectations).
- Target Paths: `backend/app/core/logging.py` (extend), `backend/app/api/routers/health.py`, `backend/app/api/main.py`, `backend/tests/integration/test_health_endpoint.py`.
**Acceptance Criteria (AC):**
- Given backend startup when logging is configured, then logs include structured fields (level, module, correlation_id) and rotate to `logs/app.log` per Architecture guidance.
- Given a GET request to `/api/v1/health` when dependencies (DB, vector index file, LLM provider config) are reachable, then the endpoint returns 200 with JSON containing component statuses and timestamps.
- Given any dependency check fails (e.g., missing index file), then `/api/v1/health` returns 503 with the failing component listed while still responding quickly (<200ms).
**Subtask Checklist:**
- [ ] Extend logging config to add file handler (rotating) in addition to stdout for local dev.
- [ ] Implement health router performing database connectivity check, vector index presence check, scheduled job heartbeat, and environment validation.
- [ ] Register health router under `/api/v1/health` in main FastAPI app.
- [ ] Add integration test verifying 200 response when dependencies mocked healthy and 503 when vector index missing.
- [ ] Document health endpoint usage in README (Monitoring section).
- [ ] Run `pytest backend/tests/integration/test_health_endpoint.py`.
**Testing Requirements:**
- Integration Tests via `pytest` (FastAPI TestClient) + manual log inspection.
- Definition of Done: ACs met, tests passing, log files generated.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 5.2
**Epic ID:** Epic 5 – Monitoring & QA
**Title:** Establish Pytest Suite, Coverage Gates, and GitHub Actions CI
**Objective:** Provide automated testing workflows with coverage enforcement and continuous integration pipeline aligning with project standards.
**Background/Context:**
- Source: docs/PRD.md (Epic 5 – Story 5.2).
- Reference: docs/architecture.md (Testing Requirements and Framework; CI/CD strategy); Patterns – Coding Standards.
- Target Paths: `backend/pytest.ini` or `pyproject` `[tool.pytest.ini_options]`, coverage config `.coveragerc`, GitHub workflow `.github/workflows/ci.yml`, `Makefile` updates, documentation.
**Acceptance Criteria (AC):**
- Given `make test` executes locally, then pytest runs unit + integration suites with coverage report enforcing ≥80% on backend packages (`events`, `llm`, `core`).
- Given a pull request when GitHub Actions triggers `ci.yml`, then the workflow installs dependencies, runs linting (`ruff`, `black --check`, `mypy`), executes pytest with coverage gate, and marks the run green on success.
- Given coverage drops below threshold or tests fail, then the workflow exits non-zero and reports failure status.
**Subtask Checklist:**
- [ ] Configure pytest options (addopts, test paths, markers) via `pyproject.toml` or `pytest.ini`.
- [ ] Add `.coveragerc` specifying include paths and fail-under=80.
- [ ] Update Makefile `test` target to run `pytest --cov=backend/app --cov-report=term-missing`.
- [ ] Create `.github/workflows/ci.yml` running on push/pull_request with steps: checkout, setup Python 3.12, create venv, install deps from requirements.txt, run lint (ruff, black, mypy), run tests with coverage, upload artifact (optional).
- [ ] Document CI command summary in README.
- [ ] Validate workflow locally using `act` or running `make lint` + `make test` before committing.
- [ ] Run `pytest` locally ensuring coverage threshold enforced.
**Testing Requirements:**
- Automated tests via pytest with coverage; CI pipeline run must pass.
- Definition of Done: ACs satisfied, CI pipeline green, coverage gate enforced.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**

---
**Story ID:** 5.3
**Epic ID:** Epic 5 – Monitoring & QA
**Title:** Implement End-to-End Smoke Test Script for Pipeline Verification
**Objective:** Provide a reproducible smoke test that ingests sample feeds, processes through event detection and LLM stubs, and verifies CSV exports.
**Background/Context:**
- Source: docs/PRD.md (Epic 5 – Story 5.3).
- Reference: docs/architecture.md (Project Structure – `backend/scripts/smoke_test.py`; Testing Requirements – Smoke test script).
- Target Paths: `backend/scripts/smoke_test.py`, sample data under `backend/tests/fixtures/smoke/`, documentation in README.
**Acceptance Criteria (AC):**
- Given the command `source .venv/bin/activate && python backend/scripts/smoke_test.py` when executed with bundled fixtures, then it ingests sample RSS entries, runs enrichment/event detection (using in-memory or temp DB), and generates CSV outputs under `data/exports/`.
- Given the smoke test completes successfully, then it prints a concise summary including number of articles ingested, events created, and location of CSV files.
- Given any step fails, then the script exits with non-zero status and emits structured error logs pointing to the failing phase.
**Subtask Checklist:**
- [ ] Create fixture RSS/articles data under `backend/tests/fixtures/smoke/` representing at least two events with multiple viewpoints.
- [ ] Implement smoke test script orchestrating ingest → enrichment → event detection → insight stub (mock LLM) → export, using transaction rollback or temp directories to avoid polluting real data.
- [ ] Allow optional flag `--skip-llm` to bypass actual API calls (use stub insights for offline runs).
- [ ] Ensure script configures logging (reuse core logging) and prints summary at end.
- [ ] Document usage in README (QA section) including expected runtime (<5 minutes).
- [ ] Run the smoke test locally to confirm outputs and exit codes.
- [ ] Add GitHub Action optional job or manual instructions referencing script.
**Testing Requirements:**
- Manual execution of smoke script (`source .venv/bin/activate && python backend/scripts/smoke_test.py`) with success criteria; optional automated invocation in CI nightly.
- Definition of Done: ACs met, script validated, documentation updated.
**Story Wrap Up (To be filled in AFTER agent execution):**
- **Agent Model Used:** 
- **Agent Credit or Cost:** 
- **Date/Time Completed:** 
- **Commit Hash:** 
- **Change Log:**
