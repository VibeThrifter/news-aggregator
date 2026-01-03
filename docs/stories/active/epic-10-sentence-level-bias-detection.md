# Epic 10: Per-Zin Bias Detectie voor Artikelen

## Overzicht

Implementeer een LLM-gedreven analyse die elk artikel scant op 26 specifieke bias types op zin-niveau. Elke gedetecteerde bias krijgt een score (0-1) en uitleg. Dit geeft gebruikers diep inzicht in de kwaliteit en objectiviteit van individuele artikelen.

### Positie in het Systeem

Deze feature staat **naast** de bestaande LLM analyses, niet in plaats van:

```
┌─────────────────────────────────────────────────────────────────┐
│                    BESTAANDE ANALYSES (Event-niveau)            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │Classificatie │  │Fase 1:       │  │Fase 2:       │          │
│  │              │→ │Feitelijk     │→ │Kritisch      │          │
│  │(event type)  │  │(summary,     │  │(fallacies,   │          │
│  │              │  │ timeline)    │  │ frames)      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         ↑                ↑                 ↑                    │
│         └────────────────┴─────────────────┘                    │
│                    Werkt op EVENT (meerdere artikelen)          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    NIEUWE ANALYSE (Artikel-niveau)              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Bias Detectie                                         │      │
│  │ (per-zin analyse, 26 bias types, journalist vs quote) │      │
│  └──────────────────────────────────────────────────────┘      │
│                              ↑                                  │
│                    Werkt op ARTIKEL (individueel)               │
└─────────────────────────────────────────────────────────────────┘
```

**Belangrijke verschillen:**
| Aspect | Bestaande Analyses | Bias Detectie |
|--------|-------------------|---------------|
| Scope | Event (N artikelen) | 1 artikel |
| Granulariteit | Thema's, clusters | Per zin |
| Trigger | Automatisch bij event | On-demand |
| Provider | `provider_factual`/`provider_critical` | `provider_bias` (apart) |

## Achtergrond

De huidige LLM-analyse werkt op event-niveau (meerdere artikelen tegelijk). Voor echte transparantie willen we ook per individueel artikel zichtbaar maken waar mogelijke biases zitten. Dit helpt lezers kritischer te lezen en media-geletterdheid te ontwikkelen.

## Belangrijk Onderscheid: Journalistieke Bias vs. Gequote Bias

Er is een fundamenteel verschil tussen bias van de journalist en bias in quotes van bronnen:

### Journalistieke Bias (auteur/redactie)
Dit is waar we primair naar zoeken - bias in de **eigen woorden van de journalist**:
- Woordkeuze in beschrijvingen
- Framing van gebeurtenissen
- Selectie en ordening van informatie
- Niet-geattribueerde claims

**Voorbeeld**: *"Het omstreden wetsvoorstel werd erdoor gedrukt"* → Word Choice Bias van journalist

### Gequote Bias (bronnen)
Bias in uitspraken van geïnterviewden of geciteerde bronnen. Dit is **informatief maar geen journalistieke fout**:
- Politici die tegenstanders bekritiseren
- Belanghebbenden die hun positie verdedigen
- Experts met een bepaald standpunt

**Voorbeeld**: *Minister Jansen noemt het plan "rampzalig voor de economie"* → Quote van bron, geen journalistieke bias

### Waarom dit onderscheid ertoe doet

| Situatie | Journalistieke Bias? | Waarom |
|----------|---------------------|--------|
| Journalist schrijft: "De incompetente minister..." | ✅ Ja | Eigen woorden, geladen taal |
| Oppositieleider zegt: "De minister is incompetent" | ❌ Nee | Gerapporteerde mening van bron |
| Journalist schrijft: "Critici noemen hem incompetent" | ⚠️ Grenseval | Vaag geattribueerd, mogelijk framing |
| Journalist selecteert alleen negatieve quotes | ✅ Ja | Source Selection Bias |

### Grijze Gebieden

Sommige situaties vereisen nuance:
1. **Selectieve quoting**: Als journalist alleen extreme quotes selecteert → Source Selection Bias
2. **Framing rond quotes**: "Hij beweerde dat..." vs "Hij legde uit dat..." → Word Choice Bias
3. **Ongebalanceerde bronnen**: Alleen één kant aan het woord → Source Selection Bias
4. **Impliciete goedkeuring**: Quote zonder context of tegengeluid → Mogelijk Opinionated Bias

## De 26 Bias Types

