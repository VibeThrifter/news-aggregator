-- Migration: Onderzoeksmodus - event entities + related events (Epic 11, Story 11.8)
--
-- event_entities : canonical entities per event with counts ("Ook in het nieuws"), plus the ids
--                  of the event's articles mentioning the entity (article_ids)
-- event_relations: precomputed related events with reasons ("Volg het spoor")
-- search_articles: full-text search over all articles ("In welke artikelen komt X voor?"),
--                  backed by the GIN index idx_articles_fts
--
-- Both tables hold derived data written by the backend (service role / postgres). The
-- frontend (anon key) may only SELECT. Display fields are denormalised so the frontend never
-- has to embed `events`; titles are always the LLM title (copyright rule).
--
-- Idempotent: safe to run more than once, and safe to run after the backend's create_all()
-- already created the tables (it then only adds RLS, policies and grants), or after an earlier
-- version of this migration (it adds event_entities.article_ids; existing rows get '{}' until
-- the next forced exploration backfill, see database/README.md).
-- Supabase only: the anon/authenticated roles must exist, and anon must already be able to read
-- articles, event_articles and events (search_articles is SECURITY INVOKER).

BEGIN;

CREATE TABLE IF NOT EXISTS event_entities (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    entity_key VARCHAR(160) NOT NULL,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    iso_code VARCHAR(2),
    aliases TEXT[] NOT NULL DEFAULT '{}',
    mention_count INTEGER NOT NULL DEFAULT 0,
    article_count INTEGER NOT NULL DEFAULT 0,
    outlet_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    article_ids INTEGER[] NOT NULL DEFAULT '{}',  -- event articles mentioning it, asc, max 200
    salience REAL NOT NULL DEFAULT 0,
    event_slug VARCHAR(255),
    event_title VARCHAR(512) NOT NULL,
    event_type VARCHAR(50),
    event_last_updated_at TIMESTAMPTZ,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_event_entities_event FOREIGN KEY (event_id)
        REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT uq_event_entities_event_key UNIQUE (event_id, entity_key),
    CONSTRAINT ck_event_entities_kind
        CHECK (kind IN ('person', 'org', 'place', 'country', 'group', 'event'))
);

-- Added after the first version of this migration: existing tables get the column (rows '{}'
-- until the next forced exploration backfill); create_all() creates it without the default.
ALTER TABLE event_entities ADD COLUMN IF NOT EXISTS article_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE event_entities ALTER COLUMN article_ids SET DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_event_entities_event_id ON event_entities (event_id);
CREATE INDEX IF NOT EXISTS idx_event_entities_entity_key ON event_entities (entity_key);
CREATE INDEX IF NOT EXISTS idx_event_entities_aliases ON event_entities USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_event_entities_recent ON event_entities (event_last_updated_at DESC);

CREATE TABLE IF NOT EXISTS event_relations (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    related_event_id INTEGER NOT NULL,
    score REAL NOT NULL,
    embedding_similarity REAL,
    entity_overlap REAL,
    country_overlap REAL,
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_slug VARCHAR(255),
    related_title VARCHAR(512) NOT NULL,
    related_event_type VARCHAR(50),
    related_article_count INTEGER,
    related_first_seen_at TIMESTAMPTZ,
    related_last_updated_at TIMESTAMPTZ,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_event_relations_event FOREIGN KEY (event_id)
        REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT fk_event_relations_related FOREIGN KEY (related_event_id)
        REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT uq_event_relations_pair UNIQUE (event_id, related_event_id),
    CONSTRAINT ck_event_relations_not_self CHECK (event_id <> related_event_id),
    CONSTRAINT ck_event_relations_score CHECK (score >= 0 AND score <= 1)
);

