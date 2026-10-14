-- Migration: AI-gebruik - every LLM call with its tokens, for the admin dashboard
--
-- The backend notes every LLM call (provider, model, pipeline step, tokens) and, for Claude Code,
-- the subscription's limits it reports with the call: how much of the 5-hour window and of the
-- week is used, and when each resets (rate_limit). Beheer shows it through /admin/llm-usage.
--
-- Local working database only: the website never reads it (the admin page asks the backend), so
-- it is not in PUBLISHED_TABLES and does not go to Supabase. The backend also creates the table at
-- startup (create_all); this file is the record. Kept LLM_USAGE_RETENTION_DAYS (90) days.
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS llm_usage (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    provider VARCHAR(32) NOT NULL,
    model VARCHAR(80) NOT NULL,
    step VARCHAR(40),
    ok BOOLEAN NOT NULL DEFAULT true,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    -- Claude Code's API list price of the call (the subscription pays it)
    cost_usd DOUBLE PRECISION,
    duration_ms INTEGER,
    -- Claude Code's rate_limit_info: status, unifiedWindows.five_hour/seven_day {utilization, resetsAt}
    rate_limit JSONB
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage (created_at);

COMMIT;
