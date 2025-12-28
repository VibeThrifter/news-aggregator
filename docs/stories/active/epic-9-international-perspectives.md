# Epic 9: Internationale Perspectieven via Google News

## Overzicht

Automatisch internationale nieuwsbronnen toevoegen aan events op basis van de betrokken landen. Wanneer een artikel gaat over Israel, Rusland of China, worden automatisch relevante artikelen uit media van die landen opgehaald via Google News RSS (gratis, onbeperkt).

## Achtergrond

Nederlandse media bieden slechts één perspectief op internationale gebeurtenissen. Voor een echt pluralistisch beeld moeten we ook bronnen uit de betrokken landen zelf tonen. Dit geeft gebruikers inzicht in hoe verschillende landen dezelfde gebeurtenis framen.

**Voorbeeld**: Bij een artikel over "Israel erkent Somaliland":
- 🇳🇱 NOS/NU.nl: Nederlandse framing
- 🇮🇱 Haaretz/Times of Israel: Israelische perspectieven
- 🇸🇴 Somalische media: Lokale reacties
- 🇪🇬 Al-Ahram: Arabische kijk

## Technische Aanpak

**Gratis oplossing**: Google News RSS feeds met land/taal parameters

```
https://news.google.com/rss/search?q={keywords}&gl={country}&hl={lang}&ceid={country}:{lang}
```

Dit is volledig gratis en onbeperkt (geen API key nodig).

---

## Story 9.1: Country Mapping & LLM Detection

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Small

### Beschrijving
Land-detectie is geïntegreerd in de bestaande LLM insight-generatie. De factual prompt vraagt nu ook om betrokken landen te identificeren. Een `CountryMapper` service mapt ISO-codes naar Google News parameters.

### Country Mapping Bestand

