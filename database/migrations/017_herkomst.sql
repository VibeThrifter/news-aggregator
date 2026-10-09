-- Migration: Waar komt een verband vandaan? (Epic 14, Story 14.23)
--
-- The owner, about a link in the propaganda model shown without any source: "staat niet eens op
-- waar het vandaan komt". Sync format 9 (backend/app/services/propaganda_model_sync.py) writes
-- per relation where it comes from and when it was added; this migration makes room and lets
-- pm_details return them:
--   - columns pm_relations.origin (opzet | register | eigenaar | assistent | agent: the first draft
--     of the model from June 2026, a public register, the owner, the owner's AI assistant or a
--     research agent - never an account name) and pm_relations.added_at (YYYY-MM-DD);
--   - pm_details (as migration 016): origin and added_at for relations.
--
-- Licence (no redistribution) and access: unchanged; the pm_* tables stay unreadable for anon.
--
-- Live database (see migration 014): the ALTER needs an exclusive lock on pm_relations, so it runs
-- in its own short transaction with lock_timeout 1s; rerun the file when it times out (idempotent).
-- Requires migrations 005, 010 and 016. Supabase only: the anon and authenticated roles must exist.
-- Run with:
--   psql "postgresql://postgres:<password>@<host>:5432/postgres" -f database/migrations/017_herkomst.sql

BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE pm_relations ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE pm_relations ADD COLUMN IF NOT EXISTS added_at TEXT;
COMMIT;

BEGIN;

-- As migration 016, plus origin and added_at for relations.
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
            'bestuurslaag', e.bestuurslaag, 'wikidata', e.wikidata,
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
            'auto_approved', r.auto_approved, 'functie', r.functie,
            'origin', r.origin, 'added_at', r.added_at, 'sources', v_sources,
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

REVOKE ALL ON FUNCTION pm_details(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pm_details(text, integer) TO anon, authenticated;

-- Verify the migration (an exception rolls back this transaction)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'pm_relations' AND column_name = 'origin')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'pm_relations' AND column_name = 'added_at') THEN
        RAISE EXCEPTION 'pm_relations.origin or pm_relations.added_at missing';
    END IF;
    IF has_table_privilege('anon', 'public.pm_relations', 'SELECT') THEN
        RAISE EXCEPTION 'anon must not read the pm_* tables';
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.pm_details(text, integer)'::regprocedure) THEN
        RAISE EXCEPTION 'pm_details must be SECURITY DEFINER';
    END IF;
    IF NOT has_function_privilege('anon', 'public.pm_details(text, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon cannot execute pm_details';
    END IF;
END $$;

COMMIT;
