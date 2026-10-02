# Epic 11: Onderzoeksmodus — de eventpagina als speurtocht

## Overzicht

De eventpagina toonde alle analyses als één lange rij secties (chronologie, standpunten, negen kritische-analyseblokken,
media-analyse, bronvergelijking). Deze epic bouwt de pagina om tot een **mobile-first onderzoeksruimte**: je scrolt door
het nieuws, tikt op tekstballonnen, draait aanwijzingen om, sleept vondsten naar je dossier, verbindt ze met elkaar en
volgt het spoor naar gerelateerd nieuws. Niet alles wordt meteen weggegeven: het is een zoektocht.

```
┌───────────────── /event/[id] ─────────────────┐     ┌──── /event/[id]/netwerk ────┐
│ Kop: categorie · LLM-titel · voortgang         │     │ Lenzen: Propagandamodel ·   │
│ Invalshoekenkaart (zwevende tekstballonnen)   │ ──▶ │ Actoren · Frames ·          │
│ Teaser → samenvatting (tikbare entiteiten)     │     │ Tegenspraak · Gerelateerd   │
│ 7 Sporen → sheets met aanwijzingskaarten       │     │ (fog-of-war)                │
│ Volg het spoor (gerelateerde events)           │     └─────────────────────────────┘
│ Dock: Dossier · Vergelijk                      │ ──▶ /onderzoek (onderzoeksbord)
└───────────────────────────────────────────────┘
```

## Achtergrond

- De gebruiker wil op de telefoon door nieuws scrollen en zelf de netwerken erachter uitzoeken (het propagandamodel van
  Herman & Chomsky), biases ontdekken en dingen koppelen. Doorklikken, ballonnetjes met visualisaties, drag & drop.
- Bijna alle benodigde data bestaat al in `llm_insights` (invalshoeken, tegenspraak, frames, autoriteiten,
  media-analyse, ...). Wat ontbrak: eigendomsdata van media, gerelateerde events en nette entiteiten per event.
- Deze epic **neemt op**: Epic 8.1 (brondata, als statische module), 8.3 (bron-detailkaart als ballon),
  8.5 (vergelijken binnen één event), 8.6 (methodologie-sheet) en Epic 10.6 (bias per bron op eventniveau).
  Epic 8.2 (`/spectrum`-pagina) en 8.4 (homepage-indicator) blijven open.

### Besluiten (2026-09-30)

| Besluit | Keuze |
|---|---|
| Hoeveel zoektocht | Verborgen tot je klikt; geen raad-puzzels. Uitweg: "Toon alles" per spoor en "Speurmodus uit" |
| Backend/database | Mag uitgebreid worden: `event_entities` en `event_relations` (migratie 004) |
| Extra's in v1 | Bronvergelijker, Wikipedia-achtergrond, Bias-zinnen verkennen, Tijdlijn-scrubber |
| Demo | `/event/demo` met volledige voorbeelddata, ook op Vercel, achter `NEXT_PUBLIC_ENABLE_DEMO` |
| Uitrol | Nieuwe UI achter `NEXT_PUBLIC_EXPLORE_UI` tot Story 11.15; de oude pagina blijft tot dan werken |

### Randvoorwaarden

- **Auteursrecht:** eventtitels komen alleen uit de LLM (eerste regel van `llm_insights.summary`); artikeltitels alleen
  als linktekst naar het artikel; nooit artikelinhoud tonen.
- **Egress:** Supabase free tier (5 GB/maand). Expliciete kolommen, geen `select('*')`.
- **Mobiel:** tikdoelen ≥ 44 px, geen hover-only interacties, safe areas, `prefers-reduced-motion`.
- **Propagandamodel:** woordkeus "aanwijzing", bewijs altijd zichtbaar, "geen signalen" is een geldige uitkomst,
  eigendomsfeiten `verified: false` tot ze gecontroleerd zijn ("te verifiëren").

---

## Story 11.1: Datafundament & bugfixes

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium

### Beschrijving
Repareer de data-laag van de eventpagina en leg het fundament voor de nieuwe UI.

### Subtaken
- [x] `getEventInsights` geeft ook `statistical_issues`, `timing_analysis`, `involved_countries` en `model` terug
      (bug: "Misleidende statistieken" en "Timing analyse" werden nooit getoond)
- [x] `select('*')` op `events` en `llm_insights` vervangen door expliciete kolommen (geen centroids, `raw_response`,
      `prompt_metadata`)
- [x] Bias rechtstreeks uit Supabase `article_bias_analyses` lezen i.p.v. de lokale FastAPI (werkt nu niet op Vercel)
- [x] Types: `Frame.technique/attribution`, `InvolvedCountry`, `AggregationResponse.involved_countries/model`
- [x] Lazy Supabase-client (`getSupabase()`), zodat tests zonder env-variabelen draaien
- [x] Viewport: pinch-zoom toestaan, `viewportFit: 'cover'`, `themeColor`; invoervelden 16px op mobiel (geen iOS-autozoom)
- [x] `typecheck`-script (`tsc --noEmit`)

### Acceptatiecriteria
- [x] De huidige eventpagina toont statistieken en timing wanneer die in de analyse staan
- [x] Biasbadges werken zonder lokale backend (één Supabase-query, nieuwste analyse per artikel)
- [x] `npm run lint`, `npm run typecheck`, `npm test` en `npm run build` slagen

