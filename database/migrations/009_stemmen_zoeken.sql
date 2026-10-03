-- Migration: Stemmen zoeken - let AI search for a voice that is missing, add what it finds (Epic 14, Story 14.10)
--
-- access_codes                : codes that unlock options for the admin (and later for paying users:
--                               role 'pro'). Only the sha256 of a code is stored.
-- voice_searches              : one AI search per missing voice of an event. Queued by the app, run by
--                               the local backend (job "Voice Search"), with the sources it found
--                               (candidates) and what was decided about them.
-- access_code_role()          : the role of a code, or null
-- request_voice_search()      : queue a search (a code whose role may search; rate-limited)
-- voice_searches_for_event()  : the searches of one event with their candidates (same code)
-- review_voice_candidate()    : approve a found source (it is added to the event, for every reader),
--                               reject it, or take an approved one out again
--
-- Who may search and approve: voice_search_role_allowed(). For now only 'admin' (owner's decision
-- 2026-10-03); add 'pro' there once paying users exist.
--
-- An approved source becomes an article of the event: a new `articles` row (guid voice:<md5(url)>)
-- unless the URL is already stored, and an `event_articles` link whose scoring_breakdown says what
-- it adds: {"source": "voice_search", "search_id", "found_voice": {perspective, who, gist, gap_key}}.
-- The found voice belongs to the link, so an article that is also in another event changes nothing
-- there.
--
-- The tables have RLS enabled WITHOUT policies and no privileges for anon/authenticated: the
-- frontend only uses the functions below. The backend connects as postgres. Idempotent.
-- Supabase only: roles anon/authenticated.

BEGIN;

