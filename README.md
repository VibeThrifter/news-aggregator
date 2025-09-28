# News Pluriformity POC

Deze proof-of-concept demonstreert hoe een event-gedreven nieuwsscraper Nederlandse bronnen kan groeperen op basis van standpunten en spectrum. Het project bevat een statische dataset rond het boerenprotest en illustreert hoe clustering, LLM-ondersteunde samenvatting en een webinterface samenkomen.

## Installatie en gebruik

1. Python 3.11 aanbevolen. Installeer dependencies:
   ```bash
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. Kopieer `.env.example` naar `.env` en vul de placeholders in:
   ```bash
   cp .env.example .env  # zorg ervoor dat dit bestand niet wordt gecommit
   ```
   Het voorbeeldbestand bevat alle variabelen die de backend verwacht (RSS-feeds, scheduler-interval, databasepad, LLM-provider). Voeg minimaal je `MISTRAL_API_KEY` toe voor live LLM-samenvattingen en pas optioneel de feed-URL's of logging aan.
   Raadpleeg [docs/architecture.md](docs/architecture.md) (sectie *Initial Project Setup*) voor aanvullende instructies en aanbevolen waarden.
3. Start de webinterface:
   ```bash
   uvicorn src.web.app:app --reload
   ```
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