CREATE INDEX IF NOT EXISTS idx_event_relations_event_score ON event_relations (event_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_event_relations_related ON event_relations (related_event_id);

-- Read-only access for the frontend (anon key); the backend connects as postgres and
-- bypasses RLS.
ALTER TABLE event_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_relations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_entities_public_read ON event_entities;
CREATE POLICY event_entities_public_read ON event_entities
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS event_relations_public_read ON event_relations;
CREATE POLICY event_relations_public_read ON event_relations
    FOR SELECT TO anon, authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON event_entities, event_relations FROM anon, authenticated;
GRANT SELECT ON event_entities, event_relations TO anon, authenticated;

-- ------------------------------------------------------------------------------------------
-- Article search
--
-- GIN expression index over title + summary + content (Dutch stemming). Size, measured on the
-- local mirror (data/app.db: 579 articles, avg title 70 / summary 1409 / content 2478 chars):
-- 1.5 MB (title + summary only: 1.0 MB); every extra article adds ~1-2 kB, so ~10-20 MB for the
-- ~10k production articles. It is built inside this transaction (CREATE INDEX CONCURRENTLY is
-- not allowed in a transaction block), which blocks writes to articles while it builds (~11 s
-- for 11.6k articles locally). search_articles MUST use exactly the same expression, otherwise
-- the planner cannot use the index.
CREATE INDEX IF NOT EXISTS idx_articles_fts ON articles USING GIN (
    to_tsvector(
        'dutch',
        coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content, '')
    )
);

-- search_articles(p_query, p_limit = 20, p_offset = 0) returns
--   {"total": int, "items": [{"id", "title", "url", "source_name", "published_at",
--     "is_international", "source_country", "event_id", "event_slug", "event_title"}]}
-- - Query: websearch_to_tsquery('dutch', ...) ("quoted phrase", OR, -word), trimmed and cut at
--   200 characters; shorter than 2 characters or only stop words -> {"total": 0, "items": []}.
-- - Order ("relevance, then date"): articles whose TITLE matches first, then articles that only
--   match in summary/content; within each tier newest first (published_at DESC NULLS LAST, then
--   id DESC). No ts_rank on purpose: it would recompute the full tsvector of every hit.
-- - p_limit clamped to 1..50, p_offset to 0..500; total = number of all matching articles.
-- - Never returns content or summary (copyright), only the fields above.
-- - event_*: the most recently updated event the article is linked to (event_articles);
--   event_title is the LLM title denormalised in event_entities / event_relations, otherwise
--   null (never events.title, which is an article headline).
-- - SECURITY INVOKER: anon already reads articles, event_articles and events (the frontend
--   embeds them via PostgREST) and event_entities / event_relations (policies above), so the
--   function exposes nothing new and any RLS on those tables still applies. The verification
--   block below checks that anon can read them.
CREATE OR REPLACE FUNCTION search_articles(
    p_query text,
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_query text := left(btrim(COALESCE(p_query, '')), 200);
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
    v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 500);
    v_tsquery tsquery;
    v_total bigint;
    v_items json;
