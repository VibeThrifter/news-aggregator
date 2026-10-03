-- Migration: invloed per richting (Epic 13, Story 13.10)
--
-- "Wie heeft invloed op DPG Media?" and "Op wie heeft DPG Media invloed?" are different questions.
-- pm_neighborhood gets a direction: p_direction 'in' = relations through which the other party has
-- influence on the entity, 'out' = relations through which the entity has influence on the other;
-- NULL = both (as before). It also returns "direction_counts": per filter how many relations go
-- each way, so the app can ask both questions without downloading the relations.
--
-- Direction of influence per relation (the same rules live in influenceOf() in
-- frontend/lib/explore/pm-graph.ts, which the demo uses; keep them in sync):
--   - bidirectional relations and alliantie, oppositie, draaideur: both ways;
--   - personeel, dienstverband, woordvoerder_van, lidmaatschap, citeert: the target has influence
--     on the source ("A werkt voor B": B on A; "A citeert B": B on A);
--   - every other relation: the source has influence on the target ("A is eigenaar van B").
--
-- Replaces pm_neighborhood(integer, integer, text[]) by pm_neighborhood(integer, integer, text[],
-- text): calls without p_direction keep working (named arguments). Re-running migration 005 puts
-- the old function back (and drops this one): run this migration again afterwards.
--
-- Licence (no redistribution): aggregates only, at most 60 relations per call, like before. The
-- pm_* tables stay unreadable for anon (migration 005).
--
-- Idempotent. Requires migration 005 (pm_* tables). Supabase only: the anon/authenticated roles
-- must exist.

BEGIN;

