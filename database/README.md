# Database Schema Documentation

## Overview
The News Aggregator uses PostgreSQL (Supabase) for production data storage. This directory contains the database schema and related documentation.

## Schema Files
- **`schema.sql`**: Complete PostgreSQL schema definition
- **`README.md`**: This file

## Tables

### `articles`
Stores raw fetched news articles from RSS feeds.

**Key Fields:**
- `guid`, `url`: Unique identifiers (constraints enforced)
- `title`, `content`, `summary`: Article content
- `embedding`: Vector embedding (binary) for similarity search
- `entities`, `extracted_dates`, `extracted_locations`: NLP enrichments
- `event_type`: LLM-classified event category

**Indexes:** `published_at`, `fetched_at`, `source_name`, `event_type`; GIN full-text index
`idx_articles_fts` on `to_tsvector('dutch', title || ' ' || summary || ' ' || content)` (migration
004, used by `search_articles`, see below)

### `events`
Detected news events (clusters of related articles).

**Key Fields:**
- `slug`: URL-friendly identifier
- `title`, `description`: Human-readable event summary
- `centroid_*`: Aggregated embeddings/entities from cluster
- `article_count`: Cached count of linked articles
- `spectrum_distribution`: Political bias distribution
- `archived_at`: Soft delete timestamp

**Indexes:** `first_seen_at`, `last_updated_at`, `slug`, `archived_at`

### `event_articles`
Many-to-many link table between events and articles.

**Key Fields:**
- `event_id`, `article_id`: Foreign keys (ON DELETE CASCADE)
- `similarity_score`: Cosine similarity or composite score
- `scoring_breakdown`: JSON with component scores

**Indexes:** `event_id`, `article_id`, `similarity_score`

### `llm_insights`
AI-generated analysis per event (timeline, contradictions, fallacies, frames).

**Key Fields:**
- `event_id`: Foreign key to events
- `provider`, `model`: LLM identifier (e.g., "mistral", "mistral-large-latest")
- `timeline`, `clusters`, `contradictions`, `fallacies`, `frames`, `coverage_gaps`: Structured JSON outputs
- `raw_response`: Full LLM response for debugging

**Unique Constraint:** One insight per (event_id, provider)

**Indexes:** `event_id`, `provider`

### `event_entities` (Epic 11, Story 11.8)
Canonical entities per event with counts ("Ook in het nieuws"). Derived data written by the
backend exploration service; the frontend reads it with the anon key (SELECT only).

**Key Fields:**
- `event_id`: Foreign key to events (ON DELETE CASCADE)
- `entity_key`: Canonical key `"{kind}:{slug}"` (e.g. `person:mark-rutte`) or `country:{iso}` (e.g. `country:il`)
- `name`: Display name (most frequent of the longest surface forms)
- `kind`: `person` | `org` | `place` | `country` | `group` | `event`
- `iso_code`: ISO 3166-1 alpha-2 for `country` entities
- `aliases`: `TEXT[]` of slugs referring to this entity (own slug, merged forms, surname, ISO code)
- `mention_count`, `article_count`, `outlet_counts` (JSONB `{source_name: mentions}`), `salience`
- `article_ids`: `INTEGER[]` of the ids of the event's (non-international) articles in which the
  entity was found - ascending, at most 200 (above that the 200 newest/highest ids), so
  `cardinality(article_ids) = article_count` up to 200
- `event_slug`, `event_title` (always the LLM title), `event_type`, `event_last_updated_at`: denormalised display fields
- `computed_at`: When the row was computed

**Unique Constraint:** One row per (event_id, entity_key)

**Indexes:** `event_id`, `entity_key`, GIN on `aliases`, `event_last_updated_at DESC`

### `event_relations` (Epic 11, Story 11.8)
Precomputed related events with reasons ("Volg het spoor"). Directional rows, written for both
directions and capped at `RELATED_EVENTS_TOP_K` per `event_id`.

