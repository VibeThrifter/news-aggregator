-- Migration: International Perspectives (Epic 9, Story 9.3)
-- Add fields for international article enrichment

-- Add international perspective fields to articles table
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_international BOOLEAN DEFAULT FALSE;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_country VARCHAR(2);  -- ISO 3166-1 alpha-2

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_articles_is_international ON articles(is_international);
CREATE INDEX IF NOT EXISTS idx_articles_source_country ON articles(source_country);

-- Add detected countries and enrichment timestamp to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS detected_countries JSONB;  -- Array of ISO codes from LLM
ALTER TABLE events ADD COLUMN IF NOT EXISTS international_enriched_at TIMESTAMPTZ;

-- Add involved_countries to llm_insights table
ALTER TABLE llm_insights ADD COLUMN IF NOT EXISTS involved_countries JSONB;

-- Update existing Dutch articles to have source_country = 'NL' and is_international = false
-- (This is a data migration, run once)
UPDATE articles
SET source_country = 'NL', is_international = FALSE
WHERE source_country IS NULL AND is_international IS NULL;

-- Verify the migration
DO $$
BEGIN
    -- Check articles columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'articles' AND column_name = 'is_international'
    ) THEN
        RAISE EXCEPTION 'Column is_international not found in articles table';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'articles' AND column_name = 'source_country'
    ) THEN
        RAISE EXCEPTION 'Column source_country not found in articles table';
    END IF;

    -- Check events columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'events' AND column_name = 'detected_countries'
    ) THEN
        RAISE EXCEPTION 'Column detected_countries not found in events table';
    END IF;

    -- Check llm_insights columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'llm_insights' AND column_name = 'involved_countries'
    ) THEN
        RAISE EXCEPTION 'Column involved_countries not found in llm_insights table';
    END IF;

    RAISE NOTICE 'Migration 002_international_perspectives completed successfully';
END $$;
