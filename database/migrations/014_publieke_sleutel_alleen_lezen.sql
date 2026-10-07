-- Migration: the public anon key may only read (security, 2026-10-07)
--
-- events, event_articles, llm_insights, article_bias_analyses, news_sources and llm_config had RLS off,
-- and anon/authenticated had every privilege on them (Supabase grants that on every new table). The
-- frontend ships that key to every browser, so anyone could change or delete the news, the analyses and
-- the sources, and rewrite the prompts and providers in llm_config that the backend gives the LLM.
--
-- Nothing that writes these tables uses that key, so nothing breaks:
--   backend (postgres: owner, BYPASSRLS)   ingest, clustering, analyses, Beheer (/admin/sources) and
--                                          LLM-configuratie (/admin/llm-config, also for the prompt
--                                          workflow in CLAUDE.md)
--   SECURITY DEFINER functions (postgres)  review_voice_candidate, share_entry, ... (unchanged)
--
-- tables the frontend reads : anon/authenticated may only SELECT, RLS on with a read policy as a second
--                             lock (articles keeps its column grants of migration 013)
-- llm_config                : nothing (RLS on, no policy); the admin page reads and writes it via the backend
-- sequences                 : nothing; anon inserts into no table directly
-- new tables of postgres    : only SELECT for anon/authenticated by default (Supabase default: everything)
--
-- Idempotent. Supabase only: roles anon/authenticated.

-- Part 1: privileges. GRANT and REVOKE take no lock on the tables, so this closes the hole at once, also
-- while the backend is busy.
BEGIN;

REVOKE ALL ON TABLE
    events, event_articles, llm_insights, article_bias_analyses, news_sources, llm_config,
    event_entities, event_relations
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
    events, event_articles, llm_insights, article_bias_analyses, news_sources,
    event_entities, event_relations
TO anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

DO $$
DECLARE
    t text;
    r text;
BEGIN
    -- No table in public is writable with the public key
    FOR t IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    LOOP
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
            IF has_any_column_privilege(r, format('public.%I', t), 'INSERT, UPDATE, REFERENCES')
               OR has_table_privilege(r, format('public.%I', t), 'DELETE, TRUNCATE, TRIGGER') THEN
                RAISE EXCEPTION '% can still change %', r, t;
            END IF;
        END LOOP;
    END LOOP;

    -- Tables the frontend reads (lib/api.ts): still readable
    FOREACH t IN ARRAY ARRAY[
        'events', 'event_articles', 'llm_insights', 'article_bias_analyses', 'news_sources',
        'event_entities', 'event_relations', 'articles'
    ]
    LOOP
        IF NOT has_any_column_privilege('anon', format('public.%I', t), 'SELECT') THEN
            RAISE EXCEPTION 'anon cannot read % (the frontend needs it)', t;
        END IF;
    END LOOP;

    IF has_any_column_privilege('anon', 'public.llm_config', 'SELECT') THEN
        RAISE EXCEPTION 'anon can still read llm_config';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'
          AND (has_sequence_privilege('anon', c.oid, 'USAGE, UPDATE')
               OR has_sequence_privilege('authenticated', c.oid, 'USAGE, UPDATE'))
    ) THEN
        RAISE EXCEPTION 'anon/authenticated can still use a sequence';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
        WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
          AND d.defaclobjtype IN ('r', 'S')
          AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
          AND NOT (d.defaclobjtype = 'r' AND a.privilege_type = 'SELECT')
    ) THEN
        RAISE EXCEPTION 'new tables or sequences would still be writable by anon/authenticated';
    END IF;
END $$;

COMMIT;

-- Part 2: RLS with a read policy as a second lock, one table per transaction. Enabling RLS needs a short
-- exclusive lock and the backend can hold a table for minutes (ingest), so each table waits at most 1 s:
-- readers (anon statement timeout 3 s) never stall longer. After a lock timeout, rerun this file.

BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_public_read ON events;
CREATE POLICY events_public_read ON events FOR SELECT TO anon, authenticated USING (true);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE event_articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_articles_public_read ON event_articles;
CREATE POLICY event_articles_public_read ON event_articles FOR SELECT TO anon, authenticated USING (true);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE llm_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_insights_public_read ON llm_insights;
CREATE POLICY llm_insights_public_read ON llm_insights FOR SELECT TO anon, authenticated USING (true);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE article_bias_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS article_bias_analyses_public_read ON article_bias_analyses;
CREATE POLICY article_bias_analyses_public_read ON article_bias_analyses
    FOR SELECT TO anon, authenticated USING (true);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE news_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS news_sources_public_read ON news_sources;
CREATE POLICY news_sources_public_read ON news_sources FOR SELECT TO anon, authenticated USING (true);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS articles_public_read ON articles;
CREATE POLICY articles_public_read ON articles FOR SELECT TO anon, authenticated USING (true);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE llm_config ENABLE ROW LEVEL SECURITY;  -- no policy: anon/authenticated see no rows
COMMIT;

DO $$
DECLARE
    t text;
BEGIN
    -- Every table in public has RLS on
    FOR t IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    LOOP
        RAISE EXCEPTION 'RLS is off on %', t;
    END LOOP;

    FOREACH t IN ARRAY ARRAY[
        'events', 'event_articles', 'llm_insights', 'article_bias_analyses', 'news_sources',
        'event_entities', 'event_relations', 'articles'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT' AND 'anon' = ANY (roles)
        ) THEN
            RAISE EXCEPTION 'no read policy for anon on %', t;
        END IF;
    END LOOP;

    RAISE NOTICE 'Migration 014_publieke_sleutel_alleen_lezen completed successfully';
END $$;

-- Let PostgREST (Supabase REST API) pick up the new privileges immediately
NOTIFY pgrst, 'reload schema';
