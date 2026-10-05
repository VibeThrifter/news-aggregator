-- Migration: Dun bewijs - verbanden laten uitzoeken (Epic 14, Story 14.13)
--
-- "Wie zit erachter?" shows how thin the evidence behind a propaganda-model link often is (one
-- press release of the party itself, nothing reviewed). The reader sees that, and the link is
-- researched: the local backend puts it in the research queue of the propaganda model
-- (nieuws_doelen, soort 'relatie') and the pm agent nieuws-bewijs looks for evidence for AND
-- against it. Everything it finds lands 'voorgesteld' until a human reviews it in the
-- propaganda model; only then does the reader see it (the pm sync).
--
-- relation_research               : one row per pm relation: demand, status of the research,
--                                   what it found (counts only); the agent's report stays here
--                                   (summary, never exposed).
-- request_relation_research(ids, slug) : the event page registers demand for its thin links
--                                   (max 12 per call, rate-limited) and gets their status back.
-- relation_research_status(ids)   : status for at most 40 relations (safe columns only).
--
-- Only relations that exist in pm_relations, that are not "onderbouwd" and that are not a tie
-- between a person and an organisation (those are researched by Epic 12) can be requested. The
-- backend decides what is actually queued (daily budget) and builds the research target from
-- its own data only: nothing a reader sends reaches the research agent.
--
-- Written by the local backend (service role / postgres) and by request_relation_research. RLS
-- without policies and no privileges for anon/authenticated: the frontend only uses the
-- functions. Run it BEFORE restarting a backend that knows the table: its create_all() would
-- create it without RLS.
--
-- Idempotent: safe to run more than once, and after create_all() created the table. Requires
-- migration 005 (pm_relations). Supabase only: the anon/authenticated roles must exist.

BEGIN;

CREATE TABLE IF NOT EXISTS relation_research (
    relation_id INTEGER PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'nieuw',
    status_reason TEXT,
    priority REAL NOT NULL DEFAULT 0,
    request_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    requested_count INTEGER NOT NULL DEFAULT 0,
    last_requested_at TIMESTAMPTZ,
    pm_doel_id INTEGER,
    found JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary TEXT,                          -- report of the research agent, never exposed
    queued_at TIMESTAMPTZ,
    researched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_relation_research_status CHECK (status IN (
        'nieuw', 'niet_nodig', 'wachtrij', 'bezig', 'klaar', 'niets_gevonden', 'overgeslagen',
        'twijfel', 'fout'
    ))
);

-- A table created earlier by the backend's create_all() must have the server defaults that
-- request_relation_research() relies on.
ALTER TABLE relation_research ALTER COLUMN status SET DEFAULT 'nieuw';
ALTER TABLE relation_research ALTER COLUMN priority SET DEFAULT 0;
ALTER TABLE relation_research ALTER COLUMN request_events SET DEFAULT '[]'::jsonb;
ALTER TABLE relation_research ALTER COLUMN requested_count SET DEFAULT 0;
ALTER TABLE relation_research ALTER COLUMN found SET DEFAULT '{}'::jsonb;
ALTER TABLE relation_research ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE relation_research ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_relation_research_status ON relation_research (status, priority);
CREATE INDEX IF NOT EXISTS idx_relation_research_requested ON relation_research (last_requested_at);

-- No direct access for the frontend: RLS on, NO policies, no privileges.
ALTER TABLE relation_research ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'relation_research'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.relation_research', pol.policyname);
    END LOOP;
END $$;

REVOKE ALL ON relation_research FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- RPC functions (PostgREST: supabase.rpc('<name>', {...})). Both return json.
-- ---------------------------------------------------------------------------------------------

-- [{"relation_id","status","status_reason","found","queued_at","researched_at","updated_at"}]
-- for at most 40 of the given relation ids (the first 40); ids without a row are left out.
CREATE OR REPLACE FUNCTION relation_research_status(p_ids integer[])
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH input AS (
        SELECT DISTINCT id
        FROM (
            SELECT id FROM unnest(COALESCE(p_ids, '{}'::integer[])) WITH ORDINALITY AS t(id, n)
            WHERE id IS NOT NULL
            ORDER BY n
            LIMIT 40
        ) picked
    )
    SELECT COALESCE(
        json_agg(
            json_build_object(
                'relation_id', r.relation_id, 'status', r.status,
                'status_reason', r.status_reason, 'found', r.found,
                'queued_at', r.queued_at, 'researched_at', r.researched_at,
                'updated_at', r.updated_at
            )
            ORDER BY r.relation_id
        ),
        '[]'::json
    )
    FROM relation_research r
    JOIN input i ON i.id = r.relation_id;
