-- Migration: Propagandamodel-koppeling (Epic 11, Story 11.17)
--
-- A read-only copy of the approved propaganda-model graph (sibling project, synced by the local
-- backend: backend/app/services/propaganda_model_sync.py). Only approved rows
-- (status = 'goedgekeurd' AND NOT vervangen); the political-position layer and machtsvalentie
-- are never exported; certainty only as a qualitative label.
--
-- pm_entities : approved entities (pm id), slug, primary filter, degree
-- pm_relations: approved relations between exported entities, certainty_label, source_count,
--               filter (primary filter of the mechanism, edge colour) + filters (that primary
--               filter UNION the mechanism's tags in the pm mechanism_filters table)
-- pm_sources  : sources supporting the existence of an entity/relation (quote <= 300 chars)
-- pm_aliases  : slug aliases (shared slugify of backend/app/nlp/entity_keys.py) -> entity
-- pm_meta     : version, synced_at, db_mtime, entity_count, relation_count, format
--
-- Epic 12: auto_approved (entities/relations approved by the automatic news pipeline, pm account
-- nieuws-autokeur) and pm_sources.unreviewed (evidence of such elements that no human merged
-- yet). The frontend labels them "automatisch toegevoegd" / "nog niet gecontroleerd".
--
-- Licence (no redistribution): the dataset must not be downloadable in one go. Therefore the
-- tables have RLS enabled WITHOUT any policy and no privileges for anon/authenticated. The
-- frontend (anon key) reaches them only through the SECURITY DEFINER functions below, which
-- return one small neighbourhood / search result / detail at a time.
--
-- Idempotent: safe to run more than once, and safe to run after the backend's create_all()
-- already created the tables (it then only adds RLS, revokes, indexes and functions), or after an
-- earlier version of this migration (it adds pm_relations.filters and replaces the earlier
-- pm_neighborhood overloads (integer, integer) and (integer, integer, text) by
-- (integer, integer, text[])). After re-running it, the next sync refills filters
-- (pm_meta.format changes; or force it: POST /admin/trigger/propagandamodel-sync?force=true).
-- Run it BEFORE the first sync: the sync refuses to write while anon can read the tables.
-- Supabase only: the anon/authenticated roles must exist.

BEGIN;

CREATE TABLE IF NOT EXISTS pm_entities (
    id INTEGER PRIMARY KEY,                -- propaganda-model entity id
    name TEXT NOT NULL,
    slug TEXT NOT NULL,                    -- '<id>-<slug>' as on the pm site (paginas.maak_slug)
    type TEXT NOT NULL,
    role TEXT,                             -- display name of the primary role
    primary_filter TEXT,                   -- eigendom|advertentie|sourcing|flak|ideologie|tegenmacht|cross_filter|systeemactor|NULL
    description TEXT,                      -- only returned by pm_details
    active_from TEXT,
    active_until TEXT,
    degree INTEGER NOT NULL DEFAULT 0,     -- number of exported relations touching the entity
    auto_approved BOOLEAN NOT NULL DEFAULT FALSE, -- approved by the news pipeline (Epic 12)
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pm_relations (
    id INTEGER PRIMARY KEY,                -- propaganda-model relation id
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    mechanism TEXT,                        -- human-readable mechanism name
    filter TEXT,                           -- primary filter of the mechanism (edge colour)
    filters TEXT[] NOT NULL DEFAULT '{}',  -- primary filter + mechanism tags: eigendom|advertentie|
                                           -- sourcing|flak|ideologie|tegenmacht ('{}' = none)
    aard TEXT,                             -- direct | veld_eigenschap
    description TEXT,                      -- only returned by pm_details
    certainty_label TEXT,                  -- onderbouwd | aannemelijk | onzeker (never a number)
    active_from TEXT,
    active_until TEXT,
    bidirectional BOOLEAN NOT NULL DEFAULT FALSE,
    source_count INTEGER NOT NULL DEFAULT 0,
    auto_approved BOOLEAN NOT NULL DEFAULT FALSE, -- approved by the news pipeline (Epic 12)
    CONSTRAINT fk_pm_relations_source FOREIGN KEY (source_id)
        REFERENCES pm_entities(id) ON DELETE CASCADE,
    CONSTRAINT fk_pm_relations_target FOREIGN KEY (target_id)
        REFERENCES pm_entities(id) ON DELETE CASCADE
);

-- Added after the first version of this migration: existing tables get the column (rows '{}'
-- until the next sync); create_all() creates it without the default.
ALTER TABLE pm_relations ADD COLUMN IF NOT EXISTS filters TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE pm_relations ALTER COLUMN filters SET DEFAULT '{}';
-- Epic 12 (automatic news pipeline): flags for automatically approved elements.
ALTER TABLE pm_entities ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pm_relations ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_pm_relations_source_id ON pm_relations (source_id);
CREATE INDEX IF NOT EXISTS idx_pm_relations_target_id ON pm_relations (target_id);

CREATE TABLE IF NOT EXISTS pm_sources (
    id SERIAL PRIMARY KEY,
    owner_kind TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    title TEXT,
    url TEXT,
    publisher TEXT,
    published_at TEXT,
    quote TEXT,                            -- <= 300 characters
    position INTEGER NOT NULL DEFAULT 0,
    unreviewed BOOLEAN NOT NULL DEFAULT FALSE, -- evidence not merged by a human yet (Epic 12)
    CONSTRAINT ck_pm_sources_owner_kind CHECK (owner_kind IN ('entity', 'relation'))
);

ALTER TABLE pm_sources ADD COLUMN IF NOT EXISTS unreviewed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_pm_sources_owner ON pm_sources (owner_kind, owner_id);

CREATE TABLE IF NOT EXISTS pm_aliases (
    alias TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    PRIMARY KEY (alias, entity_id),
    CONSTRAINT fk_pm_aliases_entity FOREIGN KEY (entity_id)
        REFERENCES pm_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pm_aliases_entity_id ON pm_aliases (entity_id);

CREATE TABLE IF NOT EXISTS pm_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- No direct access for the frontend: RLS on, NO policies, no privileges. The backend connects
-- as the table owner (postgres) and the SECURITY DEFINER functions run as that owner.
ALTER TABLE pm_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_meta ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('pm_entities', 'pm_relations', 'pm_sources', 'pm_aliases', 'pm_meta')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

REVOKE ALL ON pm_entities, pm_relations, pm_sources, pm_aliases, pm_meta
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE pm_sources_id_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- RPC functions (PostgREST: supabase.rpc('<name>', {...})). All return json.
-- ---------------------------------------------------------------------------------------------

-- {"version": text, "synced_at": text, "entity_count": int, "relation_count": int}
CREATE OR REPLACE FUNCTION pm_meta_info()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT json_build_object(
        'version', (SELECT value FROM pm_meta WHERE key = 'version'),
        'synced_at', (SELECT value FROM pm_meta WHERE key = 'synced_at'),
        'entity_count', (SELECT count(*)::int FROM pm_entities),
        'relation_count', (SELECT count(*)::int FROM pm_relations)
    );
$$;

-- [{"alias": text, "entity_id": int, "name": text, "type": text, "degree": int}], max 50 rows.
-- p_aliases are slugs (shared slugify); empty values are ignored; input capped at 100 aliases.
CREATE OR REPLACE FUNCTION pm_match(p_aliases text[])
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH input AS (
        SELECT DISTINCT lower(btrim(a)) AS alias
        FROM unnest((COALESCE(p_aliases, ARRAY[]::text[]))[1:100]) AS a
        WHERE a IS NOT NULL AND btrim(a) <> ''
    ),
    hits AS (
        SELECT al.alias, e.id AS entity_id, e.name, e.type, e.degree
        FROM input i
        JOIN pm_aliases al ON al.alias = i.alias
        JOIN pm_entities e ON e.id = al.entity_id
        ORDER BY al.alias, e.degree DESC, e.id
        LIMIT 50
    )
    SELECT COALESCE(
        json_agg(
            json_build_object(
                'alias', alias, 'entity_id', entity_id, 'name', name, 'type', type,
                'degree', degree
            )
            ORDER BY alias, degree DESC, entity_id
        ),
        '[]'::json
    )
    FROM hits;
$$;

-- [{"id","name","type","primary_filter","degree"}]; requires >= 2 characters; ILIKE on name and
-- aliases; exact matches first, then prefix matches, then degree desc; p_limit clamped 1..20.
CREATE OR REPLACE FUNCTION pm_search(p_query text, p_limit integer DEFAULT 10)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    q text := lower(left(btrim(COALESCE(p_query, '')), 100));
    lim integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 20);
    escaped text;
    q_slug text;
    result json;
BEGIN
    IF length(q) < 2 THEN
        RETURN '[]'::json;
    END IF;
    escaped := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
    q_slug := btrim(regexp_replace(q, '[^a-z0-9]+', '-', 'g'), '-');

    SELECT COALESCE(
        json_agg(
            json_build_object(
                'id', s.id, 'name', s.name, 'type', s.type,
                'primary_filter', s.primary_filter, 'degree', s.degree
            )
            ORDER BY s.match_rank, s.degree DESC, s.name, s.id
        ),
        '[]'::json
    )
    INTO result
    FROM (
        SELECT e.id, e.name, e.type, e.primary_filter, e.degree,
               MIN(
                   CASE
                       WHEN lower(e.name) = q OR (q_slug <> '' AND a.alias = q_slug) THEN 0
                       WHEN lower(e.name) LIKE escaped || '%' ESCAPE '\'
                            OR (q_slug <> '' AND a.alias LIKE q_slug || '%') THEN 1
                       ELSE 2
                   END
               ) AS match_rank
        FROM pm_entities e
        LEFT JOIN pm_aliases a ON a.entity_id = e.id
        WHERE e.name ILIKE '%' || escaped || '%' ESCAPE '\'
           OR (q_slug <> '' AND a.alias LIKE '%' || q_slug || '%')
        GROUP BY e.id
        ORDER BY match_rank, e.degree DESC, e.name, e.id
        LIMIT lim
    ) s;
    RETURN result;
END;
$$;

-- {"center": {id,name,type,role,primary_filter,degree,active_from,active_until},
--  "entities": [same shape, all neighbours of the returned relations],
--  "relations": [{"id","source_id","target_id","relation_type","mechanism","filter","filters",
--                 "aard","certainty_label","active_from","active_until","source_count",
--                 "bidirectional"}],
--  "total": int (relations touching the entity that match p_filters; all when no filters given),
--  "truncated": bool (total > limit),
--  "filter_counts": {"eigendom": int, ...} over ALL relations touching the entity, regardless of
--                   p_filters: a relation counts once for each filter in its filters, relations
--                   without filters count as "overig"; only filters with a count > 0 appear,
--  "breakdown": {"sourcing": {"types": {"overheidsinstelling": int, ...},
--                             "mechanisms": {"Expert framing": int, ...}}, ...} over the same
--                relations and keys as filter_counts: per filter the entity type of the other
--                party and the mechanism (display name; relations without one are left out of
--                "mechanisms"), most frequent first. Aggregates only (no names), so the app can
--                summarise a large fan of relations without downloading it,
--  "filters": p_filters (echo as a JSON array; null when p_filters is NULL or empty)}
-- p_filters NULL or empty = all relations; otherwise a relation matches when it shares a filter
-- with p_filters (r.filters && p_filters) or, when 'overig' is in p_filters, when it has no
-- filters at all (matching the "overig" bucket of filter_counts).
-- Most informative relation types first (the list MUST match RELATION_TYPE_PRIORITY in
-- backend/app/services/propaganda_model_sync.py and TYPE_PRIORITY in
-- frontend/lib/explore/pm-local.ts), then source_count desc, then most recent active_from.
-- p_limit clamped 1..60. No descriptions. Unknown id -> {"center": null, "entities": [],
-- "relations": [], "total": 0, "truncated": false, "filter_counts": {}, "breakdown": {},
-- "filters": <echo>}.
-- The overloads of earlier runs of this migration are dropped first (otherwise several would
-- exist and pm_neighborhood(id) would be ambiguous).
DROP FUNCTION IF EXISTS pm_neighborhood(integer, integer);
DROP FUNCTION IF EXISTS pm_neighborhood(integer, integer, text);
-- Migration 008 (direction) replaces this function; re-running 005 puts this version back, so run 008 again afterwards
DROP FUNCTION IF EXISTS pm_neighborhood(integer, integer, text[], text);

CREATE OR REPLACE FUNCTION pm_neighborhood(
    p_entity_id integer, p_limit integer DEFAULT 40, p_filters text[] DEFAULT NULL
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
    v_center json;
    v_total integer;
    v_counts json;
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
            'breakdown', '{}'::json, 'filters', v_filters
        );
    END IF;

    -- per filter over all relations touching the entity (independent of p_filters)
    SELECT COALESCE(json_object_agg(c.filter_name, c.n ORDER BY c.sort_order, c.filter_name),
                    '{}'::json)
    INTO v_counts
    FROM (
        SELECT f.filter_name, count(*)::int AS n,
               COALESCE(
                   array_position(
                       ARRAY['eigendom', 'advertentie', 'sourcing', 'flak', 'ideologie',
                             'tegenmacht', 'overig'],
                       f.filter_name
                   ),
                   99
               ) AS sort_order
        FROM pm_relations r
        CROSS JOIN LATERAL unnest(
            CASE WHEN COALESCE(cardinality(r.filters), 0) = 0 THEN ARRAY['overig']::text[]
                 ELSE r.filters END
        ) AS f(filter_name)
        WHERE r.source_id = p_entity_id OR r.target_id = p_entity_id
        GROUP BY f.filter_name
    ) c;

    -- per filter (same keys as filter_counts): type of the other party and mechanism, aggregates only
    WITH keyed AS (
        SELECT f.filter_name, r.mechanism, COALESCE(o.type, 'onbekend') AS other_type
        FROM pm_relations r
        CROSS JOIN LATERAL unnest(
            CASE WHEN COALESCE(cardinality(r.filters), 0) = 0 THEN ARRAY['overig']::text[]
                 ELSE r.filters END
        ) AS f(filter_name)
        LEFT JOIN pm_entities o
               ON o.id = CASE WHEN r.source_id = p_entity_id THEN r.target_id ELSE r.source_id END
        WHERE r.source_id = p_entity_id OR r.target_id = p_entity_id
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
           OR ('overig' = ANY(v_filters) AND COALESCE(cardinality(r.filters), 0) = 0));

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
        'breakdown', v_breakdown,
        'filters', v_filters
    );
END;
$$;

-- {"kind","id","title" (entity name or "A → B"),"type","mechanism","filter","filters",
--  "description","active_from","active_until","certainty_label","auto_approved",
--  "sources":[{"title","url","publisher","published_at","quote","unreviewed"}] (max 12, by
--  position)}. The only function returning
-- descriptions. Unknown kind/id -> NULL. For entities mechanism, filters and certainty_label are
-- null and filter is the primary filter.
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
        SELECT json_build_object(
            'kind', 'relation', 'id', r.id, 'title', src.name || ' → ' || tgt.name,
            'type', r.relation_type, 'mechanism', r.mechanism, 'filter', r.filter,
            'filters', r.filters, 'description', r.description, 'active_from', r.active_from,
            'active_until', r.active_until, 'certainty_label', r.certainty_label,
            'auto_approved', r.auto_approved, 'sources', v_sources
        )
        INTO v_result
        FROM pm_relations r
        JOIN pm_entities src ON src.id = r.source_id
        JOIN pm_entities tgt ON tgt.id = r.target_id
        WHERE r.id = p_id;
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION pm_meta_info() FROM PUBLIC;
REVOKE ALL ON FUNCTION pm_match(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION pm_search(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION pm_neighborhood(integer, integer, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION pm_details(text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION pm_meta_info() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pm_match(text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pm_search(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pm_neighborhood(integer, integer, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pm_details(text, integer) TO anon, authenticated;

-- Verify the migration (an exception rolls back the whole transaction)
DO $$
DECLARE
    t text;
    f text;
BEGIN
    FOREACH t IN ARRAY ARRAY['pm_entities', 'pm_relations', 'pm_sources', 'pm_aliases', 'pm_meta']
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

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pm_relations'
          AND column_name = 'filters' AND data_type = 'ARRAY' AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'pm_relations.filters must be a NOT NULL text[] column';
    END IF;

    IF to_regprocedure('public.pm_neighborhood(integer, integer)') IS NOT NULL
       OR to_regprocedure('public.pm_neighborhood(integer, integer, text)') IS NOT NULL THEN
        RAISE EXCEPTION 'Old pm_neighborhood overloads must be dropped (ambiguous overload)';
    END IF;

    FOREACH f IN ARRAY ARRAY[
        'public.pm_meta_info()',
        'public.pm_match(text[])',
        'public.pm_search(text, integer)',
        'public.pm_neighborhood(integer, integer, text[])',
        'public.pm_details(text, integer)'
    ]
    LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
            RAISE EXCEPTION 'Function % must be SECURITY DEFINER', f;
        END IF;

        IF NOT has_function_privilege('anon', f, 'EXECUTE') THEN
            RAISE EXCEPTION 'anon cannot execute %', f;
        END IF;
    END LOOP;

    RAISE NOTICE 'Migration 005_propagandamodel completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new functions immediately
NOTIFY pgrst, 'reload schema';