| # | Bias Type | Korte Omschrijving |
|---|-----------|-------------------|
| 1 | Ad Hominem Bias | Aanval op persoon i.p.v. argument |
| 2 | Ambiguous Attribution Bias | Onduidelijke bronverwijzing ("bronnen zeggen") |
| 3 | Anecdotal Evidence Bias | Persoonlijke verhalen als bewijs voor algemene claims |
| 4 | Causal Misunderstanding Bias | Correlatie gepresenteerd als causaliteit |
| 5 | Cherry Picking Bias | Selectief gebruik van data/voorbeelden |
| 6 | Circular Reasoning Bias | Conclusie gebruikt als premisse |
| 7 | Discriminatory Bias | Vooroordelen over groepen mensen |
| 8 | Emotional Sensationalism Bias | Overdreven emotionele taal |
| 9 | External Validation Bias | Overmatig leunen op autoriteit zonder inhoud |
| 10 | False Balance Bias | Gelijk gewicht aan ongelijke posities |
| 11 | False Dichotomy Bias | Kunstmatige tweedeling, negeren van alternatieven |
| 12 | Faulty Analogy Bias | Ongeldige vergelijking |
| 13 | Generalization Bias | Te brede conclusies uit beperkte voorbeelden |
| 14 | Insinuative Questioning Bias | Retorische vragen die suggereren |
| 15 | Intergroup Bias | "Wij vs. zij" framing |
| 16 | Mud Praise Bias | Kritiek verpakt als compliment of vice versa |
| 17 | Opinionated Bias | Meningen gepresenteerd als feiten |
| 18 | Political Bias | Duidelijke politieke voorkeur |
| 19 | Projection Bias | Eigen standpunt projecteren op anderen |
| 20 | Shifting Benchmark Bias | Veranderende criteria tijdens argumentatie |
| 21 | Source Selection Bias | Eenzijdige bronselectie |
| 22 | Speculation Bias | Speculatie gepresenteerd als feit |
| 23 | Straw Man Bias | Verzwakte versie van tegenargument aanvallen |
| 24 | Unsubstantiated Claims Bias | Claims zonder onderbouwing |
| 25 | Whataboutism Bias | Afleiding door andere issues aan te halen |
| 26 | Word Choice Bias | Geladen woordkeuze |

---

## Technische Aanpak

### Optie A: Eén LLM Call per Artikel (Aanbevolen)
- **Voordelen**: Kostenefficiënt, context behouden, sneller
- **Nadelen**: Limiet op output tokens, complexe JSON parsing
- **Aanpak**: Stuur volledige artikel, vraag JSON array met per-zin analyse

### Optie B: Batch per 10 Zinnen
- **Voordelen**: Meer detail mogelijk per zin
- **Nadelen**: Meerdere API calls, duurder, trager

### Optie C: Twee-fase Analyse
1. Eerst: Identificeer verdachte zinnen
2. Daarna: Diepere analyse van geflaggede zinnen
- **Voordelen**: Efficiënt bij weinig biases
- **Nadelen**: Meer complexiteit

**Keuze**: Optie A - één call per artikel met structured output (Pydantic/JSON schema)

---

## Story 10.1: Database Model & Repository

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Small

### Beschrijving
Creëer database model voor opslag van per-zin bias analyse resultaten.

### Subtaken
- [x] Maak `ArticleBiasAnalysis` model in `backend/app/db/models.py` (volg `LLMInsight` pattern)
- [x] Voeg `SentenceBias` en `BiasAnalysisPayload` schemas toe aan `backend/app/llm/schemas.py`
- [x] Maak migration script `database/migrations/003_article_bias_analysis.sql`
- [x] Maak `BiasRepository` in `backend/app/repositories/bias_repo.py` (volg `InsightRepository` pattern)
- [x] Schrijf unit tests in `backend/tests/unit/test_bias_repo.py`

### Database Schema

```sql
CREATE TABLE article_bias_analyses (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,

    -- Sentence counts
    total_sentences INTEGER NOT NULL,
    flagged_count INTEGER NOT NULL,

    -- Summary statistics
    biased_percentage FLOAT NOT NULL,           -- Percentage zinnen met bias
    most_frequent_bias VARCHAR(64),             -- Meest voorkomende bias type
    most_frequent_count INTEGER,                -- Aantal keer meest voorkomende
    average_bias_strength FLOAT,                -- Gemiddelde score van flagged zinnen
    overall_rating FLOAT,                       -- Gecombineerde rating (0-1, lager = minder biased)

    -- Detailed results
    flagged_sentences JSONB NOT NULL,           -- Array van SentenceBias objecten
    raw_response TEXT,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(article_id, provider)
);

CREATE INDEX idx_bias_article_id ON article_bias_analyses(article_id);
CREATE INDEX idx_bias_overall_rating ON article_bias_analyses(overall_rating);
CREATE INDEX idx_bias_most_frequent ON article_bias_analyses(most_frequent_bias);
```

### SentenceBias JSON Structuur

```json
{
  "sentence_index": 3,
  "sentence_text": "Critici beweren dat de maatregel rampzalig zal zijn.",
  "bias_type": "Ambiguous Attribution Bias",
  "bias_source": "journalist",
  "score": 0.7,
  "explanation": "De term 'critici' is vaag en niet nader gespecificeerd. Het is onduidelijk wie deze kritiek levert en op welke expertise dit is gebaseerd."
}
```

### Bias Source Waarden

| Waarde | Betekenis | Weging in Score |
|--------|-----------|-----------------|
| `journalist` | Eigen woorden van de auteur/redactie | 100% (primaire focus) |
| `framing` | Hoe journalist een quote inleidt/afsluit | 100% (subtiele bias) |
| `quote_selection` | Keuze van welke quotes worden gebruikt | 100% (redactionele keuze) |
| `quote` | Inhoud van directe quote van bron | 0% (informatief, geen journalistieke fout) |