```yaml
# backend/app/data/country_mapping.yaml
countries:
  israel:
    name: "Israel"
    iso_code: "IL"
    google_news:
      primary: { gl: "IL", hl: "en", ceid: "IL:en" }      # Engels uit Israel
      native: { gl: "IL", hl: "iw", ceid: "IL:iw" }       # Hebreeuws
    aliases:
      - "israël"
      - "israeli"
      - "israëlisch"
      - "tel aviv"
      - "jerusalem"
      - "netanyahu"
      - "idf"

  palestine:
    name: "Palestine"
    iso_code: "PS"
    google_news:
      primary: { gl: "PS", hl: "ar", ceid: "PS:ar" }      # Arabisch
    aliases:
      - "palestina"
      - "palestinian"
      - "palestijns"
      - "gaza"
      - "west bank"
      - "westelijke jordaanoever"
      - "hamas"

  russia:
    name: "Russia"
    iso_code: "RU"
    google_news:
      primary: { gl: "RU", hl: "en", ceid: "RU:en" }      # Engels uit Rusland
      native: { gl: "RU", hl: "ru", ceid: "RU:ru" }       # Russisch
    aliases:
      - "rusland"
      - "russian"
      - "russisch"
      - "moscow"
      - "moskou"
      - "kremlin"
      - "putin"

  ukraine:
    name: "Ukraine"
    iso_code: "UA"
    google_news:
      primary: { gl: "UA", hl: "en", ceid: "UA:en" }
      native: { gl: "UA", hl: "uk", ceid: "UA:uk" }
    aliases:
      - "oekraïne"
      - "ukrainian"
      - "oekraïens"
      - "kiev"
      - "kyiv"
      - "zelensky"

  china:
    name: "China"
    iso_code: "CN"
    google_news:
      primary: { gl: "HK", hl: "en", ceid: "HK:en" }      # Hong Kong Engels (CN geblokkeerd)
    aliases:
      - "chinese"
      - "chinees"
      - "beijing"
      - "peking"
      - "xi jinping"

  united_states:
    name: "United States"
    iso_code: "US"
    google_news:
      primary: { gl: "US", hl: "en", ceid: "US:en" }
    aliases:
      - "amerika"
      - "american"
      - "amerikaans"
      - "washington"
      - "white house"
      - "witte huis"
      - "trump"
      - "biden"

  united_kingdom:
    name: "United Kingdom"
    iso_code: "GB"
    google_news:
      primary: { gl: "GB", hl: "en", ceid: "GB:en" }
    aliases:
      - "engeland"
      - "british"
      - "brits"
      - "london"
      - "londen"
      - "downing street"

  germany:
    name: "Germany"
    iso_code: "DE"
    google_news:
      primary: { gl: "DE", hl: "en", ceid: "DE:en" }
      native: { gl: "DE", hl: "de", ceid: "DE:de" }
    aliases:
      - "duitsland"
      - "german"
      - "duits"
      - "berlin"
      - "berlijn"
      - "scholz"
      - "merkel"

  france:
    name: "France"
    iso_code: "FR"
    google_news:
      primary: { gl: "FR", hl: "en", ceid: "FR:en" }
      native: { gl: "FR", hl: "fr", ceid: "FR:fr" }
    aliases:
      - "frankrijk"
      - "french"
      - "frans"
      - "paris"
      - "parijs"
      - "macron"
      - "élysée"

  iran:
    name: "Iran"
    iso_code: "IR"
    google_news:
      primary: { gl: "IR", hl: "en", ceid: "IR:en" }
    aliases:
      - "iranian"
      - "iraans"
      - "tehran"
      - "teheran"
      - "khamenei"

  saudi_arabia:
    name: "Saudi Arabia"
    iso_code: "SA"
    google_news:
      primary: { gl: "SA", hl: "en", ceid: "SA:en" }
      native: { gl: "SA", hl: "ar", ceid: "SA:ar" }
    aliases:
      - "saoedi-arabië"
      - "saudi"
      - "saoedisch"
      - "riyadh"
      - "riyad"
      - "mbs"
      - "bin salman"

  turkey:
    name: "Turkey"
    iso_code: "TR"
    google_news:
      primary: { gl: "TR", hl: "en", ceid: "TR:en" }
      native: { gl: "TR", hl: "tr", ceid: "TR:tr" }
    aliases:
      - "turkije"
      - "turkish"
      - "turks"
      - "ankara"
      - "istanbul"
      - "erdogan"

  india:
    name: "India"
    iso_code: "IN"
    google_news:
      primary: { gl: "IN", hl: "en", ceid: "IN:en" }
    aliases:
      - "indian"
      - "indiaans"
      - "new delhi"
      - "mumbai"
      - "modi"

  japan:
    name: "Japan"
    iso_code: "JP"
    google_news:
      primary: { gl: "JP", hl: "en", ceid: "JP:en" }
    aliases:
      - "japanese"
      - "japans"
      - "tokyo"
      - "tokio"

  south_korea:
    name: "South Korea"
    iso_code: "KR"
    google_news:
      primary: { gl: "KR", hl: "en", ceid: "KR:en" }
    aliases:
      - "zuid-korea"
      - "korean"
      - "koreaans"
      - "seoul"

  australia:
    name: "Australia"
    iso_code: "AU"
    google_news:
      primary: { gl: "AU", hl: "en", ceid: "AU:en" }
    aliases:
      - "australië"
      - "australian"
      - "australisch"
      - "sydney"
      - "canberra"

  brazil:
    name: "Brazil"
    iso_code: "BR"
    google_news:
      primary: { gl: "BR", hl: "en", ceid: "BR:en" }
      native: { gl: "BR", hl: "pt-BR", ceid: "BR:pt-BR" }
    aliases:
      - "brazilië"
      - "brazilian"
      - "braziliaans"
      - "brasilia"
      - "são paulo"
      - "lula"
      - "bolsonaro"

  south_africa:
    name: "South Africa"
    iso_code: "ZA"
    google_news:
      primary: { gl: "ZA", hl: "en", ceid: "ZA:en" }
    aliases:
      - "zuid-afrika"
      - "south african"
      - "zuidafrikaans"
      - "pretoria"
      - "johannesburg"
      - "cape town"

  egypt:
    name: "Egypt"
    iso_code: "EG"
    google_news:
      primary: { gl: "EG", hl: "en", ceid: "EG:en" }
      native: { gl: "EG", hl: "ar", ceid: "EG:ar" }
    aliases:
      - "egypte"
      - "egyptian"
      - "egyptisch"
      - "cairo"
      - "kairo"
      - "sisi"

  mexico:
    name: "Mexico"
    iso_code: "MX"
    google_news:
      primary: { gl: "MX", hl: "en", ceid: "MX:en" }
      native: { gl: "MX", hl: "es", ceid: "MX:es" }
    aliases:
      - "mexican"
      - "mexicaans"
      - "mexico city"

# Exclusies - landen die we NIET ophalen (we hebben ze al)
excluded_countries:
  - "NL"  # Nederland - onze primaire bronnen
  - "BE"  # België - deels Nederlandse bronnen
```

