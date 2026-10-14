# Claude Code Guide - News Aggregator Project

This document provides Claude Code with essential context and guidelines for working on the 360° News Aggregator project.

## Rules
- Never commit without asking
- Frontend build warnings about `<img>` vs `<Image>` are expected and NOT errors - the build succeeds despite these warnings
- Local working database (owner 2026-10-13, Story INFRA-2; Supabase stopped the project for egress: 20 GB of 5.5 GB, all from the backend reading Supabase): the backend works on a local Postgres 17 (`DATABASE_URL`) with everything. Supabase (`SUPABASE_DATABASE_URL`) only holds what the website shows; the backend publishes changed rows there every 10 s (`backend/app/services/publish_service.py`; writing costs no egress, reading does). The backend never reads Supabase, except what the website writes there: `voice_searches` (it listens: `LISTEN voice_search`), `access_codes`, `shared_entries*` and the research requests (pulled per cycle, `website_requests.py`). A table the website reads goes in `PUBLISHED_TABLES`, a column it does not show in its `skip`; run every migration on both databases (a column Supabase lacks is left out until it is there). Setup and steps: `scripts/local_db.py`, `docs/stories/active/INFRA-2-lokale-werkdatabase.md`. The local Postgres 17 is conda-forge (micromamba, no sudo): binaries `~/.local/share/news-aggregator/postgres17/bin`, data `~/.local/share/news-aggregator/pg17-data`, LaunchAgent `nl.newsaggregator.postgres17`; connect on `127.0.0.1`, never `localhost` (a sleeping Mac cannot look it up). The website's own tables exist only in Supabase: a psql/script write to them uses `SUPABASE_DATABASE_URL`, never `DATABASE_URL`. Daily `pg_dump` of the local database (job Local Database Backup, `data/local-db/backups/`)
- Supabase storage (owner's rule 2026-10-07): Supabase keeps what the app shows; working data goes once nothing reads it, and never at the cost of accuracy. Event Maintenance clears every day the embedding + tf-idf of articles that are only in archived events (new articles are matched against event centroids, which stay) and raw LLM responses older than 7 days (`STORAGE_PRUNE_ENABLED`, `RAW_LLM_RESPONSE_RETENTION_DAYS`). `normalized_tokens` is not stored; centroids are stored with 6 decimals (`round_centroid`). The full article text stays in Supabase (search), but anon cannot read it (migration 013); `normalized_text`, vectors, centroids and raw LLM responses are only local (INFRA-2). Images are not in Supabase, only links (`image_url`), which stay. Measure before cutting: check that a change leaves clustering, related events and search unchanged
- Supabase security (2026-10-07, migration 014): the public anon key (in every browser) only reads. Writes go through the backend (postgres) or a SECURITY DEFINER function; `llm_config` is backend only (`/admin/llm-config`). Every table in `public` has RLS on: a new table enables it in its migration, adds a read policy only for what the frontend shows, and never grants anon/authenticated INSERT, UPDATE or DELETE. New tables get only SELECT for anon by default

## 📋 Project Overview

A proof-of-concept news aggregation system that demonstrates pluralistic news consumption through:
- **Multi-source ingestion** (NOS, NU.nl RSS feeds)
- **Event detection** using hybrid ML approach (embeddings + TF-IDF + entities)
- **Bias analysis** with LLM-powered insights
- **Interactive web interface** for exploring news events and viewpoints

## 📚 Essential Documentation

Always consult these canonical documents before starting any task:

| Document | Purpose | When to Reference |
| -------- | ------- | ---------------- |
| `docs/PRD.md` | Product scope, features, success metrics | Planning & feature decisions |
| `docs/architecture.md` | Tech stack, patterns, project structure | Implementation & design |
| `docs/context-events.md` | Event detection algorithm specification | ML/NLP work |
| `docs/stories/stories.md` | **Authoritative backlog** with ready-to-execute stories | Primary task source |

## 🛠 Current Technical Setup

### Backend (Python 3.11)
- **Framework**: FastAPI with Uvicorn
- **Database**: local PostgreSQL 17 (working database) + Supabase PostgreSQL (what the website shows), SQLAlchemy ORM (asyncpg driver)
- **Dependencies**: venv + pip with `requirements.txt`
- **ML Stack**: PyTorch 2.2.2 + sentence-transformers 2.7.0 + hnswlib + spaCy (fully operational)
- **Testing**: pytest with coverage target ≥80%
- **Deployment**: Runs locally (heavy ML models), writes to cloud database

### Frontend (Next.js 14)
- **Framework**: Next.js App Router
- **Styling**: Tailwind CSS 3.4
- **Components**: React 18 with TypeScript
- **Data Access**: Direct Supabase queries via `@supabase/supabase-js`
- **Testing**: Playwright for E2E tests
- **Deployment**: Vercel (auto-deploys from GitHub)

### Deployment Architecture
- **Backend**: Runs locally (to avoid 512MB memory limits for ML models)
- **Database**: local PostgreSQL 17 with everything; Supabase PostgreSQL (free tier, 500MB, 5.5 GB egress/month) with what the website shows
- **Frontend**: Vercel (free tier, auto-deploys from GitHub)
- **Data Flow**: Backend works on the local database → publishes changed rows to Supabase → Frontend reads from Supabase

### Development Tools
- **Build System**: Comprehensive Makefile with all dev targets
- **Linting**: ruff + black (Python), ESLint (JavaScript/TypeScript)
- **Environment**:
  - Backend: `.env` (DATABASE_URL = local Postgres, SUPABASE_DATABASE_URL, API keys)
  - Frontend: `frontend/.env.local` (Supabase credentials)
- **Utility scripts**: `/scripts/test_rss_feeds.py` voor snelle feedchecks; voeg nieuwe helpers in dezelfde map toe

## ⚙️ Quick Start Commands

```bash
# Setup everything
make setup              # Install both backend and frontend dependencies

# Development servers
make backend-dev        # Start backend on http://localhost:8000
make frontend-dev       # Start frontend on http://localhost:3000
make dev               # Start both servers

# Testing & Quality
make test              # Run backend tests
make lint              # Run linting for both backend and frontend
make validate          # Verify current setup is working

# Utilities
make help              # Show all available commands
make clean             # Clean up generated files
```

## 📝 Implementation Guidelines

### 1. Story-Driven Development
- **Primary source**: All tasks must originate from `docs/stories/stories.md`
- **Follow order**: Execute stories in sequence unless user reprioritizes
- **Complete checklists**: Each story has detailed subtask checkboxes to follow
- **Update status**: Mark subtasks as completed and fill in "Story Wrap Up" sections

### 2. Architecture Compliance
- **Module structure**: Follow the repository pattern and modular monolith layout
- **Path conventions**:
  - Backend: `backend/app/` (services, routers, models, core)
  - Frontend: `frontend/app/` and `frontend/components/`
  - Data: `data/` (exports, models, cache)
- **Provider abstraction**: Keep LLM clients, feed readers, vector indices behind adapters for easy swapping

### 3. Code Quality Standards
- **Python**: PEP 8 + type hints, ruff + black formatting, pytest coverage ≥80%
- **TypeScript**: Strict mode + ESLint/Prettier, Playwright for E2E tests
- **Logging**: Structured logging with structlog and correlation IDs
- **Error handling**: Consistent error response format per architecture

### 4. Testing Requirements
- **Unit tests**: For all business logic and services
- **Integration tests**: For API endpoints and database operations
- **E2E tests**: For critical user workflows
- **Coverage**: Maintain ≥80% coverage target
- **CI**: Ensure GitHub Actions stay green

## 🔧 Development Workflow

### Starting a Story
1. **Read the story** completely in `docs/stories/stories.md`
2. **Review references** in PRD, architecture, and context documents
3. **Check prerequisites** (dependencies, previous stories)
4. **Plan implementation** following the story's subtask checklist

### During Implementation
1. **Create branches** for significant features
2. **Follow TDD** where appropriate (write tests first)
3. **Test frequently** using `make validate`, `make test`, `make lint`
4. **Update documentation** when stories require it
5. **Respect module boundaries** defined in architecture

### Completing a Story
1. **Verify acceptance criteria** are all satisfied
2. **Run full test suite** (`make test`, `make lint`)
3. **Update story status** (mark subtasks complete, fill wrap-up section)
4. **Report to user** with story ID, completed ACs, test outcomes
5. **Note manual steps** user must perform (API keys, etc.)

## 🚨 Important Notes

### Current Status
- **Backend**: Fully functional with Python 3.11 + venv, runs locally on a local PostgreSQL 17 and publishes to Supabase (INFRA-2)
- **Frontend**: Next.js 14 deployed on Vercel with light theme UI (Pluriformiteit)
- **Database**: local PostgreSQL 17 for the backend; Supabase PostgreSQL (cloud) for the website, direct queries via Supabase JS client
- **ML Features**: Fully operational - PyTorch embeddings, vector search (hnswlib), spaCy NER
- **LLM Classification**: Mistral-based semantic event type classification (replaced keyword matching)
- **Clustering Performance**: 32.0% clustering rate (2.16x improvement from 14.78% baseline)
- **Event assignment** (2026-10-08): the LLM judges every candidate that may be the same news (embedding ≥ 0.70 and
  tf-idf ≥ 0.20, or the same people and places, or two shared title words), not only high scores, and its verdict
  decides. Articles are assigned one at a time. When the LLM cannot judge (session limit), the article waits as an
  orphan (while its news is younger than 20 h) instead of starting an event. A failed classification leaves the type
  unknown (asked again in the catch-up), never "other". `backend/app/services/event_service.py` (`LLM_ASK_*`,
  `merge_split_events`)
- **LLM Insights**: Auto-generation working with Mistral API, narrative summaries, frames, coverage gaps. The analysis reads at most 16 articles (`LLM_PROMPT_ARTICLE_CAP`, 8 until 2026-10-14; the newest of every outlet first) and every article's text up to 4,000 characters (`ARTICLE_TEXT_CHAR_LIMIT` in `backend/app/llm/prompt_builder.py`; until 2026-10-13 only the first three sentences, so later quotes and context counted as "missing"). A find of Zoek met AI (no text) counts with its digest; an article without text is left out instead of stopping the analysis
- **REST API**: Backend endpoints for admin/trigger functions
- **Event Detail**: Epic 14 "Eén beeld": "Wie zegt wat?" as one picture (outlets, the speakers they quote, missing voices, numbered findings) with tabs Klopt het? / Wie praat? / Wat ontbreekt? (missing voices, missing context, the debate) / Niet gevraagd (per outlet the questions it did not ask; Story 14.24) / Hoe gebracht? / Tijdlijn, plus "Wie zit erachter?" (propagandamodel). Readers can add their own answers (doubt, fallacy, contradiction, error, speaker, source, missing voice, question, remark, moment; `lib/explore/own.ts`, marked "jij", numbered after the analysis, stored on this device). They can share them with other readers and take over what others shared ("Van anderen", `lib/shared.ts`, migration 012). Nothing of others is in your picture until you take it over, and there is no AI: extra AI is admin only. No game mechanics. Spec: `docs/stories/active/epic-14-een-beeld.md`
- **Front page**: Story 14.19/14.21: the top story as a small "Wie zegt wat?" (per outlet the summary sentence that
  names it) plus "Klopt het?" (one claim without evidence, who makes it, the question to ask). Two more top stories
  follow, then the news per day. Under the start of the story every card has one hook. That is a small "Klopt het?"
  when someone with a name makes a claim, else the next part of the story: the first summary heading about the news,
  with its first sentence. The front page shows what is there, never what is missing ("Niet aan het woord" and
  questions not asked stay on the event page; `components/front/`, `lib/front-page.ts`).
  The lead is picked from the last 24 h, most Dutch outlets first.
  It only shows news with an article of a main source ("Hoofdbron" in Beheer; since 2026-10-07 NOS, RTL Nieuws,
  NU.nl, AD, De Telegraaf, Het Parool, de Volkskrant and Trouw), 120 per page sorted on `first_seen_at`; "Meer nieuws"
  loads the next page (`FEED_PAGE_SIZE`). Never sort the feed on `last_updated_at`: maintenance and re-analyses move it
- **LLM provider per step**: `llm_config` keys `provider_<step>` (event assignment, classification, factual, critical, digest, voice search, bias) via `backend/app/llm/providers.py`; never hard-wire a provider. Values: mistral, deepseek, deepseek-r1, gemini, `gemini-fast[:model]` (Gemini 3.5 Flash with minimal thinking, 1-3 s a call; `backend/app/llm/gemini_fast.py`) or `claude-code[:haiku|sonnet|opus]`, which runs the local Claude Code CLI (`claude -p`, the owner's subscription, no API key; `backend/app/llm/claude_code.py`, `CLAUDE_CODE_*`). Selectable on /admin/llm-config. Since 2026-10-04 every step runs on Claude Code (DeepSeek credit ran out); since 2026-10-14 every Claude Code step runs on Haiku, the analyses too (owner: Sonnet used too much of the subscription), and a bare `claude-code` means Haiku (`CLAUDE_CODE_MODEL`). At most `CLAUDE_CODE_MAX_PARALLEL` (2) calls run at once; a waiting call of the news pipeline (classification, event assignment) gets the next free slot before analyses, digests and the rest (`NEWS_PIPELINE_PRIORITY`): the analyses that every link starts held both slots while the poll waited (2026-10-08). Every call runs with `--effort medium` (`CLAUDE_CODE_EFFORT`, owner 2026-10-09; without it Sonnet ran on medium and Haiku probably on high)
- **Besluitvorming (Epic 15)**: the propaganda model holds decision-making in the same network (owner decision
  2026-10-07): five categories next to the filters (formele_macht, belangen, kennis_advies, polder, werving; after
  Domhoff), relation types ambt/zeggenschap/controle/geschenk, `bestuurslaag` on organisations and the office as the
  register gives it (`functie`). The registers (government organisations, Tweede Kamer, European Parliament,
  lobbyists) come in without AI; a deterministic registercheck in the model verifies them. The app gives each
  category its own colour and question (`FILTERS` in `lib/explore/labels.ts`, `group` media/besluitvorming), reads an
  office as "is secretaris-generaal bij" and explains both groups in "Over het propagandamodel". "Hoe hangen ze samen?"
  under "Wie zit erachter?" shows how parties of the same news hang together through decision-making (colleagues via a
  hub left out). Local office holders the register names with initials are linked by the research triage (surname +
  office + initial or place, never the name alone). Sync format 8 + migration 016. Spec:
  `docs/stories/active/epic-15-besluitvorming.md`
- **What matters, not what exists (Story 14.23, owner 2026-10-08)**: the pm blocks of an event show only links that
  matter for that news (`lib/explore/why.ts`).
  - Never a link without a source.
  - "Wie zit erachter?" shows who is behind an outlet, never who once had contact with it (Story 14.25, owner
    2026-10-14). That means a place in the outlet (a job, a column, a board seat, an office) or its money (owner,
    funder, an advertiser whose evidence names that outlet). It shows it directly, over a person who also belongs to
    the party (Ullah: hoofdredacteur De Telegraaf, once a VVD board member), or over the owner. A source, an expert,
    an interview, ANP copy or an attack is contact: every outlet has it. A column is a place; being asked as an
    expert is contact. Not shown: their own reporter named only by their own outlet, two newsroom jobs, and ties
    ended on both sides (`behindRoute`). With nothing left the block is gone.
  - "Hoe hangen ze samen?" skips a station that is one of many on both sides (a member, lobbyist or Kamerlid), and
    a direct tie that only says who someone is.
  - People who belong to both the party and the newsroom go first.
  - A verified structure fact needs one classified source to be "onderbouwd" (`certainty_label`); a claim of
    influence still needs two clusters.
  - Relations carry their origin (`origin`/`added_at`, sync format 9, migration 017).
  - The pm's own voice states what happened. An evaluation only appears as an attributed quote.
- **RSS Polling**: Automated every 15 minutes via APScheduler (backend). Only current news (owner 2026-10-08):
  feed items published more than 24 h ago are not fetched, and the catch-up of every poll takes only Dutch articles
  whose news is at most 24 h old (counted from publication; foreign articles are never enriched).
  `CURRENT_NEWS_HOURS` in `backend/app/services/ingest_service.py`
- **Insight Backfill**: Scheduled job every 30 minutes catches up on missing LLM insights

### Scheduled Jobs (APScheduler)

| Job | Interval | Description |
| --- | -------- | ----------- |
| RSS Feed Polling | 15 min | Polls all RSS feeds for new articles |
| Insight Backfill | 15 min | Generates LLM insights for events missing them, then redoes (≥ 30 min after the last one) analyses that leave out a Dutch outlet that joined later |
| International Enrichment | 2 hours | Adds international perspectives via Google News (Epic 9) |
| Event Maintenance | daily | Refreshes centroids, archives stale events, then clears working data of archived news (storage rule, see Rules). Every hour (first 5 min after the start) it checks whether the last run is 24 h ago; that moment is kept in `data/scheduler_state.json`, so restarts and a sleeping Mac do not reset it (a 24 h interval never ran from 2026-10-02 to 10-08). |
| Local Database Backup | hourly check | A `pg_dump` of the local working database when the newest one in `data/local-db/backups/` is a day old (it holds what Supabase does not; the age comes from the files, so restarts and a sleeping Mac do not skip it; 7 kept, `LOCAL_BACKUP_*`, INFRA-2) |
| Publish to Supabase | 10 s | Sends the rows of the local database that changed to Supabase, without the columns that stay local (INFRA-2, `PUBLISH_*`); nothing to send = no Supabase traffic |
| Bias Analysis | 6 hours | Per-sentence bias detection (Epic 10, disabled by default) |
| Exploration Refresh | 24 hours (na Event Maintenance) | Event Maintenance → daarna Exploration refresh (entiteiten + gerelateerde events, Epic 11) |
| Entity Research | 15 min | Wie is dit? (Epic 12): triage van namen in het nieuws (rol + belang), onderzoeksdoelen naar het propagandamodel en resultaten ophalen. De rondes van de pm-agent `nieuws-scout` plant het propagandamodel zelf (launchd, elke 2 uur, max 6/dag, 08–22); de nieuws-app start ze niet (sinds 2026-10-09 is die code weg) en toont in de status alleen wat de pm-runs melden. `ENTITY_RESEARCH_ENABLED`, `ENTITY_RESEARCH_*`; vereist migratie 006 + draaiende pm-server |
| Article Digest | 15 min | "Wat schreef …?": haalt de tekst van nieuwe buitenlandse artikelen op (Google News geeft alleen de kop) en laat de LLM een Nederlandse kern van hoogstens twee zinnen schrijven in `source_metadata.digest`; de tekst zelf wordt niet opgeslagen. Alleen artikelen van de laatste 72 uur, oudere via de admin-backfill (`ARTICLE_DIGEST_*`; provider: `llm_config.provider_digest`, anders die van de feitenanalyse) |
| Voice Search | 5 s | "Zoek met AI" (Epic 14, Story 14.10): runs the searches for missing voices the admin queued in the app (`voice_searches`, migration 009). Since INFRA-2 it looks in Supabase only after a signal of the website (`LISTEN voice_search`, migration 018) or every 5 minutes (`VOICE_SEARCH_FALLBACK_SECONDS`); an approval only stores the verdict in Supabase and the backend adds the article locally (`apply_reviews`). Gemini with Google Search finds and judges articles in one call (`llm_config.provider_voice_web`: `gemini-search[:model]`, or `google-news` for the old route; `GEMINI_API_KEY`). At the same time it searches own articles with an LLM check (`llm_config.provider_voice_search`: `gemini-fast`; when it fails, the provider of the factual analysis does the step). Only when Gemini fails: the same news on Google News, reading the pages ourselves. A copy of an article already in the news is never a find (same headline, an aggregator link ending in the outlet and a number like `headliner.nl/item/…-nieuwrechts-23375`, or the same text start; `is_copy`, 2026-10-13), and Gemini gets the headlines that are already there. Finds show as soon as they are there (first after about 5-10 s, done in about 15 s) and the admin can approve them right away; it becomes a source of the event (`VOICE_SEARCH_*`). Gemini's free tier allows 20 requests a day per model: Google search on 2.5 Flash, the check on 3.5 Flash. Whoever adds a missing voice first sees the voices already searched ("Al gezocht met AI", Story 14.22, migration 015): readers only what was approved, the admin everything |
| Propagandamodel Sync | 60 min | Synct het goedgekeurde propagandamodel (alleen-lezen) naar de `pm_*`-tabellen, alleen als het DB-bestand gewijzigd is (Epic 11, Story 11.17; `PROPAGANDA_SYNC_ENABLED`, `PROPAGANDA_SYNC_INTERVAL_MINUTES`, vereist migratie 005). Sinds format 5 ook de argumenten achter elke relatie (voor/tegen/nuance, status, bronnen) en de uitleg per mechanisme: vereist migratie 010 (Story 14.12). Sinds format 8 (Epic 15) ook de besluitvorming (`bestuurslaag`, `functie`, vijf categorieën): vereist migratie 016 |
| Evidence Research | 15 min | Dun bewijs (Story 14.13): verbanden onder "Wie zit erachter?" die op dun bewijs rusten (de eventpagina meldt ze aan via `request_relation_research`) gaan als onderzoeksdoel naar het propagandamodel (`nieuws_doelen`, soort `relatie`, max 6/dag) en de uitkomst komt terug (`relation_research`). De rondes van de pm-agent `nieuws-bewijs` (bewijs vóór én tegen) plant het propagandamodel zelf (launchd, elke 2 uur, max 3/dag = 6 verbanden, 08–22; de nieuws-app start ze niet); daarna beslist de automatische beoordeling van het propagandamodel, elk uur (bronzoeker, bronchecker, smaadtoets, aanklager, immuunpoort, bronklassen, opruimen; niemand beoordeelt met de hand). Elke cyclus meldt alle aangevraagde verbanden ook als voorrang (`POST /api/nieuws/voorrang`, zonder budget): het propagandamodel controleert hun bronnen eerst en zijn bronzoeker zoekt een bron waar die ontbreekt (agents doen alles, Story 14.17). `EVIDENCE_RESEARCH_*`; vereist migratie 011 |

**Note:** Bias Analysis is disabled by default to save LLM costs. Enable with `BIAS_ANALYSIS_SCHEDULER_ENABLED=true`.

**Note:** Exploration refresh draait direct na een geslaagde Event Maintenance (eigen timeout `EXPLORATION_REFRESH_TIMEOUT_SECONDS`) en na elke insight-generatie per event. Uitzetten met `EXPLORATION_ENABLED=false`. Vereist migratie `database/migrations/004_explore_entities_relations.sql`.

**Note (Epic 12 "Wie is dit?"):** namen in de nieuws-app zijn aantikbaar; ontbreekt een naam in het propagandamodel of heeft hij < 3 verbanden, dan zet de job "Entity Research" hem als onderzoeksdoel klaar in `~/Workspace/propaganda-model` (`POST /api/nieuws/doelen`, account `nieuws-agent`). Het onderzoek doet de pm-missie `nieuws-scout`, die het propagandamodel zelf inplant (agent-runner + LinkedIn-tool met snelheidsrem 2/uur, 10/dag); de pm-service `nieuws_autokeur_service.py` keurt alleen neutrale structuurfeiten met bron-URL automatisch goed (eigenaarsbesluit 2026-09-30, terug te draaien met `scripts/admin.py intrekken`). Privépersonen worden nooit onderzocht. Spec: `docs/stories/active/epic-12-wie-is-dit.md`.

**Note (Epic 13 "Waarom zo?"):** het propagandanetwerk toont verbanden *tussen* dingen in plaats van alles rond één knoop: RPC `pm_paths` (migratie `database/migrations/007_waarom_zo.sql`, zelfde regels als `frontend/lib/explore/pm-paths.ts`), vragen per filter (3 meest specifieke + bundel), "Verbind met beeld", "Zoek verband met…". Specifiek wint van "meeste verbanden".

Story 13.10:
- Wat een stap toevoegt is doorzichtig. Aantikken = houden; de rest gaat weg bij de volgende stap of met "Rest weg".
- Een vraag waarvan je niets houdt, wordt ingetrokken.
- Alle personen en organisaties van het nieuws staan in het netwerk; namen die niet in het model staan, zijn grijs
  gestippeld.
- Elke vraag kan per richting: "Invloed op X" / "Invloed van X". Dit vereist migratie `008_invloed_richting.sql`,
  met dezelfde regels als `influenceOf` in `frontend/lib/explore/pm-graph.ts`. Zonder die migratie zie je de vragen
  zonder richting.

Spec: `docs/stories/active/epic-13-waarom-zo.md`.

### LLM Prompts Updaten

De LLM prompts worden opgeslagen in de Supabase `llm_config` tabel. De lokale templates in `backend/app/llm/templates/` dienen als versiecontrole en referentie.

**BELANGRIJK: Houd database en lokale templates in sync!**
- Database = productie (wat de LLM daadwerkelijk gebruikt)
- Lokale templates = versiecontrole (voor git history en review)

**Beschikbare prompt keys:**
| Key | Bestand | Doel |
|-----|---------|------|
| `prompt_factual` | `factual_prompt.txt` | Fase 1: feitelijke analyse (summary, timeline, clusters) |
| `prompt_critical` | `critical_prompt.txt` | Fase 2: kritische analyse (frames, fallacies, authority) |
| `prompt_classification` | - | Artikel classificatie naar event type |

**Workflow bij prompt wijzigingen:**

1. **Wijzig BEIDE** - database én lokale template. De database gaat via de backend (die moet draaien): de
   publieke anon-sleutel mag sinds migratie 014 alleen lezen en ziet `llm_config` niet:
   ```bash
   # Update database (de backend leegt meteen zijn config-cache)
   PYTHONPATH=. python3.11 -c "
   import requests

   new_prompt = '''<NIEUWE PROMPT HIER>'''

   resp = requests.patch('http://localhost:8000/admin/llm-config/prompt_factual', json={'value': new_prompt})
   print(f'Database: {resp.status_code}')  # 200 = success
   "
   ```

2. **Update lokale template** - bewerk `backend/app/llm/templates/<bestand>.txt` met dezelfde wijzigingen

3. **Test de wijziging:**
   ```bash
   curl -X POST "http://localhost:8000/admin/trigger/generate-insights/{event_id}"
   ```

4. **Commit lokale template** - zodat wijzigingen in git history staan

**Huidige prompt ophalen uit database:**
```bash
PYTHONPATH=. python3.11 -c "
import requests
resp = requests.get('http://localhost:8000/admin/llm-config/prompt_factual')
print(resp.json()['value'])
"
```

### Admin Endpoints

```bash
# Trigger RSS polling manually
curl -X POST "http://localhost:8000/admin/trigger/poll-feeds"

# Assign enriched Dutch articles that are in no event (also runs, last 24 h only, in every poll cycle)
curl -X POST "http://localhost:8000/admin/trigger/assign-events?limit=200&max_age_hours=72"

# Catch-up as every poll does it (25 Dutch articles of the last 24 h), with a bigger batch: enrich + assign
# left-behind articles, newest first, then ask again the type of articles whose classification failed
curl -X POST "http://localhost:8000/admin/trigger/catch-up?limit=100"

# Merge news items of one Dutch article into the item with the same news (LLM verdict; dry_run=true only lists moves;
# older_than_hours=N skips the newest N hours, e.g. what an earlier run decided)
curl -X POST "http://localhost:8000/admin/trigger/merge-split-events?hours=72&limit=100&dry_run=true"

# Ask again the type of enriched Dutch articles whose classification failed (newest first)
curl -X POST "http://localhost:8000/admin/trigger/classify-pending?limit=50"

# Trigger insight backfill (default 10 events)
curl -X POST "http://localhost:8000/admin/trigger/backfill-insights"

# Trigger insight backfill with custom limit
curl -X POST "http://localhost:8000/admin/trigger/backfill-insights?limit=50"

# Generate insight for specific event
curl -X POST "http://localhost:8000/admin/trigger/generate-insights/{event_id}"

# Trigger event maintenance
curl -X POST "http://localhost:8000/admin/trigger/maintenance"

# International enrichment for specific event (Epic 9)
curl -X POST "http://localhost:8000/admin/trigger/enrich-international/{event_id}"

# Batch international enrichment (default 5 events)
curl -X POST "http://localhost:8000/admin/trigger/enrich-international-batch"

# Batch enrichment with custom limit
curl -X POST "http://localhost:8000/admin/trigger/enrich-international-batch?limit=10"

# Bias analysis for specific article (Epic 10)
curl -X POST "http://localhost:8000/admin/trigger/analyze-bias/{article_id}"

# Batch bias analysis (articles without analysis)
curl -X POST "http://localhost:8000/admin/trigger/analyze-bias-batch?limit=10"

# Exploration (Epic 11): recompute entities + related events for one event
curl -X POST "http://localhost:8000/admin/trigger/exploration/{event_id}"

# Exploration backfill, one page (repeat with offset=next_offset until done=true; force=true recomputes entities)
curl -X POST "http://localhost:8000/admin/trigger/exploration-backfill?limit=100&offset=0&include_archived=true"

# Exploration refresh for all active events (also runs after event maintenance)
curl -X POST "http://localhost:8000/admin/trigger/exploration-refresh"

# Exploration status (row counts, last runs, cache size)
curl "http://localhost:8000/admin/exploration/status"

# Propagandamodel sync (Epic 11, Story 11.17): only syncs when the pm database changed; force=true always syncs
# (returns 409 while the pm_* tables are not secured - run database/migrations/005_propagandamodel.sql first)
curl -X POST "http://localhost:8000/admin/trigger/propagandamodel-sync?force=false"

# Propagandamodel sync status (db path/mtime, synced version, row counts, last run)
curl "http://localhost:8000/admin/propagandamodel/status"

# Wie is dit? (Epic 12): one entity research cycle now (status, triage, queue, round)
curl -X POST "http://localhost:8000/admin/trigger/entity-research"

# Research one name now (ignores budgets/cooldown; private persons never): person:|org:|actor:<slug>
curl -X POST "http://localhost:8000/admin/trigger/entity-research/person:dilan-yesilgoz"

# Entity research status (queue counts, budgets, nieuws-scout rounds of the pm, LinkedIn brake, pm server)
curl "http://localhost:8000/admin/entity-research/status"

# Dun bewijs (Story 14.13): one evidence research cycle now (status, queue, priority)
curl -X POST "http://localhost:8000/admin/trigger/evidence-research"

# Queue one propaganda-model link for evidence research now (ignores budget and cooldown), e.g. PBL -> NOS
curl -X POST "http://localhost:8000/admin/trigger/evidence-research/1564"

# Evidence research status (queue counts, budget, nieuws-bewijs rounds of the pm, last runs)
curl "http://localhost:8000/admin/evidence-research/status"

# Wat schreef …?: Dutch gist of one foreign article now (fetch text + LLM, also when it has one)
curl -X POST "http://localhost:8000/admin/trigger/article-digest/{article_id}"

# Gist batch for foreign articles of active news without one (leave out max_age_hours = backfill all)
curl -X POST "http://localhost:8000/admin/trigger/article-digests?limit=50"

# Zoek met AI (Story 14.10): run the queued searches for missing voices now (the job does this every 5 s)
curl -X POST "http://localhost:8000/admin/trigger/voice-search?limit=2"
# Access codes for it (admin only for now): create / list / revoke; the code is printed once
PYTHONPATH=. .venv/bin/python scripts/access_code.py create --role admin --label Eigenaar

# Check scheduler status (includes exploration_last_run, propagandamodel_last_run and article_digest_last_run)
curl "http://localhost:8000/admin/scheduler/status"
```

### Public API Endpoints

```bash
# List all events
curl "http://localhost:8000/api/v1/events"

# Get event details (by ID or slug)
curl "http://localhost:8000/api/v1/events/{event_id}"
curl "http://localhost:8000/api/v1/events/{slug}"

# Get LLM insights for event
curl "http://localhost:8000/api/v1/insights/{event_id}"

# Get article bias analysis (Epic 10)
curl "http://localhost:8000/api/v1/articles/{article_id}/bias"

# Get event-level bias summary (Epic 10)
curl "http://localhost:8000/api/v1/events/{event_id}/bias-summary"
```

### What NOT to Do
- ❌ Don't install Poetry (project uses venv + pip)
- ❌ Don't upgrade Python beyond 3.11 (PyTorch compatibility)
- ❌ Don't create features outside the story backlog
- ❌ Don't skip testing requirements
- ❌ Don't commit secrets or API keys (especially Supabase credentials)
- ❌ Don't try to deploy backend to cloud (runs locally due to ML models)

### When to Ask for Help
- If story requirements conflict with current setup
- If you need credentials or external API access
- If tests are failing due to missing dependencies
- If architecture decisions need clarification

## 📁 Key File Locations

```
├── docs/
│   ├── PRD.md                    # Product requirements
│   ├── architecture.md          # Technical blueprint
│   ├── context-events.md         # Event detection spec
│   └── stories/stories.md        # **PRIMARY TASK SOURCE**
├── backend/
│   ├── app/                     # Main application code
│   └── tests/                   # Test suites
├── frontend/                    # Next.js application
├── scripts/                     # CLI helpers (RSS probe, smoke tests)
├── data/                        # Exports, models, cache
├── requirements.txt             # Python dependencies
├── .env.example                 # Environment template
├── Makefile                     # Development commands
└── CLAUDE.md                    # **THIS FILE**
```

## 🎯 Success Criteria

- Stories completed according to acceptance criteria
- Tests passing with ≥80% coverage
- Code follows architecture patterns and quality standards
- Documentation stays current with implemented features
- User can run `make setup` → `make dev` → functional application

---

**Remember**: This is a proof-of-concept demonstrating pluralistic news analysis. Focus on working functionality over optimization, but maintain good architecture for future scaling.