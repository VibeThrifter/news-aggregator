-- Migration: Achtergrondstukken - government and party documents about a news item (Story 14.29)
--
-- The factual analysis gives at most two search terms a government document about the news would
-- use ("draagmoederschap", "Silja", "spreidingswet"; llm_insights.prompt_metadata.zoektermen). The
-- local backend searches them in Bron of Open State (api.bron.live: council documents, Woo
-- documents, local party news, regulations, announcements; job "Achtergrondstukken") and keeps at
-- most five documents per news item with the term in their title. The Tijdlijn shows them in the
-- story before this news.
--
-- event_documents : one row per document of a news item. Written by the backend (postgres) in the
--                   local database and published to Supabase (PUBLISHED_TABLES); anon and
--                   authenticated may only read it (RLS on, read policy, SELECT only).
--
-- Run on both databases (local working database and Supabase). On the local database the GRANT
-- and the policy are harmless. New table only (no lock on a table the backend uses). Idempotent.

BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE TABLE IF NOT EXISTS event_documents (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    term VARCHAR(120) NOT NULL,
    -- Bron's collection: openbesluitvorming, poliflw, woogle, oor, cvdr or obk
    source VARCHAR(40) NOT NULL,
    -- Bron's document type ("Brief", "Bericht", "Rapport", ...)
    doc_type VARCHAR(80),
    title TEXT NOT NULL,
    url VARCHAR(2048) NOT NULL,
    published_at TIMESTAMPTZ,
    -- The municipality, province, ministry or party branch it comes from
    location VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_event_documents_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT uq_event_documents_event_url UNIQUE (event_id, url)
);

CREATE INDEX IF NOT EXISTS idx_event_documents_event ON event_documents (event_id);

ALTER TABLE event_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_documents_public_read ON event_documents;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE event_documents FROM anon, authenticated;
        GRANT SELECT ON TABLE event_documents TO anon, authenticated;
        CREATE POLICY event_documents_public_read ON event_documents
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END
$$;

COMMIT;