### Country Detection Service

```python
# backend/app/services/country_detector.py
class CountryDetector:
    """Detecteert betrokken landen in artikelen."""

    def __init__(self):
        self.mapping = load_country_mapping()
        self.alias_index = self._build_alias_index()

    def detect_countries(self, text: str) -> list[Country]:
        """
        Detecteert landen in tekst via:
        1. spaCy NER (GPE entities)
        2. Alias matching (leader names, cities, etc.)
        """
        countries = set()

        # NER-based detection
        doc = nlp(text)
        for ent in doc.ents:
            if ent.label_ == "GPE":
                country = self._resolve_gpe(ent.text)
                if country:
                    countries.add(country)

        # Alias-based detection
        text_lower = text.lower()
        for alias, country in self.alias_index.items():
            if alias in text_lower:
                countries.add(country)

        return list(countries)
```

### Acceptance Criteria
- [x] `country_mapping.yaml` met 27 landen en hun Google News parameters
- [x] LLM-based country detection via `involved_countries` in factual prompt
- [x] `InvolvedCountry` Pydantic schema toegevoegd aan `schemas.py`
- [x] `CountryMapper` class voor ISO → Google News params lookup
- [x] Unit tests voor country mapping (19 tests passing)
- [x] Exclusielijst voor NL (België toegevoegd als gewenste bron)

### Subtasks
- [x] Creëer `backend/app/data/country_mapping.yaml` (27 landen incl. België)
- [x] Voeg `InvolvedCountry` schema toe aan `backend/app/llm/schemas.py`
- [x] Update `FactualPayload` met `involved_countries` field
- [x] Update `factual_prompt.txt` met instructies voor land-detectie
- [x] Bouw `CountryMapper` service voor ISO → Country lookup
- [x] Schrijf unit tests (19 tests)

---

## Story 9.2: Google News RSS Reader

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 9.1

### Beschrijving
Feed reader die artikelen ophaalt via Google News RSS, met URL decoding om de echte artikel URLs te extraheren.

### Implementatie

Geïmplementeerd in `backend/app/feeds/google_news.py`:

```python
class GoogleNewsReader:
    """Fetches articles from Google News RSS based on keywords + country."""

    def __init__(self, country: Country, use_native_lang: bool = False):
        """Initialize with Country object from CountryMapper."""

    async def fetch_by_keywords(
        self,
        keywords: list[str],
        max_results: int = 10
    ) -> list[GoogleNewsArticle]:
        """Fetch articles matching keywords from country's perspective."""

# Convenience function for multi-country fetching
async def fetch_international_articles(
    keywords: list[str],
    countries: list[Country],
    max_per_country: int = 5,
    rate_limit_delay: float = 1.0,
) -> dict[str, list[GoogleNewsArticle]]:
    """Fetch articles from multiple countries with rate limiting."""
```

### URL Decoding

Gebruikt de `googlenewsdecoder` PyPI package (v0.1.7) die betrouwbaar Google News redirect URLs decodeert naar echte artikel URLs.

**Voorbeeld resultaat:**
```
Input:  https://news.google.com/rss/articles/CBMisAFBVV95cUxPX1pPTlQzVVFpenBkRG10ZGE3TU9...
Output: https://www.timesofisrael.com/upcoming-meet-to-test-if-trump-feels-same-way-about...
```

### Acceptance Criteria
- [x] `GoogleNewsReader` class die RSS feeds ophaalt per land
- [x] Correcte URL decoding via `googlenewsdecoder` package
- [x] Rate limiting (configureerbaar, default 1 seconde)
- [x] Proper error handling voor network issues (httpx exceptions)
- [x] Source name extractie uit RSS entries
- [x] Unit tests met mocked RSS responses (21 tests)

### Subtasks
- [x] Implementeer `GoogleNewsReader` class met `Country` integratie
- [x] Voeg `googlenewsdecoder>=0.1.7` toe aan requirements.txt
- [x] Voeg rate limiting toe met `asyncio.sleep`
- [x] Test met echte Google News feeds (Israel, Russia)
- [x] Schrijf unit tests (21 tests in `test_google_news.py`)

