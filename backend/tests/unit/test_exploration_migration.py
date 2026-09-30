# ruff: noqa: S101
"""Contract checks on migration 004 (Story 11.8): event_entities.article_ids + search_articles."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from backend.app.services.event_entity_service import MAX_ARTICLE_IDS

MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "database"
    / "migrations"
    / "004_explore_entities_relations.sql"
)
SIGNATURE = "search_articles(text, integer, integer)"
ITEM_KEYS = {
    "id",
    "title",
    "url",
    "source_name",
    "published_at",
    "is_international",
    "source_country",
    "event_id",
    "event_slug",
    "event_title",
}


def _flat(text: str) -> str:
    return " ".join(text.split())


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def function_sql(sql: str) -> str:
    return sql.split("CREATE OR REPLACE FUNCTION search_articles(", 1)[1].split("$$;", 1)[0]


def _fts_expression(fragment: str) -> str:
    """The to_tsvector(...) expression following ``fragment``, normalised (no ``a.``)."""

    start = fragment.index("to_tsvector(")
    depth = 0
    for index in range(start + len("to_tsvector"), len(fragment)):
        depth += {"(": 1, ")": -1}.get(fragment[index], 0)
        if depth == 0:
            expression = _flat(fragment[start : index + 1]).replace("a.", "")
            return expression.replace("( ", "(").replace(" )", ")")
    raise AssertionError("unbalanced to_tsvector expression")


def test_article_ids_column_in_create_table_and_idempotent_alter(sql: str) -> None:
    table = sql.split("CREATE TABLE IF NOT EXISTS event_entities (", 1)[1].split(");", 1)[0]
    assert "article_ids INTEGER[] NOT NULL DEFAULT '{}'" in table
    alter = (
        "ALTER TABLE event_entities ADD COLUMN IF NOT EXISTS article_ids "
        "INTEGER[] NOT NULL DEFAULT '{}';"
    )
    assert alter in sql
    assert sql.index("CREATE TABLE IF NOT EXISTS event_entities") < sql.index(alter)
    # create_all() creates the column without a default
    assert "ALTER TABLE event_entities ALTER COLUMN article_ids SET DEFAULT '{}';" in sql
    assert "max 200" in table and MAX_ARTICLE_IDS == 200


def test_fts_index_is_created_in_the_transaction(sql: str) -> None:
    assert not re.search(r"^\s*CREATE INDEX CONCURRENTLY", sql, re.MULTILINE)
    index = sql.split("CREATE INDEX IF NOT EXISTS idx_articles_fts ON articles USING GIN (", 1)[1]
    expression = _fts_expression(index.split(");", 1)[0])
    assert expression == (
        "to_tsvector('dutch', coalesce(title, '') || ' ' || coalesce(summary, '') "
        "|| ' ' || coalesce(content, ''))"
    )
    create = sql.index("CREATE INDEX IF NOT EXISTS idx_articles_fts")
    assert sql.index("BEGIN;") < create < sql.index("COMMIT;")


def test_search_articles_signature_and_security(sql: str, function_sql: str) -> None:
    header = _flat(function_sql.split("AS $$", 1)[0])
    assert header.startswith(
        "p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0 ) RETURNS json"
    )
    for attribute in ("LANGUAGE plpgsql", "STABLE", "SECURITY INVOKER", "SET search_path = public"):
        assert attribute in header
    assert "SECURITY DEFINER" not in header
    assert f"REVOKE ALL ON FUNCTION {SIGNATURE} FROM PUBLIC;" in sql
    assert f"GRANT EXECUTE ON FUNCTION {SIGNATURE} TO anon, authenticated;" in sql


def test_search_articles_query_handling(function_sql: str) -> None:
    body = _flat(function_sql)
    assert "left(btrim(COALESCE(p_query, '')), 200)" in body
    assert "LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)" in body
    assert "LEAST(GREATEST(COALESCE(p_offset, 0), 0), 500)" in body
    empty = "RETURN json_build_object('total', 0, 'items', '[]'::json)"
    assert f"IF length(v_query) < 2 THEN {empty}" in body
    assert "websearch_to_tsquery('dutch', v_query)" in body
    assert "numnode(v_tsquery) = 0" in body
    # relevance tiers (title match first), then newest first
    assert "ORDER BY h.title_hit DESC, h.published_at DESC NULLS LAST, h.id DESC" in body
    assert "LIMIT v_limit OFFSET v_offset" in body
    assert "RETURN json_build_object('total', v_total, 'items', v_items)" in body


def test_search_articles_uses_the_indexed_expression(sql: str, function_sql: str) -> None:
    index = sql.split("CREATE INDEX IF NOT EXISTS idx_articles_fts", 1)[1]
    where = function_sql.split("FROM articles a", 1)[1].split("WHERE", 1)[1]
    assert _fts_expression(where) == _fts_expression(index)


def test_search_articles_json_shape_without_article_text(function_sql: str) -> None:
    item = function_sql.split("json_agg(", 1)[1].split("ORDER BY p.title_hit", 1)[0]
    keys = set(re.findall(r"'([a-z_]+)',\s", item))
    assert keys == ITEM_KEYS
    # copyright: the JSON never carries article text
    for column in ("content", "summary", "normalized_text"):
        assert column not in item
    # event_title only from the denormalised LLM titles, never from events.title
    assert "ee.event_title" in item and "er.related_title" in item
    assert "e.title" not in function_sql
    assert "ORDER BY e.last_updated_at DESC NULLS LAST, e.id DESC" in _flat(function_sql)


def test_verification_block_and_schema_reload(sql: str) -> None:
    verification = _flat(sql.rsplit("DO $$", 1)[1])
    assert "column_name = 'article_ids'" in verification and "udt_name = '_int4'" in verification
    assert "to_regclass('public.idx_articles_fts')" in verification
    assert f"to_regprocedure('public.{SIGNATURE}')" in verification
    assert "SELECT prosecdef FROM pg_proc" in verification
    assert f"has_function_privilege( 'anon', 'public.{SIGNATURE}', 'EXECUTE' )" in verification
    for table in ("articles", "event_articles", "events", "event_entities", "event_relations"):
        assert f"'{table}'" in verification
    assert "has_table_privilege('anon', 'public.' || t, 'SELECT')" in verification
    assert sql.index("COMMIT;") < sql.index("NOTIFY pgrst, 'reload schema';")
    assert sql.rstrip().endswith("NOTIFY pgrst, 'reload schema';")
