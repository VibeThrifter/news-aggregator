-- Migration: Wie is dit? - research status per named entity (Epic 12, Story 12.5)
--
-- entity_research            : one row per canonical key (person:<slug> | org:<slug> | actor:<slug>)
--                              with role triage, priority, propaganda-model coverage and the status
--                              of the research by the propaganda-model agent nieuws-scout.
-- request_entity_research()  : a tap on a name in the app registers demand (rate-limited)
-- entity_research_status()   : status for up to 50 keys (safe columns only, no agent report)
-- entity_cooccurrence()      : who appears together with an entity in the news (event_entities)
--
-- Written by the local backend (service role / postgres) and by request_entity_research. The
-- table has RLS enabled WITHOUT policies and no privileges for anon/authenticated: the frontend
-- only uses the functions below. Only names that occur in the own news are ever researched; the
-- backend decides (privépersonen never).
--
-- Idempotent: safe to run more than once, and after the backend's create_all() created the
-- table. Requires migration 004 (event_entities). Supabase only: roles anon/authenticated.

BEGIN;

-- event_entities.aliases must be TEXT[] (as declared in migration 004): when the backend's
-- create_all() created the table first it is VARCHAR(160)[], and the && operator used below (and
-- its GIN index) needs matching types. Converting keeps the data.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'event_entities'
          AND column_name = 'aliases' AND udt_name <> '_text'
    ) THEN
        ALTER TABLE event_entities ALTER COLUMN aliases TYPE TEXT[] USING aliases::TEXT[];
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS entity_research (
    entity_key VARCHAR(170) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'unknown',
    role_category VARCHAR(20),
    role_label VARCHAR(255),
    is_foreign BOOLEAN NOT NULL DEFAULT FALSE,
    priority REAL NOT NULL DEFAULT 0,
    prominence JSONB NOT NULL DEFAULT '{}'::jsonb,
    pm_entity_id INTEGER,
    pm_degree INTEGER,
    pm_doel_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'nieuw',
    status_reason TEXT,
    summary TEXT,                          -- report of the research agent, never exposed
    found JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_event_slug VARCHAR(255),
    requested_count INTEGER NOT NULL DEFAULT 0,
    last_requested_at TIMESTAMPTZ,
    triaged_at TIMESTAMPTZ,                -- last role/priority assessment by the backend
    queued_at TIMESTAMPTZ,
    researched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_entity_research_kind CHECK (kind IN ('person', 'org', 'unknown')),
    CONSTRAINT ck_entity_research_status CHECK (status IN (
        'nieuw', 'niet_nodig', 'overgeslagen', 'wachtrij', 'bezig', 'klaar', 'niets_gevonden',
        'twijfel', 'fout'
    )),
    CONSTRAINT ck_entity_research_role CHECK (role_category IS NULL OR role_category IN (
        'politicus', 'journalist', 'woordvoerder', 'bestuurder', 'organisatie', 'expert',
        'overig', 'prive', 'onbekend'
    ))
);

ALTER TABLE entity_research ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;

-- A table created earlier by the backend's create_all() may lack the server defaults that
-- request_entity_research() relies on.
ALTER TABLE entity_research ALTER COLUMN kind SET DEFAULT 'unknown';
ALTER TABLE entity_research ALTER COLUMN is_foreign SET DEFAULT FALSE;
ALTER TABLE entity_research ALTER COLUMN priority SET DEFAULT 0;
ALTER TABLE entity_research ALTER COLUMN prominence SET DEFAULT '{}'::jsonb;
ALTER TABLE entity_research ALTER COLUMN status SET DEFAULT 'nieuw';
ALTER TABLE entity_research ALTER COLUMN found SET DEFAULT '{}'::jsonb;
ALTER TABLE entity_research ALTER COLUMN requested_count SET DEFAULT 0;
ALTER TABLE entity_research ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE entity_research ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_entity_research_status ON entity_research (status, priority);
CREATE INDEX IF NOT EXISTS idx_entity_research_requested ON entity_research (last_requested_at);