### Technische Notities
- `googlenewsdecoder` is de meest betrouwbare methode voor URL decoding
- `follow_redirects=True` is nodig in httpx client (Google doet 302 redirects)
- Source name komt uit RSS `<source>` element
- Rate limiting is ingebouwd in zowel `GoogleNewsReader` als `fetch_international_articles`

---

## Story 9.3: International Enrichment Service

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 9.1, 9.2

### Beschrijving
Orchestratie-service die events verrijkt met internationale perspectieven.

### Implementatie

```python
# backend/app/services/international_enrichment.py
class InternationalEnrichmentService:
    """Verrijkt events met internationale nieuwsperspectieven."""

    def __init__(
        self,
        country_detector: CountryDetector,
        google_news_reader: GoogleNewsReader,
        article_repo: ArticleRepository,
        event_repo: EventRepository
    ):
        self.country_detector = country_detector
        self.google_news_reader = google_news_reader
        self.article_repo = article_repo
        self.event_repo = event_repo

    async def enrich_event(
        self,
        event_id: int,
        max_articles_per_country: int = 5
    ) -> EnrichmentResult:
        """
        Verrijk een event met internationale artikelen.

        Returns:
            EnrichmentResult met toegevoegde artikelen en statistieken
        """
        event = await self.event_repo.get_by_id(event_id)

        # 1. Bepaal betrokken landen uit alle event artikelen
        all_text = " ".join([
            f"{a.title} {a.clean_text or ''}"
            for a in event.articles
        ])
        countries = self.country_detector.detect_countries(all_text)

        # 2. Filter uit: landen die we al hebben of uitgesloten zijn
        existing_countries = {a.source_country for a in event.articles}
        countries_to_fetch = [
            c for c in countries
            if c.iso_code not in existing_countries
            and c.iso_code not in EXCLUDED_COUNTRIES
        ]

        if not countries_to_fetch:
            return EnrichmentResult(
                event_id=event_id,
                countries_detected=countries,
                articles_added=0,
                message="No new countries to fetch"
            )

        # 3. Extraheer zoektermen uit event
        keywords = self._extract_keywords(event)

        # 4. Fetch artikelen per land
        all_new_articles = []
        for country in countries_to_fetch:
            reader = GoogleNewsReader(
                country_code=country.iso_code,
                lang=country.google_news_primary_lang
            )

            try:
                articles = await reader.fetch_by_keywords(
                    keywords=keywords,
                    max_results=max_articles_per_country
                )

                # Filter op relevantie
                relevant = self._filter_relevant(articles, keywords)
                all_new_articles.extend(relevant)

                # Rate limiting
                await asyncio.sleep(1)

            except Exception as e:
                logger.warning(f"Failed to fetch from {country.name}: {e}")
                continue

        # 5. Deduplicate en persist
        unique_articles = self._deduplicate(all_new_articles)

        for article in unique_articles:
            article.event_id = event_id
            article.is_international = True
            await self.article_repo.save(article)

        return EnrichmentResult(
            event_id=event_id,
            countries_detected=countries,
            countries_fetched=countries_to_fetch,
            articles_added=len(unique_articles),
            articles=unique_articles
        )

    def _extract_keywords(self, event: Event) -> list[str]:
        """Extract search keywords from event."""
        keywords = []

        # Event title words (skip stop words)
        title_words = [
            w for w in event.title.split()
            if len(w) > 3 and w.lower() not in STOP_WORDS
        ]
        keywords.extend(title_words[:3])

        # Named entities from articles
        for article in event.articles[:3]:
            if article.entities:
                # Prefer PERSON and ORG entities
                for ent in article.entities:
                    if ent.label in ("PERSON", "ORG") and ent.text not in keywords:
                        keywords.append(ent.text)
                        if len(keywords) >= 5:
                            break

        return keywords[:5]  # Max 5 keywords

    def _filter_relevant(
        self,
        articles: list[Article],
        keywords: list[str]
    ) -> list[Article]:
        """Filter articles by keyword relevance in title."""
        relevant = []
        keywords_lower = [k.lower() for k in keywords]

        for article in articles:
            title_lower = article.title.lower()
            # At least one keyword must appear in title
            if any(kw in title_lower for kw in keywords_lower):
                relevant.append(article)

        return relevant

    def _deduplicate(self, articles: list[Article]) -> list[Article]:
        """Remove duplicate articles by URL."""
        seen_urls = set()
        unique = []

        for article in articles:
            if article.url not in seen_urls:
                seen_urls.add(article.url)
                unique.append(article)

        return unique
```

