# Database Schema Documentation

## Overview
The News Aggregator uses PostgreSQL (Supabase) for production data storage. This directory contains the database schema and related documentation.

## Schema Files
- **`schema.sql`**: Complete PostgreSQL schema definition
- **`README.md`**: This file

## Tables

### `articles`
Stores raw fetched news articles from RSS feeds.

**Key Fields:**
- `guid`, `url`: Unique identifiers (constraints enforced)
- `title`, `content`, `summary`: Article content
- `embedding`: Vector embedding (binary) for similarity search
- `entities`, `extracted_dates`, `extracted_locations`: NLP enrichments
- `event_type`: LLM-classified event category

**Indexes:** `published_at`, `fetched_at`, `source_name`, `event_type`

### `events`
Detected news events (clusters of related articles).

**Key Fields:**
- `slug`: URL-friendly identifier
- `title`, `description`: Human-readable event summary
- `centroid_*`: Aggregated embeddings/entities from cluster
- `article_count`: Cached count of linked articles
- `spectrum_distribution`: Political bias distribution
- `archived_at`: Soft delete timestamp

**Indexes:** `first_seen_at`, `last_updated_at`, `slug`, `archived_at`

### `event_articles`
Many-to-many link table between events and articles.

**Key Fields:**
- `event_id`, `article_id`: Foreign keys (ON DELETE CASCADE)
- `similarity_score`: Cosine similarity or composite score
- `scoring_breakdown`: JSON with component scores

**Indexes:** `event_id`, `article_id`, `similarity_score`

### `llm_insights`
AI-generated analysis per event (timeline, contradictions, fallacies, frames).

**Key Fields:**
- `event_id`: Foreign key to events
- `provider`, `model`: LLM identifier (e.g., "mistral", "mistral-large-latest")
- `timeline`, `clusters`, `contradictions`, `fallacies`, `frames`, `coverage_gaps`: Structured JSON outputs
- `raw_response`: Full LLM response for debugging

**Unique Constraint:** One insight per (event_id, provider)

**Indexes:** `event_id`, `provider`

## Setup

### Production (Supabase)
```bash
# Initialize schema in Supabase PostgreSQL
psql $DATABASE_URL < database/schema.sql
```

Or use the Python script:
```bash
env PYTHONPATH=. .venv/bin/python scripts/create_supabase_tables.py
```

### Development (Local PostgreSQL - optional)
```bash
# For local testing with real PostgreSQL
createdb news_aggregator_dev
psql news_aggregator_dev < database/schema.sql
```

Set in `.env`:
```
DATABASE_URL=postgresql+asyncpg://localhost/news_aggregator_dev
```

## Data Flow

```
RSS Feeds → Articles (enriched) → Event Detection → Events
                                                      ↓
                                              LLM Insights
```

1. **Ingestion**: Articles fetched from NOS/NU.nl RSS, stored in `articles`
2. **Enrichment**: NLP processing adds embeddings, entities, event_type
3. **Clustering**: Similar articles linked via `event_articles`, creates `events`
4. **LLM Analysis**: Mistral generates insights, stored in `llm_insights`

## Frontend Access

The Next.js frontend queries Supabase directly via `@supabase/supabase-js`:
- `listEvents()`: Active events ordered by `last_updated_at`
- `getEventDetail(slug)`: Event + linked articles
- `getEventInsights(slug)`: LLM-generated analysis

## Migrations

Currently, schema changes are applied manually:
1. Update `backend/app/db/models.py` (SQLAlchemy models)
2. Regenerate `database/schema.sql` (run export script)
3. Apply changes to Supabase via SQL editor or `create_supabase_tables.py`

**Future**: Alembic migrations for version-controlled schema evolution.

## Data Retention

- **Articles**: Kept indefinitely for analysis
- **Events**: Soft-deleted via `archived_at` after 90 days of inactivity
- **LLM Insights**: Regenerated on-demand, old versions overwritten

## Backup & Restore

**Supabase Automatic Backups**: Daily snapshots (7-day retention on free tier)

**Manual Backup**:
```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

**Restore**:
```bash
psql $DATABASE_URL < backup_20250117.sql
```
