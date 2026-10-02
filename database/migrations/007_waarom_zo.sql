-- Migration: Waarom zo? (Epic 13, Story 13.1)
--
-- pm_paths: the best routes (at most 3 relations) between two sets of propaganda-model entities,
-- so the app can draw the network *between* things (the outlets and the actors of a news item,
-- two parties the user picked, a party and what is already on screen) instead of every neighbour
-- *around* one node. Contract: docs/stories/active/epic-13-waarom-zo.md.
--
-- The same rules live in frontend/lib/explore/pm-paths.ts (the demo runs that module). Both use
-- only multiplication, division and square roots in the same order on doubles, so they rank
-- routes identically; keep them in sync.
--
-- Licence (no redistribution): like the other pm_* functions this returns a small piece at a
-- time - at most 60 routes, and only the entities/relations on them. The pm_* tables stay
-- unreadable for anon (migration 005).
--
-- Idempotent. Requires migration 005 (pm_* tables). Supabase only: the anon/authenticated roles
-- must exist.

BEGIN;

-- {"routes": [{"from","to","rank","hops","nodes": [ids],"relations": [ids],"historic","shared_with": [ids]}],
--  "entities": [{"id","name","type","role","primary_filter","degree","active_from","active_until","auto_approved"}],
--  "relations": [same shape as pm_neighborhood],
--  "truncated": bool, "max_hops": int, "at": "YYYY-MM-DD"}
--
-- p_from: first 12 ids, p_to: first 40 ids (deduplicated, unknown ids dropped); p_max_hops 1..3;
-- p_limit = routes per (from, to) pair, 1..5; p_at = reference date YYYY-MM-DD (default today).
-- A route is a simple path over relations in either direction; intermediate stations are never
-- one of the given entities. Relations starting after p_at are ignored; relations that ended
-- before p_at are historic (half strength). Dates: YYYY = Jan 1 / Dec 31, YYYY-MM = the 1st / the
-- 31st, anything else = its first 10 characters (compared as text, byte order).
-- Order (the value is never returned): per relation w = strength(type) x certainty x (0.5 if
-- historic), per intermediate station h = 1 / sqrt(1 + degree), route = w1 x w2 x w3 x h1 x h2;
-- per (from, to) best first, then fewer hops, then relation ids; one route per node sequence.
-- shared_with = the other p_from ids with a route to the same target through the same stations
-- and kinds of relation (the same explanation). At most 60 routes (best first, then hops,
-- relation ids, from, to).
CREATE OR REPLACE FUNCTION pm_paths(
    p_from integer[], p_to integer[], p_max_hops integer DEFAULT 3,
    p_limit integer DEFAULT 2, p_at text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hops integer := LEAST(GREATEST(COALESCE(p_max_hops, 3), 1), 3);
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 2), 1), 5);
    v_at text := CASE WHEN p_at ~ '^\d{4}-\d{2}-\d{2}$' THEN p_at
                      ELSE to_char(current_date, 'YYYY-MM-DD') END;
    v_from integer[];
    v_to integer[];
    v_all integer[];
    v_result json;
