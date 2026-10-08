-- Migration: Besluitvorming in het netwerk (Epic 15, Story 15.1)
--
-- The propaganda model now holds decision-making in the same network (owner decision 2026-10-07,
-- "Uitbreiding C"): five categories next to the five filters (formele_macht, belangen,
-- kennis_advies, polder, werving), four relation types (ambt, zeggenschap, controle, geschenk), the
-- government layer of an organisation and the office as the register gives it. Sync format 8
-- (backend/app/services/propaganda_model_sync.py) writes them; this migration makes room and lets
-- the RPC functions return them:
--   - columns pm_entities.bestuurslaag, pm_entities.wikidata, pm_relations.functie;
--   - pm_neighborhood (as migration 008): the five categories in the filter_counts order (same
--     order as FILTERS in the sync), the new relation types in the priority order (after
--     lidmaatschap; same order as RELATION_TYPE_PRIORITY and TYPE_PRIORITY in
--     frontend/lib/explore/pm-local.ts), and functie/bestuurslaag/wikidata in its rows;
--   - pm_paths (as migration 007): strength 0.5 for geschenk, 0.4 for controle and a low 0.35 for
--     ambt and zeggenschap (ministries, councils and the Kamer connect everything; same table in
--     frontend/lib/explore/pm-paths.ts), and the same new fields in its rows;
--   - pm_details (as migration 010): bestuurslaag/wikidata for entities, functie for relations;
--   - request_relation_research (as migration 011): ambt, zeggenschap and geschenk are register
--     facts, checked deterministically in the model, and are not queued for evidence research.
-- pm_influence_side (008) needs no change: the new types go from source to target ("A has an office
-- at B", "A gave B a gift"), its default.
--
-- Licence (no redistribution) and access: unchanged; the pm_* tables stay unreadable for anon.
--
-- Idempotent. Requires migrations 005, 007, 008, 010 and 011. Supabase only: the anon and
-- authenticated roles must exist. Run with:
--   psql "postgresql://postgres:<password>@<host>:5432/postgres" -f database/migrations/016_besluitvorming.sql

BEGIN;

ALTER TABLE pm_entities ADD COLUMN IF NOT EXISTS bestuurslaag TEXT;
ALTER TABLE pm_entities ADD COLUMN IF NOT EXISTS wikidata TEXT;
ALTER TABLE pm_relations ADD COLUMN IF NOT EXISTS functie TEXT;

-- As migration 008, plus the decision-making categories and relation types and the new fields.
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
        'auto_approved', e.auto_approved, 'bestuurslaag', e.bestuurslaag,
        'wikidata', e.wikidata
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
                             'tegenmacht', 'formele_macht', 'belangen', 'kennis_advies',
                             'polder', 'werving', 'overig'],
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
                   WHEN 'ambt' THEN 13
                   WHEN 'zeggenschap' THEN 14
                   WHEN 'geschenk' THEN 15
                   WHEN 'controle' THEN 16
                   ELSE 17
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
                    'auto_approved', p.auto_approved, 'functie', p.functie
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
                    'auto_approved', e.auto_approved, 'bestuurslaag', e.bestuurslaag,
                    'wikidata', e.wikidata
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

-- As migration 007, plus strengths for the new relation types and the new fields.
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
                    WHEN 'geschenk' THEN 0.5
                    WHEN 'controle' THEN 0.4
                    WHEN 'ambt' THEN 0.35
                    WHEN 'zeggenschap' THEN 0.35
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
                    'auto_approved', en.auto_approved, 'bestuurslaag', en.bestuurslaag,
                    'wikidata', en.wikidata
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
                    'auto_approved', r.auto_approved, 'functie', r.functie
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

-- As migration 010, plus bestuurslaag/wikidata (entities) and functie (relations).
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
            'auto_approved', r.auto_approved, 'functie', r.functie, 'sources', v_sources,
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

-- As migration 011, plus the register facts (ambt, zeggenschap, geschenk) left out.
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
              'adviseur', 'draaideur', 'ambt', 'zeggenschap', 'geschenk'
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

REVOKE ALL ON FUNCTION pm_neighborhood(integer, integer, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pm_neighborhood(integer, integer, text[], text) TO anon, authenticated;
REVOKE ALL ON FUNCTION pm_paths(integer[], integer[], integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pm_paths(integer[], integer[], integer, integer, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION pm_details(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pm_details(text, integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION request_relation_research(integer[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_relation_research(integer[], text) TO anon, authenticated;

-- Verify the migration (an exception rolls back the whole transaction)
DO $$
DECLARE
    f text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'pm_entities' AND column_name = 'bestuurslaag')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'pm_entities' AND column_name = 'wikidata')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'pm_relations' AND column_name = 'functie') THEN
        RAISE EXCEPTION 'pm_entities.bestuurslaag/wikidata or pm_relations.functie missing';
    END IF;
    IF has_table_privilege('anon', 'public.pm_entities', 'SELECT')
       OR has_table_privilege('anon', 'public.pm_relations', 'SELECT') THEN
        RAISE EXCEPTION 'anon must not read the pm_* tables';
    END IF;
    FOREACH f IN ARRAY ARRAY[
        'public.pm_neighborhood(integer, integer, text[], text)',
        'public.pm_paths(integer[], integer[], integer, integer, text)',
        'public.pm_details(text, integer)',
        'public.request_relation_research(integer[], text)'
    ]
    LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
            RAISE EXCEPTION '% must be SECURITY DEFINER', f;
        END IF;
        IF NOT has_function_privilege('anon', f, 'EXECUTE') THEN
            RAISE EXCEPTION 'anon cannot execute %', f;
        END IF;
    END LOOP;
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the changed functions immediately
NOTIFY pgrst, 'reload schema';