### Implementatiedetails
- `frontend/lib/supabase.ts`: `getSupabase()` maakt de client pas bij eerste gebruik.
- `frontend/lib/api.ts`: `INSIGHT_COLUMNS`, `mapInsightRow`, `emptyInsights`; `BIAS_COLUMNS`, `mapBiasRow`;
  `getArticleBiasesForEvent` (batch via `.in('article_id', ids)`), `getArticleBias` gebruikt die.
- `frontend/lib/types.ts`: `FrameAttribution`, `InvolvedCountry`, extra velden.
- `frontend/app/layout.tsx`: viewport; `SearchBar`, `DateRangeFilter`, `MinSourcesFilter`: `text-base sm:text-sm`.
- Tests: Jest-suites draaiden voorheen helemaal niet (Supabase-fout bij import). Verouderde verwachtingen in
  `__tests__/EventFeed.test.tsx` en `__tests__/EventDetailComponents.test.tsx` bijgewerkt; polyfills
  (`scrollTo`, `matchMedia`, `ResizeObserver`, `IntersectionObserver`) in `tests/setupTests.ts`. 9/9 groen.
- Nulmeting bundel: `/event/[id]` First Load JS **229 kB** (page 83,3 kB).

---

## Story 11.2: Domeinmodel `lib/explore` + medialandschap + demo-data

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Large
**Depends on**: Story 11.1

### Beschrijving
Pure, geteste TypeScript-modules die alle ruwe data omzetten naar één onderzoeksmodel: bronnen, knopen en randen
(kennisgraaf), aanwijzingskaarten per spoor, fog-of-war, signalen per filter en layouts.

### Subtaken
- [x] `normalize.ts`: URL-normalisatie (+ fingerprint), `slugify` (identiek aan backend, gedeelde testvectoren
      `backend/tests/fixtures/entity_keys.json`), actor-keys, FNV-1a, seeded random
- [x] `summary.ts`: LLM-titel en eerste alinea uit de samenvatting
- [x] `media-landscape.ts`: identiteit van 13 NL-bronnen en ~30 internationale bronnen (namen, aliassen, domeinen,
      spectrum, eigendomstype als redactionele inschatting) + `pmEntityId` naar het propagandamodel
- [x] `input.ts` (+ `ArticleIndex`), `clues.ts`, `graph.ts`, `visibility.ts`, `propaganda.ts`, `compare.ts`,
      `bias.ts`, `timeline.ts`, `wikipedia.ts`, `labels.ts`, `ids.ts`
- [x] `layout/bubbles.ts` (d3-force, rechthoek-botsing, deterministisch)
- [x] `fixtures/demo-event.ts`: twee fictieve demo-events (Dijkerhoven + gerelateerd event)
- [x] Jest-tests ≥ 90% dekking op `lib/explore`
- [ ] `layout/network.ts` → verplaatst naar Story 11.10 (hangt af van de propagandamodel-data)

### Acceptatiecriteria
- [x] Elk insight-veld levert aanwijzingskaarten in het juiste spoor, ook voor oude analyses zonder kritische velden
- [x] Layouts zijn deterministisch en blijven binnen de grenzen (N = 1, 12, 40 ballonnen op 328 px)
- [x] Filtersignalen zonder niveaus of oordelen; lege lijst als er niets te melden is

### Implementatiedetails
- Aanwijzingen verklappen dicht alleen wáár je moet kijken (bronnen, namen, aantallen), niet wát er gevonden is (getest).
- Propagandamodel-filters: `eventFilterSignals` levert per filter bewijsregels die naar de aanwijzing linken
  (eigendom, advertenties, bronnen, flak, ideologie, tegenmacht). Structurele verbanden komen uit Story 11.17.
- Demo: verzonnen verhaal (Dijkerhoven, NordVind, Stichting Stille Polder); bronnamen echt, berichtgeving niet.
- Tests: 99 Jest-tests groen; dekking `lib/explore` 92,7% statements / 96,1% regels.

---

## Story 11.3: UI-fundament

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 11.2

### Beschrijving
Dependencies en herbruikbare bouwstenen: store met persistentie, sheets, tekstballonnen, chips, voortgangsring, toasts,
URL-gekoppelde panelen en een z-index-schaal.

### Subtaken
- [ ] Dependencies: `@xyflow/react`, `d3-force`, `@dnd-kit/core`, `@floating-ui/react`, `vaul`, `zustand`
- [ ] `store.ts` + `storage.ts` (persist-key `pluriformiteit:onderzoek`, versie 1, veilige opslag met fallback)
- [ ] `ui/Sheet`, `ui/Balloon`, `ui/Chip`, `ui/ProgressRing`, `ui/Toast`, `ui/CoachMark`
- [ ] `useUrlPanel` (`?p=`), zodat de terug-knop een sheet sluit
- [ ] z-index-schaal en float-animatie in Tailwind


### Implementatiedetails
- Dependencies: `@xyflow/react`, `d3-force`, `@dnd-kit/core`, `@floating-ui/react`, `vaul`, `zustand` (+ `@types/d3-force`).
- `lib/explore/store.ts` (persist `pluriformiteit:onderzoek` v1, `skipHydration`), `storage.ts` (safeStorage + quota-melding),
  `hooks.ts` (`useExploreHydration`, `useUrlPanel`, `useMediaQuery`).
