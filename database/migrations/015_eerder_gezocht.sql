-- Migration: Al gezocht met AI - which missing voices of a news item were already searched with
-- "Zoek met AI", and what was added, for every reader (Epic 14, Story 14.22)
--
-- voice_searches_public(): per missing voice of an event whether it was searched (or is being
-- searched), with only the sources the admin approved (they are articles of the event already),
-- over all its searches that did not fail. Whoever adds a missing voice sees these first and can
-- take one over. The finds that are not approved (yet) stay with the admin
-- (voice_searches_for_event, migration 009). Owner's choice 2026-10-07: readers see what was
-- approved, the admin everything; only for missing voices.
--
-- Read only: a SECURITY DEFINER function over voice_searches (RLS without policies, migration 009).
-- No table lock (CREATE FUNCTION and GRANT), so it can run while the backend runs. Requires
-- migration 009. Idempotent.

BEGIN;
SET LOCAL lock_timeout = '1s';

-- [{"id", "perspective", "gap_key", "state": "bezig"|"gezocht", "found": [{url, title, outlet,
--   domain, who, gist, article_id}], "created_at", "finished_at"}], the latest search first.
-- One row per voice (the same words, whatever the case or spacing); id, perspective and gap_key of
-- its latest search.
CREATE OR REPLACE FUNCTION voice_searches_public(p_event_id integer)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH recent AS (
        SELECT vs.*, regexp_replace(lower(btrim(vs.perspective)), '\s+', ' ', 'g') AS voice
        FROM voice_searches vs
        WHERE vs.event_id = p_event_id AND vs.status <> 'fout'
        ORDER BY vs.created_at DESC
        LIMIT 50
    ),
    voices AS (
        SELECT
            voice,
            (array_agg(id ORDER BY created_at DESC))[1] AS id,
            (array_agg(btrim(perspective) ORDER BY created_at DESC))[1] AS perspective,
            (array_agg(gap_key ORDER BY created_at DESC) FILTER (WHERE gap_key IS NOT NULL))[1] AS gap_key,
            bool_or(status IN ('wachtrij', 'bezig')) AS running,
            max(created_at) AS created_at,
            max(finished_at) AS finished_at
        FROM recent
        GROUP BY voice
    )
    SELECT COALESCE(
        json_agg(
            json_build_object(
                'id', v.id,
                'perspective', v.perspective,
                'gap_key', v.gap_key,
                'state', CASE WHEN v.running THEN 'bezig' ELSE 'gezocht' END,
                'found', COALESCE(
                    (
                        SELECT json_agg(approved.source)
                        FROM (
                            SELECT DISTINCT ON (c->>'url')
                                json_build_object(
                                    'url', c->>'url',
                                    'title', c->>'title',
                                    'outlet', c->>'outlet',
                                    'domain', c->>'domain',
                                    'who', c->>'who',
                                    'gist', c->>'gist',
                                    'article_id', NULLIF(c->>'article_id', '')::integer
                                ) AS source
                            FROM recent r, jsonb_array_elements(r.candidates) AS c
                            WHERE r.voice = v.voice AND c->>'verdict' = 'goedgekeurd'
                            ORDER BY c->>'url', r.created_at DESC
                        ) AS approved
                    ),
                    '[]'::json
                ),
                'created_at', v.created_at,
                'finished_at', v.finished_at
            )
            ORDER BY v.created_at DESC
        ),
        '[]'::json
    )
    FROM voices v;
$$;

REVOKE ALL ON FUNCTION voice_searches_public(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voice_searches_public(integer) TO anon, authenticated;

COMMIT;
