-- Migration: which search terms of a news item were searched in Bron, and when (Story 14.29)
--
-- The job "Achtergrondstukken" searches a news item again only when its analysis gives other
-- search terms, also when the first search found nothing (see migration 021).
--
-- Local working database only: the website never reads it, so it is not in PUBLISHED_TABLES and
-- does not go to Supabase. The backend also creates the table at startup (create_all); this file
-- is the record. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS event_document_searches (
    event_id INTEGER PRIMARY KEY,
    terms JSONB NOT NULL DEFAULT '[]'::jsonb,
    found INTEGER NOT NULL DEFAULT 0,
    searched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_event_document_searches_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

COMMIT;
