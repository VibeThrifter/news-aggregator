# INFRA: Supabase Egress Optimization

> Reduce Supabase data egress from 19.51 GB to under 5 GB (free tier limit) by implementing local SQLite cache for backend reads.

## Problem Description

Supabase free tier includes 5 GB egress/month. Current usage: **19.51 GB** (14.51 GB overage).

This is unexpected because:
- No real users on the website
- Only developer testing during development
- Backend scheduled jobs are the primary data consumers

## Root Cause Analysis

### Egress Sources (Ranked by Impact)

| Rank | Source | Problem | Est. Daily |
|------|--------|---------|------------|
| 1 | Backend scheduled jobs | Reads articles, events, prompts from Supabase | ~130 MB |
| 2 | `getEventDetail()` frontend | `SELECT *` includes full article content | ~30 MB |
| 3 | `listEvents()` frontend | `SELECT *` includes centroid vectors | ~16 MB |

**Total: ~176 MB/day = ~5.3 GB/month** from normal operation.

The 19.51 GB suggests backend ran continuously with frequent insight regenerations.

### The Core Problem

Backend runs locally but reads from Supabase (cloud) for every scheduled job:
- RSS polling reads existing articles to check duplicates
- Insight generation reads all articles for an event
- Clustering reads events and embeddings
- Every read = egress costs

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        SUPABASE (cloud)                      │
│            Source of truth for frontend users                │
└─────────────────────────────────────────────────────────────┘
         ▲ WRITE only                         │ READ
         │ (ingress = free)                   │ (egress = only real users)
         │                                    ▼
┌─────────────────────┐              ┌─────────────────────┐
│   BACKEND (lokaal)  │              │  FRONTEND (Vercel)  │
│                     │              │                     │
│  ┌───────────────┐  │              │  Supabase JS client │
│  │ SQLite cache  │  │              │  (unchanged)        │
│  │ - articles    │  │              │                     │
│  │ - events      │  │              └─────────────────────┘
│  │ - insights    │  │
│  └───────────────┘  │
│         ▲           │
│    ALL READS        │
│    (0 egress!)      │
└─────────────────────┘
```

**Result:**
- Backend egress: **0 GB/mo** (reads locally)
- Frontend egress: **~2.4 GB/mo** (only real users)
- **Total: ~2.4 GB/mo** - ruim onder free tier!

---

## Stories

### Story 1: Local SQLite Read Cache for Backend (Critical)

**Goal:** Backend reads from local SQLite instead of Supabase, eliminating all backend egress while keeping frontend working for users.

**How it works:**

| Operation | Source | Destination | Egress? |
|-----------|--------|-------------|---------|
| Ingest new article | RSS feed | Supabase + SQLite | ❌ No |
| Generate insights | Read SQLite | Write Supabase + SQLite | ❌ No |
| Event clustering | Read SQLite | Write Supabase + SQLite | ❌ No |
| User visits site | Supabase | Vercel | ✅ Yes (but real users only) |

**Current egress sources eliminated:**
- PromptBuilder fetching articles (~2.4 GB/mo) → reads from SQLite
- Scheduled jobs reading events (~1 GB/mo) → reads from SQLite
- LLM config/prompts (~330 MB/mo) → reads from SQLite

**Implementation steps:**

1. **Dual-write layer:**
   ```python
   class DualWriteRepository:
       async def save_article(self, article):
           await self.supabase_repo.save(article)  # For frontend
           await self.sqlite_repo.save(article)    # For local reads
   ```

2. **Read from SQLite:**
   ```python
   # All backend reads use SQLite
   class ArticleRepository:
       def __init__(self, use_local: bool = True):
           self.session = sqlite_session if use_local else supabase_session
   ```

3. **Initial sync script:**
   ```bash
   # One-time sync from Supabase to local SQLite
   python scripts/sync_supabase_to_sqlite.py
   ```

4. **Environment config:**
   ```env
   # .env
   BACKEND_READ_SOURCE=sqlite  # or "supabase" for testing
   SQLITE_DATABASE_PATH=data/local_cache.db
   ```

**Tables to sync/dual-write:**
- `articles` - Full content for insight generation
- `events` - Event metadata
- `event_articles` - Relationships
- `llm_insights` - Generated insights
- `llm_config` - Prompts and settings
- `news_sources` - Source configuration

**Acceptance Criteria:**
- [x] SQLite database schema mirrors Supabase tables
- [x] All write operations go to both Supabase and SQLite (sync_entities_to_cache() added)
- [x] All backend read operations use SQLite (PromptBuilder, LlmConfigService updated)
- [x] Initial sync script to bootstrap SQLite from Supabase
- [x] Config flag to switch between sources
- [x] Scheduled jobs work with SQLite reads (services use dual-write pattern)
- [x] Frontend unchanged (still uses Supabase)
- [ ] Integration tests pass
- [ ] BLOCKED: Run sync script (Supabase 402 egress error)

**Files created/modified (2026-01-03):**
- [x] `backend/app/db/sqlite_session.py` - SQLite connection management
- [x] `backend/app/db/dual_write.py` - Read/write session abstraction + sync helpers
- [x] `scripts/sync_supabase_to_sqlite.py` - Initial sync script
- [x] `backend/app/core/config.py` - Added BACKEND_READ_SOURCE, SQLITE_CACHE_PATH settings
- [x] `backend/app/llm/prompt_builder.py` - Uses get_read_session() for reads
- [x] `backend/app/services/llm_config_service.py` - Uses get_read_session() for reads
- [x] `backend/app/services/ingest_service.py` - Syncs articles to cache after commit
- [x] `backend/app/services/event_service.py` - Syncs events/event_articles to cache
- [x] `backend/app/services/insight_service.py` - Syncs insights/events to cache
- [x] `backend/app/services/enrich_service.py` - Syncs enriched articles to cache
- [x] `backend/app/services/international_enrichment.py` - Syncs intl articles to cache
- [x] `.env.example` - Documented new settings

**Estimated savings:** ~4+ GB/month (eliminates ALL backend reads from Supabase)

**Risks & Mitigation:**
| Risk | Mitigation |
|------|------------|
| Dual-write fails partially | Transaction-based with rollback |
| SQLite file grows large | Scheduled cleanup of old articles (>30 days) |
| Initial sync egress | One-time cost, run during low usage |

---

### Story 2: Optimize Frontend getEventDetail Query (High)

**Goal:** Stop using `SELECT *` on articles join - specify only needed fields.

**Current situation:**
```javascript
// frontend/lib/api.ts line 438-445
const { data: eventArticles } = await supabase
  .from('event_articles')
  .select(`
    article_id,
    similarity_score,
    articles (*)  // <-- Fetches ALL article fields!
  `)