### Volledige Analyse Response Structuur

```json
{
  "article_id": 123,
  "total_sentences": 21,
  "journalist_biases": [
    {
      "sentence_index": 2,
      "sentence_text": "'Bedreiging van Musk' Een van de zaken waarop de Amerikanen hun pijlen richten...",
      "bias_type": "Word Choice Bias",
      "bias_source": "journalist",
      "score": 0.6,
      "explanation": "De uitdrukking 'hun pijlen richten' is geladen taal van de journalist zelf."
    },
    {
      "sentence_index": 5,
      "sentence_text": "Rogers identificeerde de vijf wel, en noemde Breton 'het brein achter de DSA'.",
      "bias_type": "Word Choice Bias",
      "bias_source": "framing",
      "score": 0.5,
      "explanation": "De journalist kiest ervoor om deze geladen quote te gebruiken zonder context of nuancering."
    }
  ],
  "quote_biases": [
    {
      "sentence_index": 8,
      "sentence_text": "Breton reageerde: 'Is McCarthy's heksenjacht terug?'",
      "bias_type": "Ad Hominem Bias",
      "bias_source": "quote",
      "speaker": "Thierry Breton",
      "score": 0.7,
      "explanation": "Breton vergelijkt de situatie met McCarthyisme. Dit is zijn mening, geen journalistieke bias."
    }
  ],
  "summary": {
    "total_sentences": 21,
    "journalist_bias_count": 4,
    "quote_bias_count": 2,
    "journalist_bias_percentage": 19.0,
    "most_frequent_journalist_bias": "Word Choice Bias",
    "average_journalist_bias_strength": 0.58,
    "overall_journalist_rating": 0.38
  }
}
```

### Voorbeeld Output (Human-Readable)

```
=== JOURNALISTIEKE BIAS (auteur/redactie) ===

1. "'Bedreiging van Musk' Een van de zaken waarop de Amerikanen
    hun pijlen richten..."
   [Word Choice Bias] ██████░░░░ 0.6 | Bron: journalist
   → De uitdrukking 'hun pijlen richten' is geladen taal van de
     journalist zelf, impliceert agressie.

2. "Rogers identificeerde de vijf wel, en noemde Breton 'het brein
    achter de DSA'."
   [Word Choice Bias] █████░░░░░ 0.5 | Bron: framing
   → De journalist kiest ervoor deze geladen quote prominent te
     plaatsen zonder context.

3. "Amerikaanse media meldden al eerder dat Amerika sancties
    overwoog..."
   [Speculation Bias] ██████░░░░ 0.6 | Bron: journalist
   → Speculatie zonder concrete bronvermelding.

=== BIAS IN QUOTES (informatief, geen journalistieke fout) ===

4. "Breton reageerde: 'Is McCarthy's heksenjacht terug?'"
   [Ad Hominem Bias] ███████░░░ 0.7 | Bron: quote (Thierry Breton)
   → Breton vergelijkt situatie met McCarthyisme. Dit is zijn
     uitspraak, niet de mening van de journalist.

---
SAMENVATTING JOURNALISTIEKE BIAS:
Percentage zinnen met bias: 19.0% (4 van 21)
Meest voorkomend: Word Choice Bias (2 keer)
Gemiddelde sterkte: 0.58
Totaalbeoordeling: 0.38 (lager = objectiever)

ℹ️ Quote biases (2) zijn informatief maar tellen niet mee in de
   beoordeling van de journalist.
```

### Acceptatiecriteria
- [x] Model is aangemaakt en migratie draait succesvol
- [x] Repository ondersteunt create, get_by_article_id, get_by_event_id
- [x] Unit tests dekken alle repository methodes (9 tests passed)

---

## Story 10.2: Bias Detection Prompt & LLM Service

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium

### Beschrijving
Ontwikkel de LLM prompt die per-zin bias detecteert met de 26 categorieën, en een service die de analyse uitvoert.

### Subtaken
- [x] Maak prompt template `backend/app/llm/templates/bias_detection_prompt.txt`
- [x] Voeg `prompt_bias_detection` toe aan `llm_config` tabel (sync met database)
- [x] Maak `BiasDetectionService` in `backend/app/services/bias_service.py` (volg `InsightService` pattern)
- [x] Hergebruik bestaande `LLMClient` abstractie voor provider-agnostische calls
- [x] Implementeer `analyze_article(article_id: int) -> BiasAnalysisOutcome`
- [x] Schrijf unit tests in `backend/tests/unit/test_bias_service.py` met mocked LLM

### Prompt Structuur

