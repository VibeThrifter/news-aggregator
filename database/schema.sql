-- News Aggregator Database Schema
-- PostgreSQL 15+ compatible
-- Generated from SQLAlchemy models

-- Articles table: Stores fetched news articles
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    guid VARCHAR(255) NOT NULL,
    url VARCHAR(1024) NOT NULL,
    title VARCHAR(512) NOT NULL,
    summary TEXT,
    content TEXT NOT NULL,
    source_name VARCHAR(255),
    source_metadata JSONB,
    normalized_text TEXT,
    normalized_tokens JSONB,
    embedding BYTEA,
    tfidf_vector JSONB,
    entities JSONB,
    extracted_dates JSONB,
    extracted_locations JSONB,
    event_type VARCHAR(50),
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enriched_at TIMESTAMPTZ,
    CONSTRAINT uq_articles_url UNIQUE (url),
    CONSTRAINT uq_articles_guid UNIQUE (guid)
);

-- Events table: Stores detected news events (clusters of related articles)
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(255) UNIQUE,
    title VARCHAR(512),
    description TEXT,
    centroid_embedding JSONB,
    centroid_tfidf JSONB,
    centroid_entities JSONB,
    event_type VARCHAR(50),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    article_count INTEGER NOT NULL DEFAULT 0,
    spectrum_distribution JSONB,
    tags JSONB,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Event-Article link table: Many-to-many relationship with similarity scores
CREATE TABLE event_articles (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    similarity_score REAL,
    scoring_breakdown JSONB,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_event_articles_event_article UNIQUE (event_id, article_id)
);

-- LLM Insights table: AI-generated analysis per event
CREATE TABLE llm_insights (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    prompt_metadata JSONB,
    summary TEXT,
    timeline JSONB,
    clusters JSONB,
    contradictions JSONB,
    fallacies JSONB,
    frames JSONB,
    coverage_gaps JSONB,
    raw_response TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_llm_insights_event_provider UNIQUE (event_id, provider)
);

-- Indexes for performance
CREATE INDEX idx_articles_published_at ON articles(published_at);
CREATE INDEX idx_articles_fetched_at ON articles(fetched_at);
CREATE INDEX idx_articles_source_name ON articles(source_name);
CREATE INDEX idx_articles_event_type ON articles(event_type);

CREATE INDEX idx_events_first_seen_at ON events(first_seen_at);
CREATE INDEX idx_events_last_updated_at ON events(last_updated_at);
CREATE INDEX idx_events_slug ON events(slug);
CREATE INDEX idx_events_archived_at ON events(archived_at);

CREATE INDEX idx_event_articles_event_id ON event_articles(event_id);
CREATE INDEX idx_event_articles_article_id ON event_articles(article_id);
CREATE INDEX idx_event_articles_similarity_score ON event_articles(similarity_score);

CREATE INDEX idx_llm_insights_event_id ON llm_insights(event_id);
CREATE INDEX idx_llm_insights_provider ON llm_insights(provider);