**Key Fields:**
- `event_id` -> `related_event_id`: Foreign keys to events (ON DELETE CASCADE), never equal
- `score` (0..1), `embedding_similarity`, `entity_overlap`, `country_overlap`
- `reasons`: JSONB list, e.g. `[{"type":"entity","key":"person:mark-rutte","name":"Mark Rutte","kind":"person"}, {"type":"country","iso":"IL"}, {"type":"category","value":"politics"}, {"type":"topic","similarity":0.61}]`
- `related_slug`, `related_title` (always the LLM title), `related_event_type`, `related_article_count`, `related_first_seen_at`, `related_last_updated_at`: denormalised display fields
- `computed_at`: When the row was computed

**Unique Constraint:** One row per (event_id, related_event_id)

**Indexes:** `(event_id, score DESC)`, `related_event_id`

Both tables are *not* mirrored to the local SQLite cache (INFRA-1) and are never written by
the frontend. The exploration service never updates `events` (its `last_updated_at` drives feed
ordering and archiving).

### `search_articles` RPC (Epic 11, Story 11.8)
Full-text search over all articles ("in welke artikelen komt X voor?"), added by migration 004:

```
search_articles(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS json
-> {"total": 123, "items": [{"id", "title", "url", "source_name", "published_at",
    "is_international", "source_country", "event_id", "event_slug", "event_title"}]}
```

- `websearch_to_tsquery('dutch', p_query)` (`"exacte zin"`, `or`, `-woord`); the query is trimmed
  and cut at 200 characters; fewer than 2 characters or only stop words ->
  `{"total": 0, "items": []}`. `p_limit` is clamped to 1..50, `p_offset` to 0..500; `total`
  counts all matching articles.
- Order (relevance, then date): articles whose *title* matches first, then articles that only
  match in summary/content; within each group newest first (`published_at DESC NULLS LAST`,
  `id DESC`).
- Never returns `content`/`summary` (copyright). `event_id`/`event_slug`: the most recently
  updated event the article is linked to (`event_articles`), else `null`. `event_title` is the
  LLM title denormalised in `event_entities.event_title` / `event_relations.related_title`,
  otherwise `null` (never `events.title`).
- `STABLE`, `SECURITY INVOKER`, `SET search_path = public`, executable by `anon`/`authenticated`
  (not `PUBLIC`). Invoker rights because `anon` already reads `articles`, `event_articles` and
  `events` (the frontend embeds them via PostgREST) and the two exploration tables; 004's
  verification block fails if `anon` cannot read one of them.
- Index size (measured on the local mirror, 579 articles with on average 70 / 1409 / 2478
  characters title / summary / content): 1.5 MB with content vs 1.0 MB without; ~1-2 kB per
  extra article, i.e. ~10-20 MB for the ~10k production articles.

### `pm_*` - Propagandamodel-koppeling (Epic 11, Story 11.17)
A read-only copy of the approved part of the sibling `propaganda-model` knowledge graph
(`../propaganda-model/data/propaganda_model.db`, opened with `mode=ro`), written by the local
backend (`backend/app/services/propaganda_model_sync.py`, full refresh in one transaction).

| Table | Content |
| ----- | ------- |
| `pm_entities` | Approved entities (`id` = pm id), `slug` (`<id>-<slug>` as on the pm site), `type`, `role` (display name), `primary_filter`, `description`, `active_from/until`, `degree`, `auto_approved` (Epic 12) |
| `pm_relations` | Approved relations between exported entities: `relation_type`, `mechanism` (display name), `filter` (primary filter of the mechanism, edge colour), `filters` (`text[]`, primary filter + all filter tags of the mechanism), `aard`, `description`, `certainty_label`, `active_from/until`, `bidirectional`, `source_count`, `auto_approved` (Epic 12) |
| `pm_sources` | Sources supporting the *existence* of an entity/relation (`owner_kind`, `owner_id`, `title`, `url`, `publisher`, `published_at`, `quote` <= 300 chars, `position`, `unreviewed` (Epic 12); max 12 per owner) |
| `pm_aliases` | `(alias, entity_id)`: slugs made with the shared `slugify` (`backend/app/nlp/entity_keys.py`) |
| `pm_meta` | `version`, `synced_at`, `db_mtime`, `entity_count`, `relation_count`, `format` (row format; a sync is never skipped as "unchanged" while it differs) |