```
Je bent een media-analist gespecialiseerd in het detecteren van journalistieke biases in Nederlandstalige nieuwsartikelen.

BELANGRIJK ONDERSCHEID - Journalistieke bias vs. Quote bias:

JOURNALISTIEKE BIAS (telt mee in beoordeling):
- "journalist": Eigen woorden van de auteur/redactie
- "framing": Hoe de journalist een quote inleidt of afsluit (bijv. "beweerde" vs "legde uit")
- "quote_selection": Wanneer alleen eenzijdige quotes worden geselecteerd

QUOTE BIAS (informatief, telt NIET mee in beoordeling):
- "quote": Bias in de inhoud van directe quotes van bronnen
- Dit is informatief maar GEEN journalistieke fout - bronnen mogen hun mening geven

Analyseer het volgende nieuwsartikel zin voor zin. Identificeer zinnen met een van de volgende 26 bias types:

1. Ad Hominem Bias - Aanval op persoon i.p.v. argument
2. Ambiguous Attribution Bias - Onduidelijke bronverwijzing ("bronnen zeggen", "experts menen")
3. Anecdotal Evidence Bias - Persoonlijke verhalen als bewijs voor algemene claims
4. Causal Misunderstanding Bias - Correlatie gepresenteerd als causaliteit
5. Cherry Picking Bias - Selectief gebruik van data of voorbeelden
6. Circular Reasoning Bias - Conclusie wordt gebruikt als premisse
7. Discriminatory Bias - Vooroordelen over groepen mensen
8. Emotional Sensationalism Bias - Overdreven emotionele of sensationele taal
9. External Validation Bias - Overmatig leunen op autoriteit zonder inhoudelijke onderbouwing
10. False Balance Bias - Gelijk gewicht aan ongelijke posities
11. False Dichotomy Bias - Kunstmatige tweedeling, negeren van alternatieven
12. Faulty Analogy Bias - Ongeldige of misleidende vergelijking
13. Generalization Bias - Te brede conclusies uit beperkte voorbeelden
14. Insinuative Questioning Bias - Retorische vragen die iets suggereren
15. Intergroup Bias - "Wij vs. zij" framing
16. Mud Praise Bias - Kritiek verpakt als compliment of vice versa
17. Opinionated Bias - Meningen gepresenteerd als feiten
18. Political Bias - Duidelijke politieke voorkeur in berichtgeving
19. Projection Bias - Eigen standpunt projecteren op anderen
20. Shifting Benchmark Bias - Veranderende criteria tijdens argumentatie
21. Source Selection Bias - Eenzijdige bronselectie
22. Speculation Bias - Speculatie gepresenteerd als feit
23. Straw Man Bias - Verzwakte versie van tegenargument aanvallen
24. Unsubstantiated Claims Bias - Claims zonder onderbouwing
25. Whataboutism Bias - Afleiding door andere issues aan te halen
26. Word Choice Bias - Geladen of tendentieuze woordkeuze

ARTIKEL:
"""
{article_content}
"""

INSTRUCTIES:
1. Splits het artikel in zinnen
2. Analyseer elke zin op de 26 bias types
3. Bepaal voor elke bias of het "journalist", "framing", "quote_selection" of "quote" is
4. Rapporteer ALLEEN zinnen met een duidelijke bias (score >= 0.5)
5. Bij quote bias: identificeer ook de spreker indien mogelijk
6. Geef voor elke gedetecteerde bias:
   - De originele zin (exact zoals in artikel)
   - Het bias type (een van de 26)
   - De bias source ("journalist", "framing", "quote_selection", of "quote")
   - Bij "quote": de naam van de spreker indien bekend
   - Een score van 0.0 tot 1.0
   - Een uitleg IN HET NEDERLANDS (max 2 zinnen)

VOORBEELDEN:
- "Het omstreden beleid..." → journalist (eigen woordkeuze)
- "De minister beweerde dat..." → framing (geladen inleiding)
- Artikel met alleen kritische quotes → quote_selection
- "'Dit is een ramp', aldus Jansen" → quote (Jansen's mening)

Antwoord in JSON formaat:
{
  "total_sentences": number,
  "journalist_biases": [
    {
      "sentence_index": number,
      "sentence_text": "string",
      "bias_type": "string",
      "bias_source": "journalist" | "framing" | "quote_selection",
      "score": number,
      "explanation": "string"
    }
  ],
  "quote_biases": [
    {
      "sentence_index": number,
      "sentence_text": "string",
      "bias_type": "string",
      "bias_source": "quote",
      "speaker": "string of null",
      "score": number,
      "explanation": "string"
    }
  ]
}
```

### Acceptatiecriteria
- [x] Prompt template staat in versiecontrole
- [x] Prompt is gesynchroniseerd met database `llm_config`
- [x] Service retourneert gestructureerde BiasAnalysisResponse
- [x] Alleen zinnen met score >= 0.5 worden geretourneerd
- [x] Quotes van bronnen worden correct uitgesloten

### Implementatiedetails

**Prompt Template:** `backend/app/llm/templates/bias_detection_prompt.txt`
- Comprehensive Dutch prompt with all 26 bias types
- Clear distinction between journalist bias (counts toward score) and quote bias (informational)
- Examples of correct classification for each bias_source type
- Conservative approach: only flag clear cases (score >= 0.5)

