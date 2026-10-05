-- Migration: Propagandamodel - argumenten en uitleg (Epic 14, Story 14.12)
--
-- "Wie zit erachter?" showed one bare description per link ("RIVM was primaire officiële bron
-- tijdens coronacrisis. Frame werd vrijwel onkritisch overgenomen"), while the propaganda model
-- keeps the discussion behind it: arguments for, against and nuancing a relation, each with a
-- review status (geverifieerd, ongecontroleerd, bronvermelding_nodig, betwist, verouderd) and the
-- sources it cites. This migration lets the app show that, so a reader sees what a link rests on
-- (one press release? a verified study?) and how sure the model is.
--
-- pm_arguments  : per exported relation the arguments a reader may see (claim, stance, status,
--                 aspect, parent for replies, up to 3 sources as JSON), written by the sync
--                 (backend/app/services/propaganda_model_sync.py, format 5): never rejected or
--                 unmerged ones (except the unreviewed evidence of automatically approved
--                 relations), never under the smaad hold, never the excluded layers.
-- pm_mechanisms : what every mechanism means, by display name (= pm_relations.mechanism).
-- pm_details    : relations also return 'arguments' (max 12, by position), 'source' and 'target'
--                 ({id, name, type}) and 'mechanism_description' / 'mechanism_effect'.
-- pm_relation_arguments(ids) : the arguments of at most 40 relations at once, for the lines of
--                 "Wie zit erachter?" (one call instead of one per line).
--
-- Licence (no redistribution): the same as migration 005. RLS without policies and no
-- privileges on the new tables; the frontend (anon key) reaches them only through the SECURITY
-- DEFINER functions, which return the arguments of one relation, or of at most 40, at a time.
--
-- Run it BEFORE the backend with sync format 5 runs: the sync refuses to write while a pm_* table
-- is readable by anon, and the backend's create_all() creates the new tables without RLS. After
-- the migration, the next sync refills everything (pm_meta.format changes), or force it:
-- POST /admin/trigger/propagandamodel-sync?force=true.
--
-- Idempotent. Requires migration 005. Re-running 005 puts the old pm_details back: run this
-- migration again afterwards. Supabase only: the anon/authenticated roles must exist.

BEGIN;

CREATE TABLE IF NOT EXISTS pm_arguments (
    id INTEGER PRIMARY KEY,                -- propaganda-model argument id
    owner_kind TEXT NOT NULL,              -- 'relation' (entities may follow)
    owner_id INTEGER NOT NULL,
    parent_id INTEGER,                     -- reply to this argument (NULL = about the relation)
    aspect TEXT,                           -- NULL = whether it exists; certainty, influence, ...
    stance TEXT NOT NULL,                  -- supporting | contradicting | contextual
    status TEXT NOT NULL,                  -- review status in the propaganda model
    claim TEXT NOT NULL,                   -- <= 600 characters
    sources JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{title,url,publisher,published_at,kind,quote}]
    position INTEGER NOT NULL DEFAULT 0,   -- order within the relation
    CONSTRAINT ck_pm_arguments_owner_kind CHECK (owner_kind IN ('entity', 'relation')),
    CONSTRAINT ck_pm_arguments_stance
        CHECK (stance IN ('supporting', 'contradicting', 'contextual'))
);

CREATE INDEX IF NOT EXISTS idx_pm_arguments_owner ON pm_arguments (owner_kind, owner_id);

CREATE TABLE IF NOT EXISTS pm_mechanisms (
    name TEXT PRIMARY KEY,                 -- display name, as in pm_relations.mechanism
    filter TEXT,
    description TEXT,
    effect TEXT
);

ALTER TABLE pm_arguments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_mechanisms ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('pm_arguments', 'pm_mechanisms')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

REVOKE ALL ON pm_arguments, pm_mechanisms FROM PUBLIC, anon, authenticated;