**What is exported (and what never is)**
- Only `status = 'goedgekeurd' AND NOT vervangen` (entities, relations; arguments that are
  `voorgesteld`, `verworpen`, `vervangen` or under `smaad_hold` never provide sources).
- Never the political-position layer (`politieke_positie`, kleurmeter) or `machtsvalentie`
  (licence + GDPR art. 9): those arguments and every reply below them are not even read, sentences
  in descriptions that mention them are dropped, and every sync / demo export is checked
  mechanically (`politieke_positie|machtsvalentie` must not occur in the output).
- Certainty only as a qualitative label (the 0.05 floor is "unproven", not a measurement), from
  the pm project's own derived certainty (`scoring.py` layer B, replicated):
  `onderbouwd` >= 0.30 with >= 2 independent source clusters; `aannemelijk` >= 0.14 (at least one
  merged, sourced supporting argument not outweighed by contradiction); otherwise `onzeker`
  (also every relation without evidence in the discussion tree).
- `primary_filter`: the pm project's derived primary role (argmax of sum(certainty x influence)
  over the relations the entity is the source of, `tegenmacht` excluded), falling back to the
  category of the assigned primary role; `overig` becomes NULL.
- `filters` of a relation: its primary `filter` when that is one of the six filters (eigendom,
  advertentie, sourcing, flak, ideologie, tegenmacht - not `cross_filter`/`overig`/NULL) UNION
  all filter tags of its mechanism (pm table `mechanism_filters`, as in the pm `viz_data.py`; a
  mechanism can belong to several filters, e.g. `draaideurconstructie` = eigendom + ideologie +
  sourcing while its primary `filter` is `cross_filter`), `overig` dropped; `{}` when neither
  gives a filter. Order: the primary filter first, then that list order. The union guarantees
  that an edge coloured by its primary filter is found when exploring via that filter (a few pm
  mechanisms are tagged with another filter than their primary one).