-- 'in' (the other party has influence on p_entity), 'out' (p_entity on the other) or 'both'
CREATE OR REPLACE FUNCTION pm_influence_side(
    p_relation_type text, p_bidirectional boolean, p_source_id integer, p_entity_id integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN COALESCE(p_bidirectional, false)
             OR p_relation_type IN ('alliantie', 'oppositie', 'draaideur') THEN 'both'
        WHEN (p_relation_type IN ('personeel', 'dienstverband', 'woordvoerder_van', 'lidmaatschap', 'citeert'))
             = (p_source_id = p_entity_id) THEN 'in'
        ELSE 'out'
    END
$$;

-- As pm_neighborhood of migration 005, plus:
--  p_direction 'in' | 'out' | NULL (anything else = NULL): only the relations that go that way
--  (relations that go both ways always count); "total", "truncated" and "breakdown" follow it,
--  "filter_counts" does not (still over all relations touching the entity),
--  "direction_counts": {"eigendom": {"in": int, "out": int}, ...} over ALL relations touching
--  the entity, keyed like filter_counts (a relation that goes both ways counts in both),
--  "direction": p_direction (echo; null when not given).
DROP FUNCTION IF EXISTS pm_neighborhood(integer, integer, text[]);

CREATE OR REPLACE FUNCTION pm_neighborhood(
    p_entity_id integer, p_limit integer DEFAULT 40, p_filters text[] DEFAULT NULL,
    p_direction text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    lim integer := LEAST(GREATEST(COALESCE(p_limit, 40), 1), 60);
    -- NULL = no filter (all relations); an empty array means the same
    v_filters text[] := CASE WHEN COALESCE(cardinality(p_filters), 0) = 0 THEN NULL
                             ELSE p_filters END;
    v_direction text := CASE WHEN p_direction IN ('in', 'out') THEN p_direction END;
    v_center json;
    v_total integer;
    v_counts json;
    v_direction_counts json;
    v_breakdown json;
    v_relations json;
    v_entities json;
BEGIN
    SELECT json_build_object(
        'id', e.id, 'name', e.name, 'type', e.type, 'role', e.role,
        'primary_filter', e.primary_filter, 'degree', e.degree,
        'active_from', e.active_from, 'active_until', e.active_until,
        'auto_approved', e.auto_approved
    )
    INTO v_center
    FROM pm_entities e
    WHERE e.id = p_entity_id;

    IF v_center IS NULL THEN
        RETURN json_build_object(
            'center', NULL::json, 'entities', '[]'::json, 'relations', '[]'::json,
            'total', 0, 'truncated', false, 'filter_counts', '{}'::json,
            'direction_counts', '{}'::json, 'breakdown', '{}'::json, 'filters', v_filters,
            'direction', v_direction
        );
    END IF;

    -- per filter over all relations touching the entity (independent of p_filters and p_direction)
    WITH keyed AS (
        SELECT f.filter_name,
               pm_influence_side(r.relation_type, r.bidirectional, r.source_id, p_entity_id) AS side
        FROM pm_relations r
        CROSS JOIN LATERAL unnest(
            CASE WHEN COALESCE(cardinality(r.filters), 0) = 0 THEN ARRAY['overig']::text[]
                 ELSE r.filters END
        ) AS f(filter_name)
        WHERE r.source_id = p_entity_id OR r.target_id = p_entity_id
    ),
    counted AS (
        SELECT k.filter_name, count(*)::int AS n,
               count(*) FILTER (WHERE k.side IN ('in', 'both'))::int AS n_in,
               count(*) FILTER (WHERE k.side IN ('out', 'both'))::int AS n_out,
               COALESCE(
                   array_position(
                       ARRAY['eigendom', 'advertentie', 'sourcing', 'flak', 'ideologie',
                             'tegenmacht', 'overig'],
                       k.filter_name
                   ),
                   99
               ) AS sort_order
        FROM keyed k
        GROUP BY k.filter_name
    )
    SELECT COALESCE(json_object_agg(c.filter_name, c.n ORDER BY c.sort_order, c.filter_name), '{}'::json),
           COALESCE(json_object_agg(c.filter_name, json_build_object('in', c.n_in, 'out', c.n_out)
                                    ORDER BY c.sort_order, c.filter_name), '{}'::json)
    INTO v_counts, v_direction_counts
    FROM counted c;

    -- per filter (same keys as filter_counts): type of the other party and mechanism, aggregates
    -- only; only the relations that go p_direction when it is given
    WITH keyed AS (
        SELECT f.filter_name, r.mechanism, COALESCE(o.type, 'onbekend') AS other_type
        FROM pm_relations r
        CROSS JOIN LATERAL unnest(
            CASE WHEN COALESCE(cardinality(r.filters), 0) = 0 THEN ARRAY['overig']::text[]
                 ELSE r.filters END
        ) AS f(filter_name)
        LEFT JOIN pm_entities o
               ON o.id = CASE WHEN r.source_id = p_entity_id THEN r.target_id ELSE r.source_id END
        WHERE (r.source_id = p_entity_id OR r.target_id = p_entity_id)
          AND (v_direction IS NULL
               OR pm_influence_side(r.relation_type, r.bidirectional, r.source_id, p_entity_id)
                  IN (v_direction, 'both'))
    ),
    by_type AS (
        SELECT t.filter_name, json_object_agg(t.other_type, t.n ORDER BY t.n DESC, t.other_type) AS types
        FROM (SELECT filter_name, other_type, count(*)::int AS n FROM keyed GROUP BY 1, 2) t
        GROUP BY t.filter_name
    ),
    by_mechanism AS (
        SELECT m.filter_name, json_object_agg(m.mechanism, m.n ORDER BY m.n DESC, m.mechanism) AS mechanisms
        FROM (
            SELECT filter_name, mechanism, count(*)::int AS n
            FROM keyed
            WHERE NULLIF(btrim(mechanism), '') IS NOT NULL
            GROUP BY 1, 2
        ) m
        GROUP BY m.filter_name
    )
    SELECT COALESCE(
               json_object_agg(
                   bt.filter_name,
                   json_build_object('types', bt.types, 'mechanisms', COALESCE(bm.mechanisms, '{}'::json))
                   ORDER BY bt.filter_name
               ),
               '{}'::json)
    INTO v_breakdown
    FROM by_type bt
    LEFT JOIN by_mechanism bm ON bm.filter_name = bt.filter_name;

    SELECT count(*)::int INTO v_total
    FROM pm_relations r
    WHERE (r.source_id = p_entity_id OR r.target_id = p_entity_id)
      AND (v_filters IS NULL
           OR r.filters && v_filters
           OR ('overig' = ANY(v_filters) AND COALESCE(cardinality(r.filters), 0) = 0))
      AND (v_direction IS NULL
           OR pm_influence_side(r.relation_type, r.bidirectional, r.source_id, p_entity_id)
              IN (v_direction, 'both'));

    WITH picked AS (
        SELECT r.*,
               CASE r.relation_type
                   WHEN 'eigendom' THEN 0
                   WHEN 'financiering' THEN 1
                   WHEN 'adverteerder' THEN 2
                   WHEN 'flak' THEN 3
                   WHEN 'bron_van' THEN 4
                   WHEN 'beinvloeding' THEN 5
                   WHEN 'draaideur' THEN 6
                   WHEN 'bestuurder' THEN 7
                   WHEN 'adviseur' THEN 8
                   WHEN 'censuur' THEN 9
                   WHEN 'mediaplatform' THEN 10
                   WHEN 'personeel' THEN 11
                   WHEN 'lidmaatschap' THEN 12
                   ELSE 13
               END AS priority
        FROM pm_relations r
        WHERE (r.source_id = p_entity_id OR r.target_id = p_entity_id)
          AND (v_filters IS NULL
               OR r.filters && v_filters
               OR ('overig' = ANY(v_filters) AND COALESCE(cardinality(r.filters), 0) = 0))
          AND (v_direction IS NULL
               OR pm_influence_side(r.relation_type, r.bidirectional, r.source_id, p_entity_id)
                  IN (v_direction, 'both'))
        ORDER BY priority, r.source_count DESC, r.active_from DESC NULLS LAST, r.id
        LIMIT lim
    ),
    neighbours AS (
        SELECT DISTINCT CASE WHEN p.source_id = p_entity_id THEN p.target_id ELSE p.source_id END AS id
        FROM picked p
    )
    SELECT
        (SELECT COALESCE(
            json_agg(
                json_build_object(
                    'id', p.id, 'source_id', p.source_id, 'target_id', p.target_id,
                    'relation_type', p.relation_type, 'mechanism', p.mechanism,
                    'filter', p.filter, 'filters', p.filters, 'aard', p.aard,
                    'certainty_label', p.certainty_label,
                    'active_from', p.active_from, 'active_until', p.active_until,
                    'source_count', p.source_count, 'bidirectional', p.bidirectional,
                    'auto_approved', p.auto_approved
                )
                ORDER BY p.priority, p.source_count DESC, p.active_from DESC NULLS LAST, p.id
            ),
            '[]'::json)
         FROM picked p),
        (SELECT COALESCE(
            json_agg(
                json_build_object(
                    'id', e.id, 'name', e.name, 'type', e.type, 'role', e.role,
                    'primary_filter', e.primary_filter, 'degree', e.degree,
                    'active_from', e.active_from, 'active_until', e.active_until,
                    'auto_approved', e.auto_approved
                )
                ORDER BY e.degree DESC, e.id
            ),
            '[]'::json)
         FROM pm_entities e
         JOIN neighbours n ON n.id = e.id
         WHERE e.id <> p_entity_id)
    INTO v_relations, v_entities;

    RETURN json_build_object(
        'center', v_center,
        'entities', v_entities,
        'relations', v_relations,
        'total', v_total,
        'truncated', v_total > lim,
        'filter_counts', v_counts,
        'direction_counts', v_direction_counts,
        'breakdown', v_breakdown,
        'filters', v_filters,
        'direction', v_direction
    );
END;
$$;

-- Only used inside pm_neighborhood (Supabase grants new functions to anon by default)
REVOKE ALL ON FUNCTION pm_influence_side(text, boolean, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pm_neighborhood(integer, integer, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pm_neighborhood(integer, integer, text[], text) TO anon, authenticated;

-- Verify the migration (an exception rolls back the whole transaction)
DO $$
BEGIN
    IF to_regprocedure('public.pm_neighborhood(integer, integer, text[])') IS NOT NULL THEN
        RAISE EXCEPTION 'The old pm_neighborhood(integer, integer, text[]) must be dropped (ambiguous overload)';
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.pm_neighborhood(integer, integer, text[], text)'::regprocedure) THEN
        RAISE EXCEPTION 'pm_neighborhood must be SECURITY DEFINER';
    END IF;
    IF NOT has_function_privilege('anon', 'public.pm_neighborhood(integer, integer, text[], text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon cannot execute pm_neighborhood';
    END IF;
    IF has_function_privilege('anon', 'public.pm_influence_side(text, boolean, integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon must not execute pm_influence_side directly';
    END IF;
    IF pm_influence_side('eigendom', false, 1, 1) <> 'out' OR pm_influence_side('eigendom', false, 1, 2) <> 'in'
       OR pm_influence_side('personeel', false, 1, 1) <> 'in' OR pm_influence_side('personeel', false, 1, 2) <> 'out'
       OR pm_influence_side('alliantie', false, 1, 1) <> 'both' OR pm_influence_side('eigendom', true, 1, 2) <> 'both' THEN
        RAISE EXCEPTION 'pm_influence_side gives the wrong direction';
    END IF;

    RAISE NOTICE 'Migration 008_invloed_richting completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new function immediately
NOTIFY pgrst, 'reload schema';