- `components/explore/ui/`: `Sheet` (vaul; rechterlade ≥1024px), `Balloon` (floating-ui met pijl), `portal-root`, `primitives`
  (Favicon, Chip, Tag, ProgressRing, Eyebrow), `Toast`.
- Let op: `pushState` alleen met eigen state-sleutel, anders synchroniseert Next.js `useSearchParams` niet.

---

## Story 11.4: Nieuwe pagina-shell

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 11.3

### Beschrijving
De nieuwe eventpagina achter de vlag: kop, teaser en samenvatting, bronnen-sheet, lege en foutstaten, dock met
📌-bewaren, demo-route en Playwright-projecten voor mobiel.

### Acceptatiecriteria
- [ ] `/event/demo` werkt op een telefoon (demo-vlag aan) en op desktop
- [ ] Met `NEXT_PUBLIC_EXPLORE_UI` uit blijft de oude pagina ongewijzigd werken
- [ ] Playwright-projecten `desktop-chrome`, `pixel-7`, `iphone-13`


### Implementatiedetails
- `app/event/[id]/page.tsx`: nieuwe UI bij `NEXT_PUBLIC_EXPLORE_UI=1` of een demo-id (`NEXT_PUBLIC_ENABLE_DEMO=true`).
- `ExploreShell` (data, hydratatie, providers, `PanelHost`), `ExploreScreen`, `ExploreHeader`, `SummaryTeaser`, `SourcesRow`,
  `Dock`, demo-banner; `app/event/[id]/error.tsx`.
- Data: `getExploration` (1 kernquery + entiteiten/relaties/bias parallel; degradeert zonder migratie 004),
  `lib/explore/exploration.ts`, `useExploration`.
- Playwright: `playwright.explore.config.ts` met projecten `desktop-chrome`, `pixel-7`, `iphone-13` (WebKit) en eigen
  demo-server; `npm run test:e2e:explore`.

---

## Story 11.5: Sporen & aanwijzingskaarten

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Large
**Depends on**: Story 11.4

### Beschrijving
Zeven onderzoeksvragen vervangen de feature-secties. Een spoor opent een sheet met dichte kaarten; omdraaien onthult.
Elke kaart heeft chips naar gekoppelde bronnen, actoren en andere kaarten.

| Spoor | Combineert |
|---|---|
| Wie zegt wat? | invalshoeken, stances, bronpatronen, geciteerde actoren |
| Wat klopt er niet? | tegenstrijdige claims, ononderbouwde claims, misleidende statistieken, drogredenen |
| Wie heeft er belang bij? | bronkritiek (mandaat, financiering, belangen), timing, eigendom van de media |
| Hoe wordt het gebracht? | frames (eigen vs geciteerd), toon, copy-paste, anonieme bronnen, bias per zin |
| Wat zie je niet? | onderbelichte perspectieven, niet-gestelde vragen, weglating, wetenschappelijke pluraliteit |
| Hoe liep het? | chronologie, "wie was er het eerst?", tijdlijn-scrubber |
| En het buitenland? | internationale artikelen per land, betrokken landen |

### Acceptatiecriteria
- [ ] Voortgang per spoor en per event, bewaard over reloads
- [ ] "Toon alles" per spoor; gedimde tegel met reden als er geen data is


### Implementatiedetails
- `sporen/SporenGrid`, `SpoorSheet`, `ClueCard` (flip, 📌, sleepbaar), `ClueBody` (alle 21 kaarttypes), chips naar bronnen
  (`OutletChip`) en actoren (`ActorButton`); voortgang per spoor, toast bij een afgerond spoor, "Toon alles".

---

## Story 11.6: Invalshoekenkaart

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Large
**Depends on**: Story 11.5

### Beschrijving
Zwevende tekstballonnen, één per (invalshoek, bron). Dicht = favicon + typ-puntjes; open = het standpunt. Lenzen:
Invalshoek · Spectrum · Frame · Tegenspraak. Detailballon per bron (neemt Epic 8.3 op). Lijstweergave voor
toegankelijkheid.