**Service:** `backend/app/services/bias_service.py`
- `BiasDetectionService` with singleton pattern
- `analyze_article(article_id)` - analyzes single article
- `analyze_batch(limit)` - batch processing for scheduled jobs
- Automatic Mistral fallback on rate limits
- Summary stats computation (percentage, most frequent, overall rating)

**Database Config:**
- `provider_bias` - configurable LLM provider for bias detection
- `prompt_bias_detection` - stored prompt template

**Unit Tests:** 15 tests in `test_bias_service.py`
- Stats computation tests
- Client building tests
- Article analysis tests (success, not found, no content)
- Batch processing tests
- Payload parsing tests

---

## Story 10.3: Admin Trigger & Scheduler Integration

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Small

### Beschrijving
Voeg admin endpoints toe voor handmatige en batch bias analyse, plus optionele scheduler job.

### Subtaken
- [x] Voeg endpoint `POST /admin/trigger/analyze-bias/{article_id}` toe
- [x] Voeg endpoint `POST /admin/trigger/analyze-bias-batch?limit=N` toe
- [x] Voeg optionele scheduler job toe (standaard uit)
- [x] Update `/admin/scheduler/status` response
- [x] Unit tests voor admin endpoints (7 tests added)

### Admin Endpoints

```bash
# Analyse specifiek artikel
curl -X POST "http://localhost:8000/admin/trigger/analyze-bias/{article_id}"

# Batch analyse (artikelen zonder bias analyse)
curl -X POST "http://localhost:8000/admin/trigger/analyze-bias-batch?limit=10"
```

### Acceptatiecriteria
- [x] Admin endpoints werken correct
- [x] Batch endpoint verwerkt alleen artikelen zonder bestaande analyse
- [x] Foutafhandeling bij niet-bestaande artikel_id

### Implementatiedetails

**Nieuwe Admin Endpoints:**
- `POST /admin/trigger/analyze-bias/{article_id}` - Analyseer specifiek artikel
- `POST /admin/trigger/analyze-bias-batch?limit=N` - Batch analyse (1-50 artikelen)

**Scheduler Configuration (default disabled):**
```bash
BIAS_ANALYSIS_SCHEDULER_ENABLED=true   # Enable scheduled job
BIAS_ANALYSIS_INTERVAL_HOURS=6         # Run every 6 hours
BIAS_ANALYSIS_BATCH_SIZE=10            # Articles per run
```

**Gewijzigde Bestanden:**
- `backend/app/routers/admin.py` - Added BiasAnalysisResponse, BatchBiasAnalysisResponse, endpoints
- `backend/app/core/scheduler.py` - Added _bias_analysis_job(), run_bias_analysis_now()
- `backend/app/core/config.py` - Added bias_analysis_scheduler_enabled, interval_hours, batch_size
- `backend/tests/unit/test_admin_router.py` - Added 7 tests for bias endpoints

---

## Story 10.4: API Endpoints voor Bias Data

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Small

### Beschrijving
Maak publieke API endpoints om bias analyse resultaten op te halen.

### Subtaken
- [x] Voeg endpoint `GET /articles/{article_id}/bias` toe
- [x] Voeg aggregatie endpoint toe voor event-niveau samenvatting (`GET /events/{event_id}/bias-summary`)

### API Responses

```json
// GET /api/v1/articles/{article_id}/bias
{
  "data": {
    "article_id": 123,
    "analyzed_at": "2026-01-03T10:30:00Z",
    "provider": "mistral",
    "model": "mistral-small-latest",
    "summary": {
      "total_sentences": 45,
      "journalist_bias_count": 3,
      "quote_bias_count": 1,
      "journalist_bias_percentage": 6.67,
      "most_frequent_journalist_bias": "Word Choice Bias",
      "most_frequent_count": 2,
      "average_journalist_bias_strength": 0.65,
      "overall_journalist_rating": 0.35
    },
    "journalist_biases": [...],
    "quote_biases": [...]
  },
  "meta": {...}
}

// GET /api/v1/events/{event_id}/bias-summary
{
  "data": {
    "event_id": 123,
    "total_articles": 5,
    "articles_analyzed": 3,
    "average_bias_rating": 0.45,
    "by_source": [
      {"source": "NOS", "article_count": 2, "average_rating": 0.3, "articles_analyzed": 2, "total_journalist_biases": 3}
    ],
    "bias_type_distribution": [
      {"bias_type": "Word Choice Bias", "count": 5}
    ]
  },
  "meta": {...}
}
```

### Acceptatiecriteria
- [x] Endpoints retourneren correcte data
- [x] 404 als artikel geen bias analyse heeft
- [x] Response is consistent met bestaande API patterns

### Implementatiedetails

**Nieuwe Endpoints:**
- `GET /api/v1/articles/{article_id}/bias` - Artikel bias analyse met journalist en quote biases
- `GET /api/v1/events/{event_identifier}/bias-summary` - Event-niveau aggregatie per bron

**Nieuwe Bestanden:**
- `backend/app/routers/bias.py` - Bias API router
- `backend/tests/integration/test_bias_api.py` - 7 integration tests