**Automatic news pipeline (Epic 12).** Entities/relations whose latest status change in the pm
`edit_log` is an approval by the machine account `nieuws-autokeur` get `auto_approved = true`
(shown as "automatisch toegevoegd"); a later human status change removes the flag. For those
elements the not-yet-merged supporting evidence of the research agent `nieuws-scout` (no smaad
hold) is exported too, after any merged evidence, with `unreviewed = true` ("nog niet
gecontroleerd"). `pm_meta.format` is `4` since these columns.

**Access (licence: no redistribution).** RLS is enabled on all `pm_*` tables *without any
policy*, and all privileges are revoked from `anon`/`authenticated`: the dataset cannot be read or
downloaded directly. The frontend uses only these SECURITY DEFINER RPC functions (all `STABLE`,
`SET search_path = public`, returning `json`, executable by `anon`):

| Function | Returns |
| -------- | ------- |
| `pm_meta_info()` | `{"version","synced_at","entity_count","relation_count"}` |
| `pm_match(p_aliases text[])` | `[{"alias","entity_id","name","type","degree"}]` - exact slug matches, max 50 rows, input capped at 100 aliases |
| `pm_search(p_query text, p_limit int = 10)` | `[{"id","name","type","primary_filter","degree"}]` - >= 2 characters, ILIKE on names and aliases, exact/prefix first, limit 1..20 |
| `pm_neighborhood(p_entity_id int, p_limit int = 40, p_filters text[] = NULL)` | `{"center","entities","relations","total","truncated","filter_counts","filters"}` - relations touching the entity, most informative types first, limit 1..60, no descriptions; relations carry `filter` and `filters`. `p_filters` NULL or empty = all relations; otherwise a relation matches when it shares a filter with `p_filters` (`r.filters && p_filters`) or, when `'overig'` is in `p_filters`, when it has no filters. `total` = matching relations, `truncated` = `total > limit`; `filter_counts` = `{"eigendom": n, ...}` over *all* relations of the entity regardless of `p_filters` (a relation counts once per filter, relations without filters under `"overig"`, only counts > 0); `filters` echoes `p_filters` as a JSON array (null when NULL/empty); unknown id -> `{"center": null, "entities": [], "relations": [], "total": 0, "truncated": false, "filter_counts": {}, "filters": <echo>}` |
| `pm_details(p_kind text, p_id int)` | `{"kind","id","title","type","mechanism","filter","filters","description","active_from","active_until","certainty_label","auto_approved","sources"}` - the only call that returns descriptions and sources (max 12, each with `unreviewed`); `filters` is `null` for entities; unknown -> `null` |

`pm_neighborhood` also returns `auto_approved` on the center, entities and relations.

Epic 13 (migration 007) adds routes between two sets of entities:

| Function | Returns |
| -------- | ------- |
| `pm_paths(p_from int[], p_to int[], p_max_hops int = 3, p_limit int = 2, p_at text = NULL)` | `{"routes","entities","relations","truncated","max_hops","at"}` - the best simple routes of 1..3 relations (either direction) from any `p_from` id (first 12) to any `p_to` id (first 40); intermediate stations are never one of the given ids; `p_limit` routes per pair (1..5), at most 60 in all (`truncated`). Each route: `{"from","to","rank","hops","nodes","relations","historic","shared_with"}`; `shared_with` = the other `p_from` ids with the same stations and kinds of relation to the same target. Ranking (never returned): strength of the kind of relation x certainty x 0.5 when it ended before `p_at` (default today), times `1/sqrt(1 + degree)` per station; relations starting after `p_at` are ignored. `entities`/`relations` = only what is on the returned routes. Same rules as `frontend/lib/explore/pm-paths.ts` |

### `entity_research` - Wie is dit? (Epic 12)
Research status per named entity, written by the local backend
(`backend/app/services/entity_research/`) and by the RPC `request_entity_research` (a tap on a
name in the app). One row per key `person:<slug>` | `org:<slug>` | `actor:<slug>` (an LLM
authority without NER entity):

| Column | Content |
| ------ | ------- |
| `name`, `kind` | display name; `person` / `org` / `unknown` |
| `role_category`, `role_label`, `is_foreign` | role triage: `politicus`, `journalist`, `woordvoerder`, `bestuurder`, `organisatie`, `expert`, `overig`, `prive`, `onbekend` + the cue ("wethouder", "woordvoerder van Shell") |
| `priority`, `prominence` | research priority; news presence + internal context for the research target (events, article URLs, role sentences, decision, canonical key of an actor) |
| `pm_entity_id`, `pm_degree`, `pm_doel_id` | coverage in the propaganda model; id of the research target in its queue `nieuws_doelen` |
| `status`, `status_reason` | `nieuw`, `niet_nodig` (>= 3 relations), `overgeslagen` (private/foreign person, not in the news, or skipped by the agent), `wachtrij`, `bezig`, `klaar`, `niets_gevonden`, `twijfel`, `fout` |
| `summary`, `found` | report of the research agent (never exposed); `{"entities","relations","auto_approved","pending"}` |
| `requested_count`, `last_requested_at`, `request_event_slug` | taps in the app |
| `triaged_at`, `queued_at`, `researched_at`, `created_at`, `updated_at` | timestamps |

RLS without policies and no privileges for `anon`/`authenticated`; the frontend uses:

| Function | Returns |
| -------- | ------- |
| `request_entity_research(p_key, p_name, p_kind = 'unknown', p_event_slug = NULL)` | `{"ok","status","reason"}` - SECURITY DEFINER; validates the key/name; max 60 requests per hour in total; a repeat for the same key within 10 minutes only returns the status |
| `entity_research_status(p_keys text[])` | `[{entity_key,name,kind,status,status_reason,role_category,role_label,pm_entity_id,pm_degree,found,queued_at,researched_at,updated_at}]` - max 50 keys, SECURITY DEFINER |
| `entity_cooccurrence(p_aliases text[], p_limit int = 20)` | `[{entity_key,name,kind,shared_events,last_event_slug,last_event_title,last_seen}]` - persons/organisations in the same events (the entity's 200 most recent), limit 1..40, SECURITY INVOKER over `event_entities` |

The demo on Vercel (no Supabase) bundles a small slice instead:
`frontend/lib/explore/fixtures/demo-pm.json`, generated with the same transformer by
`PYTHONPATH=. .venv/bin/python scripts/export_pm_demo_slice.py` (~200 entities / ~480 relations,
< 480 KB). Relations include `filters`; per seed (the demo outlets + DPG Media, Mediahuis) and per
filter the first 6 relations of the filtered neighbourhood are selected first, so every filter is
represented around every seed.

## Setup

### Production (Supabase)
```bash
# Initialize schema in Supabase PostgreSQL
psql $DATABASE_URL < database/schema.sql
```

Or use the Python script:
```bash
env PYTHONPATH=. .venv/bin/python scripts/create_supabase_tables.py
```

### Development (Local PostgreSQL - optional)
```bash
# For local testing with real PostgreSQL
createdb news_aggregator_dev
psql news_aggregator_dev < database/schema.sql
```

Set in `.env`:
```
DATABASE_URL=postgresql+asyncpg://localhost/news_aggregator_dev
```

## Data Flow

```
RSS Feeds → Articles (enriched) → Event Detection → Events
                                                      ↓
                                              LLM Insights
                                                      ↓
                              Exploration (event_entities, event_relations)

propaganda-model SQLite (read-only) → Propagandamodel sync → pm_* (RPC-only access)
```

1. **Ingestion**: Articles fetched from NOS/NU.nl RSS, stored in `articles`
2. **Enrichment**: NLP processing adds embeddings, entities, event_type
3. **Clustering**: Similar articles linked via `event_articles`, creates `events`
4. **LLM Analysis**: Mistral generates insights, stored in `llm_insights`

## Frontend Access

The Next.js frontend queries Supabase directly via `@supabase/supabase-js`:
- `listEvents()`: Active events ordered by `last_updated_at`
- `getEventDetail(slug)`: Event + linked articles
- `getEventInsights(slug)`: LLM-generated analysis

## Migrations

Currently, schema changes are applied manually:
1. Update `backend/app/db/models.py` (SQLAlchemy models)
2. Regenerate `database/schema.sql` (run export script)
3. Apply changes to Supabase via SQL editor or `create_supabase_tables.py`

> ⚠️ `scripts/create_supabase_tables.py` drops tables - never run it against production data.
> Use the hand-run SQL files in `database/migrations/` instead.

### Hand-run migrations (run in order, in the Supabase SQL editor or with `psql`)

| File | Adds |
| ---- | ---- |
| `002_international_perspectives.sql` | International article/event/insight columns (Epic 9) |
| `003_article_bias_analysis.sql` | `article_bias_analyses` (Epic 10) |
| `004_explore_entities_relations.sql` | `event_entities` (incl. `article_ids`), `event_relations`, RLS read-only policies, `idx_articles_fts` + RPC `search_articles` (Epic 11) |
| `005_propagandamodel.sql` | `pm_entities`, `pm_relations`, `pm_sources`, `pm_aliases`, `pm_meta` (RLS without policies, no anon grants) + RPC functions `pm_meta_info`, `pm_match`, `pm_search`, `pm_neighborhood`, `pm_details` (Epic 11, Story 11.17) |
| `006_entity_research.sql` | `entity_research` (RLS without policies) + RPC functions `request_entity_research`, `entity_research_status`, `entity_cooccurrence`; converts `event_entities.aliases` to `TEXT[]` when `create_all()` made it `VARCHAR[]` (Epic 12) |
| `007_waarom_zo.sql` | RPC function `pm_paths` (routes between entities of the propaganda model; Epic 13, Story 13.1) |
| `009_stemmen_zoeken.sql` | `access_codes`, `voice_searches` (RLS without policies) + RPC functions `access_code_role`, `request_voice_search`, `voice_searches_for_event`, `review_voice_candidate` ("Zoek met AI" for missing voices; Epic 14, Story 14.10) |
| `012_van_anderen.sql` | `shared_entries`, `shared_entry_adoptions`, `shared_entry_reports` (RLS without policies) + RPC functions `share_entry`, `unshare_entry`, `shared_entries_for_event`, `adopt_shared_entry`, `report_shared_entry`, `shared_entries_reported`, `moderate_shared_entry` (readers share what they added and take over what others shared; Epic 14, Story 14.15) |
| `016_besluitvorming.sql` | `pm_entities.bestuurslaag`/`wikidata`, `pm_relations.functie`; `pm_neighborhood`, `pm_paths`, `pm_details` and `request_relation_research` with the decision-making layer of the propaganda model (Epic 15, Story 15.1) |

```bash
# plain postgresql:// connection string (not the postgresql+asyncpg:// SQLAlchemy URL)
psql "postgresql://postgres:<password>@<host>:5432/postgres" \
  -f database/migrations/004_explore_entities_relations.sql
```

All migrations are idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`) and end with a
`DO $$` verification block.

**004 - run it BEFORE starting the new backend.** The backend calls `create_all()` on start,
which creates missing tables but never RLS policies or grants. On Supabase new tables in `public`
are writable by `anon` until 004 runs (it enables RLS, adds the SELECT-only policies, revokes
INSERT/UPDATE/DELETE/TRUNCATE from `anon`/`authenticated`, and reloads the PostgREST schema).
If the backend already created the tables, just run 004 afterwards - it is safe:
- the tables are kept; RLS, policies, grants and any missing indexes are added
- `aliases` will be `varchar(160)[]` instead of `text[]` and some column defaults are missing;
  both are harmless (the backend always writes every column, PostgREST `cs`/`ov` filters work)
- only if `aliases` somehow ended up as `json`/`jsonb` the verification block fails; the data is
  derived, so fix it with `DROP TABLE event_entities;`, re-run 004 and then run the exploration
  backfill (`POST /admin/trigger/exploration-backfill`)

Re-running 004 on a database with an earlier version of it is safe too: it adds
`event_entities.article_ids` (existing rows get `{}`), the `idx_articles_fts` index and
`search_articles`. The index is built inside the migration's transaction (no `CONCURRENTLY`),
which blocks writes to `articles` while it builds (~11 s for 11.6k articles locally) - run it
while the backend is stopped or idle. 004 also requires that `anon` can already read `articles`,
`event_articles` and `events` (true when the current frontend works); otherwise its verification
block fails and nothing is changed.

After 004, fill the tables with the admin endpoints:
```bash
# Page through all events (repeat with offset=next_offset until done=true), then run it once
# more so relations of the first pages use the complete entity index
curl -X POST "http://localhost:8000/admin/trigger/exploration-backfill?limit=100&offset=0"
curl "http://localhost:8000/admin/exploration/status"
```

Entity rows written before `article_ids` existed keep `article_ids = '{}'` until they are
recomputed. The backfill skips events whose entities are up to date, so re-run it with
`force=true` (all pages) to fill `article_ids` for existing rows:
```bash
curl -X POST "http://localhost:8000/admin/trigger/exploration-backfill?limit=100&offset=0&include_archived=true&force=true"
```

**005 - run it after 004 and before the first propaganda-model sync.** Like 004, the backend's
`create_all()` creates the `pm_*` tables on start, and on Supabase new public tables are
readable by `anon` until 005 runs. The sync therefore refuses to write (admin endpoint: HTTP 409,
scheduler: logged error) while any `pm_*` table lacks RLS, has a policy, or is SELECT-able by
`anon`/`authenticated`. 005 is safe on tables created by `create_all()` (it enables RLS, drops
any policy, revokes all privileges and (re)creates the functions); its verification block fails
if a table is still readable or a function is not SECURITY DEFINER / not executable by `anon`.
Re-running it on a database with an earlier version is safe too: it adds `pm_relations.filters`
(existing rows get `{}`) and replaces the earlier `pm_neighborhood` overloads `(integer, integer)`
and `(integer, integer, text)` by `(integer, integer, text[])` (the old overloads are dropped; the
verification block fails if one still exists). The next sync refills
`filters` even when the pm database did not change (`pm_meta.format`); `?force=true` does it now.

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" \
  -f database/migrations/005_propagandamodel.sql
# then fill the tables (the job also runs every PROPAGANDA_SYNC_INTERVAL_MINUTES, only on change)
curl -X POST "http://localhost:8000/admin/trigger/propagandamodel-sync?force=true"
curl "http://localhost:8000/admin/propagandamodel/status"
```

**006 - run it after 004 and 005.** Safe after `create_all()` created `entity_research` (it adds
the server defaults the RPC needs, enables RLS, revokes all privileges) and safe to re-run. If
`event_entities.aliases` was created by `create_all()` as `VARCHAR(160)[]` it is converted to
`TEXT[]` (the `&&` operator of `entity_cooccurrence` and the GIN index need `TEXT[]`).

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" \
  -f database/migrations/006_entity_research.sql
curl -X POST "http://localhost:8000/admin/trigger/entity-research"
curl "http://localhost:8000/admin/entity-research/status"
```

**007 - run it after 005.** Only adds the SECURITY DEFINER function `pm_paths` (no tables, no
data); safe to re-run. Until it runs, the network falls back to what it can do without routes (the
questions per filter keep working).

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" \
  -f database/migrations/007_waarom_zo.sql
```

**009 - "Zoek met AI" (Epic 14, Story 14.10).** Adds two tables (no access for anon: only the
functions) and four SECURITY DEFINER functions; safe to re-run. Then make an access code (only its
hash is stored; the code is printed once) and enter it on /admin → Toegangscode:

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" \
  -f database/migrations/009_stemmen_zoeken.sql
PYTHONPATH=. .venv/bin/python scripts/access_code.py create --role admin --label Eigenaar
```

**012 - "Van anderen" (Epic 14, Story 14.15).** Three tables (no access for anon: only the
functions) and seven SECURITY DEFINER functions; safe to re-run. Needs 009 (the admin functions
check the access code). No backend job: the app calls the functions directly.

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" \
  -f database/migrations/012_van_anderen.sql
```

**016 - Besluitvorming in het netwerk (Epic 15, Story 15.1).** Three columns and four replaced SECURITY DEFINER
functions: the decision-making categories in the filter order, the new relation types in the priority and route
strengths, the office and the government layer in their rows. The `ALTER TABLE`s need a short exclusive lock: while
the backend runs, give each its own transaction with `SET LOCAL lock_timeout = '1s'` (retry when the table is busy),
then run the rest of the file. Needs 005, 007, 008, 010 and 011.

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" \
  -f database/migrations/016_besluitvorming.sql
```

**Future**: Alembic migrations for version-controlled schema evolution.

## Data Retention

- **Articles**: Kept indefinitely for analysis
- **Events**: Soft-deleted via `archived_at` after 90 days of inactivity
- **LLM Insights**: Regenerated on-demand, old versions overwritten

## Backup & Restore

**Supabase Automatic Backups**: Daily snapshots (7-day retention on free tier)

**Manual Backup**:
```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

**Restore**:
```bash
psql $DATABASE_URL < backup_20250117.sql
```