### Implementatiedetails
- `bubbles/BubbleMap` (tekstballonnen met typ-puntjes, halo's per invalshoek, 4 lenzen, ⚡-knoppen bij tegenspraak),
  `BubbleList` (lijstweergave), `outlet/OutletCard` (spectrum, eigendomstype, standpunt, toon, bias, aanwijzingen per bron,
  acties Vergelijk/Bewaar/Bias-zinnen/Netwerk).
- Spectrumlens is een 2D-kaart: horizontaal links ↔ rechts, verticaal gevestigd ↔ alternatief (`establishment` uit de
  Epic 8-referentietabel; alternatieve bronnen krijgen een links-rechtsinschatting `politicalX`). Posities worden als
  redactionele inschatting gemarkeerd; de bronballon toont beide assen (`OutletPosition`).

### Iteratie na feedback (2026-09-30): ballonnen goed zichtbaar
- Gemeld probleem:
  - de typ-puntjes staken uit de dichte ballon;
  - groepslabels werden afgekapt ("Zonde…");
  - labels lagen over de bovenste ballon;
  - halo's van groepen overlapten elkaar;
  - de hint "Tik op een ballon" lag over de onderste ballon.
- Dichte ballon is 80 px breed (favicon + drie puntjes passen).
- `layoutBubbles` (invalshoek/frame) werkt per groep:
  - de ballonnen vormen een zwevend cluster (force-layout, hooguit een kolom breed);
  - de groepen worden als blokken in rijen gezet, dus halo's en labels overlappen nooit;
  - lange labels lopen door op een tweede regel in plaats van afgekapt te worden, met ruimte boven de ballonnen
    (ook voor de zweefanimatie).
- De spectrumkaart houdt haar datagestuurde plaatsing.
- De hint krijgt eigen ruimte onder de kaart zolang hij zichtbaar is.

### Iteratie na feedback (2026-10-01): meteen de invalshoek, zelf bronnen kiezen
- **Invalshoek meteen zichtbaar**: geen typ-puntjes en geen tik-om-te-onthullen meer ("eerst puntjes en daarna klikken
  is nutteloos"). Het gaat om de kaart, de lijstweergave en de bronballon. Eén tik opent de ballon en telt de
  invalshoek als gevonden. Groepslabels zijn niet meer gemaskeerd.
- **Geen "Zonder invalshoek"** ("elke bron heeft een invalshoek"):
  - een bron die de analyse niet indeelde, staat bij de invalshoek waar haar koppen het meest op lijken
    (`lib/explore/nearest.ts`);
  - elk woord stemt met zijn aandeel per invalshoek (label, samenvatting, standpunten, koppen van de leden);
  - er moet een duidelijke winnaar zijn: minstens 1,5× de nummer twee;
  - zo'n ballon is gestippeld ("geschatte invalshoek") en de bronballon legt de schatting uit;
  - zonder duidelijke winnaar blijft de bron "Nog niet ingedeeld" (bijv. een Engelstalige kop).
- **"Wat schreef … ?"** in de bronballon: de titels van de artikelen van die bron, als link.
- **Zelf bronnen kiezen** (`SourcePicker`, "Bronnen in de kaart"):
  - vervangt de aparte pagina "+N buitenlandse bronnen";
  - Nederlandse bronnen staan standaard aan, buitenlandse (met vlag) kun je erbij zetten;
  - de keuze wordt per nieuwsitem bewaard (`EventProgress.sources`);
  - de spectrumkaart plaatst alleen bronnen met een bekende positie en noemt de rest apart.
- **"Wie zweeg?" verwijderd**:
  - zonder context is het vanzelfsprekend;
  - het kan misleiden, want een artikel kan in een ander event gevallen zijn;
  - stilte is pas iets waard bij een belang in het verhaal (idee voor later, via het propagandamodel).
- **"Geen tegenspraak gevonden"** staat boven de kaart in plaats van over de ballonnen.

### Iteratie na feedback (2026-10-01): "Wat schreef …?" zegt wat de bron schreef
- Feedback op de bronballon van Deutsche Welle: "teveel tekst en staat niet wat het schreef".
- **Geen uitlegzin meer.** "De analyse heeft … nog niet bij een invalshoek ingedeeld. Hieronder staat wat het schreef."
  is weg. Een schatting staat er kort als "Geschatte invalshoek: …".
  - Buitenlandse bronnen komen volgens de prompt nooit in een invalshoek; de summary is de enige plek waar de
    analyse ze bespreekt.
- **Wat het schreef**: de zinnen uit de LLM-summary die de bron noemen (`lib/explore/outlet-sentences.ts`).
  - De prompt laat elk feit aan een publicatie toeschrijven ("meldt NOS", "aldus Reuters"), dus deze zinnen zeggen
    wat de bron schreef in de woorden van de analyse. Dat zijn geen artikelteksten, dus het mag (auteursrecht).
  - Namen worden gematcht zoals de aantikbare namen in de summary, met alle bronnen tegelijk. Daardoor telt
    "Een Blik op de NOS" niet als NOS.
  - Een zin als "Dat meldt RTL Nieuws." of "Daarbij …" krijgt de zin ervoor erbij. Op echte data gaat dat om ±8%
    van de zinnen die een bron noemen.
  - De eigen naam staat vet. Standaard is één zin zichtbaar; de rest staat achter "Nog n zinnen".
  - Daaronder blijven de koppen als link staan, zonder de bronnaam (die staat al bovenaan de ballon).
- Aliassen voor namen die feeds en de summary gebruiken: "DW" (Deutsche Welle), "VRT" (VRT NWS), "AP News"
  (Associated Press). Niet "AP": dat is in Nederlandse tekst vaak de Autoriteit Persoonsgegevens.
- Zinsplitser `summarySentences` in `lib/explore/summary.ts`:
  - koppen worden overgeslagen;
  - niet splitsen in "NU.nl", "1.200", "o.a." of initialen;
  - getest op 300 echte summaries.
- Tests: `outlet-sentences.test.ts`; Playwright `onderzoeksmodus.spec.ts` controleert de ballonnen van DW, VRT en De
  Telegraaf, inclusief "Nog 1 zin".
- **Tweede ronde** (feedback "ik kan nog steeds niet echt lezen wat dat medium nou zegt", "aanwijzingen bij DW slaat
  nergens op", "nietsnuttig balkje van het buitenland"):
  - Van buitenlandse artikelen kennen we alleen de kop. Google News levert geen tekst: `content` is de kop plus de
    bronnaam. Wat de summary over een buitenlandse bron zegt, is dus een gok op basis van de kop.
  - Bij buitenlandse bronnen staat onder "Wat schreef …?" daarom alleen de kop, met "Van buitenlandse media hebben we
    alleen de kop." eronder. De summaryzinnen verschijnen daar niet.
  - De aanwijzing "international" is weg. Dat was per land een balkje met alleen de buitenlandse koppen, en het
    stond ook als "Aanwijzingen bij DW" in de bronballon.
  - Het spoor "En het buitenland?" toont alleen nog de landen die een rol spelen ("Waarom Duitsland?").
  - In de artikelregels van een bronballon staat geen favicon meer: het logo staat al bovenaan de ballon.
- **Derde ronde: buitenlandse tekst ophalen + Nederlandse kern** (eigenaarsbesluit 2026-10-01, "Tekst ophalen +
  NL-kern"):
  - Backend `services/article_digest.py`:
    - haalt de tekst van een buitenlands artikel op bij de uitgever (trafilatura);
    - laat de LLM in hoogstens twee Nederlandse zinnen, in eigen woorden, zeggen wat het meldt (prompt
      `llm/templates/article_digest_prompt.txt`, overschrijfbaar met `llm_config.prompt_article_digest`);
    - bewaart alleen die kern in `articles.source_metadata.digest` (`nl`, `basis`, `provider`, `model`,
      `generated_at`). De tekst zelf wordt niet opgeslagen (databasegrootte) en nooit getoond (auteursrecht).
  - Lukt ophalen niet (paywall), dan is de kern de kop in het Nederlands (`basis: "title"`).
  - Provider: `llm_config.provider_digest`, anders die van de feitenanalyse (nu DeepSeek). Mistral stond op
    2026-10-01 op 0 verzoeken per minuut.
  - Job "Article Digest": elke 15 minuten, 10 artikelen, alleen artikelen van de laatste 72 uur
    (`ARTICLE_DIGEST_*`). Oudere artikelen van actief nieuws via `POST /admin/trigger/article-digests`
    (backfill). Eén artikel: `POST /admin/trigger/article-digest/{id}`.
  - Een probleem bij de aanbieder (rate limit, quotum, storing) stopt de batch zonder het artikel iets aan te
    rekenen. Een onbruikbaar antwoord telt als mislukking; na 2 mislukkingen slaan batches het artikel over.
  - Frontend:
    - `getExploration` leest `digest:source_metadata->digest`;
    - in de bronballon staat bij een buitenlands artikel de kern in plaats van de kop, of "alleen de kop"
      zolang er geen kern is;
    - een tik opent het artikelpaneel `artikel:<id>` (`article/ArticleSheet.tsx`): de kern, waar die op
      gebaseerd is, de invalshoek met kernboodschap als het artikel in een cluster zit, en de originele kop als
      link.
  - Ballonnen zijn 340 px breed in plaats van 300 ("grotere popup").
  - Droge test op echte artikelen (zonder schrijven), met DeepSeek, ±1,3 s per kern:
    - BBC en Al Jazeera: kern uit de tekst;
    - New York Times: paywall, dus kern uit de kop.
  - Tests: `backend/tests/unit/test_article_digest.py` (14), `outlet-sentences.test.ts` (kern inlezen),
    Playwright `onderzoeksmodus.spec.ts` (kern in de ballon, artikelpaneel).

---

## Story 11.7: Slepen & bewaren

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 11.6

### Beschrijving
Lang indrukken (250 ms) en slepen naar het dossier of het vergelijk-bakje (dnd-kit), met 📌-knop en toetsenbord als
alternatief. Scrollen blijft werken.


### Implementatiedetails
- `dnd/ExploreDnd` (TouchSensor 250 ms/8 px, MouseSensor 6 px, NL-aankondigingen, DragOverlay), `DraggableOutlet`,
  dropzones in de dock en een strook in elke sheet. Het vergelijk-bakje verschijnt bóven het dossier zodat het doel niet
  verschuift tijdens het slepen.

---

## Story 11.8: Backend — entiteiten & gerelateerde events

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Large

### Beschrijving
Migratie `004_explore_entities_relations.sql` met `event_entities` (canonieke personen, organisaties, plaatsen, landen
met tellingen per bron) en `event_relations` (verwante events met score en redenen). Berekend na elke
insight-generatie en na het dagelijkse onderhoud; admin-endpoints voor backfill en status. Schrijft nooit naar `events`.

### Acceptatiecriteria
- [ ] Relaties in beide richtingen, top 12 per event, score ≥ 0,30, met redenen (entiteit, land, categorie, thema)
- [ ] Alleen events met een LLM-titel; weergavevelden gedenormaliseerd
- [ ] RLS aan met alleen-lezen policy voor `anon`
- [ ] Pytest ≥ 80% dekking op de nieuwe modules


### Implementatiedetails
- Migratie `database/migrations/004_explore_entities_relations.sql`; `EventEntity`/`EventRelation`-modellen;
  `nlp/entity_keys.py` (gedeelde `slugify`), `event_entity_service.py`, `related_events_service.py`, `exploration_service.py`,
  `repositories/exploration_repo.py`; hooks na insight-generatie en na het dagelijkse onderhoud; admin-endpoints
  `/admin/trigger/exploration*` en `/admin/exploration/status`.
- 143 nieuwe pytest-tests (95–99% dekking op de nieuwe modules). Getest op 454 echte events uit `data/app.db`.
- Openstaand besluit: `RELATED_EVENTS_MIN_SCORE` (nu 0,30) eventueel naar 0,40.

---

## Story 11.9: Volg het spoor + Wikipedia

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 11.8

### Beschrijving
Gerelateerde events met reden-chips, entiteit- en actorballonnen met Wikipedia-samenvatting (nl, anders en; "Bedoel
je…?" bij doorverwijspagina's) en "Ook in het nieuws" via `event_entities.aliases`.


### Implementatiedetails
- `related/RelatedTrail` (reden-chips), `entity/EntitySheet` (rol in dit nieuws, vermeldingen per bron, Wikipedia met
  "Bedoel je…?", "Ook in het nieuws" via `getEntityAppearances`, koppeling met het propagandamodel).

### Iteratie na feedback (2026-09-30)
- **Wikipedia bij elke entiteit**, ook personen en knopen uit het propagandamodel: automatisch op naam
  (`entity/Wikipedia.tsx`: nl-titels → nl-zoekhit met gelijke titel → en; "Bedoel je…?" bij doorverwijspagina's; niets
  tonen zonder zekere match). Eénregelige omschrijving in de netwerk-tooltip.
- **Wie schreef wat?** (`entity/ArticleMentions.tsx`, `lib/explore/coverage.ts`):
  - "Wie noemt X?" (dit nieuws): per medium een balk; tik op een medium voor de titels van wat het schreef.
  - "Ook in ander nieuws" (EntitySheet) / "Wie schreef erover?" (propagandamodel-knoop, alle nieuws): wissel
    "Per medium" (standaard) ↔ "Per nieuwsitem"; artikelen linken naar hun nieuwsitem ("in: …").
  - In de netwerk-tooltip één regel "In het nieuws" met favicons en aantallen.
  - Data: `event_entities.article_ids` (migratie 004, gevuld door de backend) via `getEntityArticles(aliases,
    {excludeEventId, kind, demo})`; alleen titels als link, nooit artikeltekst.
- **Zoek in alle artikelen**: RPC `search_articles` (004; `websearch_to_tsquery('dutch')`, GIN-index `idx_articles_fts`,
  titels eerst, dan nieuwste; geeft alleen verwijzingen terug).

---

## Story 11.10: Netwerk met propagandamodel

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Large
**Depends on**: Story 11.5, 11.9, 11.17

### Beschrijving
Full-screen netwerk (`/event/[id]/netwerk`) met lenzen Propagandamodel · Actoren · Frames · Tegenspraak · Gerelateerd.

- **Propagandamodel** = het project `propaganda-model` (NL-mediamachtsgraaf). Instap: de bronnen en actoren van het
  event, gekoppeld aan het model. Elke tik klapt de buren van een knoop uit, zodat je het hele model zelf kunt
  doorlopen; zoeken naar elke actor kan ook. Randen gekleurd per filter (eigendom, advertentie, sourcing, flak,
  ideologie, tegenmacht; kleuren uit de huisstijl van het propagandamodel).
- Simpel eerst (naam, type, filter, verbanden); "Meer weten" toont beschrijving, mechanisme, datums en bronnen.
- Vijf-filterpaneel: structurele verbanden uit het model + signalen uit de AI-analyse van dit event, als bewijs
  zonder oordeel (geen meting, ranglijst of beschuldiging — conform de datalicentie van het propagandamodel).
- Fog-of-war voor de event-lenzen; sheet "Over het model" (neemt Epic 8.6 op) met bronvermelding
  "Propagandamodel — NL-mediamachtsgraaf, dataset vX.Y.Z".


### Implementatiedetails
- Route `app/event/[id]/netwerk`; `network/NetworkView` (lenzen, zoeken, filterlegenda, paneel per knoop),
  `NetworkCanvas` (React Flow, lazy), `layout/network.ts` (incrementele d3-force-layout), `network-scene.ts`
  (fog-of-war + spookknopen), `pm-graph.ts`, `pm-store.ts`, `usePmExplorer`, `PmDetailsSheet` ("Meer weten"),
  `FiltersSheet` (structuur + signalen per filter), `ModelSheet`.

### Iteratie na feedback (2026-09-30)
- **Standaard alleen Eigendom, Bronnen en Ideologie**; de andere filters (en "Overig") aan te zetten in de legenda.
- **Uitbreiden = de graaf groeit**, niets vervaagt of wordt onklikbaar. Eén knop "Breid uit · N" (via de filters die
  aan staan) met ▾ "Alleen via …" (zet dat filter aan); de tooltip sluit en het beeld glijdt naar de nieuwe buren.
  Eén verzoek per filter, zodat elk filter zijn eigen belangrijkste verbanden meebrengt.
- **Tooltips** bij de knoop (i.p.v. een paneel onderin) en bij randen (hover = voorbeeld, klik = vastzetten met
  "Meer weten" en "Naar …"); **pijlen** alleen bij gerichte relaties (niet bij alliantie/oppositie/wederzijds).
- **Ongedaan maken / Opnieuw** (knoppen linksboven, ⌘Z / ⇧⌘Z / Ctrl+Y). Opgehaalde data blijft bewaard, dus opnieuw
  doen haalt niets opnieuw op; laden die na een ongedaan maken binnenkomen veranderen de graaf niet.
- **Bundels in plaats van elke bron ooit** (NOS heeft in het model 94 verbanden via Bronnen, grotendeels losse
  citaten): per knoop en filter worden alleen de best verbonden buren getekend (5 als je langs dat filter uitbreidde,
  anders 1). Buren die twee getekende knopen verbinden (gedeelde eigenaar of bron, zoals ANP) staan er altijd. De rest
  wordt één "+N"-bundel per filter. Tik op de bundel:
  - **Met wie?**: verdeling over de zes typefamilies van het propagandamodel (Politiek & bestuur, Personen,
    Denktanks & lobby, Media, Economie & eigendom, Wetenschap & maatschappij).
  - **Hoe?**: de belangrijkste mechanismen.
  - **Lijst van wat niet getekend is**: tik om een partij in het netwerk te zetten, of zet een hele familie erin.
    Dat is één stap om ongedaan te maken; alleen dat verband komt erbij, de rest van het beeld blijft staan.
- **Datacontract** (migratie 005):
  - `pm_relations.filters` = primair filter ∪ `mechanism_filters`.
  - `pm_neighborhood(p_entity_id, p_limit, p_filters text[])` geeft `filter_counts` en `breakdown` terug: per filter
    het type van de andere partij en het mechanisme, alleen aantallen, over alle verbanden.
  - Gevalideerd op een wegwerp-Postgres met de echte sync: 2.390 anon-aanroepen, 0 verschillen met het Python-model.
- Ontwikkeling: E2E en buildchecks draaien met `NEXT_DIST_DIR=.next-test` (in `playwright.explore.config.ts`), zodat
  ze nooit de bestanden van een lopende `npm run dev` overschrijven.

---

## Story 11.11: Bronvergelijker

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Should Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 11.7

### Beschrijving
Twee bronnen naast elkaar: invalshoek, toon, eigen frames, geciteerde stemmen, bronpatroon, bias, niet-gestelde vragen
en onderlinge tegenspraak (neemt Epic 8.5 op, binnen één event).


### Implementatiedetails
- `compare/CompareSheet` + `lib/explore/compare.ts`: versus-rijen, verschillen gemarkeerd, onderlinge tegenspraak; na de tweede
  bron opent de vergelijker vanzelf.

---

## Story 11.12: Bias-zinnen verkennen

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Should Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 11.4

### Beschrijving
Swipe-deck met bevooroordeelde zinnen per bron/artikel (voorkant: zin; achterkant: type, eigen tekst vs quote, score,
uitleg) en bias per bron op eventniveau (neemt Epic 10.6 op).


### Implementatiedetails
- `bias/BiasDeckSheet`: swipe-deck (framer-motion drag), omdraaien voor uitleg, citaten optioneel, bewaren per zin;
  biasdata rechtstreeks uit Supabase.

---

## Story 11.13: Tijdlijn-scrubber

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Should Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 11.5

### Beschrijving
Schuif door de tijd: een baan per bron, artikelstippen, LLM-tijdlijnmarkers en "eerst gemeld door ...".


### Implementatiedetails
- `timeline/TimelineScrubber` in het spoor "Hoe liep het?": banen per bron, artikelstippen, markers, voorgeschiedenis,
  "eerst gemeld door…"; verschuiven onthult tijdlijnkaarten.

---

## Story 11.14: Onderzoeksbord

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Large
**Depends on**: Story 11.3, 11.7

### Beschrijving
`/onderzoek`: verzamelde kaarten vrij slepen, verbinden met gelabelde draadjes, eigen notities en links toevoegen,
suggesties voor verbanden over events heen, lijstmodus en export/import.


### Implementatiedetails
- Route `/onderzoek`: `board/OnderzoekScreen` + `BoardCanvas` (React Flow; kaarten slepen, draadjes via tik-tik,
  labels, gestippelde suggesties die je met één tik verbindt), lijstweergave, notities, export/import, "Laatst onderzocht".
- `lib/explore/suggestions.ts`: gedeelde sleutels (zelfde bron/naam/land/propagandamodel-actor), over events heen zwaarder.

---

## Story 11.15: Overstap & opruimen

**Status**: 🔲 To Do
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium
**Depends on**: alle voorgaande

### Beschrijving
Nieuwe UI standaard aan, oude eventcomponenten verwijderen (na grep), documentatie bijwerken, bundel- en
toegankelijkheidsaudit, volledige E2E-set.


### Stand (2026-09-30)
- Nog niet uitgevoerd: wacht tot de nieuwe pagina met echte data (Supabase weer aan) is bekeken.
- Bundel `/event/[id]`: 229 kB (nulmeting) → 322 kB, waarvan de oude pagina nog deel uitmaakt; React Flow en react-markdown
  zitten niet in de eerste lading van de nieuwe pagina.
---

## Story 11.17: Propagandamodel-koppeling (backend)

**Status**: ✅ Done (2026-09-30)
**Prioriteit**: Must Have
**Geschatte complexiteit**: Large
**Depends on**: Story 11.8

### Beschrijving
De lokale backend synchroniseert het propagandamodel (`~/Workspace/propaganda-model/data/propaganda_model.db`,
alleen-lezen) naar Supabase: alleen `status='goedgekeurd' AND NOT vervangen`, zonder politieke-positie- en
machtsvalentielagen. De tabellen zijn niet direct leesbaar voor `anon`; de frontend gebruikt alleen RPC-functies die
per stap een klein stukje graaf teruggeven, zodat je het hele model kunt verkennen zonder dat de dataset in één keer
te downloaden is.

### Subtaken
- [ ] Migratie `005_propagandamodel.sql`: `pm_entities`, `pm_relations`, `pm_sources`, `pm_aliases`, `pm_meta`;
      RLS aan zonder anon-policies; RPC's `pm_match`, `pm_neighborhood`, `pm_search`, `pm_details`, `pm_meta_info`
      (SECURITY DEFINER, uitvoerbaar door `anon`)
- [ ] Sync-service + admin-endpoint + scheduler (alleen als het bestand gewijzigd is), `PROPAGANDA_DB_PATH`
- [ ] Koppeling: bronnen via vaste mapping (13 feeds), actoren via exacte aliassen + typecheck (geen fuzzy bij personen)
- [ ] Pytest ≥ 80%

### Aanvulling in het propagandamodel
Ontbrekende actuele eigendomsrelaties (o.a. DPG Media → AD/NU.nl/Volkskrant/Trouw/Parool) worden met bronnen als
`voorgesteld` klaargezet in propaganda-model; de gebruiker keurt ze goed.


### Implementatiedetails
- Migratie `database/migrations/005_propagandamodel.sql` (`pm_*`-tabellen, RLS zonder anon-policies, 5 RPC-functies),
  `backend/app/services/propaganda_model_sync.py` (alleen-lezen, uitsluitingen mechanisch gecontroleerd), scheduler (elk uur
  bij wijziging), admin `/admin/trigger/propagandamodel-sync` en `/admin/propagandamodel/status`, `scripts/export_pm_demo_slice.py`.
- Proefrun op de echte database: 1.195 actoren, 2.091 relaties, 2.287 bronnen; propaganda-model ongewijzigd.
- Frontend: `pmMatch/pmSearch/pmNeighborhood/pmDetails/pmMeta` (demo via `pm-local.ts` + `fixtures/demo-pm.json`).
- In propaganda-model staan 7 actuele eigendomsrelaties en 2 uitgevers als `voorgesteld` klaar (goedkeuren via `/overleg`).

---

## Story 11.16: Handmatige stappen (gebruiker)

**Status**: 🔲 To Do
**Prioriteit**: Must Have
**Geschatte complexiteit**: Small
**Depends on**: Story 11.8, 11.15

### Subtaken
- [ ] Supabase-project weer aanzetten (of backup herstellen in een nieuw project)
- [ ] `database/migrations/004_explore_entities_relations.sql` draaien (opnieuw als hij al gedraaid is: voegt
      `article_ids`, `idx_articles_fts` en `search_articles` toe; het bouwen van de index blokkeert schrijven naar
      `articles` kort, dus liefst als de backend stilstaat), backend herstarten, backfill met `force=true` pagina voor
      pagina tot `done` (`POST /admin/trigger/exploration-backfill?limit=100&offset=0&include_archived=true&force=true`)
- [ ] `database/migrations/005_propagandamodel.sql` (opnieuw) draaien; de volgende sync vult `filters` vanzelf
      (formaatwissel) of direct met `POST /admin/trigger/propagandamodel-sync?force=true`
- [ ] Vercel: `NEXT_PUBLIC_ENABLE_DEMO=true` (Production + Preview); bij de overstap `NEXT_PUBLIC_EXPLORE_UI=1`
- [ ] Eigendomsfeiten in `frontend/lib/explore/media-landscape.ts` controleren en `verified: true` zetten
- [ ] Telefoon-checklist (iPhone Safari, Android Chrome)

---

## Risico's

| Risico | Impact | Mitigatie |
|---|---|---|
| Dunne of oude analyses | Lege sporen | Afgeleide kaarten, eerlijke lege tegels, nieuwe events krijgen volledige analyses |
| Propagandamodel leest als beschuldiging | Vertrouwen | "Aanwijzing", bewijs zichtbaar, disclaimer, methode-sheet, "te verifiëren" |
| Gebarenconflicten op mobiel | Frustratie | Delay/tolerantie, `touch-action`, 📌-fallback, touch-E2E |
| localStorage-verlies | Dossier kwijt | Veilige opslag, export/import, melding in de UI |

## Definition of Done (Epic)
- [ ] Alle stories afgerond; oude eventpagina verwijderd
- [ ] Jest, Playwright (desktop + mobiel) en pytest groen; lint en typecheck schoon
- [ ] Demo op Vercel bruikbaar op een telefoon
- [ ] Documentatie (`CLAUDE.md`, `docs/architecture.md`, `database/README.md`) bijgewerkt

## Referenties
- Herman, E. S. & Chomsky, N. (1988). *Manufacturing Consent*.
- Epic 8: `docs/stories/active/epic-8-media-spectrum-visualization.md`
- Epic 10: `docs/stories/active/epic-10-sentence-level-bias-detection.md`
