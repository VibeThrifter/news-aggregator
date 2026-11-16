-- Migration: Kaart - waar speelt het nieuws? (Epic 14, Story 14.38)
--
-- The places of a news item, without AI: places the headline or the start of the Dutch articles
-- names, looked up in the GeoNames place list (backend/app/services/event_places.py). The page
-- /kaart shows them on a map of the Netherlands and a globe.
--
-- event_places : one row per place of a news item (at most three). Written by the backend
--                (postgres) in the local database in the exploration refresh and published to
--                Supabase (PUBLISHED_TABLES, key event_id + place_key); anon and authenticated
--                may only read it (RLS on, read policy, SELECT only).
--
-- Run on both databases (local working database and Supabase), then
-- `scripts/local_db.py init-publish` for the publish triggers. On the local database the GRANT and
-- the policy are harmless. New table only (no lock on a table the backend uses). Idempotent.

BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE TABLE IF NOT EXISTS event_places (
    event_id INTEGER NOT NULL,
    -- place:<geonameid>, place:x-<id> (hand list) or country:<iso>
    place_key VARCHAR(80) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    -- Dutch display name, the country (NL for the Netherlands) and the province or state
    name VARCHAR(255) NOT NULL,
    iso_code VARCHAR(2) NOT NULL,
    region VARCHAR(255),
    lat REAL,
    lon REAL,
    -- Dutch articles that name the place early, and whether a headline names it
    article_count INTEGER NOT NULL DEFAULT 0,
    in_title BOOLEAN NOT NULL DEFAULT FALSE,
    -- The Dutch outlets of the news item (the page keeps news of a main source)
    outlets JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- For the list without a join; event_title is always the title of the analysis
    event_slug VARCHAR(255),
    event_title VARCHAR(512) NOT NULL,
    event_type VARCHAR(50),
    event_first_seen_at TIMESTAMPTZ,
    CONSTRAINT pk_event_places PRIMARY KEY (event_id, place_key),
    CONSTRAINT fk_event_places_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT ck_event_places_kind CHECK (kind IN ('country','city','region','place','municipality'))
);

CREATE INDEX IF NOT EXISTS idx_event_places_first_seen ON event_places (event_first_seen_at);

ALTER TABLE event_places ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_places_public_read ON event_places;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE event_places FROM anon, authenticated;
        GRANT SELECT ON TABLE event_places TO anon, authenticated;
        CREATE POLICY event_places_public_read ON event_places
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END
$$;

COMMIT;