**Gewijzigde Bestanden:**
- `backend/app/models.py` - Added 8 new Pydantic response models
- `backend/app/routers/__init__.py` - Export bias_router
- `backend/app/main.py` - Register bias_router

---

## Story 10.5: Frontend - Artikel Bias Weergave

**Status**: ✅ Done
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium

### Beschrijving
Toon bias analyse resultaten in de frontend, zowel als samenvatting als interactieve tekst-highlighting.

### Subtaken
- [x] Maak `BiasScoreBadge` component in `frontend/components/`
- [x] Maak `BiasAnalysisModal` component voor interactieve weergave
- [x] Voeg bias sectie toe aan artikel kaarten (ArticleList)
- [x] Implementeer click-to-expand met uitleg bij gedetailleerde zin-analyse
- [x] Voeg kleurcodering toe op basis van score (groen → geel → oranje → rood)
- [x] Maak bias type legenda/uitleg in modal

### UI/UX Design - Integratie in Event Detail Pagina

De bias analyse wordt op **twee plekken** zichtbaar in de event detail pagina:

#### 1. Artikel Kaart - Bias Badge (ArticleList.tsx)

Op elke artikel kaart komt een kleine bias indicator:

```
┌─────────────────────────────────────────┐
│ [afbeelding]                            │
├─────────────────────────────────────────┤
│ 🔖 NOS    [Mainstream]                  │
│                                         │
│ Trump legt sancties op aan EU-officials │
│                                         │
│ 12 jan 2026, 14:30    🔍 0.38          │ ← Bias score badge
│                       └─ groen/oranje/rood afhankelijk van score
└─────────────────────────────────────────┘

Kleurcodering badge:
- 0.0-0.3: Groen (objectief)
- 0.3-0.5: Geel (licht biased)
- 0.5-0.7: Oranje (matig biased)
- 0.7-1.0: Rood (sterk biased)
- Geen analyse: Grijs met "?"
```

#### 2. Uitklapbaar Bias Paneel - Per Artikel

Klik op de bias badge opent een modal/drawer met details:

```
┌─────────────────────────────────────────────────────┐
│ 📊 Bias Analyse: NOS - "Trump legt sancties..."    │
│                                              [✕]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ JOURNALISTIEKE OBJECTIVITEIT                    │ │
│ │ Score: 0.38  ████████░░░░░░░░░░░░               │ │
│ │        (lager = objectiever)                    │ │
│ │                                                 │ │
│ │ 19% zinnen met bias (4 van 21)                  │ │
│ │ Meest voorkomend: Word Choice Bias (2x)         │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─ JOURNALISTIEKE BIAS ─────────────────────────┐   │
│ │  (eigen woorden auteur/redactie)              │   │
│ │                                               │   │
│ │  1. "'Bedreiging van Musk' Een van de         │   │
│ │      zaken waarop de Amerikanen hun pijlen    │   │
│ │      richten..."                              │   │
│ │     [Word Choice Bias] ██████░░░░ 0.6         │   │
│ │     → 'Hun pijlen richten' is geladen taal    │   │
│ │       van de journalist zelf.                 │   │
│ └───────────────────────────────────────────────┘   │
│                                                     │
│ ┌─ BIAS IN QUOTES ──────────────────────────────┐   │
│ │  (informatief, geen journalistieke fout)  ℹ️  │   │
│ │                                               │   │
│ │  1. "Breton: 'Is McCarthy's heksenjacht       │   │
│ │      terug?'"                                 │   │
│ │     [Ad Hominem Bias] ███████░░░ 0.7          │   │
│ │     Spreker: Thierry Breton                   │   │
│ │     → Dit is Breton's uitspraak, niet de      │   │
│ │       mening van de journalist.               │   │
│ └───────────────────────────────────────────────┘   │
│                                                     │
│ ℹ️ Quote biases tellen niet mee in de score.        │
└─────────────────────────────────────────────────────┘
```

#### 3. Event-niveau Samenvatting (Optioneel - Story 10.6)

Als alle artikelen geanalyseerd zijn, toon een vergelijking:

```
┌─────────────────────────────────────────────────────────────────┐
│ BIAS VERGELIJKING PER BRON                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ NOS            ████░░░░░░ 0.38  (2 artikelen)                   │
│ Telegraaf      ██████░░░░ 0.58  (2 artikelen)                   │
│ GeenStijl      ████████░░ 0.72  (1 artikel)                     │
│ NU.nl          ███░░░░░░░ 0.29  (1 artikel)                     │
│                                                                 │
│ Meest voorkomende bias types in dit event:                      │
│ • Word Choice Bias (12x)                                        │
│ • Speculation Bias (8x)                                         │
│ • Emotional Sensationalism (5x)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Kleurcodering

| Element | Kleur | Betekenis |
|---------|-------|-----------|
| Journalistieke bias sectie | Rood/oranje border | Dit telt mee |
| Quote bias sectie | Grijs/blauw border | Informatief |
| Score 0.0-0.3 | Groen (`text-green-600`) | Objectief |
| Score 0.3-0.5 | Geel (`text-yellow-600`) | Licht biased |
| Score 0.5-0.7 | Oranje (`text-orange-600`) | Matig biased |
| Score 0.7-1.0 | Rood (`text-red-600`) | Sterk biased |

### Component Structuur

```
frontend/components/
├── ArticleList.tsx           # Bestaand - voeg BiasScoreBadge toe
├── BiasScoreBadge.tsx        # NIEUW - kleine indicator op kaart
├── BiasAnalysisModal.tsx     # NIEUW - uitklapbaar detail paneel
├── BiasAnalysisContent.tsx   # NIEUW - de inhoud (journalist vs quote)
└── BiasComparisonChart.tsx   # NIEUW - event-niveau vergelijking (Story 10.6)
```

### Acceptatiecriteria
- [x] Bias score is duidelijk zichtbaar per artikel
- [x] Geflaggede zinnen zijn gegroepeerd per bias type (journalist vs quote)
- [x] Click-to-expand toont uitgebreide uitleg (modal)
- [x] Kleurcodering is consistent en toegankelijk (5-tier: groen → rood)
- [x] Component gracefully handelt ontbrekende analyse (placeholder badge)

### Implementatiedetails

**Nieuwe Bestanden:**
- `frontend/components/BiasScoreBadge.tsx` - Compacte objectiviteitsscore badge met kleurcodering
- `frontend/components/BiasAnalysisModal.tsx` - Modal met volledige bias analyse details
- `frontend/components/ArticleCard.tsx` - Individuele artikel kaart met bias integratie

**Gewijzigde Bestanden:**
- `frontend/lib/types.ts` - Added BiasSource, SentenceBias, BiasAnalysisSummary, ArticleBiasAnalysis, ArticleBiasResponse
- `frontend/lib/api.ts` - Added getArticleBias(), getArticleBiasesForEvent()
- `frontend/components/ArticleList.tsx` - Refactored to use ArticleCard, added showBias prop

**Component Features:**
- **BiasScoreBadge**: Shows objectivity % with color coding (green 80%+ to red <20%)
- **BiasAnalysisModal**:
  - Summary stats (objectivity, sentence count, bias counts)
  - Most frequent bias type highlight
  - Grouped journalist biases (count toward score)
  - Grouped quote biases (informational only)
  - Per-sentence expandable cards with explanation
- **ArticleCard**: Fetches bias on mount, shows loading state, handles missing analysis

**Kleurcodering (Objectiviteitsscore):**
| Rating | Objectiviteit | Badge Kleur |
|--------|---------------|-------------|
| 0.0-0.2 | 80-100% | Groen (CheckCircle) |
| 0.2-0.4 | 60-80% | Emerald (CheckCircle) |
| 0.4-0.6 | 40-60% | Amber (MinusCircle) |
| 0.6-0.8 | 20-40% | Oranje (AlertTriangle) |
| 0.8-1.0 | 0-20% | Rood (AlertTriangle) |

---

## Story 10.6: Event-niveau Bias Aggregatie

**Status**: 🔲 To Do
**Prioriteit**: Should Have
**Geschatte complexiteit**: Medium

### Beschrijving
Aggregeer bias analyses van alle artikelen in een event voor vergelijkende inzichten.

### Subtaken
- [ ] Bereken gemiddelde bias score per bron binnen event
- [ ] Toon bias type distributie over event
- [ ] Maak vergelijkingsvisualisatie tussen bronnen
- [ ] Voeg toe aan event detail pagina

### Event-niveau Metrics

```json
{
  "event_id": 456,
  "total_articles_analyzed": 8,
  "average_bias_score": 0.42,
  "by_source": {
    "NOS": { "articles": 2, "avg_score": 0.35 },
    "Telegraaf": { "articles": 2, "avg_score": 0.58 },
    "GeenStijl": { "articles": 1, "avg_score": 0.72 }
  },
  "bias_type_distribution": {
    "Word Choice Bias": 12,
    "Emotional Sensationalism Bias": 8,
    "Speculation Bias": 5
  }
}
```

### Acceptatiecriteria
- [ ] Event detail toont bias vergelijking tussen bronnen
- [ ] Distributie per bias type is zichtbaar
- [ ] Bronnen zonder analyse worden duidelijk aangegeven

---

## Integratie met Bestaande Architectuur

### Database Model (backend/app/db/models.py)
Voeg `ArticleBiasAnalysis` model toe, consistent met bestaande `LLMInsight` model:
- Zelfde pattern: foreign key naar parent entity, provider/model tracking
- Verschil: gekoppeld aan `Article` i.p.v. `Event`

### Repository (backend/app/repositories/bias_repo.py)
Volg pattern van `InsightRepository`:
- `get_by_article_id(article_id: int)`
- `get_by_event_id(event_id: int)` - via event_articles join
- `upsert_analysis(...)` - consistent met `upsert_insight`

### Service (backend/app/services/bias_service.py)
Volg pattern van `InsightService`:
- Gebruik bestaande `LLMClient` abstractie (Mistral/DeepSeek/Gemini)
- Gebruik `llm_config` tabel voor prompt opslag
- Return `BiasAnalysisOutcome` dataclass (zoals `InsightGenerationOutcome`)

### Pydantic Schemas (backend/app/llm/schemas.py)
Voeg toe, consistent met bestaande schema patterns:
```python
class SentenceBias(BaseModel):
    sentence_index: int
    sentence_text: str
    bias_type: str  # Een van de 26 types
    bias_source: Literal["journalist", "framing", "quote_selection", "quote"]
    speaker: str | None = None  # Alleen bij bias_source="quote"
    score: float = Field(..., ge=0.0, le=1.0)
    explanation: str