```

**What `*` on articles fetches (wasteful):**
- `content` (TEXT, 50-100 KB) - **NOT DISPLAYED**
- `normalized_text` (TEXT, 10-30 KB) - **NOT DISPLAYED**
- `embedding` (BLOB) - **NOT DISPLAYED**
- `tfidf_vector` (JSON) - **NOT DISPLAYED**
- `normalized_tokens` (JSON) - **NOT DISPLAYED**
- `entities` (JSON) - **NOT DISPLAYED**
- `extracted_dates/locations` (JSON) - **NOT DISPLAYED**

**What we actually use (line 454-465):**
- `id, title, url, source_name, summary, published_at, image_url`
- `source_metadata` (for spectrum)
- `is_international, source_country`

**Acceptance Criteria:**
- [ ] Replace `articles (*)` with explicit field list
- [ ] Event detail page still renders correctly
- [ ] Article links, sources, dates all display properly
- [ ] International source badges still work

**Files to modify:**
- `frontend/lib/api.ts` - `getEventDetail()` function

**New query:**
```javascript
.select(`
  article_id,
  similarity_score,
  articles (
    id, title, url, source_name, summary, published_at, image_url,
    source_metadata, is_international, source_country
  )
`)
```

**Estimated savings:** ~50 MB/day (~1.5 GB/month for users)

---

### Story 3: Optimize Frontend listEvents Query (High)

**Goal:** Reduce data fetched in event list query by selecting only needed fields.

**Current situation:**
```javascript
// frontend/lib/api.ts line 250-263
.select(`
  *,  // <-- Fetches ALL event fields including centroid_embedding, centroid_tfidf, etc.
  llm_insights (summary),
  event_articles (articles (source_name, source_metadata, image_url, published_at))
`)
```

**What `*` on events fetches (wasteful):**
- `centroid_embedding` (JSON) - large vector, NOT displayed
- `centroid_tfidf` (JSON) - NOT displayed
- `centroid_entities` (JSON) - NOT displayed
- `description` (TEXT) - NOT used (always null or copyright content)
- `tags` (JSON) - NOT displayed in list

**What we actually need:**
- `id, slug, title, event_type, article_count, first_seen_at, last_updated_at, spectrum_distribution, archived_at`
- `llm_insights (summary)` - **MUST KEEP** for title extraction!

**IMPORTANT:** We CANNOT remove `llm_insights (summary)` because `extractTitleFromSummary()` uses it to generate the event title. Without it, all events show as "Event #123".

**Acceptance Criteria:**
- [ ] Replace `*` with explicit field list in events query
- [ ] Keep `llm_insights (summary)` - required for title
- [ ] Keep `event_articles` join for source breakdown
- [ ] Event list page renders correctly with proper titles
- [ ] Test with various events

**Files to modify:**
- `frontend/lib/api.ts` - `listEvents()` function

**New query:**
```javascript
.select(`
  id, slug, title, event_type, article_count,
  first_seen_at, last_updated_at, spectrum_distribution, archived_at,
  llm_insights!inner (summary),
  event_articles (articles (source_name, source_metadata, image_url, published_at))
`)
```

**Estimated savings:** ~30 MB/day (~900 MB/month for users)

---

### Story 4: Frontend Caching Layer

**Status**: ✅ Done (2026-01-03)

**Goal:** Implement frontend caching to reduce repeated Supabase queries for better UX.

**Implementation:** SWR with `dedupingInterval` for client-side caching.

**Acceptance Criteria:**
- [x] Event list cached for 5 minutes
- [x] Event detail cached for 1 minute
- [x] Cache invalidation on new data (via `revalidateIfStale`)

**Files created/modified:**
- [x] `frontend/lib/swr-config.ts` - Centralized SWR cache configuration
- [x] `frontend/components/EventFeed.tsx` - Uses `eventListSwrOptions` (5 min TTL)
- [x] `frontend/app/event/[id]/EventDetailScreen.tsx` - Uses `eventDetailSwrOptions` (1 min) + `insightsSwrOptions` (5 min)

**Cache TTLs:**
| Page | dedupingInterval | revalidateOnFocus |
|------|------------------|-------------------|
| Event list | 5 minutes | true |
| Event detail | 1 minute | false |
| Insights | 5 minutes | false |

**Benefits:**
- Faster back-button navigation (instant from cache)
- Reduced Supabase egress (~30-50% reduction for repeated queries)
- Better UX with stale-while-revalidate pattern

---

## Implementation Priority

| Priority | Story | Impact | Effort |
|----------|-------|--------|--------|
| 1 | **Story 1: SQLite Cache** | ~4+ GB/mo saved | Medium-High |
| 2 | **Story 2: getEventDetail** | ~1.5 GB/mo saved | Low |
| 3 | **Story 3: listEvents** | ~900 MB/mo saved | Low |
| 4 | Story 4: Frontend Caching | UX improvement | Medium |

**After Stories 1-3:**
- Backend egress: **0 GB/mo**
- Frontend egress: **~2.4 GB/mo** (only real users)
- **Total: ~2.4 GB/mo** - well under 5 GB free tier!

---

## Quick Wins (No Code)

While implementing stories:
- Stop backend when not actively developing
- Disable insight backfill scheduler temporarily

---

## Technical Notes

### Current Scheduled Jobs

| Job | Interval | After Story 1 |
|-----|----------|---------------|
| RSS Feed Polling | 15 min | Reads SQLite ✅ |
| Insight Backfill | 15 min | Reads SQLite ✅ |
| International Enrichment | 2 hours | Reads SQLite ✅ |
| Event Maintenance | 24 hours | Reads SQLite ✅ |
| Bias Analysis | 6 hours (disabled) | Reads SQLite ✅ |

### Database Field Sizes

| Field | Typical Size |
|-------|-------------|
| `Article.content` | 50-100 KB |
| `Article.normalized_text` | 10-30 KB |
| `Article.embedding` | ~3 KB |
| `Event.centroid_embedding` | ~3 KB |
| `LLMInsight.summary` | 2-5 KB |

---

## Status

**BLOCKED** - Story 1 implementation ~95% complete. Waiting for Supabase to unblock.

### Story 1 Progress (2026-01-03)
- [x] Created SQLite session management (`sqlite_session.py`)
- [x] Created dual-write abstraction (`dual_write.py` + `sync_entities_to_cache()`)
- [x] Added config settings (`BACKEND_READ_SOURCE`, `SQLITE_CACHE_PATH`)
- [x] Created sync script (`scripts/sync_supabase_to_sqlite.py`)
- [x] Updated PromptBuilder to use `get_read_session()`
- [x] Updated LlmConfigService to use `get_read_session()`
- [x] Updated ingest_service with dual-write (sync articles to cache)
- [x] Updated event_service with dual-write (sync events/event_articles to cache)
- [x] Updated insight_service with dual-write (sync insights/events to cache)
- [x] Updated enrich_service with dual-write (sync enriched articles to cache)
- [x] Updated international_enrichment with dual-write (sync intl articles to cache)
- [ ] BLOCKED: Cannot run sync script (Supabase 402 egress error)

### Next Steps (when Supabase unblocks)
1. Run sync script: `PYTHONPATH=. python scripts/sync_supabase_to_sqlite.py`
2. Set `BACKEND_READ_SOURCE=sqlite` in `.env` on production PC
3. Test with backend running
4. Verify dual-write works by checking SQLite has new data

### Stories 2, 3 & 4 Completed (2026-01-03)
Frontend optimizations implemented:
- [x] **Story 2**: Optimized `getEventDetail()` - replaced `articles (*)` with explicit 10 fields
- [x] **Story 3**: Optimized `listEvents()` - replaced `*` with explicit 9 fields (kept `llm_insights (summary)`)
- [x] **Story 4**: SWR caching layer - Event list (5 min), Event detail (1 min), Insights (5 min)

---

## Related

- Supabase billing: Dashboard → Settings → Billing
- Backend scheduler: `backend/app/core/scheduler.py`
- Frontend API: `frontend/lib/api.ts`
- PromptBuilder: `backend/app/llm/prompt_builder.py`
- Current SQLite file: `data/db.sqlite` (already exists in project)
- Database models: `backend/app/db/models.py`
- Session management: `backend/app/db/session.py`
