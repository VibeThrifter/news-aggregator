# News Pluriformity POC

Deze proof-of-concept demonstreert hoe een event-gedreven nieuwsscraper Nederlandse bronnen kan groeperen op basis van standpunten en spectrum. Het project bevat een statische dataset rond het boerenprotest en illustreert hoe clustering, LLM-ondersteunde samenvatting en een webinterface samenkomen.

## Installatie en gebruik

### Snelle setup (aanbevolen)

```bash
# Installeer Python 3.12 en Node.js 20+ als deze nog niet beschikbaar zijn
make check-deps

# Installeer alle dependencies (backend + frontend)
make setup

# Start development servers
make dev    # Backend: http://localhost:8000, Frontend: http://localhost:3000
```

### Handmatige setup

1. **Backend (Python 3.12):**
   ```bash
   # Maak virtual environment
   python3.12 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Frontend (Node.js 20+):**
   ```bash
   cd frontend && npm install
   ```

3. **Configuratie:**
   ```bash
   cp .env.example .env  # zorg ervoor dat dit bestand niet wordt gecommit
   ```
   Het voorbeeldbestand bevat alle variabelen die de backend verwacht (RSS-feeds, scheduler-interval, databasepad, LLM-provider). Voeg minimaal je `MISTRAL_API_KEY` toe voor live LLM-samenvattingen.
   Nieuwe parameters voor de event-detectielaag:
   - `VECTOR_INDEX_PATH` en `VECTOR_INDEX_METADATA_PATH` bepalen waar de hnswlib-index op schijf staat.
   - `VECTOR_INDEX_MAX_ELEMENTS`, `VECTOR_INDEX_M`, `VECTOR_INDEX_EF_CONSTRUCTION` en `VECTOR_INDEX_EF_SEARCH` tunen respectievelijk capaciteit en recall/latency van de ANN-index.
   - `EVENT_CANDIDATE_TOP_K` en `EVENT_CANDIDATE_TIME_WINDOW_DAYS` sturen de recency-filter tijdens kandidaatselectie.
   - `EVENT_SCORE_WEIGHT_*`, `EVENT_SCORE_THRESHOLD`, `EVENT_SCORE_TIME_DECAY_HALF_LIFE_HOURS` en `EVENT_SCORE_TIME_DECAY_FLOOR` bepalen hoe streng de hybride score een artikel koppelt aan een event of een nieuw event start.
   - `EVENT_RETENTION_DAYS`, `EVENT_MAINTENANCE_INTERVAL_HOURS` en `EVENT_INDEX_REBUILD_ON_DRIFT` controleren het onderhoudsproces (archiveren van oude events, frequentie van onderhoud en automatische herbouw van de vectorindex bij drift).

   De APScheduler plant nu twee achtergrondtaken: `poll_rss_feeds` voor ingest en `event_maintenance` (standaard elke 24 uur) voor centroid-herberekening, archivering en indexherstel. Pas de intervallen aan via de bovenstaande variabelen.

   Download daarna het spaCy-model voor Nederlandse NER:
   ```bash
   source .venv/bin/activate && python -m spacy download nl_core_news_lg
   ```

   Raadpleeg [docs/architecture.md](docs/architecture.md) voor aanvullende setup instructies.

4. **Start servers:**
   ```bash
   # Backend only
   make backend-dev    # of: source .venv/bin/activate && uvicorn src.web.app:app --reload

   # Frontend only
   make frontend-dev   # of: cd frontend && npm run dev
   ```

### Beschikbare commando's

Gebruik `make help` voor alle beschikbare targets. Belangrijkste commando's:

```bash
make setup          # Installeer alle dependencies
make dev           # Start beide servers
make test          # Run tests
make lint          # Run linting
make validate      # Controleer setup
make clean         # Cleanup gegenereerde bestanden
```
### Handige scripts

Alle losse hulpscripts staan in `/scripts/`. Gebruik bijvoorbeeld `test_rss_feeds.py` om snel te controleren of de RSS-readers antwoord geven:

```bash
# Test alle readers en toon de eerste vijf items
python scripts/test_rss_feeds.py --limit 5

# Beperk tot de NOS-feed en print de summary mee
python scripts/test_rss_feeds.py --reader nos_rss --show-summary

