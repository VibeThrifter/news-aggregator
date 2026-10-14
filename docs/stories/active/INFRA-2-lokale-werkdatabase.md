# INFRA-2: Lokale werkdatabase, Supabase als etalage

## Overzicht

Supabase (free tier, 5,5 GB egress per maand) zette het project op 2026-10-12 stil: egress 20,18 GB van 5,5 GB
(Fair Use, na een verkorte grace period). In januari gebeurde hetzelfde (19,5 GB); de oplossing van toen
(INFRA-1: een SQLite-leescache) is nooit aangezet.

Eigenaarsvraag (2026-10-13): "Opslag op zo een manier doen dat meer lokaal wordt opgeslagen en op supabase alleen
wat je daadwerkelijk nodig hebt op de front end?" Plan goedgekeurd dezelfde dag.

### Wat het verkeer veroorzaakte (gemeten 2026-10-13)

Vrijwel alles kwam van de eigen backend op de Mac, die alles uit Supabase las. De website leest per bezoek
30-400 kB.

| Wat de backend las | Per keer | Per dag |
|---|---|---|
| tf-idf opnieuw fitten: alle `normalized_text` (bij elke poll, per feed) | 15 MB | 3-6 GB |
| vectorindex: alle actieve events met alle kolommen (na elke service-reset) | 27 MB | 1-2 GB |
| koppelen, analyses, "Wie is dit?", onderhoud samen | | 1-3 GB |

### De opzet

```
  Mac (backend)                                 Supabase                    Vercel
  ┌────────────────────────┐   alleen wat     ┌──────────────────┐  leest  ┌──────────┐
  │ Postgres 17 (lokaal)   │   veranderde,    │ wat de website   │ ◀────── │ website  │
  │ alles: tekst, vectoren,│ ───────────────▶ │ toont            │         └──────────┘
  │ centroids, ruwe LLM,   │   elke 10 s      │ + wat de website │
  │ prompts, onderzoek     │   (schrijven =   │ zelf schrijft    │
  └────────────────────────┘   geen egress)   └──────────────────┘
              ▲  verzoeken + seintjes (LISTEN), klein                 │
              └───────────────────────────────────────────────────────┘
```

- **Lokaal (`DATABASE_URL`):** Postgres 17.11, dezelfde hoofdversie als Supabase, met alles. De backend leest en
  schrijft alleen hier; de code is dezelfde (zelfde SQL). Homebrew kon niet installeren (`/usr/local/share/man/man8`
  is van root), dus conda-forge via `micromamba`, zonder sudo:
  - programma's: `~/.local/share/news-aggregator/postgres17/bin` (micromamba: `~/.local/bin/micromamba`)
  - data: `~/.local/share/news-aggregator/pg17-data` (UTF-8, ICU en-US zoals Supabase; `timezone = 'UTC'` en
    `default_text_search_config = 'pg_catalog.english'` zoals Supabase)
  - service: LaunchAgent `~/Library/LaunchAgents/nl.newsaggregator.postgres17.plist` (start bij inloggen, herstart
    bij een crash; log `~/.local/share/news-aggregator/postgres17.log`)
  - gebruiker `macbook`, wachtwoord in `.env` en `~/.local/share/news-aggregator/.pgpass-macbook`; host `127.0.0.1`
    (niet `localhost`: in DarkWake van een slapende Mac faalt zelfs het opzoeken van `localhost`, 2026-10-14)
- **Doorzetten (`backend/app/services/publish_service.py`):** een trigger op elke gepubliceerde tabel noteert elke
  wijziging in `publish_queue`. Elke 10 s neemt de publisher die (in dezelfde lokale transactie die vastlegt wat
  gepubliceerd is), vergelijkt per rij een md5 van de gepubliceerde kolommen met wat hij eerder stuurde
  (`publish_state`) en stuurt alleen wat veranderde: eerst verwijderen (kinderen eerst), dan invoegen/bijwerken
  (ouders eerst). Een rij die Supabase weigert blijft in de wachtrij.