class BiasAnalysisPayload(BaseModel):
    total_sentences: int
    journalist_biases: list[SentenceBias]
    quote_biases: list[SentenceBias]
```

### Admin Endpoints (backend/app/routers/admin.py)
Voeg toe, consistent met bestaande trigger endpoints:
```python
@router.post("/trigger/analyze-bias/{article_id}")
@router.post("/trigger/analyze-bias-batch")
```

### Frontend Types (frontend/lib/types.ts)
Voeg toe:
```typescript
export type SentenceBias = {
  sentence_index: number;
  sentence_text: string;
  bias_type: string;
  bias_source: "journalist" | "framing" | "quote_selection" | "quote";
  speaker?: string | null;
  score: number;
  explanation: string;
};

export type ArticleBiasAnalysis = {
  article_id: number;
  analyzed_at: string;
  total_sentences: number;
  journalist_biases: SentenceBias[];
  quote_biases: SentenceBias[];
  summary: {
    journalist_bias_count: number;
    journalist_bias_percentage: number;
    most_frequent_journalist_bias: string | null;
    average_journalist_bias_strength: number;
    overall_journalist_rating: number;
  };
};
```

### LLM Config Tabel
Voeg nieuwe keys toe (naast bestaande `provider_factual`, `provider_critical`, etc.):

```sql
-- Provider voor bias detectie (apart selecteerbaar in admin panel)
INSERT INTO llm_config (key, value, config_type, description)
VALUES ('provider_bias', 'mistral', 'provider', 'LLM provider voor per-zin bias detectie');

-- Prompt voor bias detectie
INSERT INTO llm_config (key, value, config_type, description)
VALUES ('prompt_bias_detection', '...', 'prompt', 'Per-zin bias detectie prompt (26 bias types)');
```

### Frontend Admin Panel Aanpassingen (frontend/app/admin/llm-config/page.tsx)

De bestaande provider toggle UI moet uitgebreid worden:

```typescript
// Bestaande PHASE_LABELS uitbreiden:
const PHASE_LABELS: Record<string, string> = {
  provider_classification: "Classificatie",
  provider_factual: "Fase 1: Feitelijk",
  provider_critical: "Fase 2: Kritisch",
  provider_bias: "Bias Detectie",  // NIEUW
};

// Bestaande sortedProviderConfigs order uitbreiden:
const order = [
  "provider_classification",
  "provider_factual",
  "provider_critical",
  "provider_bias"  // NIEUW
];
```

Dit zorgt ervoor dat de bias provider als 4e toggle verschijnt in het admin panel:

```
┌─────────────────────────────────────────────────────────────────────┐
│ LLM Provider per Fase                                               │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
│ │Classificatie│ │Fase 1:      │ │Fase 2:      │ │Bias         │    │
│ │             │ │Feitelijk    │ │Kritisch     │ │Detectie     │    │
│ │ [Mistral]   │ │ [DeepSeek]  │ │ [DeepSeek]  │ │ [Mistral]   │    │
│ │ [DeepSeek]  │ │ [Mistral]   │ │ [Mistral]   │ │ [DeepSeek]  │    │
│ │ [Gemini]    │ │ [Gemini]    │ │ [Gemini]    │ │ [Gemini]    │    │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Dependencies

- Mistral API (of andere LLM provider) - hergebruik bestaande `LLMClient`
- Bestaande artikel content in database (`articles.content`)
- Frontend event detail pagina (al aanwezig)
- Bestaande `llm_config` tabel voor prompt opslag

## Risico's

| Risico | Impact | Mitigatie |
|--------|--------|-----------|
| LLM kosten bij grote volumes | Hoog | Start met on-demand analyse, geen automatische batch |
| Inconsistente LLM output | Medium | Strikte JSON schema, retry logica |
| False positives | Medium | Hoge threshold (0.5+), conservatieve prompt |
| Performance bij lange artikelen | Medium | Token limit handling, artikel truncatie |

## Toekomstige Uitbreidingen

- Bias trend tracking over tijd per bron
- Machine learning model trainen op LLM output
- Browser extension voor real-time bias detectie
- CSV export voor onderzoekers

---

## Definition of Done

- [ ] Database model en migratie aanwezig
- [ ] LLM prompt getest en geoptimaliseerd
- [ ] Admin endpoints functioneel
- [ ] Publieke API endpoints gedocumenteerd
- [ ] Frontend componenten toegevoegd
- [ ] Unit tests met ≥80% coverage
- [ ] Integration test met echte LLM call
- [ ] Documentatie bijgewerkt (CLAUDE.md, API docs)