CREATE TABLE IF NOT EXISTS access_codes (
    id BIGSERIAL PRIMARY KEY,
    code_hash CHAR(64) NOT NULL UNIQUE,
    role VARCHAR(10) NOT NULL CHECK (role IN ('admin', 'pro')),
    label VARCHAR(120),
    daily_search_limit INTEGER NOT NULL DEFAULT 30 CHECK (daily_search_limit >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS voice_searches (
    id BIGSERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    -- The missing voice as the app shows it ("Boeren op de polder")
    perspective VARCHAR(200) NOT NULL,
    -- Why it is missing: the analysis' description, or what the reader wrote
    context TEXT,
    -- 'analyse': a missing voice the analysis named; 'eigen': one a reader added
    origin VARCHAR(10) NOT NULL CHECK (origin IN ('analyse', 'eigen')),
    -- Finding id of the missing voice in the app (gap:<hash> or own:<id>)
    gap_key VARCHAR(80),
    requested_by BIGINT REFERENCES access_codes(id) ON DELETE SET NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'wachtrij'
        CHECK (status IN ('wachtrij', 'bezig', 'klaar', 'niets_gevonden', 'fout')),
    status_reason TEXT,
    -- [{id, url, title, outlet, domain, is_international, country, published_at, who, gist,
    --   confidence, strategy, verdict: open|goedgekeurd|afgewezen, article_id, reviewed_at}]
    candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Queries, counts and timings (to tune the search)
    stats JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_voice_searches_event ON voice_searches (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_voice_searches_queue ON voice_searches (created_at)
    WHERE status IN ('wachtrij', 'bezig');
CREATE INDEX IF NOT EXISTS ix_voice_searches_requested_by ON voice_searches (requested_by, created_at DESC);

ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_searches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON access_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON voice_searches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE access_codes_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE voice_searches_id_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers (not callable by the app)
-- ---------------------------------------------------------------------------------------------

-- The roles that may search and approve. Paying users later: role IN ('admin', 'pro').
CREATE OR REPLACE FUNCTION voice_search_role_allowed(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_role IN ('admin');
$$;

-- The active code row for a code as typed, or nothing
CREATE OR REPLACE FUNCTION access_code_lookup(p_code text)
RETURNS SETOF access_codes
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM access_codes
    WHERE length(btrim(COALESCE(p_code, ''))) BETWEEN 12 AND 200
      AND code_hash = encode(sha256(convert_to(btrim(p_code), 'UTF8')), 'hex')
      AND revoked_at IS NULL
    LIMIT 1;
$$;

-- One search as the app sees it
CREATE OR REPLACE FUNCTION voice_search_json(s voice_searches)
RETURNS json
LANGUAGE sql
STABLE
AS $$
    SELECT json_build_object(
        'id', s.id, 'event_id', s.event_id, 'perspective', s.perspective, 'origin', s.origin,
        'gap_key', s.gap_key, 'status', s.status, 'status_reason', s.status_reason,
        'candidates', s.candidates, 'created_at', s.created_at, 'finished_at', s.finished_at
    );
$$;

-- ---------------------------------------------------------------------------------------------
-- RPC functions (PostgREST: supabase.rpc('<name>', {...})). All return json.
-- ---------------------------------------------------------------------------------------------

-- {"role": "admin"|"pro"|null, "can_search": bool}
CREATE OR REPLACE FUNCTION access_code_role(p_code text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code access_codes%ROWTYPE;
BEGIN
    SELECT * INTO v_code FROM access_code_lookup(p_code);
    IF NOT FOUND THEN
        RETURN json_build_object('role', NULL, 'can_search', false);
    END IF;
    RETURN json_build_object('role', v_code.role, 'can_search', voice_search_role_allowed(v_code.role));
END;
$$;

-- {"ok": bool, "reason": text|null, "search": {...}|null}
-- Reasons: geen_toegang, ongeldig, onbekend_event, limiet, druk. A search for the same voice of the
-- same event that is queued, running or less than 10 minutes old comes back instead of a new one.
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

    RETURN json_build_object('ok', true, 'reason', NULL, 'search', voice_search_json(v_search));
END;
$$;

-- [search, ...] newest first; [] without a code that may search
CREATE OR REPLACE FUNCTION voice_searches_for_event(p_code text, p_event_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code access_codes%ROWTYPE;
BEGIN
    SELECT * INTO v_code FROM access_code_lookup(p_code);
    IF NOT FOUND OR NOT voice_search_role_allowed(v_code.role) THEN
        RETURN '[]'::json;
    END IF;
    RETURN COALESCE(
        (
            -- A table alias (not a subquery) so the row has the voice_searches type
            SELECT json_agg(voice_search_json(vs) ORDER BY vs.created_at DESC)
            FROM voice_searches vs
            WHERE vs.id IN (
                SELECT id FROM voice_searches WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 50
            )
        ),
        '[]'::json
    );
END;
$$;

-- {"ok": bool, "reason": text|null, "candidate": {...}|null}
-- p_verdict: 'goedgekeurd' adds the source to the event; 'afgewezen' or 'open' takes it out again
-- when it was added (and removes the article when this search created it and nothing else uses it).
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
    v_article_id integer;
    v_linked boolean;
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
    v_article_id := NULLIF(v_candidate->>'article_id', '')::integer;

    IF v_verdict = 'goedgekeurd' THEN
        IF v_url IS NULL OR v_url !~* '^https?://' OR length(v_url) > 1024 THEN
            RETURN json_build_object('ok', false, 'reason', 'ongeldig', 'candidate', NULL);
        END IF;
        -- The article: stored already (any event, or none), or new with the gist as its Dutch digest
        SELECT id INTO v_article_id FROM articles WHERE url = v_url LIMIT 1;
        IF v_article_id IS NULL THEN
            INSERT INTO articles (
                guid, url, title, content, source_name, source_metadata, published_at,
                fetched_at, created_at, updated_at, is_international, source_country
            )
            VALUES (
                'voice:' || md5(v_url),
                v_url,
                left(COALESCE(NULLIF(v_candidate->>'title', ''), v_url), 512),
                '',
                left(NULLIF(v_candidate->>'outlet', ''), 255),
                json_build_object(
                    'digest', json_build_object('nl', v_candidate->>'gist', 'basis', 'text', 'provider', 'voice_search'),
                    'voice_search_id', v_search.id
                ),
                NULLIF(v_candidate->>'published_at', '')::timestamptz,
                v_now, v_now, v_now,
                COALESCE((v_candidate->>'is_international')::boolean, false),
                NULLIF(upper(left(v_candidate->>'country', 2)), '')
            )
            ON CONFLICT DO NOTHING
            RETURNING id INTO v_article_id;
            IF v_article_id IS NULL THEN
                SELECT id INTO v_article_id FROM articles WHERE url = v_url LIMIT 1;
            END IF;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM event_articles WHERE event_id = v_search.event_id AND article_id = v_article_id
        ) INTO v_linked;
        IF NOT v_linked THEN
            INSERT INTO event_articles (event_id, article_id, similarity_score, scoring_breakdown, linked_at)
            VALUES (
                v_search.event_id, v_article_id, NULL,
                json_build_object(
                    'source', 'voice_search',
                    'search_id', v_search.id,
                    'found_voice', json_build_object(
                        'perspective', v_search.perspective,
                        'who', v_candidate->>'who',
                        'gist', v_candidate->>'gist',
                        'gap_key', v_search.gap_key,
                        'approved_at', v_now
                    )
                ),
                v_now
            );
            UPDATE events SET article_count = article_count + 1 WHERE id = v_search.event_id;
        END IF;
        v_candidate := v_candidate || jsonb_build_object('article_id', v_article_id);
    ELSIF v_article_id IS NOT NULL THEN
        -- Take it out again: only the link this search made, and the article only if it made that too
        DELETE FROM event_articles
        WHERE event_id = v_search.event_id AND article_id = v_article_id
          AND (scoring_breakdown::jsonb)->>'source' = 'voice_search';
        IF FOUND THEN
            UPDATE events SET article_count = greatest(article_count - 1, 0) WHERE id = v_search.event_id;
        END IF;
        DELETE FROM articles a
        WHERE a.id = v_article_id AND a.guid = 'voice:' || md5(a.url)
          AND NOT EXISTS (SELECT 1 FROM event_articles ea WHERE ea.article_id = a.id);
        v_candidate := v_candidate || jsonb_build_object('article_id', NULL);
    END IF;

    v_candidate := v_candidate || jsonb_build_object('verdict', v_verdict, 'reviewed_at', v_now, 'reviewed_by', v_code.id);
    UPDATE voice_searches
    SET candidates = jsonb_set(candidates, ARRAY[v_index::text], v_candidate), updated_at = v_now
    WHERE id = v_search.id;
    UPDATE access_codes SET last_used_at = v_now WHERE id = v_code.id;

    RETURN json_build_object('ok', true, 'reason', NULL, 'candidate', v_candidate);
END;
$$;

REVOKE ALL ON FUNCTION voice_search_role_allowed(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION access_code_lookup(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION voice_search_json(voice_searches) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION access_code_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_voice_search(text, integer, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION voice_searches_for_event(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION review_voice_candidate(text, bigint, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION access_code_role(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION request_voice_search(text, integer, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION voice_searches_for_event(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION review_voice_candidate(text, bigint, text, text) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE 'Migration 009_stemmen_zoeken completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new tables and functions immediately
NOTIFY pgrst, 'reload schema';