-- Migration 005's pm_details plus, for relations: 'arguments', 'source', 'target',
-- 'mechanism_description' and 'mechanism_effect'. Entities are unchanged.
CREATE OR REPLACE FUNCTION pm_details(p_kind text, p_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_kind text := lower(btrim(COALESCE(p_kind, '')));
    v_sources json;
    v_arguments json;
    v_result json;
BEGIN
    IF v_kind NOT IN ('entity', 'relation') OR p_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(
        json_agg(
            json_build_object(
                'title', s.title, 'url', s.url, 'publisher', s.publisher,
                'published_at', s.published_at, 'quote', s.quote, 'unreviewed', s.unreviewed
            )
            ORDER BY s.position, s.id
        ),
        '[]'::json
    )
    INTO v_sources
    FROM (
        SELECT * FROM pm_sources
        WHERE owner_kind = v_kind AND owner_id = p_id
        ORDER BY position, id
        LIMIT 12
    ) s;

    IF v_kind = 'entity' THEN
        SELECT json_build_object(
            'kind', 'entity', 'id', e.id, 'title', e.name, 'type', e.type,
            'mechanism', NULL::text, 'filter', e.primary_filter, 'filters', NULL::json,
            'description', e.description,
            'active_from', e.active_from, 'active_until', e.active_until,
            'certainty_label', NULL::text, 'auto_approved', e.auto_approved,
            'sources', v_sources
        )
        INTO v_result
        FROM pm_entities e
        WHERE e.id = p_id;
    ELSE
        SELECT COALESCE(
            json_agg(
                json_build_object(
                    'id', a.id, 'parent_id', a.parent_id, 'aspect', a.aspect,
                    'stance', a.stance, 'status', a.status, 'claim', a.claim,
                    'sources', a.sources
                )
                ORDER BY a.position, a.id
            ),
            '[]'::json
        )
        INTO v_arguments
        FROM (
            SELECT * FROM pm_arguments
            WHERE owner_kind = 'relation' AND owner_id = p_id
            ORDER BY position, id
            LIMIT 12
        ) a;

        SELECT json_build_object(
            'kind', 'relation', 'id', r.id, 'title', src.name || ' → ' || tgt.name,
            'type', r.relation_type, 'mechanism', r.mechanism, 'filter', r.filter,
            'filters', r.filters, 'description', r.description, 'active_from', r.active_from,
            'active_until', r.active_until, 'certainty_label', r.certainty_label,
            'auto_approved', r.auto_approved, 'sources', v_sources,
            'arguments', v_arguments,
            'source', json_build_object('id', src.id, 'name', src.name, 'type', src.type),
            'target', json_build_object('id', tgt.id, 'name', tgt.name, 'type', tgt.type),
            'mechanism_description', m.description,
            'mechanism_effect', m.effect
        )
        INTO v_result
        FROM pm_relations r
        JOIN pm_entities src ON src.id = r.source_id
        JOIN pm_entities tgt ON tgt.id = r.target_id
        LEFT JOIN pm_mechanisms m ON m.name = r.mechanism
        WHERE r.id = p_id;
    END IF;

    RETURN v_result;
END;
$$;

-- [{"relation_id", "arguments": [{"id","parent_id","aspect","stance","status","claim",
--   "sources"}] (max 12 per relation, by position)}] for at most 40 of the given relation ids
-- (the first 40, unknown ids skipped). Relations without arguments have an empty list.
CREATE OR REPLACE FUNCTION pm_relation_arguments(p_ids integer[])
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ids integer[];
BEGIN
    SELECT COALESCE(array_agg(DISTINCT id), '{}')
    INTO v_ids
    FROM (
        SELECT id FROM unnest(COALESCE(p_ids, '{}'::integer[])) WITH ORDINALITY AS t(id, n)
        WHERE id IS NOT NULL
        ORDER BY n
        LIMIT 40
    ) picked;

    RETURN COALESCE(
        (
            SELECT json_agg(
                json_build_object(
                    'relation_id', r.id,
                    'arguments', COALESCE(
                        (
                            SELECT json_agg(
                                json_build_object(
                                    'id', a.id, 'parent_id', a.parent_id, 'aspect', a.aspect,
                                    'stance', a.stance, 'status', a.status, 'claim', a.claim,
                                    'sources', a.sources
                                )
                                ORDER BY a.position, a.id
                            )
                            FROM (
                                SELECT * FROM pm_arguments
                                WHERE owner_kind = 'relation' AND owner_id = r.id
                                ORDER BY position, id
                                LIMIT 12
                            ) a
                        ),
                        '[]'::json
                    )
                )
                ORDER BY r.id
            )
            FROM pm_relations r
            WHERE r.id = ANY(v_ids)
        ),
        '[]'::json
    );
END;
$$;

REVOKE ALL ON FUNCTION pm_details(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION pm_relation_arguments(integer[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION pm_details(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pm_relation_arguments(integer[]) TO anon, authenticated;

-- Verify the migration (an exception rolls back the whole transaction)
DO $$
DECLARE
    t text;
    f text;
BEGIN
    FOREACH t IN ARRAY ARRAY['pm_arguments', 'pm_mechanisms']
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            RAISE EXCEPTION 'Table % not created', t;
        END IF;

        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
            RAISE EXCEPTION 'Row level security not enabled on %', t;
        END IF;

        IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
            RAISE EXCEPTION 'Table % must not have policies (access only via RPC functions)', t;
        END IF;

        IF has_table_privilege('anon', 'public.' || t, 'SELECT')
           OR has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
            RAISE EXCEPTION 'anon/authenticated must not be able to SELECT %', t;
        END IF;
    END LOOP;

    FOREACH f IN ARRAY ARRAY[
        'public.pm_details(text, integer)',
        'public.pm_relation_arguments(integer[])'
    ]
    LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
            RAISE EXCEPTION 'Function % must be SECURITY DEFINER', f;
        END IF;

        IF NOT has_function_privilege('anon', f, 'EXECUTE') THEN
            RAISE EXCEPTION 'anon cannot execute %', f;
        END IF;
    END LOOP;

    RAISE NOTICE 'Migration 010_pm_argumenten completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new functions immediately
NOTIFY pgrst, 'reload schema';