### Acceptance Criteria
- [x] `InternationalEnrichmentService` die events verrijkt
- [x] Keyword extractie uit event titel en entities
- [x] Relevantie filtering (keyword in titel)
- [x] Deduplicatie van artikelen
- [x] Rate limiting tussen requests
- [x] Proper logging en error handling
- [x] Integration test met mock data

### Subtasks
- [x] Implementeer `InternationalEnrichmentService`
- [x] Voeg `is_international` en `source_country` velden toe aan Article model
- [x] Database migratie voor nieuwe velden
- [x] Schrijf unit tests (17 tests)
- [x] Voeg logging toe voor monitoring

### Implementatie Details

Geïmplementeerd in:
- `backend/app/services/international_enrichment.py` - InternationalEnrichmentService
- `backend/app/db/models.py` - Article.is_international, Article.source_country, Event.detected_countries
- `backend/app/repositories/insight_repo.py` - involved_countries storage
- `backend/app/services/insight_service.py` - detected_countries + search_keywords caching
- `backend/app/llm/schemas.py` - search_keywords field in FactualPayload
- `backend/app/llm/templates/factual_prompt.txt` - Instructions for English search keywords
- `database/migrations/002_international_perspectives.sql` - Supabase migration

**LLM-generated English search keywords:**
- The factual prompt now generates 3-5 English keywords for international search
- Examples: `["United Kingdom", "Egypt", "cabinet", "criticism"]`
- Stored in `prompt_metadata.search_keywords`
- Used by enrichment service as primary source for Google News queries

---

## Story 9.4: Admin Endpoint & Scheduled Job

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Small
**Depends on**: Story 9.3

### Beschrijving
Admin endpoint voor handmatige trigger en optionele scheduled job voor automatische enrichment.

### API Endpoints

```python
# backend/app/routers/admin.py

@router.post("/trigger/enrich-international/{event_id}")
async def trigger_international_enrichment(
    event_id: int,
    max_per_country: int = Query(default=5, ge=1, le=20)
):
    """Trigger international enrichment for a specific event."""
    result = await enrichment_service.enrich_event(
        event_id=event_id,
        max_articles_per_country=max_per_country
    )
    return result

@router.post("/trigger/enrich-international-batch")
async def trigger_batch_enrichment(
    limit: int = Query(default=5, ge=1, le=20)
):
    """Enrich recent events that haven't been enriched yet."""
    events = await event_repo.get_events_without_international(limit=limit)
    results = []

    for event in events:
        result = await enrichment_service.enrich_event(event.id)
        results.append(result)

    return {"enriched": len(results), "results": results}
```

### Scheduled Job (Optioneel)

```python
# backend/app/scheduler.py

@scheduler.scheduled_job('interval', hours=2, id='international_enrichment')
async def scheduled_international_enrichment():
    """Automatically enrich events with international perspectives."""
    logger.info("Starting scheduled international enrichment")

    # Get events from last 24 hours without international articles
    events = await event_repo.get_recent_events_without_international(
        hours=24,
        limit=10
    )

    for event in events:
        try:
            result = await enrichment_service.enrich_event(event.id)
            logger.info(f"Enriched event {event.id}: +{result.articles_added} articles")
        except Exception as e:
            logger.error(f"Failed to enrich event {event.id}: {e}")

        await asyncio.sleep(5)  # Pause between events
```

### Acceptance Criteria
- [x] POST `/admin/trigger/enrich-international/{event_id}` endpoint
- [x] POST `/admin/trigger/enrich-international-batch` endpoint
- [x] Repository method `get_events_without_international`
- [x] Scheduled job elke 2 uur
- [x] Logging van enrichment resultaten

### Subtasks
- [x] Voeg admin endpoints toe
- [x] Implementeer repository query
- [x] Voeg scheduled job toe
- [x] Test endpoints handmatig
- [x] Update CLAUDE.md met nieuwe endpoints

---

## Story 9.5: Database Schema Updates

**Status**: ✅ Done (merged into Story 9.3)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Small

### Beschrijving
Voeg noodzakelijke velden toe aan het database schema voor internationale artikelen.