BEGIN
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::integer[])
    INTO v_from
    FROM unnest((COALESCE(p_from, ARRAY[]::integer[]))[1:12]) AS x
    WHERE x IS NOT NULL AND EXISTS (SELECT 1 FROM pm_entities e WHERE e.id = x);

    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::integer[])
    INTO v_to
    FROM unnest((COALESCE(p_to, ARRAY[]::integer[]))[1:40]) AS x
    WHERE x IS NOT NULL AND EXISTS (SELECT 1 FROM pm_entities e WHERE e.id = x);

    IF cardinality(v_from) = 0 OR cardinality(v_to) = 0 THEN
        RETURN json_build_object(
            'routes', '[]'::json, 'entities', '[]'::json, 'relations', '[]'::json,
            'truncated', false, 'max_hops', v_hops, 'at', v_at
        );
    END IF;
    v_all := v_from || v_to;

    WITH dated AS (
        SELECT r.id, r.source_id, r.target_id, r.relation_type, r.certainty_label,
               CASE
                   WHEN NULLIF(btrim(r.active_from), '') IS NULL THEN NULL
                   WHEN length(btrim(r.active_from)) = 4 THEN btrim(r.active_from) || '-01-01'
                   WHEN length(btrim(r.active_from)) = 7 THEN btrim(r.active_from) || '-01'
                   ELSE left(btrim(r.active_from), 10)
               END COLLATE "C" AS period_start,
               CASE
                   WHEN NULLIF(btrim(r.active_until), '') IS NULL THEN NULL
                   WHEN length(btrim(r.active_until)) = 4 THEN btrim(r.active_until) || '-12-31'
                   WHEN length(btrim(r.active_until)) = 7 THEN btrim(r.active_until) || '-31'
                   ELSE left(btrim(r.active_until), 10)
               END COLLATE "C" AS period_end
        FROM pm_relations r
        WHERE r.source_id <> r.target_id
    ),
    rel AS (
        SELECT d.id, d.source_id, d.target_id, d.relation_type,
               (d.period_end IS NOT NULL AND d.period_end < v_at COLLATE "C") AS historic,
               (CASE d.relation_type
                    WHEN 'eigendom' THEN 1.0
                    WHEN 'financiering' THEN 0.9
                    WHEN 'investering' THEN 0.8
                    WHEN 'adverteerder' THEN 0.8
                    WHEN 'donor' THEN 0.8
                    WHEN 'bestuurder' THEN 0.8
                    WHEN 'personeel' THEN 0.7
                    WHEN 'dienstverband' THEN 0.7
                    WHEN 'woordvoerder_van' THEN 0.7
                    WHEN 'draaideur' THEN 0.7
                    WHEN 'mediaplatform' THEN 0.7
                    WHEN 'adviseur' THEN 0.6
                    WHEN 'bron_van' THEN 0.6
                    WHEN 'flak' THEN 0.6
                    WHEN 'censuur' THEN 0.6
                    WHEN 'intimidatie' THEN 0.6
                    WHEN 'cooptatie' THEN 0.6
                    WHEN 'lobbyt' THEN 0.6
                    WHEN 'lidmaatschap' THEN 0.5
                    WHEN 'citeert' THEN 0.5
                    WHEN 'framing' THEN 0.5
                    WHEN 'etikettering' THEN 0.5
                    WHEN 'zelfcensuur' THEN 0.5
                    WHEN 'regulering' THEN 0.5
                    WHEN 'alliantie' THEN 0.5
                    WHEN 'oppositie' THEN 0.5
                    ELSE 0.4
                END)::float8
               * (CASE d.certainty_label
                      WHEN 'onderbouwd' THEN 1.0
                      WHEN 'aannemelijk' THEN 0.85
                      ELSE 0.7
                  END)::float8
               * (CASE WHEN d.period_end IS NOT NULL AND d.period_end < v_at COLLATE "C"
                       THEN 0.5 ELSE 1.0 END)::float8 AS w
        FROM dated d
        WHERE d.period_start IS NULL OR d.period_start <= v_at COLLATE "C"
    ),
    -- both directions: a route may follow a relation either way
    e AS (
        SELECT id AS rid, source_id AS a, target_id AS b, relation_type AS kind, w, historic FROM rel
        UNION ALL
        SELECT id, target_id, source_id, relation_type, w, historic FROM rel
    ),
    hub AS (
        SELECT id, 1.0::float8 / sqrt((1 + GREATEST(degree, 0))::float8) AS h FROM pm_entities
    ),
    candidates AS (
        SELECT e1.a AS f, e1.b AS t, ARRAY[e1.a, e1.b] AS nodes, ARRAY[e1.rid] AS rels,
               ARRAY[e1.kind] AS kinds, e1.w AS score, 1 AS hops, e1.historic AS historic
        FROM e e1
        WHERE e1.a = ANY (v_from) AND e1.b = ANY (v_to) AND e1.a <> e1.b
        UNION ALL
        SELECT e1.a, e2.b, ARRAY[e1.a, e1.b, e2.b], ARRAY[e1.rid, e2.rid], ARRAY[e1.kind, e2.kind],
               e1.w * e2.w * h1.h, 2, e1.historic OR e2.historic
        FROM e e1
        JOIN e e2 ON e2.a = e1.b
        JOIN hub h1 ON h1.id = e1.b
        WHERE v_hops >= 2
          AND e1.a = ANY (v_from) AND e2.b = ANY (v_to) AND e1.a <> e2.b
          AND NOT (e1.b = ANY (v_all))
        UNION ALL
        SELECT e1.a, e3.b, ARRAY[e1.a, e1.b, e2.b, e3.b], ARRAY[e1.rid, e2.rid, e3.rid],
               ARRAY[e1.kind, e2.kind, e3.kind], e1.w * e2.w * e3.w * h1.h * h2.h, 3,
               e1.historic OR e2.historic OR e3.historic
        FROM e e1
        JOIN e e2 ON e2.a = e1.b
        JOIN e e3 ON e3.a = e2.b
        JOIN hub h1 ON h1.id = e1.b
        JOIN hub h2 ON h2.id = e2.b
        WHERE v_hops >= 3
          AND e1.a = ANY (v_from) AND e3.b = ANY (v_to) AND e1.a <> e3.b
          AND NOT (e1.b = ANY (v_all)) AND NOT (e2.b = ANY (v_all)) AND e1.b <> e2.b
    ),
    -- one route per node sequence: the strongest choice of relations
    unique_routes AS (
        SELECT DISTINCT ON (f, t, nodes)
               f, t, nodes, rels, score, hops, historic,
               array_to_string(kinds, ',') || '|' || array_to_string(nodes[2:hops], ',') AS signature
        FROM candidates
        ORDER BY f, t, nodes, score DESC, rels
    ),
    per_pair AS (
        SELECT u.*, row_number() OVER (PARTITION BY f, t ORDER BY score DESC, hops, rels) AS pair_rank
        FROM unique_routes u
    ),
    ordered AS (
        SELECT p.*, row_number() OVER (ORDER BY score DESC, hops, rels, f, t) AS position,
               count(*) OVER () AS total
        FROM per_pair p
        WHERE p.pair_rank <= v_limit
    ),
    kept AS (
        SELECT * FROM ordered WHERE position <= 60
    )
    SELECT json_build_object(
        'routes', COALESCE((
            SELECT json_agg(
                json_build_object(
                    'from', k.f, 'to', k.t, 'rank', k.pair_rank, 'hops', k.hops,
                    'nodes', k.nodes, 'relations', k.rels, 'historic', k.historic,
                    'shared_with', COALESCE((
                        SELECT array_agg(DISTINCT o.f ORDER BY o.f)
                        FROM unique_routes o
                        WHERE o.t = k.t AND o.signature = k.signature AND o.f <> k.f
                    ), ARRAY[]::integer[])
                )
                ORDER BY k.position
            )
            FROM kept k
        ), '[]'::json),
        'entities', COALESCE((
            SELECT json_agg(
                json_build_object(
                    'id', en.id, 'name', en.name, 'type', en.type, 'role', en.role,
                    'primary_filter', en.primary_filter, 'degree', en.degree,
                    'active_from', en.active_from, 'active_until', en.active_until,
                    'auto_approved', en.auto_approved
                )
                ORDER BY en.id
            )
            FROM pm_entities en
            WHERE en.id IN (SELECT unnest(k.nodes) FROM kept k)
        ), '[]'::json),
        'relations', COALESCE((
            SELECT json_agg(
                json_build_object(
                    'id', r.id, 'source_id', r.source_id, 'target_id', r.target_id,
                    'relation_type', r.relation_type, 'mechanism', r.mechanism,
                    'filter', r.filter, 'filters', r.filters, 'aard', r.aard,
                    'certainty_label', r.certainty_label,
                    'active_from', r.active_from, 'active_until', r.active_until,
                    'source_count', r.source_count, 'bidirectional', r.bidirectional,
                    'auto_approved', r.auto_approved
                )
                ORDER BY r.id
            )
            FROM pm_relations r
            WHERE r.id IN (SELECT unnest(k.rels) FROM kept k)
        ), '[]'::json),
        'truncated', COALESCE((SELECT max(total) FROM ordered), 0) > 60,
        'max_hops', v_hops,
        'at', v_at
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION pm_paths(integer[], integer[], integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pm_paths(integer[], integer[], integer, integer, text) TO anon, authenticated;

-- Verify the migration (an exception rolls back the whole transaction)
DO $$
BEGIN
    IF to_regclass('public.pm_relations') IS NULL OR to_regclass('public.pm_entities') IS NULL THEN
        RAISE EXCEPTION 'Run migration 005_propagandamodel.sql first (pm_* tables missing)';
    END IF;

    IF NOT (SELECT prosecdef FROM pg_proc
            WHERE oid = 'public.pm_paths(integer[], integer[], integer, integer, text)'::regprocedure) THEN
        RAISE EXCEPTION 'pm_paths must be SECURITY DEFINER';
    END IF;

    IF NOT has_function_privilege('anon', 'public.pm_paths(integer[], integer[], integer, integer, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon cannot execute pm_paths';
    END IF;

    IF has_table_privilege('anon', 'public.pm_relations', 'SELECT') THEN
        RAISE EXCEPTION 'anon must not be able to SELECT pm_relations (run migration 005 again)';
    END IF;

    RAISE NOTICE 'Migration 007_waarom_zo completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new function immediately
NOTIFY pgrst, 'reload schema';