-- No direct access for the frontend: RLS on, NO policies, no privileges.
ALTER TABLE entity_research ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'entity_research'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.entity_research', pol.policyname);
    END LOOP;
END $$;

REVOKE ALL ON entity_research FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- RPC functions (PostgREST: supabase.rpc('<name>', {...})). All return json.
-- ---------------------------------------------------------------------------------------------

-- {"ok": bool, "status": text, "reason": text|null}. Registers demand for a name the user tapped.
-- p_key: person:<slug> | org:<slug> | actor:<slug> (shared slugify); p_kind: person|org|unknown.
-- Rate limits: at most 60 requests per hour in total, and a repeat for the same key within 10
-- minutes only returns the current status. The backend decides whether anything is researched.
CREATE OR REPLACE FUNCTION request_entity_research(
    p_key text, p_name text, p_kind text DEFAULT 'unknown', p_event_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key text := lower(btrim(COALESCE(p_key, '')));
    v_name text := btrim(COALESCE(p_name, ''));
    v_kind text := lower(btrim(COALESCE(p_kind, 'unknown')));
    v_slug text := NULLIF(btrim(COALESCE(p_event_slug, '')), '');
    v_row entity_research%ROWTYPE;
    v_recent integer;
BEGIN
    IF length(v_key) > 170 OR v_key !~ '^(person|org|actor):[a-z0-9]+(-[a-z0-9]+)*$' THEN
        RETURN json_build_object('ok', false, 'status', NULL, 'reason', 'ongeldige_sleutel');
    END IF;
    IF length(v_name) < 2 OR length(v_name) > 160 THEN
        RETURN json_build_object('ok', false, 'status', NULL, 'reason', 'ongeldige_naam');
    END IF;
    IF v_kind NOT IN ('person', 'org', 'unknown') THEN
        v_kind := 'unknown';
    END IF;
    IF v_slug IS NOT NULL AND (length(v_slug) > 255 OR v_slug !~ '^[A-Za-z0-9_-]+$') THEN
        v_slug := NULL;
    END IF;

    SELECT * INTO v_row FROM entity_research WHERE entity_key = v_key;
    IF FOUND AND v_row.last_requested_at IS NOT NULL
       AND v_row.last_requested_at > now() - interval '10 minutes' THEN
        RETURN json_build_object('ok', true, 'status', v_row.status, 'reason', v_row.status_reason);
    END IF;

    SELECT count(*)::int INTO v_recent
    FROM entity_research
    WHERE last_requested_at > now() - interval '1 hour';
    IF v_recent >= 60 THEN
        RETURN json_build_object(
            'ok', false, 'status', CASE WHEN FOUND THEN v_row.status END, 'reason', 'druk'
        );
    END IF;

    INSERT INTO entity_research AS er (
        entity_key, name, kind, request_event_slug, requested_count, last_requested_at
    )
    VALUES (v_key, v_name, v_kind, v_slug, 1, now())
    ON CONFLICT (entity_key) DO UPDATE SET
        requested_count = er.requested_count + 1,
        last_requested_at = now(),
        request_event_slug = COALESCE(EXCLUDED.request_event_slug, er.request_event_slug),
        kind = CASE WHEN er.kind = 'unknown' THEN EXCLUDED.kind ELSE er.kind END,
        updated_at = now()
    RETURNING * INTO v_row;

    RETURN json_build_object('ok', true, 'status', v_row.status, 'reason', v_row.status_reason);
END;
$$;

-- [{"entity_key","name","kind","status","status_reason","role_category","role_label",
--   "pm_entity_id","pm_degree","found","queued_at","researched_at","updated_at"}], max 50 keys.
CREATE OR REPLACE FUNCTION entity_research_status(p_keys text[])
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH input AS (
        SELECT DISTINCT lower(btrim(k)) AS entity_key
        FROM unnest((COALESCE(p_keys, ARRAY[]::text[]))[1:50]) AS k
        WHERE k IS NOT NULL AND btrim(k) <> ''
    )
    SELECT COALESCE(
        json_agg(
            json_build_object(
                'entity_key', r.entity_key, 'name', r.name, 'kind', r.kind,
                'status', r.status, 'status_reason', r.status_reason,
                'role_category', r.role_category, 'role_label', r.role_label,
                'pm_entity_id', r.pm_entity_id, 'pm_degree', r.pm_degree, 'found', r.found,
                'queued_at', r.queued_at, 'researched_at', r.researched_at,
                'updated_at', r.updated_at
            )
            ORDER BY r.entity_key
        ),
        '[]'::json
    )
    FROM entity_research r
    JOIN input i ON i.entity_key = r.entity_key;
$$;

-- [{"entity_key","name","kind","shared_events","last_event_slug","last_event_title","last_seen"}]
-- People and organisations that appear in the same events as the entity (matched on its
-- aliases, max 20), over its 200 most recent events; the entity itself is excluded.
-- p_limit clamped 1..40. SECURITY INVOKER: event_entities is readable for anon (migration 004).
CREATE OR REPLACE FUNCTION entity_cooccurrence(p_aliases text[], p_limit integer DEFAULT 20)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH input AS (
        SELECT COALESCE(array_agg(DISTINCT lower(btrim(a))), ARRAY[]::text[]) AS aliases
        FROM unnest((COALESCE(p_aliases, ARRAY[]::text[]))[1:20]) AS a
        WHERE a IS NOT NULL AND btrim(a) <> ''
    ),
    own AS (
        SELECT ee.event_id
        FROM event_entities ee, input i
        WHERE cardinality(i.aliases) > 0
          AND ee.aliases && i.aliases
          AND ee.kind IN ('person', 'org')
        GROUP BY ee.event_id
        ORDER BY max(ee.event_last_updated_at) DESC NULLS LAST, ee.event_id DESC
        LIMIT 200
    ),
    others AS (
        SELECT ee.entity_key, ee.name, ee.kind, ee.event_id, ee.event_slug, ee.event_title,
               ee.event_last_updated_at
        FROM event_entities ee
        JOIN own o ON o.event_id = ee.event_id
        CROSS JOIN input i
        WHERE ee.kind IN ('person', 'org') AND NOT (ee.aliases && i.aliases)
    ),
    grouped AS (
        SELECT entity_key,
               (array_agg(name ORDER BY event_last_updated_at DESC NULLS LAST))[1] AS name,
               (array_agg(kind ORDER BY event_last_updated_at DESC NULLS LAST))[1] AS kind,
               count(DISTINCT event_id)::int AS shared_events,
               (array_agg(event_slug ORDER BY event_last_updated_at DESC NULLS LAST))[1]
                   AS last_event_slug,
               (array_agg(event_title ORDER BY event_last_updated_at DESC NULLS LAST))[1]
                   AS last_event_title,
               max(event_last_updated_at) AS last_seen
        FROM others
        GROUP BY entity_key
        ORDER BY count(DISTINCT event_id) DESC, max(event_last_updated_at) DESC NULLS LAST,
                 entity_key
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 40)
    )
    SELECT COALESCE(
        json_agg(
            json_build_object(
                'entity_key', entity_key, 'name', name, 'kind', kind,
                'shared_events', shared_events, 'last_event_slug', last_event_slug,
                'last_event_title', last_event_title, 'last_seen', last_seen
            )
            ORDER BY shared_events DESC, last_seen DESC NULLS LAST, entity_key
        ),
        '[]'::json
    )
    FROM grouped;
$$;

REVOKE ALL ON FUNCTION request_entity_research(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION entity_research_status(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION entity_cooccurrence(text[], integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION request_entity_research(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION entity_research_status(text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION entity_cooccurrence(text[], integer) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE 'Migration 006_entity_research completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new table and functions immediately
NOTIFY pgrst, 'reload schema';
