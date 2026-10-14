-- Migration: Lokale werkdatabase - Supabase holds only what the website shows (Story INFRA-2)
--
-- The backend works on a local Postgres and publishes what the website reads to Supabase
-- (backend/app/services/publish_service.py). Reading from Supabase costs egress; writing does not.
-- The website still writes its own tables here (voice searches, access codes, shared entries,
-- research requests). Two functions change:
--
-- review_voice_candidate : stores only the admin's verdict. It no longer adds the article and its
--                          link to the event itself: Supabase must never write published tables,
--                          the local database is their source. The backend makes the article and
--                          the link locally (they are published from there) and notes the article in
--                          the find (article_id), so a find is done once; a withdrawn approval is
--                          undone the same way.
-- request_voice_search   : unchanged, and it now signals the backend.
--
-- Both signal the backend with pg_notify('voice_search', ...): it listens instead of asking the
-- queue every 5 seconds (LISTEN works through the session pooler).
--
-- Supabase only. No table lock (CREATE FUNCTION), so it can run while the backend runs. Requires
-- migration 009. Idempotent.

BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION request_voice_search(
    p_code text,
    p_event_id integer,
    p_perspective text,
    p_context text DEFAULT NULL,
    p_origin text DEFAULT 'analyse',
    p_gap_key text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code access_codes%ROWTYPE;
    v_perspective text := btrim(regexp_replace(COALESCE(p_perspective, ''), '\s+', ' ', 'g'));
    v_context text := NULLIF(left(btrim(COALESCE(p_context, '')), 1000), '');
    v_origin text := lower(btrim(COALESCE(p_origin, 'analyse')));
    v_gap_key text := NULLIF(btrim(COALESCE(p_gap_key, '')), '');
    v_search voice_searches%ROWTYPE;
    v_count integer;
BEGIN
    SELECT * INTO v_code FROM access_code_lookup(p_code);
    IF NOT FOUND OR NOT voice_search_role_allowed(v_code.role) THEN
        RETURN json_build_object('ok', false, 'reason', 'geen_toegang', 'search', NULL);
    END IF;
    IF length(v_perspective) < 2 OR length(v_perspective) > 200 OR v_origin NOT IN ('analyse', 'eigen') THEN
        RETURN json_build_object('ok', false, 'reason', 'ongeldig', 'search', NULL);
    END IF;
    IF v_gap_key IS NOT NULL AND (length(v_gap_key) > 80 OR v_gap_key !~ '^(gap|own):[A-Za-z0-9_-]+$') THEN
        v_gap_key := NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id) THEN
        RETURN json_build_object('ok', false, 'reason', 'onbekend_event', 'search', NULL);
    END IF;

    SELECT * INTO v_search
    FROM voice_searches
    WHERE event_id = p_event_id
      AND lower(perspective) = lower(v_perspective)
      AND (status IN ('wachtrij', 'bezig') OR created_at > now() - interval '10 minutes')
    ORDER BY created_at DESC
    LIMIT 1;
    IF FOUND THEN
        RETURN json_build_object('ok', true, 'reason', NULL, 'search', voice_search_json(v_search));
    END IF;

    SELECT count(*)::int INTO v_count
    FROM voice_searches
    WHERE requested_by = v_code.id AND created_at > now() - interval '1 day';
    IF v_count >= v_code.daily_search_limit THEN
        RETURN json_build_object('ok', false, 'reason', 'limiet', 'search', NULL);
    END IF;
    SELECT count(*)::int INTO v_count
    FROM voice_searches
    WHERE created_at > now() - interval '1 day';
    IF v_count >= 200 THEN
        RETURN json_build_object('ok', false, 'reason', 'druk', 'search', NULL);
    END IF;

    INSERT INTO voice_searches (event_id, perspective, context, origin, gap_key, requested_by)
    VALUES (p_event_id, v_perspective, v_context, v_origin, v_gap_key, v_code.id)
    RETURNING * INTO v_search;
    UPDATE access_codes SET last_used_at = now() WHERE id = v_code.id;
    PERFORM pg_notify('voice_search', 'request:' || v_search.id);

    RETURN json_build_object('ok', true, 'reason', NULL, 'search', voice_search_json(v_search));
END;
$$;

CREATE OR REPLACE FUNCTION review_voice_candidate(
    p_code text, p_search_id bigint, p_candidate_id text, p_verdict text
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code access_codes%ROWTYPE;
    v_search voice_searches%ROWTYPE;
    v_verdict text := lower(btrim(COALESCE(p_verdict, '')));
    v_index integer;
    v_candidate jsonb;
    v_url text;
    v_now timestamptz := now();
BEGIN
    SELECT * INTO v_code FROM access_code_lookup(p_code);
    IF NOT FOUND OR NOT voice_search_role_allowed(v_code.role) THEN
        RETURN json_build_object('ok', false, 'reason', 'geen_toegang', 'candidate', NULL);
    END IF;
    IF v_verdict NOT IN ('goedgekeurd', 'afgewezen', 'open') THEN
        RETURN json_build_object('ok', false, 'reason', 'ongeldig', 'candidate', NULL);
    END IF;

    SELECT * INTO v_search FROM voice_searches WHERE id = p_search_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'reason', 'onbekend', 'candidate', NULL);
    END IF;
    SELECT (t.idx - 1)::int, t.elem INTO v_index, v_candidate
    FROM jsonb_array_elements(v_search.candidates) WITH ORDINALITY AS t(elem, idx)
    WHERE t.elem->>'id' = p_candidate_id;
    IF v_index IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'onbekend', 'candidate', NULL);
    END IF;

    v_url := v_candidate->>'url';
    IF v_verdict = 'goedgekeurd' AND (v_url IS NULL OR v_url !~* '^https?://' OR length(v_url) > 1024) THEN
        RETURN json_build_object('ok', false, 'reason', 'ongeldig', 'candidate', NULL);
    END IF;

    -- article_id stays as the backend noted it: the article it linked, or null
    v_candidate := v_candidate || jsonb_build_object('verdict', v_verdict, 'reviewed_at', v_now, 'reviewed_by', v_code.id);
    UPDATE voice_searches
    SET candidates = jsonb_set(candidates, ARRAY[v_index::text], v_candidate), updated_at = v_now
    WHERE id = v_search.id;
    UPDATE access_codes SET last_used_at = v_now WHERE id = v_code.id;
    PERFORM pg_notify('voice_search', 'review:' || v_search.id);

    RETURN json_build_object('ok', true, 'reason', NULL, 'candidate', v_candidate);
END;
$$;

REVOKE ALL ON FUNCTION request_voice_search(text, integer, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_voice_search(text, integer, text, text, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION review_voice_candidate(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_voice_candidate(text, bigint, text, text) TO anon, authenticated;

DO $$
DECLARE
    f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.request_voice_search(text, integer, text, text, text, text)',
        'public.review_voice_candidate(text, bigint, text, text)'
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
            RAISE EXCEPTION 'Function % must be SECURITY DEFINER', f;
        END IF;
        IF position('pg_notify' IN pg_get_functiondef(f::regprocedure)) = 0 THEN
            RAISE EXCEPTION 'Function % does not signal the backend', f;
        END IF;
    END LOOP;
    IF position('INSERT INTO articles' IN pg_get_functiondef('public.review_voice_candidate(text, bigint, text, text)'::regprocedure)) > 0 THEN
        RAISE EXCEPTION 'review_voice_candidate still writes articles';
    END IF;
END;
$$;

COMMIT;