BEGIN
    IF length(v_query) < 2 THEN
        RETURN json_build_object('total', 0, 'items', '[]'::json);
    END IF;
    v_tsquery := websearch_to_tsquery('dutch', v_query);
    IF numnode(v_tsquery) = 0 THEN  -- only stop words / punctuation
        RETURN json_build_object('total', 0, 'items', '[]'::json);
    END IF;

    WITH hits AS MATERIALIZED (
        SELECT a.id,
               a.published_at,
               to_tsvector('dutch', coalesce(a.title, '')) @@ v_tsquery AS title_hit
        FROM articles a
        WHERE to_tsvector(
            'dutch',
            coalesce(a.title, '') || ' ' || coalesce(a.summary, '') || ' ' || coalesce(a.content, '')
        ) @@ v_tsquery
    ),
    page AS (
        SELECT h.id, h.published_at, h.title_hit
        FROM hits h
        ORDER BY h.title_hit DESC, h.published_at DESC NULLS LAST, h.id DESC
        LIMIT v_limit OFFSET v_offset
    )
    SELECT
        (SELECT count(*) FROM hits),
        COALESCE(
            json_agg(
                json_build_object(
                    'id', a.id,
                    'title', a.title,
                    'url', a.url,
                    'source_name', a.source_name,
                    'published_at', a.published_at,
                    'is_international', a.is_international,
                    'source_country', a.source_country,
                    'event_id', ev.id,
                    'event_slug', ev.slug,
                    'event_title', COALESCE(
                        (SELECT ee.event_title FROM event_entities ee
                         WHERE ee.event_id = ev.id ORDER BY ee.computed_at DESC LIMIT 1),
                        (SELECT er.related_title FROM event_relations er
                         WHERE er.related_event_id = ev.id ORDER BY er.computed_at DESC LIMIT 1)
                    )
                )
                ORDER BY p.title_hit DESC, p.published_at DESC NULLS LAST, p.id DESC
            ),
            '[]'::json
        )
    INTO v_total, v_items
    FROM page p
    JOIN articles a ON a.id = p.id
    LEFT JOIN LATERAL (
        SELECT e.id, e.slug
        FROM event_articles ea
        JOIN events e ON e.id = ea.event_id
        WHERE ea.article_id = p.id
        ORDER BY e.last_updated_at DESC NULLS LAST, e.id DESC
        LIMIT 1
    ) ev ON true;

    RETURN json_build_object('total', v_total, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION search_articles(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_articles(text, integer, integer) TO anon, authenticated;

-- Verify the migration (an exception rolls back the whole transaction)
DO $$
DECLARE
    t text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'event_entities'
    ) THEN
        RAISE EXCEPTION 'Table event_entities not created';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'event_relations'
    ) THEN
        RAISE EXCEPTION 'Table event_relations not created';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'event_entities'
          AND column_name = 'aliases' AND data_type = 'ARRAY'
    ) THEN
        RAISE EXCEPTION 'Column event_entities.aliases must be an array (see database/README.md)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'event_entities'
          AND column_name = 'article_ids' AND data_type = 'ARRAY' AND udt_name = '_int4'
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'Column event_entities.article_ids must be a NOT NULL integer[] column';
    END IF;

    IF NOT (
        SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_entities'::regclass
    ) THEN
        RAISE EXCEPTION 'Row level security not enabled on event_entities';
    END IF;

    IF NOT (
        SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_relations'::regclass
    ) THEN
        RAISE EXCEPTION 'Row level security not enabled on event_relations';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'event_entities'
          AND policyname = 'event_entities_public_read'
    ) THEN
        RAISE EXCEPTION 'Policy event_entities_public_read missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'event_relations'
          AND policyname = 'event_relations_public_read'
    ) THEN
        RAISE EXCEPTION 'Policy event_relations_public_read missing';
    END IF;

    IF to_regclass('public.idx_articles_fts') IS NULL THEN
        RAISE EXCEPTION 'Index idx_articles_fts missing';
    END IF;

    IF to_regprocedure('public.search_articles(text, integer, integer)') IS NULL THEN
        RAISE EXCEPTION 'Function search_articles(text, integer, integer) missing';
    END IF;

    IF (SELECT prosecdef FROM pg_proc
        WHERE oid = 'public.search_articles(text, integer, integer)'::regprocedure) THEN
        RAISE EXCEPTION 'search_articles must be SECURITY INVOKER';
    END IF;

    IF NOT has_function_privilege(
        'anon', 'public.search_articles(text, integer, integer)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'anon cannot execute search_articles';
    END IF;

    -- search_articles runs with the caller's rights: anon must be able to read all its tables
    FOREACH t IN ARRAY ARRAY[
        'articles', 'event_articles', 'events', 'event_entities', 'event_relations'
    ]
    LOOP
        IF NOT has_table_privilege('anon', 'public.' || t, 'SELECT') THEN
            RAISE EXCEPTION 'anon cannot SELECT % (needed by search_articles, SECURITY INVOKER)', t;
        END IF;

        IF (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass)
           AND NOT EXISTS (
               SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t AND cmd IN ('SELECT', 'ALL')
                 AND roles && ARRAY['anon', 'public']::name[]
           ) THEN
            RAISE EXCEPTION 'RLS on % has no SELECT policy for anon (needed by search_articles)', t;
        END IF;
    END LOOP;

    RAISE NOTICE 'Migration 004_explore_entities_relations completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new tables, column and function immediately
NOTIFY pgrst, 'reload schema';