- **Wat lokaal blijft** (`skip` in `PUBLISHED_TABLES`): `normalized_text`, `normalized_tokens`, `embedding`,
  `tfidf_vector`, `entities`, `extracted_dates/locations` (articles); `description` en de centroids (events);
  `raw_response` en `prompt_metadata` (llm_insights, bias); `summary` en `prominence` (onderzoek); `llm_config`.
- **Wat in Supabase blijft:** alles wat de website toont, ook de artikeltekst: "Zoek in alle artikelen"
  (`search_articles`) doorzoekt titel, intro en tekst.
- **Wat de website zelf schrijft** staat alleen in Supabase (`WEBSITE_TABLES`): `voice_searches`, `access_codes`,
  `shared_entries*`; de lokale database heeft er geen kopie van, zodat een vergissing hard faalt. De
  onderzoeksverzoeken (`request_entity_research`, `request_relation_research`) schrijven daar ook; elke
  onderzoeksronde haalt de nieuwere verzoeken op (`backend/app/services/website_requests.py`, watermerk in
  `website_pulls`). De publisher overschrijft die verzoekkolommen nooit (`website` in `PUBLISHED_TABLES`).
- **Zoek met AI:** de backend luistert (`LISTEN voice_search`, `SupabaseListener`) in plaats van elke 5 s de
  wachtrij te lezen; daarnaast kijkt hij elke 5 minuten (een gemist seintje). Goedkeuren noteert in Supabase alleen
  het oordeel (migratie 018); de backend maakt het artikel en de koppeling lokaal (`apply_reviews`) en noteert het
  artikel in de vondst (`article_id`). De app wacht daar tot 15 s op en laadt dan het nieuws opnieuw.
- **Back-up:** eens per dag een `pg_dump` van de lokale database naar `data/local-db/backups/` (7 bewaard): de job
  kijkt elk uur of de nieuwste back-up een dag oud is (eerst na Event Maintenance; dat liet tests een echte dump
  maken, 2026-10-14).
- **Zonder `SUPABASE_DATABASE_URL`** werkt alles als vroeger: één database, geen publisher.

## Story INFRA-2.1: Lokale werkdatabase en publisher

**Status:** omgezet 2026-10-13 21:44 UTC; werkdata uit Supabase 2026-10-14.

- [x] Momentopname van Supabase (alle tabellen, één consistente snapshot): `scripts/local_db.py snapshot`
  (2026-10-13 17:54 UTC, 359 MB, `data/local-db/snapshot-20261013T175439Z/`)
- [x] Publisher met wachtrij, triggers, md5-vergelijking, volgorde, weigeringen, TRUNCATE, nieuwe kolommen
  (`publish_service.py`; tests `backend/tests/integration/test_publish_service.py` op echte Postgres)
- [x] Verzoeken van de website ophalen (`website_requests.py`; `test_website_requests.py`)
- [x] Zoek met AI: luisteren, goedkeuren lokaal (`voice_search.py`, `db/supabase.py`; `test_voice_reviews.py`)
- [x] Migratie 018 (Supabase): `review_voice_candidate` alleen het oordeel, beide functies geven een seintje.
  Gedraaid 2026-10-13.
- [x] Dagelijkse lokale back-up (`services/local_backup.py`)
- [x] Oude SQLite-cache (INFRA-1) weg: `dual_write.py`, `sqlite_session.py`, `sync_supabase_to_sqlite.py`,
  `BACKEND_READ_SOURCE`. `PromptBuilder` gebruikt weer de sessie die hij krijgt (de tests faalden daardoor).
- [x] Postgres 17 (conda-forge via micromamba, zie boven; LaunchAgent)
- [x] `scripts/local_db.py schema`, `restore <snapshot>`, `verify <snapshot>`, `compare` (md5 van de gepubliceerde
  kolommen per tabel, lokaal = Supabase voor alle 17 tabellen), `init-publish` (248.852 rijen als gepubliceerd)
- [x] `.env`: `DATABASE_URL` lokaal, `SUPABASE_DATABASE_URL` = de pooler-URL; backend gestart
- [x] Meten in Supabase (`pg_stat_statements`): zie wrap-up
- [x] `scripts/local_db.py prune-supabase --apply`: werkdata in Supabase leeg + VACUUM FULL per tabel

