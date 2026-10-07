-- Migration: shield the full article text from the public anon key (storage rule, 2026-10-07)
--
-- Until now anon/authenticated had every privilege on articles (RLS off): anyone with the public
-- key could read the full text of every article, also of subscription newspapers, and change or
-- delete articles. The frontend only reads the columns granted below and never writes.
--
-- articles        : anon/authenticated may only SELECT the columns below: no full text (content),
--                   no working data (normalized_text, normalized_tokens, embedding, tfidf_vector)
--                   and no writes. The backend (postgres) is not affected.
-- search_articles : now SECURITY DEFINER (was INVOKER, migration 004), so "Zoek in alle artikelen"
--                   keeps searching title, intro and text. It still returns references only.
--
-- Idempotent. Supabase only: roles anon/authenticated.

BEGIN;

REVOKE ALL ON TABLE articles FROM anon, authenticated;

GRANT SELECT (
    id, guid, url, title, summary, source_name, source_metadata, entities, extracted_dates,
    extracted_locations, event_type, published_at, fetched_at, created_at, updated_at,
    enriched_at, image_url, is_international, source_country
) ON TABLE articles TO anon, authenticated;

ALTER FUNCTION search_articles(text, integer, integer) SECURITY DEFINER;
ALTER FUNCTION search_articles(text, integer, integer) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION search_articles(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_articles(text, integer, integer) TO anon, authenticated;

DO $$
DECLARE
    c text;
BEGIN
    FOREACH c IN ARRAY ARRAY['content', 'normalized_text', 'normalized_tokens', 'embedding', 'tfidf_vector']
    LOOP
        IF has_column_privilege('anon', 'public.articles', c, 'SELECT') THEN
            RAISE EXCEPTION 'anon can still read articles.%', c;
        END IF;
    END LOOP;

    -- Columns the frontend reads (lib/api.ts)
    FOREACH c IN ARRAY ARRAY[
        'id', 'title', 'url', 'summary', 'source_name', 'source_metadata', 'published_at',
        'image_url', 'is_international', 'source_country'
    ]
    LOOP
        IF NOT has_column_privilege('anon', 'public.articles', c, 'SELECT') THEN
            RAISE EXCEPTION 'anon cannot read articles.% (the frontend needs it)', c;
        END IF;
    END LOOP;

    IF has_table_privilege('anon', 'public.articles', 'INSERT, UPDATE, DELETE, TRUNCATE') THEN
        RAISE EXCEPTION 'anon can still change articles';
    END IF;

    IF NOT (SELECT prosecdef FROM pg_proc
            WHERE oid = 'public.search_articles(text, integer, integer)'::regprocedure) THEN
        RAISE EXCEPTION 'search_articles must be SECURITY DEFINER';
    END IF;

    IF NOT has_function_privilege('anon', 'public.search_articles(text, integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon cannot execute search_articles';
    END IF;

    RAISE NOTICE 'Migration 013_artikeltekst_afschermen completed successfully';
END $$;

COMMIT;

-- Let PostgREST (Supabase REST API) pick up the new privileges immediately
NOTIFY pgrst, 'reload schema';
