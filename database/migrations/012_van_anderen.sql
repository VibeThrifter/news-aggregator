-- Migration: Van anderen - readers share what they added to a news item; others search it and take
-- over what they find good (Epic 14, Story 14.15)
--
-- shared_entries            : what a reader shared of their own entries (frontend own.ts), per event,
--                             with the same fields. Anonymous: the author is the sha256 of a random
--                             token of their device (not a person or account); only that device can
--                             change or withdraw it.
-- shared_entry_adoptions    : which devices took an entry over (counted in adopted_count)
-- shared_entry_reports      : reports ("Meld"); 3 reports hide an entry until the admin looks at it
-- share_entry()             : share an own entry, or update it (device token; limits)
-- unshare_entry()           : withdraw it
-- shared_entries_for_event(): what readers shared about an event (not hidden), with this device's state
-- adopt_shared_entry()      : take an entry over, or give it back (keeps the count)
-- report_shared_entry()     : report an entry
-- shared_entries_reported() : admin: what was reported or hidden
-- moderate_shared_entry()   : admin: hide, show again or delete
--
-- No AI anywhere (owner's rule 2026-10-06: what costs extra AI is admin only). Nothing a reader
-- shares appears in anyone's picture: others see it only when they open "Van anderen", and take
-- over what they choose.
--
-- The tables have RLS enabled WITHOUT policies and no privileges for anon/authenticated: the
-- frontend only uses the functions below. Requires migration 009 (access_codes, for the admin
-- functions). Idempotent. Supabase only: roles anon/authenticated.

BEGIN;

CREATE TABLE IF NOT EXISTS shared_entries (
    id BIGSERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    -- sha256 of the device token of who shared it
    author_hash CHAR(64) NOT NULL,
    -- The id of the entry on that device (own:<random>)
    own_id VARCHAR(48) NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK (kind IN (
        'claim', 'fallacy', 'contradiction', 'error', 'speaker', 'source', 'gap', 'question', 'note', 'moment'
    )),
    text VARCHAR(300) NOT NULL,
    detail VARCHAR(1000),
    quote VARCHAR(300),
    -- What it hangs on: outlet:<key> or speaker:<id> (contradiction: both sides)
    anchor VARCHAR(220),
    against VARCHAR(220),
    -- Error: the finding of the analysis it corrects (claim:<hash>, ...)
    about VARCHAR(80),
    fallacy VARCHAR(40),
    url VARCHAR(1024),
    title VARCHAR(200),
    entry_date DATE,
    adopted_count INTEGER NOT NULL DEFAULT 0,
    report_count INTEGER NOT NULL DEFAULT 0,
    hidden_at TIMESTAMPTZ,
    -- 'meldingen' (3 reports) or 'admin'
    hidden_reason VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (author_hash, own_id)
);

CREATE INDEX IF NOT EXISTS ix_shared_entries_event ON shared_entries (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_shared_entries_author ON shared_entries (author_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_shared_entries_flagged ON shared_entries (updated_at DESC)
    WHERE report_count > 0 OR hidden_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS shared_entry_adoptions (
    entry_id BIGINT NOT NULL REFERENCES shared_entries(id) ON DELETE CASCADE,
    device_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entry_id, device_hash)
);
CREATE INDEX IF NOT EXISTS ix_shared_entry_adoptions_device ON shared_entry_adoptions (device_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS shared_entry_reports (
    entry_id BIGINT NOT NULL REFERENCES shared_entries(id) ON DELETE CASCADE,
    device_hash CHAR(64) NOT NULL,
    reason VARCHAR(20) NOT NULL CHECK (reason IN ('spam', 'beledigend', 'prive', 'anders')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entry_id, device_hash)
);
CREATE INDEX IF NOT EXISTS ix_shared_entry_reports_device ON shared_entry_reports (device_hash, created_at DESC);

ALTER TABLE shared_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_entry_adoptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_entry_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shared_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON shared_entry_adoptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON shared_entry_reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE shared_entries_id_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers (not callable by the app)
-- ---------------------------------------------------------------------------------------------

-- The author of a device token (random, made on the device), or null for something else
CREATE OR REPLACE FUNCTION shared_device_hash(p_device text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_device ~ '^[A-Za-z0-9_-]{32,128}$' THEN encode(sha256(convert_to(p_device, 'UTF8')), 'hex')
    END;
$$;

-- One shared entry as the app sees it; mine/own_id/hidden only for its own device
CREATE OR REPLACE FUNCTION shared_entry_json(e shared_entries, p_hash text)
RETURNS json
LANGUAGE sql
STABLE
AS $$
    SELECT json_build_object(
        'id', e.id, 'event_id', e.event_id, 'kind', e.kind, 'text', e.text, 'detail', e.detail,
        'quote', e.quote, 'anchor', e.anchor, 'against', e.against, 'about', e.about,
        'fallacy', e.fallacy, 'url', e.url, 'title', e.title, 'date', e.entry_date,
        'adopted', e.adopted_count, 'created_at', e.created_at,
        'mine', COALESCE(e.author_hash = p_hash, false),
        'own_id', CASE WHEN e.author_hash = p_hash THEN e.own_id END,
        'adopted_by_me', p_hash IS NOT NULL AND EXISTS (
            SELECT 1 FROM shared_entry_adoptions a WHERE a.entry_id = e.id AND a.device_hash = p_hash
        ),
        'hidden', CASE WHEN e.author_hash = p_hash THEN e.hidden_at IS NOT NULL ELSE false END
    );
$$;

-- ---------------------------------------------------------------------------------------------
-- RPC functions (PostgREST: supabase.rpc('<name>', {...})). All return json.
-- ---------------------------------------------------------------------------------------------

-- {"ok": bool, "reason": text|null, "entry": {...}|null}
-- Reasons: geen_apparaat, ongeldig, onbekend_event, limiet, druk. Sharing the same own entry again
-- updates it (also when it was hidden: it stays hidden).
CREATE OR REPLACE FUNCTION share_entry(p_device text, p_event_id integer, p_entry jsonb)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hash text := shared_device_hash(p_device);
    v_own_id text := p_entry->>'id';
    v_kind text := p_entry->>'kind';
    v_text text := btrim(COALESCE(p_entry->>'text', ''));
    v_detail text := NULLIF(btrim(COALESCE(p_entry->>'detail', '')), '');
    v_quote text := NULLIF(btrim(COALESCE(p_entry->>'quote', '')), '');
    v_anchor text := NULLIF(btrim(COALESCE(p_entry->>'anchor', '')), '');
    v_against text := NULLIF(btrim(COALESCE(p_entry->>'against', '')), '');
    v_about text := NULLIF(btrim(COALESCE(p_entry->>'about', '')), '');
    v_fallacy text := NULLIF(btrim(COALESCE(p_entry->>'fallacy', '')), '');
    v_url text := NULLIF(btrim(COALESCE(p_entry->>'url', '')), '');
    v_title text := NULLIF(btrim(COALESCE(p_entry->>'title', '')), '');
    v_date_text text := NULLIF(btrim(COALESCE(p_entry->>'date', '')), '');
    v_date date;
    v_entry shared_entries%ROWTYPE;
    v_count integer;
BEGIN
    IF v_hash IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'geen_apparaat', 'entry', NULL);
    END IF;
    -- Fields of another kind are not shared
    IF v_kind IS DISTINCT FROM 'contradiction' THEN v_against := NULL; END IF;
    IF v_kind IS DISTINCT FROM 'error' THEN v_about := NULL; END IF;
    IF v_kind IS DISTINCT FROM 'fallacy' THEN v_fallacy := NULL; END IF;
    IF v_kind IS DISTINCT FROM 'source' THEN v_title := NULL; END IF;
    IF v_kind IS DISTINCT FROM 'speaker' THEN v_quote := NULL; END IF;
    IF v_kind IS DISTINCT FROM 'moment' THEN v_date_text := NULL; END IF;
    IF v_date_text IS NOT NULL THEN
        IF v_date_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
            RETURN json_build_object('ok', false, 'reason', 'ongeldig', 'entry', NULL);
        END IF;
        BEGIN
            v_date := v_date_text::date;
        EXCEPTION WHEN others THEN
            RETURN json_build_object('ok', false, 'reason', 'ongeldig', 'entry', NULL);
        END;
    END IF;
    IF v_own_id IS NULL OR v_own_id !~ '^own:[A-Za-z0-9_-]{1,40}$'
        OR v_kind IS NULL
        OR v_kind NOT IN ('claim', 'fallacy', 'contradiction', 'error', 'speaker', 'source', 'gap', 'question', 'note', 'moment')
        OR length(v_text) < 2 OR length(v_text) > 300
        OR length(COALESCE(v_detail, '')) > 1000
        OR length(COALESCE(v_quote, '')) > 300
        OR length(COALESCE(v_title, '')) > 200
        OR (v_url IS NOT NULL AND (length(v_url) > 1024 OR v_url !~* '^https?://[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$'))
        OR (v_anchor IS NOT NULL AND v_anchor !~ '^(outlet|speaker):\S{1,200}$')
        OR (v_against IS NOT NULL AND v_against !~ '^(outlet|speaker):\S{1,200}$')
        OR (v_about IS NOT NULL AND v_about !~ '^[a-z]+:[A-Za-z0-9_-]{1,40}$')
        OR (v_fallacy IS NOT NULL AND v_fallacy NOT IN (
            'stroman', 'ad_hominem', 'vals_dilemma', 'cirkelredenering', 'slippery_slope',
            'autoriteit_zonder_bewijs', 'aanname_als_feit', 'consensus_fabricatie',
            'selectieve_presentatie', 'post_hoc', 'andere'
        ))
        -- What each kind cannot do without
        OR (v_kind = 'moment' AND v_date IS NULL)
        OR (v_kind = 'source' AND v_url IS NULL)
        OR (v_kind = 'fallacy' AND v_fallacy IS NULL)
        OR (v_kind = 'contradiction' AND (v_anchor IS NULL OR v_against IS NULL OR v_anchor = v_against))
    THEN
        RETURN json_build_object('ok', false, 'reason', 'ongeldig', 'entry', NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id) THEN
        RETURN json_build_object('ok', false, 'reason', 'onbekend_event', 'entry', NULL);
    END IF;

    SELECT * INTO v_entry FROM shared_entries WHERE author_hash = v_hash AND own_id = v_own_id;
    IF FOUND AND v_entry.event_id <> p_event_id THEN
        RETURN json_build_object('ok', false, 'reason', 'ongeldig', 'entry', NULL);
    END IF;
    IF NOT FOUND THEN
        -- Limits for something new: per news item, per day, and for everyone together
        SELECT count(*)::int INTO v_count FROM shared_entries WHERE author_hash = v_hash AND event_id = p_event_id;
        IF v_count >= 30 THEN
            RETURN json_build_object('ok', false, 'reason', 'limiet', 'entry', NULL);
        END IF;
        SELECT count(*)::int INTO v_count FROM shared_entries
        WHERE author_hash = v_hash AND created_at > now() - interval '1 day';
        IF v_count >= 60 THEN
            RETURN json_build_object('ok', false, 'reason', 'limiet', 'entry', NULL);
        END IF;
        SELECT count(*)::int INTO v_count FROM shared_entries WHERE created_at > now() - interval '1 day';
        IF v_count >= 3000 THEN
            RETURN json_build_object('ok', false, 'reason', 'druk', 'entry', NULL);
        END IF;
    END IF;

    INSERT INTO shared_entries (
        event_id, author_hash, own_id, kind, text, detail, quote, anchor, against, about, fallacy,
        url, title, entry_date
    )
    VALUES (
        p_event_id, v_hash, v_own_id, v_kind, v_text, v_detail, v_quote, v_anchor, v_against, v_about,
        v_fallacy, v_url, v_title, v_date
    )
    ON CONFLICT (author_hash, own_id) DO UPDATE SET
        kind = EXCLUDED.kind, text = EXCLUDED.text, detail = EXCLUDED.detail, quote = EXCLUDED.quote,
        anchor = EXCLUDED.anchor, against = EXCLUDED.against, about = EXCLUDED.about,
        fallacy = EXCLUDED.fallacy, url = EXCLUDED.url, title = EXCLUDED.title,
        entry_date = EXCLUDED.entry_date, updated_at = now()
    WHERE shared_entries.event_id = EXCLUDED.event_id
    RETURNING * INTO v_entry;

    RETURN json_build_object('ok', true, 'reason', NULL, 'entry', shared_entry_json(v_entry, v_hash));
END;
$$;

-- {"ok": bool, "removed": int}
CREATE OR REPLACE FUNCTION unshare_entry(p_device text, p_own_id text)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hash text := shared_device_hash(p_device);
    v_count integer;
BEGIN
    IF v_hash IS NULL THEN
        RETURN json_build_object('ok', false, 'removed', 0);
    END IF;
    DELETE FROM shared_entries WHERE author_hash = v_hash AND own_id = p_own_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN json_build_object('ok', true, 'removed', v_count);
END;
$$;

-- [entry, ...] newest first: what is not hidden (your own also when it is), without what you reported
CREATE OR REPLACE FUNCTION shared_entries_for_event(p_event_id integer, p_device text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hash text := shared_device_hash(p_device);
BEGIN
    RETURN COALESCE(
        (
            -- A table alias (not a subquery) so the row has the shared_entries type
            SELECT json_agg(shared_entry_json(e, v_hash) ORDER BY e.created_at DESC)
            FROM shared_entries e
            WHERE e.id IN (
                SELECT s.id
                FROM shared_entries s
                WHERE s.event_id = p_event_id
                  AND (s.hidden_at IS NULL OR s.author_hash = v_hash)
                  AND NOT EXISTS (
                      SELECT 1 FROM shared_entry_reports r WHERE r.entry_id = s.id AND r.device_hash = v_hash
                  )
                ORDER BY s.created_at DESC
                LIMIT 300
            )
        ),
        '[]'::json
    );
END;
$$;

-- {"ok": bool, "reason": text|null, "adopted": int}
-- Reasons: geen_apparaat, onbekend (or hidden), eigen (your own entry), limiet
CREATE OR REPLACE FUNCTION adopt_shared_entry(p_device text, p_id bigint, p_adopt boolean DEFAULT true)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hash text := shared_device_hash(p_device);
    v_entry shared_entries%ROWTYPE;
    v_count integer;
BEGIN
    IF v_hash IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'geen_apparaat', 'adopted', NULL);
    END IF;
    SELECT * INTO v_entry FROM shared_entries WHERE id = p_id AND hidden_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'reason', 'onbekend', 'adopted', NULL);
    END IF;
    IF v_entry.author_hash = v_hash THEN
        RETURN json_build_object('ok', false, 'reason', 'eigen', 'adopted', v_entry.adopted_count);
    END IF;
    IF COALESCE(p_adopt, true) THEN
        SELECT count(*)::int INTO v_count FROM shared_entry_adoptions
        WHERE device_hash = v_hash AND created_at > now() - interval '1 day';
        IF v_count >= 300 THEN
            RETURN json_build_object('ok', false, 'reason', 'limiet', 'adopted', v_entry.adopted_count);
        END IF;
        INSERT INTO shared_entry_adoptions (entry_id, device_hash) VALUES (p_id, v_hash) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM shared_entry_adoptions WHERE entry_id = p_id AND device_hash = v_hash;
    END IF;
    UPDATE shared_entries
    SET adopted_count = (SELECT count(*) FROM shared_entry_adoptions WHERE entry_id = p_id)
    WHERE id = p_id
    RETURNING adopted_count INTO v_count;
    RETURN json_build_object('ok', true, 'reason', NULL, 'adopted', v_count);
END;
$$;

-- {"ok": bool, "reason": text|null}
-- Reasons: geen_apparaat, ongeldig, onbekend, eigen, limiet. The 3rd report hides the entry.
CREATE OR REPLACE FUNCTION report_shared_entry(p_device text, p_id bigint, p_reason text)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hash text := shared_device_hash(p_device);
    v_reason text := lower(btrim(COALESCE(p_reason, '')));
    v_entry shared_entries%ROWTYPE;
    v_count integer;
BEGIN
    IF v_hash IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'geen_apparaat');
    END IF;
    IF v_reason NOT IN ('spam', 'beledigend', 'prive', 'anders') THEN
        RETURN json_build_object('ok', false, 'reason', 'ongeldig');
    END IF;
    SELECT * INTO v_entry FROM shared_entries WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'reason', 'onbekend');
    END IF;
    IF v_entry.author_hash = v_hash THEN
        RETURN json_build_object('ok', false, 'reason', 'eigen');
    END IF;
    SELECT count(*)::int INTO v_count FROM shared_entry_reports
    WHERE device_hash = v_hash AND created_at > now() - interval '1 day';
    IF v_count >= 50 THEN
        RETURN json_build_object('ok', false, 'reason', 'limiet');
    END IF;
    INSERT INTO shared_entry_reports (entry_id, device_hash, reason) VALUES (p_id, v_hash, v_reason)
    ON CONFLICT DO NOTHING;
    SELECT count(*)::int INTO v_count FROM shared_entry_reports WHERE entry_id = p_id;
    UPDATE shared_entries
    SET report_count = v_count,
        hidden_reason = CASE WHEN hidden_at IS NULL AND v_count >= 3 THEN 'meldingen' ELSE hidden_reason END,
        hidden_at = CASE WHEN hidden_at IS NULL AND v_count >= 3 THEN now() ELSE hidden_at END,
        updated_at = now()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'reason', NULL);