**Note**: Deze wijzigingen zijn geïmplementeerd als onderdeel van Story 9.3.

### Schema Changes

```sql
-- Add to articles table
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_international BOOLEAN DEFAULT FALSE;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_country VARCHAR(2);  -- ISO country code

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_articles_international ON articles(is_international);
CREATE INDEX IF NOT EXISTS idx_articles_source_country ON articles(source_country);

-- Add to events table (optional: cache detected countries)
ALTER TABLE events ADD COLUMN IF NOT EXISTS detected_countries TEXT[];  -- Array of ISO codes
```

### Model Updates

```python
# backend/app/models.py

class Article(Base):
    # ... existing fields ...

    is_international: Mapped[bool] = mapped_column(default=False)
    source_country: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
```

### Acceptance Criteria
- [x] `is_international` en `source_country` velden op Article
- [x] Database migratie (of Supabase SQL)
- [x] Model updates met type hints
- [x] Backward compatible (bestaande artikelen = NL, niet international)

### Subtasks
- [x] Update SQLAlchemy models
- [x] Maak Supabase migratie SQL
- [x] Test met bestaande data
- [x] Update seed data als nodig

---

## Story 9.6: Frontend - Internationale Bronnen Sectie

**Status**: ✅ Done
**Prioriteit**: Should Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 9.3, 9.5

### Beschrijving
Toon internationale bronnen apart in de event detail pagina.

### UI Design

```
┌─────────────────────────────────────────────────────────────┐
│  Event: Israel erkent Somaliland als onafhankelijke staat   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📰 Nederlandse bronnen (3)                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🇳🇱 NOS        "Israel erkent Somaliland..."        │   │
│  │ 🇳🇱 NU.nl      "Netanyahu tekent erkenning..."      │   │
│  │ 🇳🇱 RTL        "Diplomatieke stap Israel..."        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  🌍 Internationale perspectieven (4)                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🇮🇱 Times of Israel  "Historic recognition..."      │   │
│  │ 🇮🇱 Haaretz          "Critics slam move..."         │   │
│  │ 🇪🇬 Al-Ahram         "Arab League condemns..."      │   │
│  │ 🇬🇧 BBC              "What recognition means..."    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ℹ️ Bronnen uit: Israel, Egypte, Verenigd Koninkrijk        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Component Updates

```typescript
// frontend/components/InternationalSources.tsx

interface InternationalSourcesProps {
  articles: Article[];
  countries: string[];  // ISO codes
}

