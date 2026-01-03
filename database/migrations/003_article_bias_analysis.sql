-- Migration: Article Bias Analysis (Epic 10, Story 10.1)
-- Add table for per-sentence bias detection results

-- Create the article_bias_analyses table
CREATE TABLE IF NOT EXISTS article_bias_analyses (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,

    -- Sentence counts
    total_sentences INTEGER NOT NULL,
    journalist_bias_count INTEGER NOT NULL DEFAULT 0,
    quote_bias_count INTEGER NOT NULL DEFAULT 0,

    -- Summary statistics (only for journalist biases - quotes don't count)
    journalist_bias_percentage FLOAT NOT NULL DEFAULT 0.0,
    most_frequent_bias VARCHAR(64),
    most_frequent_count INTEGER,
    average_bias_strength FLOAT,
    overall_rating FLOAT NOT NULL DEFAULT 0.0,

    -- Detailed results - separate arrays for journalist vs quote biases
    journalist_biases JSONB NOT NULL,
    quote_biases JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_response TEXT,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint: one analysis per article per provider
    CONSTRAINT uq_article_bias_article_provider UNIQUE(article_id, provider)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_bias_article_id ON article_bias_analyses(article_id);
CREATE INDEX IF NOT EXISTS idx_bias_overall_rating ON article_bias_analyses(overall_rating);
CREATE INDEX IF NOT EXISTS idx_bias_most_frequent ON article_bias_analyses(most_frequent_bias);
CREATE INDEX IF NOT EXISTS idx_bias_provider ON article_bias_analyses(provider);
CREATE INDEX IF NOT EXISTS idx_bias_analyzed_at ON article_bias_analyses(analyzed_at);

-- Verify the migration
DO $$
BEGIN
    -- Check table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'article_bias_analyses'
    ) THEN
        RAISE EXCEPTION 'Table article_bias_analyses not created';
    END IF;

    -- Check required columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'article_bias_analyses' AND column_name = 'journalist_biases'
    ) THEN
        RAISE EXCEPTION 'Column journalist_biases not found in article_bias_analyses table';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'article_bias_analyses' AND column_name = 'quote_biases'
    ) THEN
        RAISE EXCEPTION 'Column quote_biases not found in article_bias_analyses table';
    END IF;

    RAISE NOTICE 'Migration 003_article_bias_analysis completed successfully';
END $$;