END;
$$;

-- [{entry, event_id, event_slug, event_title, reports, reasons, hidden_at, hidden_reason}, ...]
-- Hidden first, then the most recently reported; [] for a code that is not the admin's
CREATE OR REPLACE FUNCTION shared_entries_reported(p_code text)
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
    IF NOT FOUND OR v_code.role <> 'admin' THEN
        RETURN '[]'::json;
    END IF;
    RETURN COALESCE(
        (
            SELECT json_agg(
                json_build_object(
                    'entry', shared_entry_json(e, NULL),
                    'event_slug', ev.slug,
                    'event_title', ev.title,
                    'reports', e.report_count,
                    'reasons', (
                        SELECT json_object_agg(t.reason, t.n)
                        FROM (
                            SELECT r.reason, count(*) AS n FROM shared_entry_reports r WHERE r.entry_id = e.id GROUP BY r.reason
                        ) t
                    ),
                    'hidden_at', e.hidden_at,
                    'hidden_reason', e.hidden_reason
                )
                ORDER BY (e.hidden_at IS NULL), e.updated_at DESC
            )
            FROM shared_entries e
            JOIN events ev ON ev.id = e.event_id
            WHERE e.id IN (
                SELECT s.id FROM shared_entries s
                WHERE s.report_count > 0 OR s.hidden_at IS NOT NULL
                ORDER BY s.updated_at DESC
                LIMIT 200
            )
        ),
        '[]'::json
    );
