-- Migration: Gekleurde zinnen op verzoek - per-sentence bias of one news item, on request (Story 10.7)
--
-- The per-sentence bias detection (Epic 10) costs one LLM call per article, so it does not run for
-- every article (job "Bias Analysis" stays off). A paying user or the admin starts it for one news
-- item with a button; what it finds is for every reader (article_bias_analyses is published and
-- readable by anon).
--
-- bias_requests             : one request per news item. Queued by the app, run by the local backend
--                             (job "Bias Requests"): it analyses the Dutch articles of the news that
--                             have no analysis yet and notes its progress here.
-- bias_role_allowed()       : the roles that may start it: admin and pro (owner 2026-10-14)
-- access_code_role()        : also says can_analyze_bias
-- request_bias_analysis()   : queue a request (a code whose role may; rate-limited)
-- bias_request_for_event()  : the latest request of a news item, for every reader (no code)
--
-- The table has RLS enabled WITHOUT policies and no privileges for anon/authenticated: the
-- frontend only uses the functions below. The backend connects as postgres; it listens on
-- channel 'bias_request' (pg_notify) instead of asking the queue every few seconds.
--
-- Supabase only (the website's table, like voice_searches). Requires migration 009. New objects
-- and CREATE OR REPLACE FUNCTION only (no lock on a table the backend uses). Idempotent.

BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE TABLE IF NOT EXISTS bias_requests (
    id BIGSERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    requested_by BIGINT REFERENCES access_codes(id) ON DELETE SET NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'wachtrij'
        CHECK (status IN ('wachtrij', 'bezig', 'klaar', 'fout')),
    status_reason TEXT,
    -- Articles to analyse, analysed, failed (set by the backend)
    total INTEGER,
    done INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_bias_requests_event ON bias_requests (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_bias_requests_queue ON bias_requests (created_at)
    WHERE status IN ('wachtrij', 'bezig');
CREATE INDEX IF NOT EXISTS ix_bias_requests_requested_by ON bias_requests (requested_by, created_at DESC);

ALTER TABLE bias_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bias_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE bias_requests_id_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers (not callable by the app)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bias_role_allowed(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_role IN ('admin', 'pro');
$$;

-- One request as the app sees it (never who asked), with how many articles of the news have an
-- analysis in this database: the backend's analyses arrive through the publisher, a few seconds
-- after it noted them as done
CREATE OR REPLACE FUNCTION bias_request_json(r bias_requests)
RETURNS json
LANGUAGE sql
STABLE
AS $$
    SELECT json_build_object(
        'id', r.id, 'event_id', r.event_id, 'status', r.status, 'status_reason', r.status_reason,
        'total', r.total, 'done', r.done, 'failed', r.failed,
        'analysed', (
            SELECT count(DISTINCT aba.article_id)::int
            FROM article_bias_analyses aba
            JOIN event_articles ea ON ea.article_id = aba.article_id
            WHERE ea.event_id = r.event_id
        ),
        'created_at', r.created_at, 'finished_at', r.finished_at
    );
$$;

-- ---------------------------------------------------------------------------------------------
-- RPC functions (PostgREST: supabase.rpc('<name>', {...})). All return json.
-- ---------------------------------------------------------------------------------------------

-- {"role": "admin"|"pro"|null, "can_search": bool, "can_analyze_bias": bool}
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
        RETURN json_build_object('role', NULL, 'can_search', false, 'can_analyze_bias', false);
    END IF;
    RETURN json_build_object(
        'role', v_code.role,
        'can_search', voice_search_role_allowed(v_code.role),
        'can_analyze_bias', bias_role_allowed(v_code.role)
    );
END;
$$;

-- {"ok": bool, "reason": text|null, "request": {...}|null}
-- Reasons: geen_toegang, onbekend_event, limiet, druk. A request for the same news that is queued,
-- running or finished less than 10 minutes ago comes back instead of a new one.
CREATE OR REPLACE FUNCTION request_bias_analysis(p_code text, p_event_id integer)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code access_codes%ROWTYPE;
    v_request bias_requests%ROWTYPE;
    v_count integer;
BEGIN
    SELECT * INTO v_code FROM access_code_lookup(p_code);
    IF NOT FOUND OR NOT bias_role_allowed(v_code.role) THEN
        RETURN json_build_object('ok', false, 'reason', 'geen_toegang', 'request', NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id) THEN
        RETURN json_build_object('ok', false, 'reason', 'onbekend_event', 'request', NULL);
    END IF;

    SELECT * INTO v_request
    FROM bias_requests
    WHERE event_id = p_event_id
      AND (status IN ('wachtrij', 'bezig') OR finished_at > now() - interval '10 minutes')
    ORDER BY created_at DESC
    LIMIT 1;
    IF FOUND THEN
        RETURN json_build_object('ok', true, 'reason', NULL, 'request', bias_request_json(v_request));
    END IF;

    -- Every request is up to 16 LLM calls: 20 news items a day per code, 100 for everyone
    SELECT count(*)::int INTO v_count
    FROM bias_requests
    WHERE requested_by = v_code.id AND created_at > now() - interval '1 day';
    IF v_count >= 20 THEN
        RETURN json_build_object('ok', false, 'reason', 'limiet', 'request', NULL);
    END IF;
    SELECT count(*)::int INTO v_count
    FROM bias_requests
    WHERE created_at > now() - interval '1 day';
    IF v_count >= 100 THEN
        RETURN json_build_object('ok', false, 'reason', 'druk', 'request', NULL);
    END IF;

    INSERT INTO bias_requests (event_id, requested_by)
    VALUES (p_event_id, v_code.id)
    RETURNING * INTO v_request;
    UPDATE access_codes SET last_used_at = now() WHERE id = v_code.id;
    PERFORM pg_notify('bias_request', 'request:' || v_request.id);

    RETURN json_build_object('ok', true, 'reason', NULL, 'request', bias_request_json(v_request));
END;
$$;

-- The latest request of a news item, or null; for every reader
CREATE OR REPLACE FUNCTION bias_request_for_event(p_event_id integer)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- A table alias (not a subquery) so the row has the bias_requests type
    SELECT bias_request_json(br)
    FROM bias_requests br
    WHERE br.event_id = p_event_id
    ORDER BY br.created_at DESC
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION bias_role_allowed(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bias_request_json(bias_requests) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION access_code_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_bias_analysis(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION bias_request_for_event(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION access_code_role(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION request_bias_analysis(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bias_request_for_event(integer) TO anon, authenticated;

DO $$
DECLARE
    f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.access_code_role(text)',
        'public.request_bias_analysis(text, integer)',
        'public.bias_request_for_event(integer)'
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
            RAISE EXCEPTION 'Function % must be SECURITY DEFINER', f;
        END IF;
    END LOOP;
    IF has_table_privilege('anon', 'public.bias_requests', 'SELECT') THEN
        RAISE EXCEPTION 'anon must not read bias_requests (who asked)';
    END IF;
    RAISE NOTICE 'Migration 019_bias_op_verzoek completed successfully';
END;
$$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new table and functions immediately
NOTIFY pgrst, 'reload schema';