### Omzetten (volgorde)

1. Postgres 17: `micromamba create -p ~/.local/share/news-aggregator/postgres17 -c conda-forge postgresql=17`,
   `initdb --locale-provider=icu --icu-locale=en-US -E UTF8`, de instellingen van hierboven, de LaunchAgent
   (of, als Homebrew mag schrijven: `brew install postgresql@17`)
2. `PYTHONPATH=. .venv/bin/python scripts/local_db.py schema` (pg_dump --schema-only; klein)
3. `... scripts/local_db.py restore data/local-db/snapshot-20261013T175439Z`
4. `... scripts/local_db.py verify data/local-db/snapshot-20261013T175439Z` en `compare`: snapshot = lokaal = Supabase. Verschilt
   Supabase, dan schreef de website sinds de snapshot iets in een gepubliceerde tabel: eerst uitzoeken.
5. `... scripts/local_db.py init-publish`: triggers, en elke rij telt als gepubliceerd (alleen nu: Supabase houdt
   wat de snapshot houdt).
6. `.env`: `DATABASE_URL=postgresql+asyncpg://localhost:5432/news_aggregator`,
   `SUPABASE_DATABASE_URL=<de oude DATABASE_URL>`; backend starten; `/admin/scheduler/status` → `storage`.
7. Na een dag meten; dan `prune-supabase` (eerst zonder `--apply`).

## Story INFRA-2.2: Wat de backend leest en schrijft efficiënter maken (later, niet nodig voor egress)

- Lokaal kost lezen geen egress, wel tijd: de tf-idf-fit laadt bij elke poll het hele corpus en de vectorindex
  herlaadt alle actieve events na elke service-reset.
- De verkenning vervangt de verwante events van een event door nieuwe rijen (nieuwe id's): na het onderhoud van
  2026-10-13 gingen zo ~45.000 rijen `event_relations` weg en weer terug naar Supabase. Schrijven kost geen egress,
  maar het laat dode rijen achter (autovacuum ruimt ze op). Bijwerken op (event_id, related_event_id) met behoud van
  id zou alleen de echte wijzigingen sturen.

## Wrap-up

- **Omzetten (2026-10-13):** snapshot 17:54 UTC (359 MB, één transactie), migratie 018 in Supabase, schema met
  pg_dump 17, restore, `verify` (aantallen gelijk) en `compare` (inhoud gelijk), `init-publish`, `.env` om, backend
  gestart 21:45 UTC. Eerste doorzetting: 31 artikelen, niets geweigerd.
- **Egress daarna (pg_stat_statements, 21:46-07:45 UTC):** de backend las 426 rijen uit Supabase (kolomlijsten,
  types, onderzoeksverzoeken), tegen gigabytes per dag ervoor. Schrijven: tienduizenden rijen (geen egress).
- **Zoek met AI:** een afwijzing in Supabase (zoekopdracht 5) kwam als seintje binnen; de backend haalde de koppeling
  en het artikel lokaal weg en de publisher in Supabase (event 8786 nu 16 artikelen).
- **Opschonen (2026-10-14):** Supabase van 381 naar 248 MB (articles 107 → 63 MB, events 64 → 3 MB, llm_insights
  69 → 57 MB, entity_research 10 → 2 MB; llm_config leeg).
- **Lessen:**
  - Een andere sessie schreef met `DATABASE_URL` naar wat ze voor Supabase hield en kwam lokaal uit; daarom staan de
    websitetabellen niet meer lokaal.
  - Bij het herstarten deadlockte `ensure_local_schema` (alle triggers opnieuw) met het nog stoppende oude
    proces; nu maakt het alleen ontbrekende triggers, per tabel met `lock_timeout`, en faalt de start er niet door.
  - De publish-job werd overgeslagen als een poll de event loop vasthield (APScheduler-grace 1 s); nu
    `misfire_grace_time=None`.
- **Tests:** `backend/tests/integration/test_publish_service.py`, `test_website_requests.py`,
  `test_voice_reviews.py` (echte Postgres via `TEST_POSTGRES_URL`); unit-tests van voice search en de prompt builder
  (die faalden al sinds INFRA-1).