END;
$$;

-- {"ok": bool, "reason": text|null}
-- p_action: 'verberg' (hide), 'toon' (show again; the reports are cleared) or 'verwijder' (delete)
CREATE OR REPLACE FUNCTION moderate_shared_entry(p_code text, p_id bigint, p_action text)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code access_codes%ROWTYPE;
    v_action text := lower(btrim(COALESCE(p_action, '')));
BEGIN
    SELECT * INTO v_code FROM access_code_lookup(p_code);
    IF NOT FOUND OR v_code.role <> 'admin' THEN
        RETURN json_build_object('ok', false, 'reason', 'geen_toegang');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM shared_entries WHERE id = p_id) THEN
        RETURN json_build_object('ok', false, 'reason', 'onbekend');
    END IF;
    IF v_action = 'verberg' THEN
        UPDATE shared_entries SET hidden_at = now(), hidden_reason = 'admin', updated_at = now() WHERE id = p_id;
    ELSIF v_action = 'toon' THEN
        DELETE FROM shared_entry_reports WHERE entry_id = p_id;
        UPDATE shared_entries SET hidden_at = NULL, hidden_reason = NULL, report_count = 0, updated_at = now() WHERE id = p_id;
    ELSIF v_action = 'verwijder' THEN
        DELETE FROM shared_entries WHERE id = p_id;
    ELSE
        RETURN json_build_object('ok', false, 'reason', 'ongeldig');
    END IF;
    UPDATE access_codes SET last_used_at = now() WHERE id = v_code.id;
    RETURN json_build_object('ok', true, 'reason', NULL);
END;
$$;

REVOKE ALL ON FUNCTION shared_device_hash(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION shared_entry_json(shared_entries, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION share_entry(text, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION unshare_entry(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION shared_entries_for_event(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION adopt_shared_entry(text, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION report_shared_entry(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION shared_entries_reported(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION moderate_shared_entry(text, bigint, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION share_entry(text, integer, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION unshare_entry(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION shared_entries_for_event(integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION adopt_shared_entry(text, bigint, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION report_shared_entry(text, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION shared_entries_reported(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION moderate_shared_entry(text, bigint, text) TO anon, authenticated;

DO $$
BEGIN
    RAISE NOTICE 'Migration 012_van_anderen completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new tables and functions immediately
NOTIFY pgrst, 'reload schema';