export function InternationalSources({ articles, countries }: InternationalSourcesProps) {
  // Group articles by country
  const byCountry = groupBy(articles, 'source_country');

  return (
    <section className="mt-6">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <GlobeIcon className="w-5 h-5" />
        Internationale perspectieven ({articles.length})
      </h3>

      <div className="mt-3 space-y-2">
        {articles.map(article => (
          <ArticleCard
            key={article.id}
            article={article}
            showCountryFlag={true}
          />
        ))}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Bronnen uit: {countries.map(getCountryName).join(', ')}
      </p>
    </section>
  );
}
```

### Acceptance Criteria
- [x] Aparte sectie "Internationale perspectieven" op event detail
- [x] Landvlaggen naast bron naam (emoji of library)
- [x] Groepering of lijst van internationale artikelen
- [x] "Bronnen uit: X, Y, Z" footer
- [x] Graceful handling als er geen internationale bronnen zijn
- [x] Mobile responsive

### Subtasks
- [x] Update Supabase query om `is_international` te fetchen
- [x] Bouw `InternationalSources` component
- [x] Voeg country flag utility toe (emoji mapping)
- [x] Integreer in EventDetailScreen
- [x] Test met events met/zonder internationale bronnen

### Implementation Details

**Files created/modified:**
- `frontend/lib/types.ts` - Added `is_international` and `source_country` to `EventArticle` interface
- `frontend/lib/api.ts` - Updated `getEventDetail` to map international article fields
- `frontend/lib/format.ts` - Added `getCountryFlag()` and `getCountryName()` utilities with Dutch country names
- `frontend/components/InternationalSources.tsx` - New component displaying international articles with country flags
- `frontend/app/event/[id]/EventDetailScreen.tsx` - Integrated component, split articles into Dutch/international sections

**Country flag implementation:**
- Uses Unicode regional indicator symbols for flag emojis (ISO code → flag)
- 22 country name translations in Dutch
- Globe icon (🌍) as fallback for unknown countries

**UI Changes:**
- Dutch articles now shown under "Nederlandse bronnen (N)" heading
- International articles shown separately under "Internationale perspectieven (N)"
- Each international article displays: country flag, source favicon, source name, title, date
- Footer shows "Bronnen uit: 🇺🇸 Verenigde Staten, 🇬🇧 Verenigd Koninkrijk..." etc.
- Section only appears when international articles exist

---

## Story 9.7: Handmatige Test & Iteratie

**Status**: 🔲 Ready
**Prioriteit**: Must Have
**Geschatte complexiteit**: Small
**Depends on**: Story 9.4

### Beschrijving
Test de volledige flow handmatig en itereer op basis van resultaten.

### Test Plan

1. **Selecteer test events**:
   - Event over Israel/Palestina conflict
   - Event over Rusland/Oekraïne
   - Event over US verkiezingen
   - Event puur Nederlands (controlegroep)

2. **Trigger enrichment per event**:
   ```bash
   curl -X POST "http://localhost:8000/admin/trigger/enrich-international/123"
   ```

3. **Evalueer resultaten**:
   - Zijn de gedetecteerde landen correct?
   - Zijn de opgehaalde artikelen relevant?
   - Werkt de URL decoding?
   - Zijn er duplicaten?

4. **Tune parameters**:
   - Keyword extractie verfijnen
   - Relevantie filtering aanpassen
   - Rate limiting optimaliseren

### Acceptance Criteria
- [ ] 5+ events succesvol verrijkt
- [ ] Relevantie score > 70% (handmatige beoordeling)
- [ ] Geen duplicate artikelen
- [ ] Geen errors in logs
- [ ] Documenteer bevindingen en aanpassingen

### Subtasks
- [ ] Selecteer diverse test events
- [ ] Voer enrichment uit per event
- [ ] Beoordeel kwaliteit handmatig
- [ ] Pas configuratie aan waar nodig
- [ ] Documenteer learnings

---

## Technische Overwegingen

### Rate Limiting Strategy

```python
# Voorkom Google throttling
RATE_LIMITS = {
    "requests_per_second": 1,
    "requests_per_country": 10,
    "max_countries_per_event": 5,
    "cooldown_between_events": 5  # seconds
}
```

### Error Handling

```python
class EnrichmentError(Exception):
    """Base exception for enrichment errors."""
    pass

class GoogleNewsUnavailable(EnrichmentError):
    """Google News RSS not accessible."""
    pass

class URLDecodingFailed(EnrichmentError):
    """Failed to decode Google News URL."""
    pass
```

### Caching

```python
# Cache Google News responses (5 minuten)
@cached(ttl=300)
async def fetch_google_news(country: str, keywords: list[str]) -> list[Article]:
    ...
```

### Monitoring

Track metrics voor:
- Aantal enriched events per dag
- Artikelen toegevoegd per land
- URL decoding success rate
- API response times

---

## Definition of Done (Epic)

- [ ] Country mapping met 20+ landen
- [ ] Google News RSS reader werkend
- [ ] URL decoding betrouwbaar
- [ ] Enrichment service getest
- [ ] Admin endpoints beschikbaar
- [ ] Database schema updated
- [ ] Frontend toont internationale bronnen
- [ ] Handmatige tests succesvol
- [ ] Documentatie in CLAUDE.md bijgewerkt
- [ ] Geen breaking changes voor bestaande functionaliteit

---

## Toekomstige Uitbreidingen

1. **Automatische vertaling** - Google Translate API voor niet-Engelse titels
2. **Sentiment vergelijking** - Vergelijk sentiment tussen landen
3. **Source quality scoring** - Beoordeel betrouwbaarheid internationale bronnen
4. **Real-time alerts** - Notificatie bij conflicterende berichtgeving
5. **API fallback** - GNews.io of NewsData.io als backup

---

## Referenties

- [Google News RSS Parameters](https://www.newscatcherapi.com/blog-posts/google-news-rss-search-parameters-the-missing-documentaiton)
- [FiveFilters Google News Guide](https://www.fivefilters.org/2021/google-news-rss-feeds/)
- [google-news-feed PyPI](https://pypi.org/project/google-news-feed/)
- [ISO 3166-1 Country Codes](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