$$;

-- Registers demand for the thin links an event page shows and returns their status (as
-- relation_research_status). At most 12 ids per call; ids that are unknown, "onderbouwd" or a
-- person-organisation tie are ignored. A repeat for the same relation within 10 minutes is not
-- counted, and at most 300 registrations per hour are taken in total. p_event_slug only says
-- where the demand came from (the backend looks the event up itself).
CREATE OR REPLACE FUNCTION request_relation_research(p_ids integer[], p_event_slug text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ids integer[];
    v_slug text := NULLIF(btrim(COALESCE(p_event_slug, '')), '');
    v_recent integer;
BEGIN
    SELECT COALESCE(array_agg(DISTINCT id), '{}')
    INTO v_ids
    FROM (
        SELECT id FROM unnest(COALESCE(p_ids, '{}'::integer[])) WITH ORDINALITY AS t(id, n)
        WHERE id IS NOT NULL AND id > 0
        ORDER BY n
        LIMIT 12
    ) picked;
    IF v_slug IS NOT NULL AND (length(v_slug) > 255 OR v_slug !~ '^[A-Za-z0-9_-]+$') THEN
        v_slug := NULL;
    END IF;

    SELECT count(*)::int INTO v_recent
    FROM relation_research
    WHERE last_requested_at > now() - interval '1 hour';

    IF v_recent < 300 AND cardinality(v_ids) > 0 THEN
        INSERT INTO relation_research AS rr (
            relation_id, requested_count, last_requested_at, request_events
        )
        SELECT r.id, 1, now(),
               CASE WHEN v_slug IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_slug) END
        FROM pm_relations r
        WHERE r.id = ANY(v_ids)
          AND COALESCE(r.certainty_label, 'onzeker') <> 'onderbouwd'
          AND r.relation_type NOT IN (
              'lidmaatschap', 'personeel', 'dienstverband', 'woordvoerder_van', 'bestuurder',
              'adviseur', 'draaideur'
          )
        ON CONFLICT (relation_id) DO UPDATE SET
            requested_count = rr.requested_count + 1,
            last_requested_at = now(),
            request_events = CASE
                WHEN v_slug IS NULL THEN rr.request_events
                ELSE (
                    SELECT COALESCE(jsonb_agg(e.value ORDER BY e.n), '[]'::jsonb)
                    FROM (
                        SELECT value, n
                        FROM jsonb_array_elements(
                            jsonb_build_array(v_slug) || (rr.request_events - v_slug)
                        ) WITH ORDINALITY AS x(value, n)
                        ORDER BY n
                        LIMIT 5
                    ) e
                )
            END,
            updated_at = now()
        WHERE rr.last_requested_at IS NULL
           OR rr.last_requested_at < now() - interval '10 minutes';
    END IF;

    RETURN relation_research_status(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION relation_research_status(integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_relation_research(integer[], text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION relation_research_status(integer[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION request_relation_research(integer[], text) TO anon, authenticated;

-- Verify the migration (an exception rolls back the whole transaction)
DO $$
DECLARE
    f text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'relation_research'
    ) THEN
        RAISE EXCEPTION 'Table relation_research not created';
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.relation_research'::regclass) THEN
        RAISE EXCEPTION 'Row level security not enabled on relation_research';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'relation_research'
    ) THEN
        RAISE EXCEPTION 'relation_research must not have policies (access only via RPC functions)';
    END IF;

    IF has_table_privilege('anon', 'public.relation_research', 'SELECT')
       OR has_table_privilege('authenticated', 'public.relation_research', 'SELECT') THEN
        RAISE EXCEPTION 'anon/authenticated must not be able to SELECT relation_research';
    END IF;

    FOREACH f IN ARRAY ARRAY[
        'public.relation_research_status(integer[])',
        'public.request_relation_research(integer[], text)'
    ]
    LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
            RAISE EXCEPTION 'Function % must be SECURITY DEFINER', f;
        END IF;

        IF NOT has_function_privilege('anon', f, 'EXECUTE') THEN
            RAISE EXCEPTION 'anon cannot execute %', f;
        END IF;
    END LOOP;

    RAISE NOTICE 'Migration 011_bewijs_zoeken completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new functions immediately
NOTIFY pgrst, 'reload schema';