# Toon ook de volledige (geëxtraheerde) artikeltekst, max 1200 tekens
python scripts/test_rss_feeds.py --reader nos_rss --show-content --content-limit 1200
```

Voor bronnen met consent/cookie walls kun je automatisch cookies opslaan via:

```bash
python scripts/refresh_cookies.py --source nunl_rss
```

Het script leest de feed-URL's uit je `.env` en schrijft niets weg naar de database; het is puur bedoeld als connectiviteitstest.

> ℹ️ Consentprofielen beheer je via `source_profiles.yaml`. Zie docs/architecture.md voor configuratie en het cookie-refresh script.

4. Navigeer naar http://127.0.0.1:8000 en voer een zoekterm in (bv. "boerenprotest"). Kies optioneel om te clusteren via KMeans (algoritmisch) of per mediumtype via de radiobuttons. Met een valide Mistral-sleutel genereert de UI per cluster een naam en beschrijving op basis van de artikelen.
   Voor cli-output:
   ```bash
   python main.py "boerenprotest"
   python main.py "boerenprotest" --mode medium
   ```
   Test je sleutel snel met een curl-call:
   ```bash
   curl https://api.mistral.ai/v1/chat/completions \
     -H "Authorization: Bearer $MISTRAL_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"Hallo Mistral"}]}'
   ```

Wanneer geen verbinding met de Mistral API mogelijk is, laat de `ClusterSummarizer` een melding zien dat een Mistral-sleutel nodig is voor de inhoudelijke clusterbeschrijving.

## Hoe het werkt

- `data/sample_articles.py` levert handverzamelde voorbeelden uit mainstream, sociale en alternatieve Nederlandse media.
- `src/services/fetchers.py` filtert artikelen op query.
- `src/services/clustering.py` gebruikt TF-IDF + KMeans (of valt terug op spectrum-clustering) en combineert met bronmetadata voor pluriformiteit. Via de `mode`-parameter kun je ook groeperen op mediumtype.
- `src/services/llm.py` en `src/services/summarizer.py` praten met de Mistral Chat API via het REST-endpoint (mits `MISTRAL_API_KEY` bekend) om een label + beschrijving te genereren per cluster. Zonder API-sleutel valt het systeem terug op heuristische naamgeving.
- `src/web/app.py` rendert clusters met bronverwijzingen, badges voor spectrum en medium en een woordwolk onderaan iedere kaart voor snelle terminologie-scanning.

## Voorstel scrapingstrategie

Voor een volwaardige aggregator:

- **Mainstream media**: gebruik RSS-feeds (NRC, NOS, De Volkskrant) en HTML-parsing via `feedparser` + `newspaper3k` of `readability-lxml` met attente user-agent en throttling.
- **Alternatieve media**: veel sites bieden WordPress-RSS (`/feed/`) of JSON-endpoints; hanteer per domeinrate-limieten en detecteer paywalls actief.
- **Sociale bronnen (X)**: combineer de officiële API (Academic of Elevated tiers) met third-party toolkits zoals `snscrape` waar toegestaan; cache resultaten en respecteer terms of service.
- **Deduplicatie**: normaliseer titels, remove tracking parameters met `urlextract`, gebruik hashing op artikeltekst.
- **Opslag**: schrijf ruwe artikelen naar object storage (S3/MinIO) plus een querybare store (Postgres/Elastic) voor snelle filter.
- **LLM-integratie**: genereer embeddings met OpenAI `text-embedding-3-large` of open-source modellen (e5-large) en cluster via HDBSCAN; gebruik LLM voor clusterbeschrijvingen en bias-detectie rapportage.

Breid de dataset uit met live scraping jobs onder `scripts/` en automatiseer met een scheduler (APScheduler, Prefect of Airflow) zodra de feeds zijn vastgesteld.

## News360 Tavily + ChatGPT stack

Naast de statische demo bevat de repo nu een moderne Tavily + ChatGPT flow:

### Backend (FastAPI)

1. Activeer je virtuele omgeving en installeer afhankelijkheden (zelfde `requirements.txt`).
2. Vul in `.env` in elk geval `OPENAI_API_KEY` en `TAVILY_API_KEY`.
3. Start de API:
   ```bash
   uvicorn backend.app.main:app --reload
   ```
4. Probeer de healthcheck: `curl http://127.0.0.1:8000/health`.
5. Query uitvoeren:
   ```bash
   curl -X POST http://127.0.0.1:8000/api/news360 \
     -H "Content-Type: application/json" \
     -d '{"query": "anti-immigratie demonstratie Malieveld 20 september 2025"}'
   ```

   De orchestrator roept Tavily aan, extraheert content via Trafilatura en stuurt een JSON-prompt naar OpenAI. Als OpenAI niet beschikbaar is of quota-issues geeft, schakelt de backend automatisch over op Mistral (mits `MISTRAL_API_KEY` gezet). Je ontvangt een `timeline`, `clusters` en `contradictions` payload.

### Frontend (Next.js 14 + Tailwind + Framer Motion)

1. Ga naar `frontend/` en installeer packages:
   ```bash
   cd frontend
   npm install
   ```
2. Start de dev-server (zorg dat backend draait, standaard op poort 8000):
   ```bash
   npm run dev
   ```
3. Stel optioneel `NEXT_PUBLIC_API_BASE_URL` in (default `http://localhost:8000`).
4. Open http://localhost:3000 voor een glassmorphism interface met animaties, tijdlijn, clusters en tegenstrijdigheden.

Het frontend spreekt direct de FastAPI-route aan en rendert de JSON als kaarten met een flashy gradient-achtergrond.
