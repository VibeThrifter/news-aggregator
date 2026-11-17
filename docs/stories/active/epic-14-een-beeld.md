# Epic 14: Eén beeld — de eventpagina als samenhangend analysegereedschap

## Overzicht

Feedback van de eigenaar (2026-10-02) op de Onderzoeksmodus (Epic 11–13):
- "Onderzoek het zelf" en "Volg het spoor" zijn dom; het moet geen spelletje zijn, maar een tool om te ontdekken en
  te analyseren.
- "Wie zegt wat?" met de ballonnen is een goede basis.
- Stapels kaartjes zijn onoverzichtelijk en onsamenhangend: alles moet duidelijk en visueel met elkaar verbonden zijn.
- Later: "geen spel betekent niet dat alles meteen open moet staan". Doorklikken, openen en verbinden blijven.

```
Kop: datum · bronnen · "Ook in n andere nieuwsitems over dit verhaal ›" · titel · kern (namen tikbaar) · landen
Wie zegt wat?      één beeld: bronnen, de sprekers die ze aan het woord laten, "Niet aan het woord"
                   genummerde markeringen (! claim, # cijfer, ↯ redeneerfout, ⚡ tegenspraak, lege stemmen)
Tabs               Invalshoeken · Klopt het? · Wie praat? · Wat ontbreekt? · Hoe gebracht? · Tijdlijn
                   compacte rijen, inline openklappen; nummer ↔ ballon springen heen en terug
Wie zit erachter?  per partij uit het nieuws hoe ze de bronnen bereikt, met de toelichting uit het model
Bronnen en artikelen
```

### Besluiten (2026-10-02)

| Besluit | Keuze |
|---|---|
| Opzet | Eén vast beeld + tabs eronder; tabs herschikken het beeld niet |
| Bewaren | Slepen en zwevende Dock weg; "Bewaar" op bevindingen, bronnen, sprekers; "Bewaard (n)" in de kop |
| Netwerkpagina | Alleen het propagandamodel ("Wie zit erachter?"): event-lenzen en spookknopen weg |
| Versplinterde events 1–2 okt | Niet opnieuw clusteren; ze verschijnen in de Tijdlijn als eerdere/latere afleveringen |

### Wat de data liet zien
- Sinds 2026-10-01 had elk event precies één Nederlands artikel (zie Story 14.0). Ook daarvoor had maar ±5% ≥ 2
  NL-bronnen. Het beeld werkt daarom in de eerste plaats voor één artikel met de stemmen erin.
- Bijna altijd gevuld: claims met spreker (98%), ontbrekende stemmen (100%), toon/bronpatroon/niet-gestelde vragen
  (100%), autoriteiten met belang (66%). Zeldzaam: tegenspraak (3%).

---

## Story 14.0: Backend — bronnen weer samenvoegen

**Status**: ✅ Done (2026-10-02)

- Event-toewijzing: een mislukte of onduidelijke LLM-aanroep is geen "nieuw event" meer; de scores beslissen
  (`LLMEventDecision` in `event_service.py`). De provider komt uit `llm_config` (`provider_event_assignment`, anders
  `provider_factual`) via `backend/app/llm/providers.py` (`StepLLMClient`, `build_llm_client`).
- Classificatie gebruikt `provider_classification` (in Supabase op `deepseek` gezet).
- Ingest: dedupe op guid met savepoint (RTL verloor hele batches), `.astext` → `.as_string()` (AD faalde elke poll).
- Achtergebleven artikelen: `EventService.assign_orphaned_articles` (ontbrak, terwijl `/admin/trigger/assign-events`
  hem aanriep) + een inhaalslag in elke poll-cyclus (`IngestService.catch_up_orphans`, 25 artikelen van ≤ 72 uur,
  eigen time-out).
- Vectorindex herbouwt ook als er events in de DB staan die in de index ontbreken.
- Google News: alleen artikelen binnen 7 dagen van het event (`within_event_window`).
- Backend herstart als één proces (de digest-job draaide niet; er liep een tweede oud proces).
- Resultaat na herstart: o.a. RTL+Telegraaf, NU.nl+AD, Telegraaf+AD in één event; kernen van buitenlandse artikelen.
- Tests: `tests/unit/test_pipeline_recovery.py` (9), `tests/integration/test_event_assignment.py` (geen netwerk meer,
  LLM gestubd; 5). Vooraf al falend en los hiervan: `test_insight_pipeline`, `test_google_news` (1),
  `test_prompt_builder` (3).

## Story 14.1: Geen spel meer + store v2

**Status**: ✅ Done

- Weg: speurmodus, onthullen, voortgangsringen, hints, "spoor onderzocht", fog-of-war (`visibility.ts`,
  `network-scene.ts`, `graph.ts`), `ProgressRing`, sporen-tegels en -sheets, kaartjes, drag & drop (`dnd/*`, Dock).
- `lib/explore/clues.ts` → `findings.ts`: `Finding` met `tab`, ids `<type>:<hash>` (de oude clue-id zonder spoor,
  `legacyFindingId`).
- Store v2: `migrateState` (quest-state weg, dossier-"clue" → "finding" met dezelfde id zodat draadjes blijven),
  `sanitizePrefs` (allow-list; voorkomt crashes door hernoemde waarden).

## Story 14.2–14.5: Het beeld, sprekers, tabs en koppeling

**Status**: ✅ Done

- `lib/explore/speakers.ts`: parseert `source_in_article` ("NU.nl (eigen bewering)", "X (geciteerd via NU.nl)",
  "Naam (Org)", "Naam, rol", anoniem, media als "via"), samengevoegd met `authority_analysis`.
- `lib/explore/figure.ts`: groepen per bron (1 NL-bron) of per invalshoek (≥ 2; tot 2026-10-19 pas vanaf 3), Buitenland (via de
  bronnenkiezer), "Niet aan het woord"; vaste nummering per event.
- UI in `components/explore/map/`: `NewsFigure`, `SpectrumMap` (Links/rechts), `FindingsTabs`, `FindingRow`,
  `FindingDetail`, `StemmenTab` (met matrix ● aan het woord / ○ genoemd), `TijdlijnTab`, `PeopleCards`, `Markers`.
- Koppeling: `lib/explore/focus.ts` (springen + ring 2 s), deeplink `?f=<findingId>`, oude links
  `?p=spoor:X&c=Y` werken nog.

## Story 14.6–14.7: Profielen, kop, Tijdlijn, Wie zit erachter?

**Status**: ✅ Done

- Bron-popover: wat schreef …, "In dit nieuws" (één regel per vraag met nummers, `lib/explore/lens-index.ts`),
  Vergelijk/Bewaar/Wie zit erachter?.
- EntitySheet: "In dit nieuws" met rol, claims en belang i.p.v. "?"-teasers.
- Tijdlijn (`lib/explore/chronology.ts`): voorgeschiedenis, eerdere afleveringen, dit nieuws, tegelijk verschenen,
  latere afleveringen, "Waarom nu?". Relaties met alleen thema/categorie/land vallen weg; ijkpunt is het eerste
  NL-artikel (oude buitenlandse artikelen maakten de eventstart soms maanden te vroeg). Sinds Story 14.26 één as in
  één kaart, zonder "Dezelfde mensen in ander nieuws".
- `why/WhoIsBehind.tsx`: routes, geladen zodra het blok in beeld komt.
- Netwerkpagina: alleen het propagandamodel; `focus=outlet:<key>` werkt nu.

## Story 14.8: Tests, docs

**Status**: ✅ Done

- Jest 222 groen (nieuw: `figure.test.ts`, `speakers.test.ts`; aangepast: model, store, layout, suggestions).
- Playwright explore 84 groen (desktop-chrome, pixel-7, iphone-13).
- `next build` (in `.next-test`) slaagt.

### Demo (2026-10-03)
- Het demoverhaal bestaat uit vier items (`lib/explore/fixtures/demo-event.ts` + `demo-thread.ts`):
  - `/event/demo`: 8 NL-bronnen, invalshoeken, tegenspraak, sprekers (anoniem, via ANP, omwonende, ecoloog, RIVM, PBL).
  - `/event/demo-aanloop`: eerdere aflevering.
  - `/event/demo-vervolg`: latere aflevering met één NL-bron (de gewone situatie), sprekers, lege stemmen en een oud
    buitenlands artikel met datum.
  - `/event/demo-verbeek`: ander nieuws met de wethouder (sinds Story 14.26 via de naam: "Ook in ander nieuws").
- Echte instanties (RIVM, PBL, ANP, Ipsos I&O) staan erin zodat "Wie zit erachter?" echte routes uit het
  propagandamodel toont; hun uitspraken en rol in het verhaal zijn verzonnen (banner).
- "Belang"-label alleen bij genoemde belangen of een analyse die partij niet onafhankelijk noemt; financiering alleen
  telt niet (RIVM).
- "Alle bronnen en artikelen" klapt op de pagina open (geen sheet meer).
- Jest 225, Playwright explore 93 groen.

## Story 14.9: Zelf invullen

**Status**: ✅ Done (2026-10-03)

Feedback eigenaar (2026-10-03): "zou ook chill zijn als je bij dingen zoals 'niet aan het woord' ook zelf dingen
kon invullen".

Elke vraag kun je ook zelf beantwoorden. Wat je toevoegt wordt een bevinding zoals die van de analyse
(`lib/explore/own.ts`, `withOwn`): genummerd, in het beeld, in de tab, te bewaren en te verbinden op het bord.

| Tab | Toevoegen | Velden | In het beeld |
|---|---|---|---|
| Klopt het? | Twijfel | wat wordt er beweerd · wie zegt het · waarom · bron | ! op die spreker of bron |
| Wie praat? | Spreker | naam · rol · bij welke bron · wat zegt hij of zij | ballon of pil in de groep van die bron |
| Wat ontbreekt? | Ontbrekende stem · Vraag | wie · waarom; vraag · aan wie | lege stem in "Niet aan het woord"; ? op die spreker of bron |
| Hoe gebracht? | Opmerking | wat valt je op · bij wie · bron | ✎ op die spreker of bron |
| Tijdlijn | Moment | wanneer · wat · bron | punt op de as, op datum |

- Waar: "＋" onder elke tab, "＋ Toevoegen" in "Niet aan het woord" (staat er nu altijd), "＋ Spreker" per bron, en
  "＋ Twijfel"/"＋ Vraag" in de sprekerpopover (opent het formulier in de tab, spreker al gekozen). Het formulier klapt
  open waar je tikt, nooit in een zijpaneel.
- Herkenbaar: label "jij" en omlijnde nummers (de analyse heeft gevulde). Eigen nummers komen ná die van de analyse;
  de analyse houdt haar nummers.
- Aanpassen en verwijderen (met ongedaan maken) in de rij en in de popover. Op het bord als "Twijfel · jij" enz.
- Opslag: `own` in de explore-store per event-id, alleen op dit apparaat, maximaal 100 per nieuwsitem, opgeschoond
  bij het lezen (`sanitizeOwnEntry`: bekende soort, lengtes, alleen http(s)-links). Export en import van het dossier
  nemen ze mee.
- Wat je toevoegt telt niet mee in de analyse (vergelijken, filters). Eigen sprekers (persoon of organisatie) zoekt
  "Wie zit erachter?" wel meteen op in het propagandamodel.
- "Bewaard"-sheet: de oude tekst over slepen is weg.
- Tests: `__tests__/explore/own.test.ts` (8), `store.test.ts` (+5), `tests/explore/zelf-invullen.spec.ts` (4 × 3
  apparaten).

## Story 14.10: Stemmen zoeken (Zoek met AI)

**Status**: ✅ Gebouwd (2026-10-03). Wacht op migratie 009, een admincode en een backendherstart (zie Handmatig).

Wens eigenaar (2026-10-03): bij "Niet aan het woord" laat AI zoeken naar dat perspectief. Een gevonden bron mag
worden goedgekeurd en wordt dan een bron van het nieuws, zodat het perspectief groter wordt. Dat geldt ook voor
ontbrekende stemmen die je zelf bedenkt. Alleen voor betalende gebruikers en admin. Besluit (AskUserQuestion): **eerst
alleen admin**, met een admincode; betalende gebruikers later.

### Praktijktest (vooraf)
`scripts/experiment_missing_voices.py`, 45 ontbrekende stemmen van 15 echte nieuwsitems (25 sep – 2 okt):
- In 23 (51%) komt de stem zelf aan het woord in een artikel over hetzelfde nieuws; ruim genomen in 26 (58%).
- Per soort stem:
  - ontbrekende context: 71%;
  - een concrete groep of organisatie: 52%;
  - algemene experts: 20%.
- Per zoekweg:
  - eigen database (A): 31%;
  - hetzelfde nieuws op Google News (D): 31%;
  - twee LLM-zoekopdrachten (B): 22%;
  - namen van mogelijke bronnen (C): 9%, en C voegde niets toe.
  A en D samen vinden 21 van de 23.
- De LLM-controle klopte in 60–75% van zijn treffers. Daarom keurt de admin goed.
- Waarom het mislukt:
  - de stem bestaat nergens;
  - 44% van de Google-artikelen levert alleen een kop op (betaalmuur of cookiemuur);
  - ANP-kopieën;
  - breaking news.

### Hoe het werkt
- **App**:
  - "Zoek met AI wie dit wél zegt" staat in de kaart van elke ontbrekende stem (van de analyse of door jou toegevoegd)
    en in de rij in "Wat ontbreekt?". Je ziet hem alleen met een code die mag zoeken.
  - De status loopt van wachtrij via zoekt naar *n bronnen gevonden* of niemand gevonden.
  - Per bron zie je wie er praat, de kern, de kop als link, en de knoppen "Voeg toe aan dit nieuws" / "Klopt niet" /
    "Haal weg".
- **Database** (`database/migrations/009_stemmen_zoeken.sql`):
  - tabel `access_codes`, met alleen de sha256 van een code, en `voice_searches`;
  - RPC's `access_code_role`, `request_voice_search`, `voice_searches_for_event` en `review_voice_candidate`;
  - RLS staat aan zonder policies;
  - wie mag zoeken bepaalt `voice_search_role_allowed()`: nu `admin`, later `pro` erbij;
  - limieten: 30 zoektochten per code per dag, 200 per dag in totaal, en dezelfde stem binnen 10 minuten geeft de
    lopende zoektocht terug.
- **Goedkeuren**:
  - het artikel komt in `articles` (guid `voice:<md5(url)>`), of het bestaande wordt gekoppeld;
  - de koppeling in `event_articles.scoring_breakdown.found_voice` zegt wie er praat, de kern en welke stem het
    beantwoordt;
  - terugdraaien haalt alleen weg wat de zoektocht maakte.
- **Backend**:
  - job "Voice Search", elke 5 seconden (eerst elke minuut), maximaal 2 zoektochten (`VOICE_SEARCH_*`), via
    `backend/app/services/voice_search.py`;
  - stappen (sinds 2026-10-07, zie "Sneller met Google"): Gemini met Google Search (G) zoekt en beoordeelt in één
    aanroep, en tegelijk plan (LLM) → eigen database (A) → controle (LLM);
  - zonder G (`provider_voice_web` = `google-news`) of als G faalt, de oude route: hetzelfde nieuws op Google News (D)
    → teksten (betaalmuur telt als geen tekst, ANP-kopieën één keer) → controle (LLM). Niets gevonden bij een
    concrete groep of context? Dan de twee zoekopdrachten (B);
  - wat blijft: hetzelfde nieuws, de stem zelf (of de context concreet), de tekst gelezen, zekerheid ≥ 0,6. Eerst
    was dat 0,7, maar de zekerheid schommelt per run rond die grens en jij keurt toch alles goed. Elk oordeel staat in
    `voice_searches.stats.verdicts`, voor het bijstellen;
  - de provider komt uit `llm_config.provider_voice_search`, anders `provider_factual`;
  - handmatig: `POST /admin/trigger/voice-search`.
- **Beeld, voor iedereen**:
  - de gevonden stem praat bij de bron waar hij gevonden is, met het label "gevonden"; een bron uit het buitenland
    staat dan ook standaard in het beeld;
  - de ontbrekende stem krijgt een microfoon en "· wél bij Trouw";
  - de kaart toont "Wél aan het woord";
  - een bron die alleen hiervoor is toegevoegd zegt "Laat … aan het woord".
- **Demo**: de zoektocht wordt in de browser gesimuleerd (`lib/explore/fixtures/demo-voices.ts`, met verzonnen bronnen
  voor de boeren en de energiecoöperatie). Ook in de demo heb je een admincode nodig.
- **Tests**:
  - backend `tests/unit/test_voice_search.py` (8);
  - Jest `found-voices.test.ts` (5);
  - Playwright `stemmen-zoeken.spec.ts` (3 × 3 apparaten);
  - migratie 009 lokaal getest op PostgreSQL 15: twee keer draaien, rollen, limieten, goedkeuren en terugdraaien;
  - de job tegen die database gedraaid met een gestubde LLM.

### Aangezet (2026-10-04)
- Migratie 009 is gedraaid op Supabase. Admincode 1 (Eigenaar) is gemaakt; je vult hem in op /admin →
  Toegangscode. De backend is herstart en de job "Voice Search" draait.
- LLM: het DeepSeek-tegoed was op. Op verzoek van de eigenaar doet Claude Code nu alle AI-stappen.
  - Provider `claude-code[:model]` in `backend/app/llm/claude_code.py` start lokaal `claude -p`: het abonnement, geen
    API-sleutel, geen tools, geen projectcontext. Het schema gaat mee als `--json-schema`.
  - Kiesbaar per stap op /admin/llm-config.
  - Nu ingesteld:
    - feitelijk, kritisch en Zoek met AI: `claude-code:sonnet`;
    - classificatie, event-toewijzing, kern buitenlandse artikelen en bias: `claude-code:haiku`.
  - Proef: een echte feitelijke analyse duurde 12 s (Sonnet), een kern 12 s (Haiku).

### Sneller met Google (2026-10-07)
Vraag eigenaar: "waarom duurt Zoeken met AI zo lang? … Dat killt de UX. Google of Perplexity zou dit super goed en snel
kunnen."
- Gemeten bij de zoektocht naar NSC-partijleiding: 80 s, en niets gevonden.
  - 42 s wachtrij: de job keek één keer per minuut.
  - 39 s zoeken:
    - plan (Sonnet, 5 s);
    - eigen artikelen, Google News met pauzes en pagina's ophalen (16 s);
    - controle (Sonnet, 5 s);
    - B (11 s) voor niets: Trouw, de Volkskrant en Parool (cookiemuur), IJmuider Courant en BNR (403) gaven geen
      tekst.
- Nu:
  - De job kijkt elke 5 s (`VOICE_SEARCH_INTERVAL_SECONDS`). APScheduler's regels over deze job blijven uit het log.
  - G (`backend/app/llm/web_search.py`): Gemini 2.5 Flash met Google Search zoekt en beoordeelt in één aanroep,
    tegelijk met A. Google heeft de artikelen achter de muren wel gelezen.
  - De links zijn Google-doorverwijzingen. Alleen die van de eigen zoekresultaten tellen, dus een verzonnen link
    valt af. Een artikel dat al bij het nieuws hoort, van buiten de week of met zekerheid < 0,6 valt ook af.
  - D en B alleen nog als G faalt. Bij 503 (overbelast, vanavond 2 op de 3 keer) eerst één keer opnieuw.
  - Kiesbaar op /admin/llm-config, "Zoek met AI: zoeken op het web": Google (Gemini) of Google News
    (`provider_voice_web`, ook `gemini-search:<model>`).
- Proef zonder iets op te slaan, NSC-partijleiding: 22 s en 2 bronnen waarin het NSC-bestuur zelf reageert (Trouw via
  A, Nieuws.nl via G). Gemini alleen duurt 12–18 s.
- Kosten:
  - de Gemini-sleutel zit in de gratis laag, met een daglimiet per model; is die op, dan volgt de oude route;
  - betaald: ±1 cent per zoektocht (±1.900 tokens in, ±3.700 uit met denken), Google Search gratis tot 1.500 per
    dag;
  - Perplexity Sonar: ±0,6–2 cent per zoektocht, eigen betaald account nodig.
- Tests: `test_voice_search.py` (15), `test_web_search.py` (10).

### Nog sneller: vondsten meteen in beeld (2026-10-09)
Eigenaar: "Zoeken met AI · admin duurt erg lang nog".
- Gemeten bij de eerste echte zoektocht via de nieuwe route (zoektocht 5, huisregels rond vlaggen): 3 s wachtrij,
  35 s zoeken.
  - G 22 s: Gemini dacht zelf na (4.300 tokens uit).
  - A 35 s: plan en controle via Claude Code wachtten op een vrije plek achter het nieuws (de inhaalslag na een
    herstart). Zonder wachtrij is A met Sonnet 14–16 s; Haiku was trager (35–62 s).
- Nu:
  - G met een denkbudget van 1024 tokens (`VOICE_SEARCH_WEB_THINKING_BUDGET`): 5–17 s.
    - Zonder denken was het 2–6 s, maar het vond minder: niets bij 3 van 5 zoektochten, waar 1024 wel iets vond.
    - Eén keer kwam er geen JSON.
  - A via `gemini-fast` (`backend/app/llm/gemini_fast.py`): Gemini 3.5 Flash met zo min mogelijk denken, 1–3 s per
    stap, A in 6–10 s.
    - Zelfde oordelen als Sonnet bij zoektochten 3 en 5.
    - Faalt Gemini, dan doet de aanbieder van de feitenanalyse (Claude Code) de stap opnieuw.
    - Kiesbaar op /admin/llm-config bij "Zoek met AI (ontbrekende stemmen)".
  - Vondsten verschijnen zodra G of A ze heeft: de rij krijgt ze terwijl de status nog 'bezig' is en de app kijkt
    dan elke 1,5 s.
    - Elke vondst houdt zijn nummer (c1 …), dus de admin kan meteen goedkeuren.
    - Een latere schrijfactie laat goed- en afkeuringen staan (`keep_reviews`, met een rijslot zoals
      `review_voice_candidate`).
    - Gaat het zoeken daarna mis, dan blijven de getoonde vondsten staan.
  - `stats.timings` noteert per zoektocht wanneer plan, controle, G en de eerste vondst klaar waren (ms).
- Gratis laag van Gemini: 20 verzoeken per dag per model (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`).
  - G gebruikt 2.5 Flash, de enige met Google Search in de gratis laag (3.x geeft 429), dus ±20 zoektochten per dag.
  - A gebruikt daarom een eigen model (3.5 Flash).
  - Is een limiet op, dan volgt de oude route (G) of Claude (A).
  - Betaald (±1 cent per zoektocht) heft dat op.
- De Gemini-sleutel ging als `?key=` in de URL en stond zo in `logs/app.log` (httpx logt URL's). Hij gaat nu in de
  header `x-goog-api-key`.
- Tests: `test_voice_search.py` (19), `test_web_search.py` (10), `test_gemini_fast.py` (7).

### Later
- Elk gevonden artikel tegen álle ontbrekende stemmen van het item controleren: één artikel beantwoordt soms een
  andere stem.
- Tekst achter cookiemuren ophalen met de toestemming van de feedlezers (DPG, Telegraaf, NU.nl). G leest wat Google
  daar zag; alleen de oude route heeft dit nog nodig.
- Perplexity Sonar als tweede zoekmodel in `provider_voice_web`.
- Betalende gebruikers: accounts en betalingen, en dan `pro` toelaten in `voice_search_role_allowed()`.

## Story 14.11: Wie zit erachter? leesbaar

**Status**: ✅ Done (2026-10-05)

Feedback van de eigenaar: "beïnvloedt en wordt beïnvloed door klopt semantisch niet echt en deze graph geeft niet
echt nuttige info". Wat er misging:
- het label kwam van het kale relatietype `beinvloeding`; de betekenis zit in het mechanisme;
- de vertaling ging uit van "bron → doel", maar het model slaat lidmaatschap en dienstverband beide kanten op op
  ("CDA is lid van Kathleen Ferrier");
- routes waarin twee partijen allebei een derde beïnvloeden, verschenen gewoon. Een voorbeeld: "de Volkskrant zet de
  agenda van RTL, RIVM is bron voor RTL". Juist zulke routes kwamen bovenaan, omdat ze "alleen de Volkskrant" waren;
- de toelichting van het model ("RIVM was primaire bron tijdens de coronacrisis") stond pas achter een tik.

Wat het nu doet:
- **Labels per mechanisme** (`lib/explore/labels.ts`):
  - "is vaste bron voor" en omgekeerd "leunt als bron op";
  - "levert experts en analyses aan", "zet de agenda van", "bepaalt het bereik van";
  - voor alle mechanismen bij `beinvloeding`; onbekende worden "beïnvloedt via <mechanisme>".
  - Affiliaties lezen vanuit de persoon, hoe het model ze ook opslaat (`labelSourceId`, `relationWords`). Dat geldt
    overal: het netwerk, de actorpagina, het filterscherm, de minikaart en het detailvel.
- **Alleen routes die iets verklaren** (`meaningfulRoute` in `lib/explore/why.ts`). Eén stap telt altijd. Bij twee
  stappen hoort de tussenstap bij één van beide kanten: eigenaar, programma, medewerker, lid of geldgever (de
  NOS-uitzending Nieuwsuur, PBL-directeur Hekkert). Anders moet het een bronketen zijn van de partij naar het
  medium (bedrijf → ANP → NU.nl). "Europese Commissie censureert TikTok, TikTok bepaalt het bereik van de NOS" valt
  dus weg. Dit filter geldt ook voor "Media verbonden met dit nieuws".
- **Per partij gegroepeerd** (`behindParties`). Dat levert regels als:
  - "**RIVM** is vaste bron voor NOS en de Volkskrant";
  - "**PBL** heeft als medewerker Marko Hekkert ↳ Marko Hekkert treedt op als deskundige bij NOS".
  Media met hetzelfde verband delen één regel. Eronder staat de toelichting van het model, met voorrang voor de stap
  die de invloed draagt. "onzeker" en "historisch" staan erbij. Tik opent de bronnen. Na 3 partijen en 2 regels per
  partij volgt "Nog n verbanden".
- **Routekaarten** (`RouteList`, filterscherm en actorpagina): de route leest vanaf wie de invloed heeft. De pijl
  toont de richting, ↕ bij wederzijds of erbij horen.
- **Gemeten** op 12 echte nieuwsitems (26 sep–5 okt) plus het geval van de eigenaar: 14 routes gehouden, 9 vielen weg.
- **Tests**:
  - Jest `why.test.ts`: nu 8 tests, met het RIVM/PBL-geval;
  - Playwright `waarom-zo.spec.ts` en de demo-test van `onderzoeksmodus.spec.ts` (desktop + Pixel 7).
- **Data**: DPG Media → NU.nl/AD/de Volkskrant/Trouw (`eigendom`) staat in het propagandamodel nog op `voorgesteld`.
  Daardoor valt "RIVM → DPG Media → NU.nl" (via zelfcensuur) weg. Na goedkeuring verschijnt hij vanzelf via eigendom.

## Story 14.12: Waarop rust dit?

**Status**: ✅ Done (2026-10-05). Live: migratie 010 gedraaid, backend herstart, sync geforceerd (2.418 argumenten, 157 mechanismen).

Feedback van de eigenaar op 14.11:
- "kan wat genuanceerder en betere uitleg"
- "claim gebaseerd op 1 eerdere bron van NOS?"

Wat er in het model zat, maar niet in de app:
- PBL → NOS ("levert experts en analyses aan") rust op één ongecontroleerd argument: "De PBL Klimaat- en
  Energieverkenning wordt door NOS als gezaghebbend feit doorgegeven (24 okt 2024)". De enige bron is het
  PBL-persbericht zelf.
- De beschrijving van RIVM → NOS ("Frame werd vrijwel onkritisch overgenomen") is de tekst van een vervangen
  argument. Het huidige argument is genuanceerder: Medialogica/HUMAN, "het beeld ontstond dat …".
- RIVM → de Volkskrant/AD/De Telegraaf/DPG: argumenten **betwist**, zonder bron.
- De corona-relatie RIVM → NOS heeft nuance in het model ("een jaar later erkende het RIVM de aerogene route wél").

Wat het nu doet:
- **Sync, format 5** (`propaganda_model_sync.py`):
  - `collect_arguments` exporteert per relatie de argumenten die een lezer mag zien: claim (≤ 600 tekens),
    voor/tegen/nuance, reviewstatus, waar het over gaat, reacties onder hun ouder, en ≤ 3 bronnen (titel, url,
    uitgever, datum, soort, citaat);
  - nooit afgewezen of niet-gemergede argumenten (behalve het nieuws-scout-bewijs bij automatisch
    goedgekeurde relaties), nooit onder smaad-hold, nooit classificatiedebatten of de uitgesloten lagen;
  - `mechanism_rows` levert de uitleg per mechanisme (zonder de interne kruisverwijzingen van het model);
  - live: 2.418 argumenten (2.216 ongecontroleerd, 125 betwist, 10 geverifieerd; 78 tegen, 51 nuance) en
    157 mechanismen.
- **Migratie `010_pm_argumenten.sql`**:
  - tabellen `pm_arguments` en `pm_mechanisms`, beveiligd als 005 (RLS zonder policies, geen grants);
  - `pm_details` geeft bij relaties ook `arguments`, `source`/`target` en `mechanism_description`/`_effect`;
  - nieuw: `pm_relation_arguments(ids)`, de argumenten van ≤ 40 relaties in één keer.
  - Lokaal getest op PostgreSQL 15: 005 → 007 → 008 → 010 (twee keer), echte snapshot geschreven, als `anon`
    aangeroepen. `anon` kan de tabellen niet lezen.
- **Frontend**:
  - `lib/explore/evidence.ts` maakt van de argumenten een graad (gecontroleerd, met bron, zonder bron,
    betwist, verouderd, geen) en één regel als "1 bron: persbericht · niet gecontroleerd" of "betwist ·
    zonder bron", met "1 nuancering" en "2 tegenargumenten" erbij.
  - In "Wie zit erachter?" staat onder elke regel de claim van het sterkste argument (3 regels) en die regel.
    Regels splitsen op onderbouwing en staan sterkste eerst; betwist en verouderd zijn grijs (`behindParties`
    met `rankOf`).
  - Het detailvel (`PmEvidence.tsx`, ook op de actorpagina):
    - de titel is een zin ("PBL levert experts en analyses aan NOS");
    - eerst "Onderbouwing: …", dan "Wat het model bedoelt met …";
    - daaronder "Waarop het rust", "Nuance" en "Tegenargumenten", elk met status en bronnen.
  - Zonder migratie 010 valt alles terug op de oude weergave.
- **Demo**: alleen de relaties van de echte instanties uit het demo-verhaal (RIVM, PBL, ANP, Ipsos I&O) krijgen
  argumenten (`DEMO_ARGUMENT_FOCUS`, max 4 per relatie). De grens van de demo-slice ging van 480 naar 560 KB
  (514 KB, alle bronnen behouden).
- **Tests**:
  - pytest: pm-sync, demo-slice, service en contract van migratie 010, samen 115;
  - Jest: `evidence.test.ts` (5) en `why.test.ts` (9), in totaal 270 groen;
  - Playwright explore: 82 groen (desktop + Pixel 7).

**Aanzetten**:
1. Migratie 010 draaien op Supabase.
2. De backend herstarten: de sync weigert te schrijven zolang een pm-tabel leesbaar is voor `anon`.
3. Sync forceren: `POST /admin/trigger/propagandamodel-sync?force=true`.

Draait 005 ooit opnieuw, draai dan 010 daarna weer.

## Story 14.13: Dun bewijs — tonen en laten uitzoeken

**Status**: ✅ Done (2026-10-06). Live: migratie 011, de backend is herstart en de rondes staan aan
(`NIEUWS_BEWIJS_ENABLED=true`, max 2 per dag, 08–22 uur).

Vraag van de eigenaar (2026-10-05):
- "deze verbanden zullen er vast wel zijn alleen het bewijs mag wel beter … wat doen we met mager bewijs.. meer
  bewijs zoeken en intussen laten zien dat bewijslast nog dun is ofzo?"
- "Dit gaat natuurlijk ook over propaganda model"

Stand van het model op 2026-10-05: van de 801 invloedsverbanden zijn er 25 "onderbouwd", 658 "aannemelijk"
(meestal één bron) en 118 "onzeker". Dun bewijs is in het model de regel, geen uitzondering.

Besluiten:
- **Tonen.** Dun bewijs wordt niet verstopt en niet als feit gebracht:
  - vooraan staat één oordeel: stevig onderbouwd, dun bewijs, onbewezen, betwist of verouderd;
  - daarbij staat wat er ontbreekt;
  - een bron van de partij zelf heet zo ("persbericht van PBL zelf").
- **Uitzoeken in het propagandamodel**, waar het bewijs staat. Dat gaat via de pijplijn van Epic 12:
  - de app zet een dun verband dat lezers zien als doel in de pm-wachtrij;
  - een pm-agent zoekt bewijs vóór én tegen;
  - een mens beoordeelt.
- **Wat de agent vindt, blijft `voorgesteld`** tot de eigenaar het keurt. Invloedsclaims blijven mensenwerk; de
  autokeur raakt ze niet. De lezer ziet "uitgezocht: 3 nieuwe argumenten wachten op beoordeling", niet de inhoud.
- **Niets wat een lezer stuurt, bereikt de agent.** De aanvraag bevat alleen relatie-id's en een event-slug. Het
  doel bouwt de backend uit het model en uit de eigen events.
- **Rondes kosten Opus.** Ze staan standaard uit en gaan pas aan na een OK van de eigenaar: maximaal 2 per dag,
  tussen 08 en 22 uur.

Wat het doet:
- **Frontend** (`lib/explore/evidence.ts`):
  - `verdictOf`:
    - stevig: het model noemt het verband "onderbouwd" (`certainty_label`, minstens twee onafhankelijke
      bronclusters), of, zonder label, een gecontroleerd argument met twee onafhankelijke bronnen;
    - dun: wel een bron, maar niet stevig;
    - onbewezen: geen bron;
    - betwist en verouderd: zoals de argumenten zeggen.
  - `fromParty`/`ownSourcesOnly` herkennen een eigen bron aan de eigen website of de uitgever.
  - Verder: `evidenceGaps`, `researchNote`, `VERDICT_RANK`.
  - "Wie zit erachter?":
    - het label met het oordeel staat vóór de onderbouwing;
    - de regels staan in de volgorde van het oordeel;
    - onbewezen, betwist en verouderd zijn grijs;
    - de status van het uitzoeken staat eronder.
  - De eventpagina meldt haar dunne verbanden aan (`request_relation_research`).
  - Detailvel (ook op de actorpagina):
    - "Onderbouwing: [dun bewijs] 1 bron: persbericht van PBL zelf · niet gecontroleerd";
    - "Wat ontbreekt: …";
    - de status van het uitzoeken;
    - bij elke bron "van PBL zelf" waar dat zo is.
- **Migratie `011_bewijs_zoeken.sql`**:
  - tabel `relation_research`, RLS zonder policies;
  - `request_relation_research(ids, slug)`:
    - hooguit 12 id's per aanroep;
    - alleen verbanden die niet onderbouwd zijn, en geen banden tussen persoon en organisatie;
    - een herhaling binnen 10 minuten telt niet, en er gaan hooguit 300 aanmeldingen per uur in;
  - `relation_research_status(ids)`: hooguit 40 id's, en nooit het verslag van de agent.
  - Lokaal getest op PostgreSQL 15 met de echte pm-data: twee keer gedraaid en als `anon` aangeroepen.
- **Backend** (`services/evidence_research.py`, job "Evidence Research", elke 15 minuten):
  1. Haal de status uit de pm-wachtrij.
  2. Zet aangevraagde dunne verbanden in de pm-wachtrij, hooguit 6 per dag. Het doel bevat de nieuwsberichten,
     wat het verband nu draagt (`evidence_line`, bv. "1 argument vóór (niet gecontroleerd); 1 bron: persbericht
     van PBL zelf; niets ertegen ingebracht") en wat ontbreekt.
  3. Start een ronde van `nieuws-bewijs` als `NIEUWS_BEWIJS_ENABLED` aanstaat.

  Admin: `POST /admin/trigger/evidence-research[/{relation_id}]` en `GET /admin/evidence-research/status`. De
  runner van Epic 12 kan nu elke pm-agent starten (label, account, brief, extra argumenten).
- **Propagandamodel** (zusterproject):
  - `nieuws_doelen` kreeg de soort `relatie` en de kolom `relation_id`, via de herbouw
    `scripts/migrate_nieuws_doelen_relatie.py`. Die is live gedraaid, met een backup.
  - Claimen en bijwerken gaat per soort: `nieuws-scout` alleen namen, `nieuws-bewijs` alleen relaties. De
    autokeur kijkt nooit naar bewijsdoelen.
  - De missie `missies/nieuws_bewijs_brief.md`:
    - toetst of de bestaande bron de claim draagt (zo niet: een ondergraving);
    - zoekt vóór én tegen (het protocol van de documentalist);
    - checkt of het mechanisme past (aspect `mechanism`);
    - doet hooguit 2 doelen per ronde, en alles blijft `voorgesteld`.
  - Account `nieuws-bewijs` (bijdrager).
  - `agent_runner.py --doel-soort relatie`; de launchd-taak `nieuws-bewijs` in `agent_schedule.py` staat
    standaard uit.
  - `scout_indienen.py` kan nu ook reacties en clusters indienen.
  - De pm-server is herstart.
- **Tests**:
  - pytest: `test_evidence_research.py` (11);
  - Jest: `evidence.test.ts` (+4), in totaal 274 groen;
  - pm: `scripts/test_nieuws_doelen.py` (stap 1b, 14 en 15), plus de autokeur-, fresh-build- en auth-tests;
    `validate_model.py --strict` is groen;
  - Playwright explore: 82 groen (desktop + Pixel 7);
  - backend unit: 622 groen. 4 rood: Google News en de promptbouwer, die falen ook op de laatste commit.
- **Gecontroleerd op echte data** (migratie 010 live), westnijlvirus: "RIVM is vaste bron voor NOS" toont dun
  bewijs (1 bron, HUMAN/VPRO, niet gecontroleerd), en "is vaste bron voor DPG Media" is betwist en grijs. Zonder
  migratie 011 ontbreekt alleen de status van het uitzoeken.

**Aangezet (2026-10-06, op verzoek van de eigenaar)**:
1. Migratie 011 gedraaid op Supabase, vóór de backendherstart (anders maakt `create_all()` de tabel zonder RLS).
2. `NIEUWS_BEWIJS_ENABLED=true` in `.env` gezet en de backend herstart.
3. Proefronde op PBL → NOS (`POST /admin/trigger/evidence-research/1564`, daarna handmatig één ronde, want het was
   buiten de actieve uren): 214 s, Opus.
   - **Ondergraving** op argument 2322: de bron is het persbericht van PBL zelf en zegt niets over hoe de NOS het
     bracht.
   - **3 vóór**: NOS-berichten bij de KEV van 2024, 2025 en 2026, met PBL als enige deskundige of als maatstaf.
   - **3 tegen**: NOS bracht kritiek op het PBL (CDA en GroenLinks 2019, Aedes 2020) en een kanttekening van een
     kabinetsbron (2022).
   - **Mechanisme**: `institutioneel_gezag` past beter dan `expert_framing`; precedent is CPB → NOS.
   - Alle 6 bronnen zijn NOS-artikelen, dus één broncluster. Vier citaten steekproefsgewijs gecontroleerd op
     nos.nl: ze staan er letterlijk.
   - Negatieve resultaten (ombudsman, NOS-verantwoording, geen inhoudsanalyse gevonden) staan alleen in het
     ronde-log.
   - In de app: "Uitgezocht: 8 nieuwe argumenten wachten op beoordeling". Ze tellen pas mee na een merge in
     `/overleg`.

## Story 14.14: Meer zelf invullen — drogreden, tegenspraak, fout, bron

**Status**: ✅ Done (2026-10-06)

Wens eigenaar (2026-10-06): naast "niet aan het woord" ook drogredenen, tegenstellingen, fouten en nieuwe bronnen
kunnen toevoegen, en die delen (Story 14.15).

| Tab | Toevoegen | Velden | In het beeld |
|---|---|---|---|
| Klopt het? | Drogreden | welke (de soorten van de analyse) · welke redenering · wie · waarom klopt die niet | ↯ op die spreker of bron |
| Klopt het? | Tegenspraak | waarover · wie zegt het één · wie het andere · wat zeggen ze · bron | ⚡ op beide kanten (zie hieronder) |
| Klopt het? | Fout | wat is er fout · waar · wat klopt wel · bron | ✕ naast het nummer dat hij verbetert |
| Wie praat? | Bron | link · wat brengt deze bron · kop · wie komt er aan het woord | een eigen ballon |

- **Fout**: "Klopt niet" bij elke bevinding van de analyse opent het formulier met die bevinding erboven (`about`).
  De ✕ komt op dezelfde ballon als die bevinding. Die rij krijgt het label "fout volgens jou" en toont wat je
  schreef.
- **Tegenspraak**: alleen als er twee kanten te kiezen zijn. Een spreker zonder eigen ballon (bij groepen per
  invalshoek, of een buitenlandse bron) telt als zijn bron. Staat er maar één kant in het beeld, dan komt het
  nummer op die kant.
- **Tegenspraak in het beeld** (eigenaar 2026-10-14: "geen schijnverband maken en maak duidelijk wat het is als er
  wel een verband is"), voor die van de analyse en die van jou. Een lange lijn dwars door het beeld suggereerde een
  verband met de bronnen waar hij overheen liep.
  - Een gestippelde lijn met ⚡ in het midden komt er alleen tussen twee kanten in dezelfde groep die naast of onder
    elkaar staan. Zo'n lijn kruist geen andere ballon.
  - Elke andere ballon van de tegenspraak krijgt "⚡14 ≠ NOS": nummer plus de andere kant, onder aan de ballon.
    Dat geldt voor alle bronnen van beide kanten, en voor elke kopie van een bron die in twee invalshoeken staat.
  - Een tik opent de bevinding. "Toon in het beeld" laat alle kanten tegelijk oplichten.
  - Het model staat in `figure.ts`: `contradictions` (lijnen tussen buren) en `contradictionNotes` (per
    `placeKey(groep, anker)`).
- **Bron**: "＋ Bron" in de bronnenkiezer en onder Wie praat?. Een link van een medium dat al in het nieuws zit,
  hangt aan die bron. Een nieuw medium komt in `Exploration.ownOutlets`, niet in `input`. Wat de analyse vond
  (toeschrijving, nummers, groepering per invalshoek) verandert dus niet. `index.outlet()` vindt hem wel, zodat er
  sprekers, twijfels en tegenspraak aan kunnen hangen. Bij groepen per bron krijgt hij een eigen groep, bij groepen
  per invalshoek staat hij in "Bronnen van jou".
- **Opslag** als in 14.9:
  - `OwnEntry` krijgt `fallacy`, `against`, `about` en `title`;
  - `sanitizeOwnEntry` eist per soort wat die nodig heeft (een bekende drogreden, twee verschillende kanten, een
    weblink) en laat velden van een andere soort weg.
- **Tests**: `__tests__/explore/own-kinds.test.ts` (8) en `store.test.ts` (+1).

## Story 14.15: Van anderen — delen en overnemen

**Status**: ✅ Done (2026-10-06)

Vraag eigenaar (2026-10-05): kan een lezer analyses en suggesties bij een nieuwsitem delen, zonder dat iedereen
wordt overladen met slechte ideeën van anderen?

Het eerste voorstel was een AI-toets met goedkeuring vooraf. Besluit eigenaar (2026-10-06):
- "Alles wat extra AI-kracht kost is admin only."
- In plaats daarvan: "iets om interessante takes in te zoeken en die te selecteren die je goed vindt".
- Ook bronnen, drogredenen, tegenstellingen en fouten moeten deelbaar zijn.

### Hoe het werkt
- **Delen**:
  - "Deel" staat bij alles wat je zelf toevoegde. Het is anoniem en je trekt het altijd in met "Niet meer delen".
  - Aanpassen en verwijderen werken door.
  - Wat je overnam, deel je niet opnieuw.
  - Bij een gedeeld punt staat "gedeeld · n lezers", of "verborgen na meldingen".
- **Van anderen**:
  - Staat onder elke tab en is dicht tot je hem opent, bij elk nieuwsitem opnieuw.
  - Eén regel per punt, hoeveel lezers ook hetzelfde deelden: zelfde soort, waar het aan hangt en dezelfde woorden;
    een bron telt op zijn link.
  - Zoeken (vanaf 5), filteren op soort (vanaf 4) en de volgorde "Meeste lezers" (gedeeld plus overgenomen) of
    "Nieuwste".
  - In de popover van een spreker of bron staat wat anderen daarover deelden.
- **Neem over**: het punt wordt een eigen punt met het label "overgenomen", en pas dan staat het in je beeld. Niets
  van anderen staat ongevraagd in het beeld. "Heb je al" verschijnt als je hetzelfde zelf al schreef.
- **Geen AI, geen accounts**: een willekeurige sleutel van dit apparaat (`pluriformiteit:apparaat`) maakt wat je
  deelde van jou. De database bewaart alleen de sha256 ervan.
- **Tegen misbruik**:
  - "Meld" kent vier redenen: spam, beledigend, privépersoon en anders. Een gemeld punt is weg voor wie het meldt.
    Na 3 meldingen is het verborgen voor iedereen tot de admin kijkt.
  - Limieten: per apparaat 30 per nieuwsitem en 60 per dag; samen 3000 per dag.
  - Links van anderen tonen alleen de domeinnaam en hebben `rel="nofollow ugc"`.
  - Citaten zijn hoogstens 300 tekens.
- **Admin**:
  - "Gemeld door lezers" op /admin, met toon weer, verberg en verwijder.
  - "Verberg · admin" bij elk punt.
  - De enige AI blijft "Zoek met AI", alleen voor de admin.
- **Demo**: nagespeeld op het apparaat (`lib/explore/fixtures/demo-shared.ts`), met verzonnen lezers en bronnen
  (example.org, `.example`).

### Database (migratie 012)
- Tabellen `shared_entries`, `shared_entry_adoptions` en `shared_entry_reports`, met RLS zonder policies.
- RPC's `share_entry`, `unshare_entry`, `shared_entries_for_event`, `adopt_shared_entry`, `report_shared_entry`,
  `shared_entries_reported` en `moderate_shared_entry`.
- De frontend roept alleen deze functies aan, via `lib/shared.ts`. Er is geen backendjob, dus het werkt ook als de
  lokale backend uit staat.
- Lokaal getest op PostgreSQL 15 als rol `anon`, met 16 controles:
  - delen, bijwerken en intrekken;
  - ongeldige invoer per soort;
  - overnemen telt één keer per apparaat, en je eigen punt kun je niet overnemen;
  - 3 meldingen verbergen, zichtbaar voor de auteur;
  - moderatie alleen met de admincode;
  - limieten, en verwijderen met het event;
  - tabellen en hulpfuncties zijn niet direct te lezen.

### Tests
- `__tests__/explore/others.test.ts` (8).
- `tests/explore/van-anderen.spec.ts` (6 × 3 apparaten).

### Later
- Bij veel lezers: wie vaak punten deelt die anderen overnemen, mag meekeuren. Daarna een brugscore zoals bij
  Community Notes: een punt telt als lezers die het meestal oneens zijn het allebei nuttig vinden.
- Delen via een link met wie jij kiest.

## Story 14.16: Niemand beoordeelt met de hand

**Status**: ✅ Done (2026-10-06). Live: de automatische beoordeling draait elke 2 uur en direct na elke bewijsronde.

Eigenaar (2026-10-06), op "beoordeel de 8 voorstellen in /overleg": "ik ga niks handmatig beoordelen.. veel te
veel werk.. maak dat beter en schoon ook op". De wachtrij in het propagandamodel telde toen 177 argumenten, 91
relaties en 31 entiteiten. Het oudste item stond er sinds juli.

Besluit: het propagandamodel beslist zelf, met onafhankelijke controles. De mens kan alles terugdraaien maar
hoeft niets te doen. Theorielaag en RfC's blijven buiten de automaat. Vastgelegd in de `CLAUDE.md` van het
propagandamodel, § "Automatische beoordeling".

Wat het doet (`scripts/automatische_beoordeling.py` in het propagandamodel):
1. **Bronchecker** (A1, `scripts/bronchecker.py`, account `bronchecker`):
   - haalt elke bron opnieuw op (live, het archief of Wayback);
   - zoekt het citaat letterlijk terug;
   - laat Claude Sonnet oordelen of de bron de feitelijke inhoud van de bewering draagt;
   - een storing geeft geen oordeel, maar een nieuwe poging in de volgende ronde.
2. **Aanklager** (A2, Opus, max 2 rondes per dag): probeert elke invloedsclaim te weerleggen.
3. **Immuunpoort** (A7). Twee nieuwe routes:
   - neutrale structuurfeiten (lid van, werkt bij, bestuurder van) mergen op de bronchecker alleen;
   - een bezwaar dat de bronchecker bevestigt, merget ook.

   Invloedsclaims vergen beide controles. Wat een persoon raakt en geen structuurfeit is, merget nooit
   automatisch.
4. **Relaties en entiteiten** met gecontroleerd bewijs gaan de graaf in.
5. **Opruimen**: wat de bron niet draagt, of na 14 dagen niet te bevestigen is, wordt verworpen of afgewezen. De
   reden staat in het `edit_log`, en het is terug te draaien.

In de app:
- "Uitgezocht: 3 nieuwe argumenten worden gecontroleerd" in plaats van "wachten op beoordeling".
- Een argument met een automatisch nagelezen bron heet "automatisch gecontroleerd". In het detailvel staat bij
  die bron "citaat teruggevonden". Dat gebeurt via sync format 6: `checked` in de bron-JSON, zonder migratie.
- Dun bewijs blijft dun: twee NOS-artikelen zijn één bewijslijn. "Stevig" komt pas met twee onafhankelijke
  bronnen (het model noemt dat "onderbouwd").

Eerste rondes (2026-10-06):
- **Ronde 1**:
  - 165 argumenten gecontroleerd en 102 gemerged;
  - 24 relaties en 19 entiteiten goedgekeurd;
  - 51 argumenten en 31 relaties of entiteiten opgeruimd;
  - één aanklager-ronde.
- **Steekproef**: de eerste versie van de bronchecker eiste dat een bron ook de duiding van het model noemde
  (bv. "tegenmacht" bij PILP/SyRI). Daardoor zijn 10 argumenten ten onrechte opgeruimd. Versie 2 beoordeelt
  alleen de feiten.
- **Ronde 2**: 26 twijfelgevallen opnieuw bekeken en 8 gemerged.
- **PBL → NOS**:
  - vóór: KEV 2024 en 2025, automatisch gecontroleerd;
  - tegen: kritiek van CDA en GroenLinks (2019) en van Aedes (2020);
  - het oude argument op basis van het persbericht van PBL zelf is aangevochten;
  - het argument over de kabinetsbron viel bij de aanklager af.

Tests:
- propagandamodel: `scripts/test_automatische_beoordeling.py` (nieuw); `test_auto_merge`, `test_immuunsysteem`,
  `test_nieuws_autokeur`, `test_nieuws_doelen` en `test_fresh_build` groen;
- nieuws-app: pytest (sync format 6, de ronde na een bewijsronde) en Jest groen.

### Open
- PBL → NOS valt onder `expert_framing`. De definitie daarvan gaat over denktanks die sponsors betalen, en PBL
  is een planbureau van de overheid. De missie `nieuws-bewijs` toetst of het mechanisme past (aspect `mechanism`).
- `influenceOf` en `pm_influence_side` (migratie 008) gaan er nog van uit dat lidmaatschap/dienstverband als
  "lid → groep" zijn opgeslagen. De vragen "Invloed op/van X" tellen omgekeerd opgeslagen affiliaties daardoor de
  verkeerde kant op. Oplossen vergt een wijziging van 008 op Supabase.
- `embedding_similarity`/`entity_overlap` worden nog niet gebruikt; "zelfde verhaal" werkt op gedeelde namen.
- Oude events (dec 2025) hebben dunnere analyses; het beeld toont dan minder sprekers.

## Story 14.17: Agents doen alles

**Status**: ✅ Done (2026-10-06). Live: de automatische beoordeling van het propagandamodel draait elk uur.

Eigenaar (2026-10-06), bij RIVM → De Telegraaf ("betwist · zonder bron") en RIVM → NOS ("niet gecontroleerd"):
"als er geen bronnen zijn moet een agent op zoek gaan", "hier staat niet gecontroleerd.. laat een agent het dan
controleren.. haal human uit de loop en laat agents alles doen in propaganda model".

Waarom het niet soepel liep:
- de automatische beoordeling las alleen nieuwe voorstellen. Wat al in het model stond (≈2.400 argumenten onder
  verbanden, ≈800 onder entiteiten), was nooit gecontroleerd, en alleen een mens kon "geverifieerd" zetten;
- 125 oude argumenten hadden geen enkele bron. In juli zette de eigenaar ze op "betwist" ("onvoldoende te
  sourcen"); de app toonde dat als "betwist", alsof iemand ze had weerlegd;
- diep onderzoek (Opus) volgt alleen verbanden die een lezer zag, met hooguit 6 per dag.

Wat er nu gebeurt, in het propagandamodel (§ "Vervolg dezelfde dag: agents doen alles" in zijn `CLAUDE.md`):
1. **Bronzoeker** (`scripts/bronzoeker.py`): bij argumenten zonder (goede) bron zoekt Claude Sonnet op het web een
   bron met een letterlijk citaat. Het script haalt die bron zelf op en zoekt het citaat terug. Wat standhoudt,
   wordt een revisie, die langs de gewone controles gaat. Een herformulering moet dezelfde partijen noemen.
   Een argument dat om de inhoud betwist werd (perifeer, weerlegd), raakt hij niet aan.
2. **Controle van alles**: de bronchecker leest ook wat al gemerged is, en wat lezers zien gaat voor.
3. **Verificatie**: draagt de bron de bewering, dan wordt het argument "geverifieerd" (telt in het model twee keer
   zo zwaar als "ongecontroleerd"). Draagt hij haar niet, dan "bronvermelding nodig", en de bronzoeker zoekt een
   betere. Wat een mens zelf besliste, blijft staan.
4. **Heropenen**: wat de eerste bronchecker te streng opruimde, haalt de beoordeling zelf terug zodra de bron
   bevestigd is.

In de nieuws-app:
- **Voorrang**: elke cyclus meldt alle aangevraagde verbanden bij het propagandamodel (`POST /api/nieuws/voorrang`,
  zonder budget; `EvidenceResearchService.prioritise`).
- **Onbewezen**: een verband dat alleen rust op bronloze, "betwiste" argumenten zonder tegenargument heet nu
  "onbewezen · zonder bron" (`unsourcedOnly`).
- **Controle-uitkomst**: wat de controle vond, staat erbij in plaats van "niet gecontroleerd": "bron draagt het
  deels", "bron draagt het niet" of "citaat niet teruggevonden". Dat loopt via sync format 7 (`check` in de
  bron-JSON) en `checkOf`/`CHECK_LABELS`.
- **Automatisch gecontroleerd**: zo heet het ook als de automaat de status "geverifieerd" zette (`autoChecked`).
  "Gecontroleerd" zonder meer betekent een mens.

Eerste ronde (2026-10-06, 23:00, 9 minuten):
- 60 bestaande argumenten gecontroleerd en 134 geverifieerd;
- van de 10 ten onrechte opgeruimde argumenten zijn er 6 terug en geverifieerd;
- de bronzoeker vond voor RIVM → Telegraaf, AD en Volkskrant geen bron met een letterlijk citaat. Dat klopt met
  het onderzoek uit juli; die verbanden heten nu "onbewezen".
- Twee revisies van de bronzoeker waren te algemeen (Google → "Nederlandse nieuwssites") of veranderden de
  strekking (de Volkskrant stopte met Facebook). Ze zijn verworpen, en de bronzoeker eist sindsdien dat een
  herformulering de partijen zelf noemt.

Tests:
- propagandamodel: `scripts/test_automatische_beoordeling.py` stap 8–12. `test_auto_merge`, `test_immuunsysteem`,
  `test_fase2`, `test_nieuws_doelen`, `test_nieuws_autokeur`, `test_fresh_build`, `test_publieke_intake`,
  `test_admin_veto`, `test_bezwaar_resolutie`, `test_dedup` en `test_scoring` zijn groen.
- nieuws-app: pytest (voorrang, sync format 7) en Jest (`evidence.test.ts`) zijn groen.

Vervolg dezelfde avond. Eigenaar: "niks door mensen doen.. alles door agents.. laat de smaad firewall gewoon checken
of het feitelijk is en als het niet feitelijk is dan koppel het terug en anders is het geen smaad". In het
propagandamodel:
- **Smaadtoets** (`scripts/smaadtoets.py`, Claude Opus, account `smaadtoets`): een claim over een persoon gaat door
  als ze feitelijk is, de bron haar draagt (niet verder dan de bron, geen insinuatie) en ze over de publieke rol
  gaat. Anders wordt ze teruggekoppeld: verworpen met de reden en een feitelijke formulering. Die feitelijke versie
  dient de bronzoeker met dezelfde bronnen opnieuw in, en ze gaat weer langs alle controles. Neutrale
  structuurfeiten (lid van, werkt bij) hebben geen toets nodig.
- Eerste ronde (2026-10-06, 23:38, 7 minuten):
  - smaadtoets: 8 persoonsclaims, waarvan 4 feitelijk en 4 teruggekoppeld. Voorbeelden: Van Mulligen duidt de
    inflatie "maandelijks", maar de bron toont één maand; Sophie Straat: de bedreigingen hoorden bij een ander
    festival dan de claim noemde;
  - RfC's: De Persgroep is samengevoegd met DPG Media, het mechanisme `overheidssubsidie_ngo` is aangenomen, en
    `betaalde_content` is afgewezen omdat het overlapt met `supportive_selling_environment`;
  - 9 van 12 kandidaat-verbanden kregen een mechanisme; voor 3 paste er geen (opleiding ↔ hogeschool);
  - 7 verbanden goedgekeurd en 37 argumenten geverifieerd; pdf-bronnen zijn nu leesbaar (3 van 3 klopten).
- **Kandidaat-verbanden**: de mechanisme-toewijzer geeft verbanden zonder mechanisme er een, en daarna beslist de
  gewone bewijspoort.
- **RfC's**: twee agents met elk een eigen rol en model beoordelen ze (een toetser en een criticus). Twee keer
  akkoord betekent aangenomen; één afwijzing met reden betekent afgewezen.
- **Breder**: ook duiding, aspecten (zoals politieke positie), theorie-argumenten en steunende reacties gaan nu langs
  bron-check en aanklager, in plaats van na 14 dagen ongezien te worden opgeruimd. De aanklager krijgt 4 rondes per
  dag (was 2).

Vervolg 2026-10-07: het hele proces opgeschoond. Eigenaar: "Schoon het hele proces met agents die aan
propagandamodel werken op.. geen humans in de loop maar het moet effectief zijn en goed werken en zorgen dat er geen
gaten vallen en gestroomlijnd en duidelijk verloopt". De analyse vond werk dat op niemand wachtte en dubbel werk:
- **Gaten**:
  - 19 van de 30 voorgestelde argumenten kregen "twijfel" van de bron-check. Daarna gebeurde er 14 dagen niets,
    en dan werden ze verworpen;
  - 59 goedgekeurde verbanden hadden geen enkel steunend argument. De bronzoeker zocht alleen bij bestaande
    argumenten;
  - 1.963 voorstellen voor een bronklasse wachtten op een reviewer. 2.242 bronnen stonden daardoor op
    "onbeoordeeld" (gewicht 0,15);
  - verbanden zonder mechanisme bleven eeuwig hangen, en de entiteiten eraan ook;
  - sinds augustus werden nieuwe bronnen niet meer gearchiveerd;
  - een bevestigd bezwaar werd nooit geverifieerd.
- **Dubbel werk**:
  - de agentlijst noemde 16 agents, waarvan 12 standaard "aan", maar er draaiden er 3;
  - `nieuws-autokeur` keurde goed zonder bron-check, naast de uurronde die dat mét check doet;
  - de nieuws-scout werd vanuit twee plekken gestart;
  - vier inhaalstanden van de bron-check draaiden elk uur voor een lege wachtrij;
  - het oude merge-script `auto_merge_service.py` deed niets meer.

Nu, in het propagandamodel:
- **Eén ronde per uur, in 13 stappen**: eerst repareren en controleren, dan beslissen, dan opruimen. Elk stuk werk
  eindigt in een eindtoestand, met de reden erbij.
- **Bronzoeker**: zoekt ook een betere bron bij een voorstel met twijfel (een vervangend voorstel) en een steunend
  argument voor een verband zonder argument. Daarna wordt het origineel meteen verworpen: vervangen, of "geen betere
  bron gevonden".
- **Bronklassen**: twee onafhankelijke oordelen per bron; bij verschil geldt het voorzichtigste.
- **Mechanisme-toewijzer**: wat buiten het model valt, wordt afgewezen met reden. Een invloedspatroon zonder
  mechanisme wacht op een RfC.
- **Bezwaren** die de bron-check bevestigt, worden geverifieerd. **Archiveren** is een vaste stap van de ronde.
- **Planning**: alleen de ronde (elk uur), `nieuws-scout` (max 6 per dag) en `nieuws-bewijs` (max 3 per dag, samen
  de 6 verbanden die de nieuws-app per dag klaarzet). Het propagandamodel plant de rondes. De nieuws-app zet alleen
  doelen en voorrang klaar (`NIEUWS_SCOUT_ENABLED=false`, `NIEUWS_BEWIJS_ENABLED=false` in `.env`; dat geldt na de
  volgende herstart van de backend).
- **Eerste ronde** (2026-10-07, 21:13, 13 minuten):
  - de bronzoeker vond voor 8 voorstellen met twijfel een betere bron. 3 vervangers hielden stand; 5 gingen nog
    steeds verder dan de bron. De bronzoeker houdt een bewering daarom sindsdien binnen wat de bron letterlijk zegt;
  - 11 verbanden zonder mechanisme vielen buiten het model (een opleiding binnen een hogeschool, een
    vakbondsvoorzitter, een partijfusie) en zijn afgewezen; 1 wacht op een RfC;
  - 160 bronnen kregen een klasse: 75 keer waren de oordelen het eens, 78 keer gold het voorzichtigste. Na een
    scherpere instructie zijn 29 besluiten opnieuw genomen: de eigen site van een organisatie over haar bestuur is
    geen grijze bron;
  - 39 argumenten geverifieerd en 10 bronnen gearchiveerd; 20 argumenten verworpen, elk met de reden erbij.
  - Stand na de ronde: 16 voorgestelde argumenten (was 30), 16 voorgestelde verbanden (was 32, nog 4 zonder
    mechanisme) en 1.830 open bronvoorstellen (was 1.963; 160 per ronde).
- Tests: `scripts/test_automatische_beoordeling.py` stap 1–22. Elf andere suites zijn ook groen: `test_auto_merge`,
  `test_immuunsysteem`, `test_nieuws_autokeur`, `test_nieuws_doelen`, `test_bron_classificatie`,
  `test_bezwaar_resolutie`, `test_scoring`, `test_admin_veto`, `test_fase2`, `test_fase3` en
  `test_publieke_intake`.

### Open
- De aanklager (Opus) draait alleen tussen 08:00 en 22:00 uur. Wat 's avonds klaar staat, wacht tot de ochtend.
- Op een slapende Mac draait er niets. De gemiste ronde volgt bij het ontwaken.
- Voorspellingen hebben nog geen agent. De eerste deadline is 1 maart 2027.

## Story 14.18: Eén stijl voor de hele site

**Status**: ✅ Done (2026-10-06)

Eigenaar (2026-10-06):
- "de nieuwe lay out … is geweldig maar de oude lay out van de website is super lelijk", met screenshots van:
  - de zijpanelen;
  - "WAT SCHREEF DE ANDERE KRANT?";
  - de kaarten onder "Meer nieuws";
  - de admin-pagina ("kleuren onleesbaar").
- "De lees alles bovenaan zou naar onder uit moeten klappen niet naar lelijke zijbalk."
- Over de kopjes in hoofdletters met letterafstand: "dit lettertype als kopjes werkt gewoon niet echt of
  überhaupt deze stijl".
- Over de scrollbalk onder de tabs: "lelijk en mag weg".
- "de pluriformiteit titel en balk ook niet echt doe het ff opnieuw met nieuwe stijl".

De eventpagina van Epic 14 is de stijl:
- Merriweather voor koppen, Inter voor de rest, overal gewone hoofdletters;
- witte kaarten met `rounded-2xl`/`rounded-3xl` op `paper-100`;
- pillen, met een zwarte pil voor wat actief is.

Wat er veranderd is:
- **Panelen**: op desktop een venster in het midden in plaats van een zijbalk (`ui/Sheet.tsx`, Radix Dialog,
  waar vaul op gebouwd is). Op de telefoon blijft het een onderblad. Het venster zelf krijgt de focus, niet de
  sluitknop.
- **Lees alles** klapt de hele samenvatting naar beneden open, in de letter van de eerste alinea
  (`summary/FullStory.tsx`). Namen en media zijn aantikbaar zoals in `EntityText`. `SummarySheet` is weg; een
  oude link `?p=samenvatting` klapt het verhaal open.
- **Kopjes**: `Eyebrow` (hoofdletters, letterafstand) heet nu `SubHeading`: serif, vet, 15px. Losse labels in
  hoofdletters zijn ook weg, zoals "Niet aan het woord", de assen van Links/rechts, "Over" en "Reactie: tegen".
- **Scrollrijen** (tabs, bronnen, categorieën, filters) hebben geen scrollbalk meer (`ui/ScrollRow.tsx`). De rand
  vervaagt waar er meer is, en op desktop staat daar een pijl.
- **Homepage**:
  - categorieën als pillen;
  - zoeken en filters als pillen; op de telefoon staan de filters achter "Filters";
  - kaarten zonder "Bekijk event"-knop, "Overig" en dubbele tijden;
  - wie het bracht: Nederlandse logo's, "+ n buitenlandse" en het aantal artikelen (`EventMeta.tsx`);
  - de links-rechtsbalk alleen bij twee of meer Nederlandse bronnen, en niet meer breder dan het scherm (de
    pagina scrolde op de telefoon zijwaarts);
  - "Best gelezen" heet "Meest besproken", want de lijst sorteert op het aantal artikelen;
  - "1 artikelen" en "1 bronnen" zijn "1 artikel" en "1 bron".
- **Kop en balk**:
  - "Pluriformiteit" rechtop in serif, op de achtergrond van de pagina;
  - de datum met een kleine letter in de maand, ingevuld door de browser (de statische homepage hield anders
    de datum van de deploy);
  - "Beheer" in plaats van "Admin";
  - "← Nieuws", "Bewaard", "← Terug" en "Netwerk" zijn witte pillen (`PILL`).
- **Beheer en LLM-configuratie** zijn licht en leesbaar (`components/admin/ui.tsx`):
  - het model per stap kies je met pillen, in de groepen Lokaal en API;
  - op de telefoon is de bronnentabel een lijst, met de schakelaars in beeld.
- **Filtervenster en bord**: geen dikke gekleurde rand links meer, maar een gekleurde stip.

Gevonden via "waarom hier geen zinnetje?" (ballonnen met alleen "1 artikel"):
- `PromptBuilder._select_balanced_subset` zette eerst álle buitenlandse artikelen in de prompt (cap 8). Bij acht
  of meer Google News-koppen ging er geen enkel Nederlands artikel mee.
  - Event 7807 (Halle Berry): "De beschikbare artikelen zijn uitsluitend internationale bronnen."
  - Event 6470 (Flydubai): AD stond zonder standpunt in het beeld.
- In de week tot 6 oktober was dit zo bij 33 nieuwsitems; bij 31 daarvan ging er geen enkel Nederlands artikel
  mee.
- Nieuw:
  1. eerst het nieuwste artikel van elke Nederlandse bron, verdeeld over het spectrum, met twee plekken vrij voor
     buitenland;
  2. dan elke buitenlandse bron;
  3. dan de rest.
- Backend herstart en 6470 opnieuw geanalyseerd: 4 Nederlandse en 4 buitenlandse artikelen, AD met een eigen
  standpunt.

Tests:
- Jest: 292 groen.
- Playwright explore: 140 van 141 groen. Eén test liep in een time-out terwijl de server het nieuwe venster voor
  het eerst compileerde; los herhaald is hij groen. In `wie-is-dit.spec.ts` opent `?p=samenvatting` nu het
  verhaal in de pagina.
- pytest: 3 nieuwe tests voor de selectie zijn groen. De 3 oude tests in `test_prompt_builder.py` falen al
  langer: de builder leest via `get_read_session()` uit Supabase in plaats van uit de testdatabase.
- ESLint geeft alleen de bekende waarschuwingen in oude bestanden.

### Heranalyse van de getroffen nieuwsitems (2026-10-07)
De andere 31 getroffen nieuwsitems gingen één voor één opnieuw door de analyse
(`/admin/trigger/generate-insights/{id}`, per item twee Sonnet-aanroepen).
- **Uitkomst**: alle 31 hebben nu een nieuwe analyse van Claude Code, en in alle 31 noemt de samenvatting hun
  Nederlandse bron.
  - Eerste ronde: 10 gelukt. 21 mislukten binnen ongeveer 8 seconden met `INSIGHT_GENERATION_FAILED`.
  - Tweede ronde: 15 gelukt (6298 als proef). Daarna mislukten er 3 op rij, en de ronde stopte.
  - Derde ronde: de laatste 6 gelukt.
- **Oorzaak**: in de tweede ronde kwam de reden mee: `EMAXCONNSESSION — max clients reached in session mode, max
  clients are limited to pool_size: 15`.
  - De Supabase-pooler (session mode) laat voor het hele project 15 verbindingen toe. De backend mocht er zelf 25
    openen (`pool_size=10`, `max_overflow=15`) en had er 21 open.
  - Zat alles vol, dan mislukte binnen seconden alles wat een nieuwe verbinding nodig had.
  - Opgelost: `DATABASE_POOL_SIZE=6` en `DATABASE_MAX_OVERFLOW=6`, samen 12 en instelbaar. Bij drukte wacht werk op een
    vrije verbinding (pool timeout 30 s).
  - De admin-route logt voortaan de reden (`insight_generation_failed`). Eerst ging die alleen naar wie de route
    aanriep.
  - Beide gaan pas in na een herstart van de backend.
- **Gevonden**: een analyse door een andere provider komt als tweede rij naast de oude, want er is één rij per event
  en provider (`upsert_insight`).
  - De eventpagina neemt de nieuwste. De voorpagina nam een willekeurige rij en kon zo de oude DeepSeek-samenvatting
    tonen.
  - Nu vraagt ook de voorpagina alleen de nieuwste op (`order` + `limit` op `llm_insights`).
  - De oude rijen staan er nog. Na deze heranalyse hebben 42 events er twee.

### Een bron die tijdens de analyse binnenkwam (2026-10-07)
Eigenaar: "hier staat geen tekst bij telegraaf wolkje" (event 7955, Stockholm: alleen "1 artikel").
- **Oorzaak**: het AD opende het nieuws om 21:40:45, De Telegraaf kwam er 35 seconden later bij. De analyse liep
  toen al en las alleen het AD. De samenvatting zei "Het is de enige bron in dit overzicht".
  - Een artikel dat binnenkomt terwijl de analyse loopt, of minder dan 30 minuten erna, start geen nieuwe
    (`EventService._maybe_schedule_insight_generation`).
  - Kwam er daarna geen artikel meer, dan bleef de analyse zo staan. De backfill vulde alleen nieuws zonder analyse.
  - Op 7 oktober om 22 uur was dit zo bij 30 actuele nieuwsitems, zoals "Christa Pike weer bij bewustzijn": NOS,
    De Telegraaf, RTL Nieuws en AD stonden niet in de analyse.
- **Backend**: de Insight Backfill (elke 15 minuten) doet na het nieuws zonder analyse ook de analyses opnieuw die een
  Nederlandse bron missen (`InsightService._events_missing_dutch_outlets`).
  - Dat geldt alleen voor bronnen die er vanaf 30 minuten vóór de laatste analyse bij kwamen. De laatste analyse moet
    ook minstens 30 minuten oud zijn, dezelfde wachttijd als bij `EventService` (`INSIGHT_REFRESH_TTL`).
  - Een bron telt alleen als die in de prompt past (artikelplafond 8, waarvan 2 plekken voor buitenland). Een nieuwe
    analyse lost het dus altijd op en herhaalt zich niet.
  - Droge test op de live database: precies de 30 nieuwsitems. De statistiek van de backfill telt ze als
    `events_outdated`.
- **Eventpagina**: noemt geen zin van de samenvatting de bron, dan toont het wolkje de kop van het artikel
  (`textKind: "headline"` in `lib/explore/figure.ts`) in plaats van "1 artikel".
- Tests:
  - pytest: `test_insight_backfill_outdated.py` (2 nieuw, groen).
  - Jest explore: 284 groen, waarvan 1 nieuw.
  - tsc en ESLint zijn schoon.
  - Op een screenshot van 7955 staat in het wolkje van De Telegraaf de kop: "Man met mes neergeschoten bij koninklijk
    paleis in Stockholm: gedroeg zich agressief".
- 7955 opnieuw geanalyseerd (`/admin/trigger/generate-insights/7955`). De analyse las nu beide artikelen, en de
  samenvatting noemt AD en De Telegraaf. Het wolkje van De Telegraaf zegt nu: "Benadrukt in de kop dat de man zich
  agressief gedroeg".
- De backend is om 22:31 herstart (hij draait zonder auto-reload), en om 22:44 nog eens.
- **Eerste ronde (22:59)**: `events_outdated=0`. De 30 plekken gingen allemaal naar nieuws zonder analyse.
  - Dat waren er 996, op 2 na ouder dan 72 uur (28 september t/m 4 oktober). De backfill sorteert ze op
    `last_updated_at`.
  - Een ronde loopt na ongeveer 7 analyses in de time-out van 10 minuten. Dat gebeurde ook al vóór deze wijziging.
  - De verouderde analyses kwamen zo nooit aan de beurt, ook niet die van het topverhaal "Christa Pike".
  - Nu gaan de verouderde analyses voor: het zijn er weinig en ze gaan over recent nieuws. Daarna komt het nieuws
    zonder analyse.
  - Het nieuws zonder analyse gaat voortaan op `first_seen_at`: het nieuwste nieuws eerst, zoals de voorpagina het
    toont (gemeld door de backend-sessie).
    - `last_updated_at` verschuift door het onderhoud en door inhaalslagen.
    - De inhaalslag van de Volkskrant, het Parool en Trouw maakte vannacht 370 nieuwsitems. 282 daarvan gaan over
      nieuws van meer dan 24 uur oud, en die stonden zo vóór de 47 nieuwsitems zonder analyse op pagina 1 van de
      voorpagina.

### Opgelost
- De oude eventpagina (`EventDetailScreen` met `CriticalAnalysis` en dergelijke) is weg, met de vlag
  `NEXT_PUBLIC_EXPLORE_UI` (Story 11.15, 2026-10-09).

## Story 14.19: Een voorpagina die bij het beeld past

**Status**: ✅ Done (2026-10-07)

Eigenaar (2026-10-07):
- "De voorpagina mag nog wel beter eruit zien en beter passen bij de event pagina's"
- "vooral het meer nieuws is ook mega karig.. je mag de voor pagina helemaal rethinken als het nodig is"
- "Het moet gewoon echt aansluiten op het idee van de website en aantrekkelijk zijn"

De voorpagina leek op een gewone nieuwssite: een foto met donkere overlay, een zijkolom met tijden, en een muur van
kaarten met alleen een kop en "NOS · 1 artikel". Nu laat elk nieuwsitem in het klein zien waar de eventpagina over
gaat: wie het bracht, wat die zei, en wie er niet aan het woord is.

```
Topverhaal  foto · kop · begin van het verhaal | Wie zegt wat?  ballon per bron (wat die meldde) · Niet aan het woord
            twee topverhalen ernaast: kop, twee ballonnen (of het begin van het verhaal), bronnen, eerste ontbrekende stem
Per dag     Vandaag · Gisteren · Zaterdag 3 oktober … : kaarten met foto, kop, begin, bronnen als pillen,
            de eerste ontbrekende stem (+n); 6 per dag, de rest achter "Nog n nieuwsitems"
```

Wat er veranderd is:
- **Wie zegt wat? in het klein.**
  - Elke ballon is de eerste zin uit de samenvatting die de bron noemt. `outletSentencesIn` gebruikt dezelfde
    regels als "Wat schreef …?" (korte namen als "RTL", "Een Blik op de NOS" telt niet als NOS).
  - Wat het begin van het verhaal al zegt, valt weg. Dat geldt ook voor zinnen over de bronnen zelf ("de enige
    Nederlandse bron").
  - De ballonnen wisselen links en rechts af, in de kleuren van het beeld (`lib/explore/colors.ts`).
  - "Niet aan het woord" ziet er net zo uit als op de eventpagina.
- **Welke verhalen bovenaan staan** (`pickTopStories`): uit de 15 nieuwste telt eerst hoeveel bronnen de analyse
  aan het woord laat, dan het aantal Nederlandse bronnen, dan alle bronnen en dan wat het nieuwst is. Nieuwsitems
  zonder analyse komen nooit bovenaan.
- **Het nieuws per dag** vervangt "Topverhalen", "Nieuws", "Meest besproken" en "Meer nieuws".
- **Hele koppen**: de lijst knipt de LLM-titel af op 60 tekens. De kaarten tonen de hele titel en korten die zelf in.
  Vet (`**…**`) in titels is weg.
- **Volgorde op het moment van het nieuws**:
  - De tijd van een nieuwsitem is nu die van het laatste Nederlandse artikel. Eerst was het de tijd waarop de
    backend het event voor het laatst bijwerkte (onderhoud, nieuwe analyse).
  - Daardoor stonden nieuwsitems van 2 oktober bovenaan "Meer nieuws", en zaten er vijf uit april in "deze week".
  - Nieuws van voor de gekozen periode valt nu weg.
  - Google News vindt buitenlandse artikelen soms dagen later; die tellen niet mee voor de tijd.
- **Zoeken en filters**:
  - Zoeken staat in het midden. De filters staan ook op desktop achter "Filters".
  - Het stipje "aangepast" verscheen ten onrechte tijdens het zoeken (minder bronnen in beeld).
- **Data**: de ontbrekende stemmen komen mee als JSON-paden (`coverage_gaps->0..5->>perspective`), een paar bytes
  per stem. Er zijn geen extra queries bij gekomen. In de afgelopen week had 0,2% van de analyses meer dan zes
  ontbrekende stemmen.
- **Opgeruimd**:
  - Weg: `HeroEventCard`, `MediumEventCard`, `NewsSidebar`, `BestGelezen`, `CompactEventCard` en `EventCard`.
  - Nieuw: `components/front/` (`FrontPage`, `StoryCards`, `StoryParts`) en `lib/front-page.ts`.
  - `outletsLine` staat nu in `lib/format.ts`, zodat de kop van de eventpagina en het topverhaal dezelfde regel
    tonen.

Gevonden, niet aangepast:
- In Beheer is alleen NOS hoofdbron. De voorpagina toont daarom alleen nieuwsitems met een NOS-artikel.
  - Van de afgelopen week zijn dat er 81 van de 982 geanalyseerde, en in Sport geen enkele.
  - Met RTL Nieuws, NU.nl, AD, De Telegraaf, Het Parool, de Volkskrant en Trouw ook als hoofdbron zouden het er
    770 zijn.
  - Welke bronnen hoofdbron zijn, beslist de eigenaar in Beheer.

Tests:
- Jest: 307 groen, waarvan 15 nieuw in `__tests__/front-page.test.ts` (daglabels, begin van het verhaal, ballonnen
  per bron, keuze van de topverhalen).
- tsc en ESLint zijn schoon.
- Screenshots op 1440 en 390 breed, zonder zijwaarts scrollen: de voorpagina, een categorie, de filters open,
  zoeken, geen resultaat en "Nog n nieuwsitems".

### Statement timeout (2026-10-07)
Eigenaar: "canceling statement due to statement timeout".
- **Oorzaak**:
  - De rol `anon` (de website) heeft in Supabase een `statement_timeout` van 3 s.
  - Volgens `pg_stat_statements` duurde de lijstquery van de voorpagina gemiddeld 0,9 tot 1,1 s, met uitschieters
    tot 2,9 s. Bij drukte op de database (de backend met zijn geplande taken) ging hij daar af en toe overheen.
  - Afgebroken queries staan niet in die statistiek.
- **Waarom zo zwaar**:
  - De query haalde alle nieuwsitems van de week op, 1000 (het maximum van PostgREST), met al hun artikelen en de
    hele `source_metadata`. Dat was 3,4 MB.
  - Daarna gooide de browser alles weg zonder artikel van een hoofdbron. Er bleven er 83 over.
- **Nu**:
  - De database filtert op hoofdbronnen, via een tweede join met alias:
    `main:event_articles!inner(articles!inner(source_name))` met `.in('main.articles.source_name', …)`. De gewone
    `event_articles` houdt alle bronnen voor de pillen.
  - Van de metadata komt alleen het spectrum mee.
  - Resultaat: 298 KB in plaats van 3,4 MB, en 0,25 tot 0,55 s in plaats van 0,6 tot 0,9 s bij gewone drukte.
- **Let op**: met alle grote Nederlandse kranten als hoofdbron worden het weer ±870 nieuwsitems (3 MB) per week. Dan
  moet de lijst in stukken laden.

### Meer hoofdbronnen, laden in stukken en bronnen die stillagen (2026-10-07)
Eigenaar: "ja er moeten meer hoofdbronnen.. waarom zijn er maar een paar?" en "zijn er bronnen die het niet meer
doen?"
- **Waarom alleen NOS**:
  - Sinds december 2025 is NOS de enige hoofdbron (`DEFAULT_MAIN_SOURCES = {"nos_rss"}`), als ijkpunt.
  - Elke krant die later is toegevoegd, kwam er als gewone bron bij.
- **Nu hoofdbron**:
  - NOS, RTL Nieuws, NU.nl, AD, De Telegraaf, Het Parool, de Volkskrant en Trouw. Gezet via
    `PATCH /admin/sources/{id}`, dezelfde schakelaar als in Beheer.
  - Nog geen hoofdbron: GeenStijl, NieuwRechts, NineForNews, De Andere Krant en Een Blik op de NOS.
- **De lijst laadt in stukken** (eerst gezet, daarna pas de hoofdbronnen, anders kwam de time-out terug):
  - `listEvents` geeft 120 nieuwsitems per keer (`FEED_PAGE_SIZE`, `range`), met `meta.has_more` en `next_offset`.
    "Meer nieuws" onder de dagen haalt de volgende.
  - De topverhalen komen uit de eerste pagina, zodat meer laden het topverhaal niet verschuift.
  - De standaardkeuze van bronnen (alles behalve sociale media) geldt ook voor bronnen die pas op een latere pagina
    opduiken.
  - **Volgorde op `first_seen_at`**. Op `last_updated_at`, dat onderhoud en een nieuwe analyse verzetten, stond oud
    nieuws (1 tot en met 4 oktober) naast vandaag, en ontbrak gisteren. Op `first_seen_at` is pagina 1 vandaag en
    gisteren, en de query duurt 0,3 s in plaats van 1,3 s.
  - In productie: pagina 1 is 293 KB en komt in 0,2 tot 0,4 s binnen, pagina 2 is 300 KB. Er zijn geen fouten en de
    pagina scrolt nergens zijwaarts.
- **Bronnen die stillagen**:
  - Het pakket `playwright` stond in `requirements.txt` maar ontbrak in `.venv`. Daardoor:
    - sloeg de backend elk artikel van de Volkskrant, Het Parool en Trouw over; hun RSS heeft geen samenvatting, en
      het laatste artikel was van april;
    - kregen NU.nl, AD, De Telegraaf, NineForNews en deels NieuwRechts alleen de RSS-samenvatting binnen.
  - Weer geïnstalleerd: 1.49.0 met `playwright-stealth`. Chromium 1148 stond al op de Mac. Een proef haalt volledige
    artikelen op van de Volkskrant (6.351 tekens), Trouw (5.742), Het Parool (2.144), NU.nl en AD.
  - Bij betaalartikelen van De Telegraaf haalde de parser toen de JSON van de betaalmuur op. Zulke tekst telt nu als
    parse-fout (`looks_like_code` in `ingestion/parser.py`). Bij een parse-fout gebruikt de backend de
    RSS-samenvatting, net als bij een mislukte fetch; eerst sloeg hij het artikel over (commit e49db1c).
  - Met `playwright` weer actief haalde de ingest van elk bekend artikel opnieuw de pagina op, en zag pas daarna dat
    het dubbel was. De eerste ronde liep na 300 s tegen de time-out (918 dubbele, 67 keer een browser). Nu vraagt
    `ArticleRepository.known_items` in één query (URL, guid, bij AD ook het artikel-id) welke items al bestaan, en
    haalt de ingest alleen nieuwe pagina's op. Na die controle en na elk opgeslagen artikel sluit de transactie,
    zodat er tijdens het ophalen geen transactie openstaat. Een andere sessie zag sessies die 13 minuten "idle in
    transaction" bleven, met locks op `articles` (commit 52ed946).
  - Daarna kwam er van de drie kranten nog steeds niets binnen. In de backend liep elke pagina tegen de 15 s aan,
    en dan stond de browser nog op de privacypoort van DPG (`myprivacy.dpgmedia.nl`, ±18 KB). Die HTML is geen
    artikel ("empty_extraction"). Los haalde een script dezelfde pagina's wel op. Twee oorzaken, in
    `ingestion/playwright_fetch.py`:
    - Om plaatjes te weren stuurde de browser elk verzoek van een pagina langs Python (`route("**/*")`). Tijdens een
      ronde heeft de event loop van de backend het druk, en dan wacht elk verzoek. In een proef met een drukke loop
      duurde een DPG-artikel zo 15 tot 24 s. Wie alleen plaatjes, fonts en video op bestandsnaam weert
      (`STATIC_FILES`), is in 6 tot 9 s klaar.
    - Alle Playwright-bronnen laadden tegelijk. De pool had `max_contexts=3`, maar gebruikte dat niet. Nu laden
      er hoogstens 3 pagina's tegelijk.
  - De poort stuurt de browser vanzelf terug naar het artikel. Staat de pagina na het laden nog op de poort, dan
    wacht de fetch tot dat gebeurt. Lukt dat niet, dan telt het als mislukte fetch: dan de RSS-samenvatting, of de
    volgende ronde.
  - Resultaat in de backend: ±10 s per artikel in plaats van ±45 s, zonder time-outs. Tussen 22:40 en 23:35 kwamen
    er 100 artikelen van de Volkskrant, 129 van Het Parool en 83 van Trouw binnen, gemiddeld 4.500 tot 5.200
    tekens. De korte zijn video-, podcast- en cartoonpagina's. AD, NU.nl en De Telegraaf slaan weer de
    artikeltekst op. Sinds 30 september was 93 tot 100% van hun artikelen korter dan 400 tekens, de
    RSS-samenvatting. Bij De Telegraaf is het de tekst vóór de betaalmuur, ±1.600 tekens.
  - **Gevolgen van de inhaalronde**. De RSS van de drie kranten bevat ook ouder werk: 200 van de 312 artikelen
    waren ouder dan een dag, terug tot juni (achtergronden, cartoons, recepten).
    - Elk artikel vroeg om een classificatie en vaak een nieuw nieuwsitem met een analyse. Rond 23:30 zat het
      Claude Code-abonnement aan zijn sessielimiet, tot 00:50. In die tijd mislukten 393 classificaties (dan
      `other`) en 373 analyses. De backfill haalt de analyses in, de classificaties niet.
    - Een nieuw nieuwsitem kreeg als `first_seen_at` het moment van ophalen. Pagina 1 van de voorpagina bestond
      daardoor uit 120 nieuwsitems van de inhaalronde, met nieuws van juni tot vandaag, en niets geanalyseerd.
      Hersteld: van de 370 nieuwsitems van na 20:00 is `first_seen_at` nu de eerste publicatie van hun artikelen.
      Dat is de regel die Event Maintenance al gebruikte (een dag later). Pagina 1 is weer nieuws van 7 en 8
      oktober, en 73 van de 120 items zijn geanalyseerd. Een nieuw nieuwsitem begint nu bij de publicatie van zijn
      artikel (`_news_start` in `repositories/event_repo.py`), met een test voor een bron die achterloopt.
      `last_updated_at` blijft het moment van koppelen.
    - De backfill zocht nieuwsitems zonder analyse op `last_updated_at`. Dan kwamen de ±280 items met ouder
      nieuws eerst, ±10 uur Sonnet, vóór de items zonder analyse op pagina 1. Daarom sorteert hij ze nu op
      `first_seen_at`, zoals de voorpagina (`services/insight_service.py`, opgepakt door de sessie die daar aan
      werkte).
  - NieuwRechts (een Angular-app) gaf ook via de browser geen tekst aan trafilatura. Opgelost op 8 oktober, zie
    hieronder.
  - Een Blik op de NOS levert sinds 24 december 2025 niets. De X-API weigert de sleutel (403, "keys and tokens from
    a developer App that is attached to a Project"). Sinds 8 oktober komt de bron van YouTube, zie hieronder.
- **Gevonden door een andere sessie**: hetzelfde verhaal staat vaak los in twee nieuwsitems, bijvoorbeeld 8079 "Messi
  eert Maradona" (NU.nl) en 7973 "Messi neemt afscheid" (2 bronnen). Van de 120 items op pagina 1 hebben er maar 7
  twee of meer Nederlandse bronnen. Dat lag aan de clustering, zie hieronder.

### Losse items, bronnen zonder tekst en wat geen nieuws is (2026-10-08)
Eigenaar, over de open punten van 14.19: "fix dit allemaal".
- **Een Blik op de NOS komt van YouTube**:
  - Het account heeft geen website, xcancel is opgeheven en Nitter werkt niet meer. Het X-account vraagt een
    betaald API-abonnement om berichten te lezen.
  - Het YouTube-kanaal "Een blik op de NOS" heeft een open feed. Elke video is een fragment van de NOS met de kritiek
    in de beschrijving; de laatste is van 2 oktober.
  - `feeds/eenblikopdenos.py` leest die feed. Titel plus beschrijving zijn de tekst (`parser: rss_only`: de
    videopagina wordt nooit opgehaald). Zoals bij elke bron alleen nieuws van de laatste 24 uur (zie "Alleen
    actueel nieuws" hieronder); eerst 14 dagen, anders haalt de oude kritiek gearchiveerd nieuws terug.
  - De koppeling met NOS-nieuws (`source_affinity`, de aparte prompt) is dezelfde als bij de tweets.
- **NieuwRechts geeft weer tekst**: `playwright-stealth` breekt hun Angular-app; zonder stealth toont de pagina het
  artikel (2.492 tot 23.664 tekens in een proef). Stealth is nu per bron instelbaar (`stealth: false` in
  `source_profiles.yaml`).
- **Wat geen nieuws is, gaat er vóór het ophalen uit**:
  - Per bron patronen op URL en kop (`skip_urls`, `skip_titles` in `source_profiles.yaml`), getoetst op alle
    opgeslagen artikelen. Het gaat om:
    - cartoons, strips en puzzels: Trouw, Het Parool;
    - recepten: Trouw;
    - "Zoek de verschillen": Het Parool;
    - horoscopen, "Praat mee" en stellingen: De Telegraaf;
    - quizzen, winacties en "Praat mee": AD;
    - oproepen aan lezers: NU.nl;
    - quizzen: de Volkskrant;
    - StamCafé, VrijMiBo en lijstjes: GeenStijl;
    - advertenties voor crypto-mining: NineForNews;
    - de aankondiging van een nieuwe uitgave: De Andere Krant. Die regel stond eerst los in de code.
  - Recensies, columns, opinie en roddels blijven erin: dat is journalistiek met een standpunt.
  - 26 nieuwsitems die alleen uit zulke items bestonden, zijn gearchiveerd. Twee zulke items hangen in een echt
    nieuwsitem (StamCafé bij Gaza, een stelling bij de warmtepomp) en zijn gebleven.
- **Event Maintenance draait weer dagelijks**:
  - Een interval van 24 uur telt vanaf de start van de backend, en die herstart vaker dan dagelijks. Tussen 2 en 8
    oktober liep het daarom nooit.
  - Een vaste tijd werkt ook niet: 's nachts slaapt de Mac (geen rondes tussen ±01:00 en ±10:00).
  - Nu kijkt de job elk uur, de eerste keer 5 minuten na de start, of de laatste geslaagde ronde 24 uur oud is. Dat
    moment staat in `data/scheduler_state.json` en overleeft een herstart. Ook een handmatige ronde telt.
    `/admin/scheduler/status` toont `event_maintenance_last_run`.
  - De eerste ronde (8 oktober 09:51): 2.634 nieuwsitems doorgerekend, 0 gearchiveerd. Het oudste actieve item is
    van 2 oktober, en archiveren gebeurt na 14 dagen. Daarna schreef de verkenning 49.186 verbanden opnieuw.
- **357 artikelen kwamen nooit op de site**:
  - Nederlandse artikelen van drie dagen stonden opgeslagen, maar waren nooit verrijkt. Daardoor zaten ze in
    geen nieuwsitem: 93 van RTL Nieuws, 54 van AD, 52 van De Telegraaf en 49 van de NOS.
  - Het waren rondes die werden afgebroken (herstarts, time-outs) tussen opslaan en verrijken. De verrijking sloeg
    alles pas aan het eind van een batch op. De inhaalronde (25 per ronde, oudste eerst, 240 s) liep 29 van de 32
    keer tegen zijn time-out, verloor dan alles en begon weer bij dezelfde 25.
  - Nu slaat de verrijking per 5 artikelen op (`ENRICH_CHUNK_SIZE`), zonder open transactie tijdens de
    LLM-aanroepen. De inhaalronde koppelt eerst wat al verrijkt is, en verrijkt daarna de nieuwste eerst; eerst
    at de verrijking zijn 240 s op en kwamen verrijkte artikelen nooit aan een nieuwsitem. Sinds die avond neemt
    hij alleen Nederlands nieuws van de laatste 24 uur (zie "Alleen actueel nieuws" hieronder).
    `POST /admin/trigger/catch-up?limit=100` doet hetzelfde met een grotere batch.
- **Losse items**: 2 tot 8% van de nieuwsitems had twee of meer Nederlandse bronnen, ook na de sessielimiet. Van de
  ±85 artikelen tussen 06:00 en 10:00 op 8 oktober kwam er geen bij een bestaand item. Oorzaken, gemeten op 230
  paren artikelen van verschillende kranten in verschillende items (30 uur):
  - De LLM kreeg alleen kandidaten vanaf score 0,55, en koppelen vroeg daarna nog 0,60. Kranten noemen andere
    mensen en plaatsen, en de strafpunten voor weinig gedeelde namen drukten het zelfde nieuws naar 0,14 tot 0,78.
    Zelfs een "EVENT_1" van de LLM werd overruled (RTL en De Telegraaf over ABN Amro: 0,58).
  - Een mislukte classificatie gaf `other`, en een ander type dan het item vroeg 0,70. Tijdens de sessielimiet kwam
    daardoor bijna niets bij elkaar.
  - De lezers lopen naast elkaar. Twee kranten met hetzelfde nieuws, beoordeeld op hetzelfde moment, zagen elkaars
    nieuwe item niet.
  - Vaste tekst van een krant ("Luister ook naar onze podcast", een cookiemelding) drukt de woordovereenkomst. Haiku
    zet soms uitleg achter zijn oordeel, en de code las dan "EVENT 1" uit die uitleg.
- **Nu, in `services/event_service.py`**:
  - De LLM beoordeelt elke kandidaat die hetzelfde nieuws kan zijn (`LLM_ASK_*`), ongeacht het type: embedding ≥ 0,70
    en woordovereenkomst (tf-idf) ≥ 0,20. Of dezelfde mensen en plaatsen met wat gedeelde woorden. Of twee gedeelde
    woorden in de kop ("BAM koopt bouwbedrijf ..." en "Bouwbedrijf BAM koopt ..."). Gemeten: het zelfde nieuws deelt
    minstens ±0,2 aan woorden, teksten die alleen op elkaar lijken minder dan 0,15.
  - Het oordeel van de LLM beslist, zonder drempel achteraf. Het eerste oordeel in zijn antwoord telt.
  - Artikelen worden één voor één gekoppeld (`_assignment_lock`). Een artikel dat al in een item zit, blijft daar.
  - Kan de LLM niet oordelen terwijl het moest, dan wacht het artikel als wees op de volgende ronde in plaats van
    een eigen item te beginnen, zolang zijn nieuws jonger is dan 20 uur (eerst: 24 uur na ophalen).
  - Een mislukte classificatie laat het type leeg (`None`), en de inhaalronde vraagt het opnieuw (10 per ronde,
    `classify_pending`). Het nieuwsitem krijgt dan dat type als het er nog geen had.
- **Herstel van de data**:
  - 275 artikelen die tijdens de sessielimiet `other` kregen, en 254 nieuwsitems met dat type, hebben weer een leeg
    type en worden opnieuw geclassificeerd (`POST /admin/trigger/classify-pending`).
  - `POST /admin/trigger/merge-split-events` beoordeelt elk nieuwsitem met één Nederlands artikel van de laatste 72
    uur opnieuw, zonder zichzelf als kandidaat. Zegt de LLM dat het artikel bij een ander item hoort, dan verhuist
    het en wordt het lege item gearchiveerd. De nieuwste gaan eerst, zodat een artikel naar het item gaat dat er al
    was. Items waar lezers iets in zochten of deelden, blijven staan, en een proef (`dry_run`) toont alleen wat er
    zou verhuizen.
  - Proef op 80 losse items: 31 verhuizingen, waarvan 30 terecht (Jigal Krant, Jetten en AI, het stikstofslot van
    de Rotterdamse haven, Depay bij Corinthians, BAM, de WWF-index). Eén was fout: RTL over de familievakantie van
    André en Roxeanne Hazes kwam bij een ander verhaal over André Hazes.
  - Echte run op de nieuwste 148 losse items (8 oktober 10:10–10:32, tot ±7 oktober 12:00): 41 samengevoegd, 98
    bleven los, 9 overgeslagen. Twee samenvoegingen waren fout: Hazes, en "Demonstranten onderbreken
    Trump-bijeenkomst in Texas" bij de rechtszaak over Trumps reclamespots. Beide zijn met de hand teruggezet.
    Reken op ±5% fouten bij deze stap. De run stopte toen het Claude Code-abonnement om ±10:30 weer aan zijn
    sessielimiet zat. Een tweede run nam de items van 22 tot 72 uur oud (`older_than_hours`).
  - Tijdens die sessielimiet (10:30–10:50) wachtten 15 artikelen als wees, in plaats van een eigen nieuwsitem te
    beginnen. De inhaalronde van 10:54 verrijkte eerst en liep toen tegen zijn 240 s aan, zodat ze bleven wachten;
    daarom koppelt de inhaalronde nu eerst. Om ±11:30 waren alle 15 gekoppeld: 12 bij een bestaand nieuwsitem,
    3 als eigen item. Zonder wachten waren het 15 losse items geworden.
  - Tweede run (items van 22 tot 72 uur oud): 40 samengevoegd, 24 bleven los. Eén was fout (AD over André Hazes en
    zijn moeder kwam bij De slimste mens en Paulien Cornelisse) en is teruggezet. De run is om 11:25 gestopt: met
    de samenvoegrun en de analyses op beide LLM-plekken (`CLAUDE_CODE_MAX_PARALLEL=2`) liepen de RSS-rondes tegen
    hun tijdslimiet, en na een time-out slaat de backend de inhaalronde over. Wat over is, kan later
    (`merge-split-events?hours=72&older_than_hours=…`).
- Tests: de nieuwe tests voor koppelen, samenvoegen, verrijken, classificeren, de feeds, de profielen en
  Event Maintenance slagen. Tegen de oude koppelcode falen er 11 van de 12 nieuwe koppeltests. In de hele
  backend-suite slagen er 764 en falen er 8. Die 8 falen ook op een schone `HEAD`.
- Live, sinds de nieuwe code (8 oktober 09:53–11:40): 38 artikelen kwamen bij een bestaand nieuwsitem (27 op het
  oordeel van de LLM), 45 begonnen een nieuw item. Tussen 06:00 en 10:00 die ochtend was dat 0 tegen ±85. Het
  aandeel actieve nieuwsitems met twee of meer Nederlandse bronnen: 6 oktober van 8 naar 12,5%, 7 oktober van 3
  naar 7,5% (veel oud nieuws uit de inhaalronde, zonder tegenhanger), 8 oktober van 2 naar 15,4%.
- **Alleen actueel nieuws, Nederlandse bronnen eerst** (eigenaar, 8 oktober 's avonds: "gebruik de nederlandse
  bronnen als hoofdbronnen niet de buitenlandse.. en doe maar het huidige nieuws ophalen en geen oud nieuws van
  gisteren of daarvoor"):
  - De hoofdbronnen waren al de acht Nederlandse (`news_sources.is_main_source`); geen buitenlandse bron heeft die
    vlag. Het lek zat in de inhaalronde. Die verrijkte ook de buitenlandse artikelen van Google News, en omdat die
    het nieuwst zijn, kwamen ze steeds eerst: 274 in 12 uur, elk met een Haiku-aanroep voor het type. Intussen
    wachtten 10 Nederlandse artikelen van die dag (5 van De Telegraaf sinds 17:11, 5 van NieuwRechts sinds 07:04).
    Buitenlandse artikelen worden niet meer verrijkt: Google News geeft alleen de kop, en de internationale
    verrijking hangt ze zelf aan het nieuws.
  - "Huidig" is de laatste 24 uur sinds publicatie. Een grens om middernacht zou een artikel van 23:50 laten vallen
    dat om 00:05 binnenkomt.
  - Feeditems die langer geleden verschenen, worden voor geen enkele bron meer opgehaald (`CURRENT_NEWS_HOURS` in
    `services/ingest_service.py`; vervangt de 14 dagen van Een Blik op de NOS). Ze worden nooit opgeslagen, dus elke
    ronde ziet ze opnieuw: één logregel per feed (`skipping_old_items`).
  - De inhaalronde (verrijken, koppelen, opnieuw classificeren) neemt alleen Nederlandse artikelen waarvan het
    nieuws hoogstens 24 uur oud is, geteld vanaf publicatie in plaats van ophalen. Van de 69 onverwerkte artikelen
    die in de laatste 24 uur binnenkwamen, waren er 59 nieuws van 6 en 7 oktober (de Volkskrant, Het Parool en
    Trouw, opgehaald op 7 oktober om ±23:00). Met de 284 die eerder binnenkwamen zijn dat de 343 Nederlandse
    artikelen van 6 en 7 oktober; die blijven liggen, net als de 863 buitenlandse.
  - Een artikel wacht op de LLM zolang zijn nieuws jonger is dan 20 uur (`DEFER_MAX_AGE`). Daarna beslist de
    inhaalronde op de scores, voordat het artikel uit zijn venster van 24 uur valt; anders kreeg het nooit een
    nieuwsitem.
  - De admin-knoppen `catch-up` en `classify-pending` nemen standaard ook 24 uur. `POST /admin/trigger/enrich`
    verrijkt alle Nederlandse artikelen, ook oudere, en nooit buitenlandse.
- **De nieuwsstappen gaan voor bij de LLM-plekken** (eigenaar: "Als we huidig nieuws ophalen loopt alles dan wel vlot
  zonder opstopping?"). Gemeten tussen 21:15 en 23:00 op 8 oktober:
  - 4 van de 8 rondes liepen tegen hun limiet van 300 s, en 3 inhaalrondes tegen hun 240 s.
  - Op de twee plekken van Claude Code (`CLAUDE_CODE_MAX_PARALLEL=2`) draaiden 368 Sonnet-aanroepen (66 minuten,
    tot 126 s per aanroep) en 209 Haiku-aanroepen (32 minuten, mediaan 7 s).
  - 201 van die Sonnet-aanroepen kwamen uit de ronde zelf. Elke koppeling of nieuw item start op de achtergrond een
    (nieuwe) analyse. De rest kwam van de insight-backfill, die tegelijk met de ronde start.
  - De korte aanroepen van de ronde (type, koppelen) stonden daardoor achter analyses in de rij.
  - Nu krijgt een wachtende aanroep van de nieuwsstappen de eerstvolgende vrije plek
    (`NEWS_PIPELINE_PRIORITY` in `llm/claude_code.py`; classificatie en koppelen). De analyses en de digests van
    buitenlandse artikelen komen daarna. Een lopende aanroep wordt niet onderbroken, dus een nieuwsaanroep wacht
    hoogstens tot er één klaar is. Het aantal plekken en de modellen blijven gelijk.

## Story 14.20: Namen onder een bevinding openen hun ballon

**Status**: ✅ Done (2026-10-07)

Eigenaar (2026-10-07), met een screenshot van "sensationeel" met "AD" eronder in Hoe gebracht?:
- "maak ook dit soort dingen klikbaar zodat je de tooltip van artikel weer ziet"

Wat er veranderd is:
- **In elke rij met een bevinding**, in alle tabs, openen de bron en de spreker onder de kop dezelfde ballon als in
  "Wie zegt wat?":
  - bij een bron: "Naar het artikel", "Wat schreef …?" en de artikelen;
  - bij een spreker: de sprekerkaart.
  
  De rij klapt dan niet open. Een tik elders op die regel klapt hem wel open.
- **De regel met namen staat nu onder de knop.** De namen stonden in de knop die de rij openklapt, en een knop in een
  knop kan niet (`FindingRow`, `SharedRow`).
- **Ook aantikbaar**: de spreker en de zijden van een tegenspraak bij "Van anderen", en de kop per bron in "Wie praat?".
- **In een ballon blijven namen gewone tekst**, want een ballon in een ballon zit in de weg (`AnchorInline` met
  `plain`).
- **Nieuw** naast `OutletInline`: `SpeakerInline` en `AnchorInline` (`map/PeopleCards.tsx`).
- **Opgeruimd**: in de sprekerkaart zat een knop (het nummer) in een knop (de bewering). Nu is het nummer gewoon een
  label.

Tests:
- Jest: 307 groen. tsc en ESLint zijn schoon.
- Playwright explore op desktop, Pixel 7 en iPhone 13: 141 groen.
  - Eerst viel er één om: de koppen van één regel waren te kleine tikdoelen geworden, nu de regel met namen buiten
    de knop staat. De knop heeft nu padding met een negatieve marge.
- In de browser: een tik op de bron onder "sensationeel" opent de bronballon ("Naar het artikel") en de rij blijft
  dicht; een tik op een spreker onder een bewering opent de sprekerkaart. Er zijn geen fouten in de console.

## Story 14.21: Klopt het? en een haakje op de voorpagina

**Status**: ✅ Done (2026-10-07)

Eigenaar (2026-10-07):
- "niet aan het woord is niet echt iets voor de voorpagina.. wat kan er beter op?"
- Over de eerste versie, met een niet gestelde vraag per kaart: "die vroeg niet werkt ook niet echt.. je wilt wat
  meer info en een haakje om door te lezen", en "je wilt niet weten wat ontbreekt bij een voorpagina".
- Over "Klopt het?" bij het topverhaal: "dit is opzich wel een haakje", en "Hoeft niet allemaal zo te zijn".

Waarom "Niet aan het woord" en "NOS vroeg niet" weg moesten:
- Een voorpagina laat zien wat er is, niet wat ontbreekt.
- "Niet aan het woord" is bijna altijd hetzelfde soort zin ("Onafhankelijke energie-economen", "Juridische
  experts"). Alle 34 recente analyses hadden zo'n lijst, dus het onderscheidt het ene verhaal niet van het andere.
- Een losse vraag ("Wat is de motivatie van het college?") geeft geen informatie over het nieuws.

```
Topverhaal   Wie zegt wat?  ballon per bron
             Klopt het?     ! claim zonder bewijs · wie het zegt (organisatie) · zonder bewijs
                            ? de vraag die je kunt stellen
Kaarten      begin van het verhaal, dan één haakje:
             Klopt het?     ! "Volgens de man zou Nederland Hamas niet als terroristische organisatie
                               moeten zien …" · een organisator van de demonstratie · zonder bewijs
             of
             Reactie van Ronaldo
                            Volgens NU.nl was Cristiano Ronaldo een van de prominenten die reageerde.
```

Wat er veranderd is:
- **Topverhaal**: onder "Wie zegt wat?" staat "Klopt het?". Het is één claim zonder bewijs, met de rode "!" van de
  eventpagina. Daaronder staat wie hem doet en de eerste vraag die je erbij kunt stellen.
  - `frontClaim` kiest een spreker met naam ("Jan-Willem van den Beukel (Vemobin)") vóór een medium dat het zelf
    beweert, en een claim met vraag vóór een zonder.
  - Wie het zegt, leest `parseSourcePart` van "Wie praat?". Zo wordt "Kommersant, via de NOS" Kommersant, en
    "(anoniem)" een anonieme bron. "Niet-genoemde Franse media" telt niet als spreker met naam.
  - Zonder claim toont het topverhaal het volgende stuk van het verhaal (zie hieronder).
- **Kaarten** (de twee topverhalen met minder dan twee ballonnen, en het nieuws per dag) tonen onder het begin van
  het verhaal één haakje (`storyHook`), niet overal hetzelfde:
  - Doet iemand met naam een claim zonder bewijs, dan staat er een kleine "Klopt het?" (zonder de vraag).
  - Anders staat er het volgende stuk van het verhaal: het eerste tussenkopje van de samenvatting met de eerste zin
    eronder (`storySection`), zoals "Reactie van Zelensky" of "Context en eerdere incidenten". Alle samenvattingen
    hebben tussenkopjes.
  - Kopjes over de bronnen of de berichtgeving vallen weg: "Beperkte bronbasis", "Duiding", "Internationale
    perspectieven", "Framing van De Telegraaf".
  - Zinnen over het artikel zelf ("Het bericht van NU.nl is kort …") vallen ook weg, en zinnen die de kaart al toont
    (het begin van het verhaal, een ballon).
- **Topverhalen kiezen** (`pickTopStories`): wat het kleine beeld van het topverhaal laat zien, telt als ballonnen
  plus een claim. Bij evenveel ballonnen gaat een nieuwsitem met een claim dus voor.
- **Eén bron bovenaan** (eigenaar: "waarom staat bovenaan een artikel met maar 1 bron?"):
  - Oorzaak: de keuze keek alleen naar de 15 nieuwste nieuwsitems. Met meer hoofdbronnen zijn dat een paar uur nieuws,
    en die 15 hadden allemaal één Nederlandse bron. "Nobelprijs Scheikunde" (NU.nl + 10 buitenlandse) won op het
    aantal buitenlandse bronnen.
  - Nu: de kandidaten zijn het nieuws van het laatste etmaal voor het nieuwste nieuwsitem, en minstens de 15 nieuwste.
  - Eerst telt hoeveel Nederlandse bronnen het brachten (1, 2, 3 of meer), dan het kleine beeld, dan alle bronnen en
    dan wat het nieuwst is.
  - Op 7 oktober om 22 uur staat nu bovenaan "Christa Pike weer bij bewustzijn" (5 Nederlandse bronnen). Daarna
    volgen "Gotink verlaat NSC" (3) en "Hybride warmtepomp" (2).
  - Van de 120 nieuwsitems op de eerste pagina hadden er maar 7 twee of meer Nederlandse bronnen. Hetzelfde nieuws
    staat vaak in twee nieuwsitems, zoals "Messi eert Maradona" (NU.nl) en "Messi neemt afscheid" (2 bronnen). Zie
    de clustering.
- **Data**:
  - In plaats van `coverage_gaps->0..5->>perspective` haalt de lijstquery nu `unsubstantiated_claims->0..1` op
    (claim, `source_in_article`, eerste `critical_questions`), als JSON-paden.
  - Het tussenkopje komt uit de samenvatting, die al meekwam.
  - `EventListItem.missing_voices` is vervangen door `claims`.
- **Opgeruimd**: `MissingVoices` en `MissingVoicePill` (`components/front/StoryParts.tsx`). "Niet aan het woord"
  staat alleen nog op de eventpagina.

Tests:
- Jest: 317 groen, waarvan 9 nieuw in `__tests__/front-page.test.ts`. Ze testen de claim en de spreker, het
  tussenkopje (wat de kaart al toont en kopjes over de bronnen vallen weg), de keuze van het haakje, de voorrang in de
  topverhalen en het laatste etmaal.
- tsc en ESLint zijn schoon.
- Screenshots op 1440 en 390 breed, zonder zijwaarts scrollen en zonder fouten in de console:
  - het topverhaal toont "Klopt het?";
  - 15 van de 19 zichtbare kaarten hebben een haakje, een mix van "Klopt het?" en tussenkopjes;
  - "Niet aan het woord" en "vroeg niet" staan niet meer op de voorpagina.

## Story 14.22: Al gezocht met AI

**Status**: ✅ Done (2026-10-08)

Eigenaar (2026-10-07): "bij niet aan het woord en dat soort dingen zou je wel al bij toevoegen moeten kunnen zien wat
andere gebruikers hebben gezocht en gevonden met hun AI search". Besluiten (AskUserQuestion):
- **Lezers zien wat goedgekeurd is, de admin alles.** De regel van Story 14.10 blijft: een vondst die niet is
  goedgekeurd, zien lezers nooit (de controle klopt in 60–75%).
- **Alleen bij ontbrekende stemmen**, want alleen daar bestaat "Zoek met AI".

Hoe het werkt:
- In het formulier "Ontbrekende stem" staat onder "Wie komt niet aan het woord?" de lijst **Al gezocht met AI**: de
  stemmen van dit nieuws die al gezocht zijn. Wat lijkt op wat je typt staat bovenaan; hoogstens 5.
- Per stem:
  - de goedgekeurde bronnen: wie, bij welk medium, en de kern;
  - anders "Nog geen bron", of "Wordt gezocht";
  - voor de admin ook "n te beoordelen".
- **Bekijk** als de stem al in je beeld staat (de ontbrekende stem van de analyse, of je eigen met dezelfde woorden).
  Anders **Neem over**: de stem komt in je beeld, met wat je bij "Waarom doet dat ertoe?" schreef. De goedgekeurde
  bronnen hangen er dan vanzelf onder (gelijke woorden).
- **Database**: migratie `015_eerder_gezocht.sql`, RPC `voice_searches_public(p_event_id)`, voor anon:
  - één rij per stem over al haar zoektochten (hoofdletters en spaties tellen niet);
  - mislukte zoektochten tellen niet mee;
  - alleen goedgekeurde kandidaten;
  - de tabel blijft dicht.

  De admin krijgt alles uit `voice_searches_for_event`.
- **Code**:
  - `lib/explore/earlier-searches.ts`: de rijen per stem, de volgorde en "staat al in je beeld";
  - `EarlierSearches` in `components/explore/map/VoiceSearch.tsx`, getoond door `OwnForm`;
  - `publicVoiceSearches` in `lib/voice-search.ts`;
  - de demo leidt het af uit de demozoektochten.

Tests:
- Jest: `__tests__/explore/earlier-searches.test.ts` (5), en alle 289 explore-tests groen. tsc en ESLint zijn schoon.
- Migratie 015 eerst op een tijdelijke PostgreSQL 15 getest, twee keer gedraaid. Daarna op Supabase gezet, zonder
  tabellock. Getest met de anon-sleutel: de RPC werkt en de tabel blijft dicht (42501).
- In de browser (390 breed, als lezer zonder code), eventpagina 7970, Wat ontbreekt? → Ontbrekende stem:
  - "NSC-partijleiding · Nog geen bron";
  - "Mona Keijzer en haar achterban" met de goedgekeurde bron van RTL Nieuws;
  - beide met "Bekijk";
  - typ je "NSC", dan staat die stem bovenaan.

## Story 14.23: Wat ertoe doet — Wie zit erachter? en Hoe hangen ze samen?

**Status**: ✅ Live (2026-10-09): app-commit 3cbde36 op main, migratie 017 toegepast, pm-commit 54516d9.

Eigenaar (2026-10-08), bij "Geen regenboogvlag op Tweede Kamer na verzet van SGP" (AD, De Telegraaf, RTL Nieuws):
- "Kamran Ullah voor VVD en Telegraaf staat gemarkeerd als dun bewijs maar in het echt is er heel veel bewijs voor"
- "PVV censureert AD … dit is niet echt van belang als we AD artikelen lezen.. heel onbelangrijk terwijl het zo wel
  heel erg wordt uitvergroot"
- "'ondermijnt zo het vertrouwen in de journalistiek' … deze taal moeten we niet overnemen dit is duidelijk een
  politiek spelletje … waak hier streng voor in propagandamodel"
- Over "Hoe hangen ze samen?" (Tweede Kamer – CIDI – VVD, Eerste Kamer – Saskia Kluit – PRO): "ontzettend
  onbelangrijk en random"
- Over Berghuis (VVD-woordvoerder, RTL Nieuws) en Ullah: "deze info is dan wel weer interessant … mag wel meer van
  dit soort verbanden laten zien"
- Over "PVV werkt samen met De Telegraaf" (geen bron, betwist): "slaat ook helemaal nergens op.. staat niet eens op
  waar het vandaan komt"

Waar het misging:
- **De app toonde wat in het model bestaat, niet wat ertoe doet.** Elke route van hoogstens twee stappen telde.
  - PVV → AD (censuur, mechanisme publieke aanval) rust op één argument over Wilders' "tuig van de richel".
    Dat gaat over journalisten in het algemeen, niet over het AD. Dezelfde koppeling staat ook naar NOS,
    Volkskrant, RTL, ANP en NRC.
  - Elke partij zit in de Kamer. "Tweede Kamer – Moorman – PRO" is één willekeurige van tientallen routes.
- **Verbanden zonder bron bleven goedgekeurd.** Het gaat om 166 van de 173 verbanden zonder levend argument met
  bron, allemaal uit de eerste AI-opzet van het model (juni 2026). Een voorbeeld is rel 127 "PVV werkt samen met De
  Telegraaf". De bronzoeker vond niets, maar niets sloot ze af.
- **Eén lat voor feiten en voor invloed.** "Onderbouwd" vroeg twee onafhankelijke argumenten. Daardoor bleef een
  cv-regel met één primaire bron altijd "dun".
  - Het argument over Ullahs VVD-bestuur (2795) propte twee feiten in één zin: bestuur Amsterdam-West 2006–2010
    en de Kamerkandidatuur van 2010. De bronchecker vond het eerste wel in de bron, het tweede niet: "bron draagt
    het deels".
  - "VVD wordt bestuurd door Ullah" las een afdelingsbestuurszetel als het besturen van de partij.
- **De eigen stem van het model nam retoriek over**: "ondermijnt het vertrouwen", "rechts-populistisch",
  "neoliberale consensus". De bronchecker laat de duiding bewust ongemoeid, de smaadtoets en NEUTRALITEIT-RENDER
  kijken alleen naar personen.

Wat het doet in de nieuws-app:
- **"Wie zit erachter?"** (`behindParties`, `specificParties`, `lineTier` in `lib/explore/why.ts`):
  - een route met een verband zonder enige bron (`source_count` 0) valt weg, net als een regel met het oordeel
    onbewezen;
  - een stap die invloed draagt (geen band van erbij horen) moet rusten op bewijs dat het medium noemt: in de
    claim, een citaat of een brontitel (`evidenceNames`, `textNames`: "AD" alleen als hoofdletters, "de
    Volkskrant" ook als "Volkskrant");
  - de invloed van het medium zelf op de partij telt niet ("NOS lobbyt bij de Tweede Kamer" zegt niet wie achter
    het nieuws van de NOS zit);
  - de volgorde: eerst mensen die bij beide kanten horen (Berghuis, Ullah), dan eigendom en geld, dan bronnen,
    dan andere invloed, dan druk van buiten.
- **"Hoe hangen ze samen?"** (`governanceRoutes`, `massTie`):
  - een route valt weg als de tussenpersoon aan beide kanten gewoon lid, medewerker, lobbyist of Kamerlid is;
  - een minister, bestuurder of adviseur ertussen blijft ("Financiën – minister Heinen – VVD");
  - een directe band die alleen zegt wie iemand is, valt weg (`whoIsWho`: "VVD heeft als lid Thom van Campen",
    "Van Campen is Kamerlid"): dat staat al in het nieuws. Een lobby of een ambt van één blijft;
  - routes zonder bron vallen weg;
  - het blok verdwijnt als er niets overblijft.
- **Woorden** (`lib/explore/labels.ts`):
  - een afgelopen band staat in de verleden tijd ("had als bestuurder", "werkte voor", "was minister … bij");
  - bestuurder heet "is bestuurder bij" in plaats van "bestuurt";
  - een type dat niet zegt wat er gebeurde, leest zijn mechanisme: "valt publiekelijk aan" in plaats van
    "censureert", "is bron voor" in plaats van "werkt samen met".
- **Feitenlat in de sync** (`certainty_label` in `propaganda_model_sync.py`): een structuurfeit (baan, bestuurszetel,
  lidmaatschap, ambt, eigendom) is "onderbouwd" met één steunend argument dat een onafhankelijke controle in een
  geclassificeerde bron terugvond (status geverifieerd, score ≥ 0,30), tenzij een bron het tegenspreekt. Op het echte
  model gaan 164 verbanden van "aannemelijk" naar "onderbouwd", onder meer Ullah als hoofdredacteur van De Telegraaf.
- **Herkomst** (sync format 9, migratie `017_herkomst.sql`):
  - `pm_relations.origin` (opzet, register, eigenaar, assistent, agent; nooit een accountnaam) en `added_at`;
  - het uitlegblad toont "Herkomst: Uit de eerste opzet van het model, met AI gemaakt (1 jun)";
  - zolang 017 niet gedraaid is, laat de sync de kolommen weg en bewaart hij format 8 (`PENDING_RELATION_COLUMNS`),
    zodat een herstart de sync niet stilzet.

In het propagandamodel (in de maak, git-worktree, nog niet live):
- **Stemtoets**: de eigen stem zegt wat er gebeurde, geen oordeel over gevolgen of bedoelingen en geen etiketten;
  zo'n oordeel alleen als citaat van wie het zegt. Een stap in de automatische beoordeling, een neutrale
  herformulering via de gewone controles, en een strenge controle `NEUTRALITEIT-EIGEN-STEM`. De woordenlijst vond
  25 echte gevallen, waaronder argument 2189 en de omschrijvingen van PVV en VVD.
- **Specificiteit**: de bronchecker toetst of claim en bron over dít verband gaan. De bronzoeker splitst
  samengestelde claims (één feit per argument) en neemt alleen een bron die beide kanten noemt.
- **Opruimen**: een goedgekeurd verband zonder dragende bron waarvoor de bronzoeker niets vond, wordt afgewezen
  (terug te draaien). De proefrun telde 64 zulke verbanden, 88 zijn nog niet geprobeerd.
- **Meer mensen tussen redactie en partij**: onderzoeksdoelen voor de redactieleiding van de acht hoofdbronnen.

Tests:
- Jest: `__tests__/explore/why.test.ts` (6 nieuwe, met de voorbeelden van de eigenaar); alle 332 frontend-tests
  groen; tsc en ESLint schoon.
- Pytest: de feitenlat, de herkomst en de kolommen die op een migratie wachten; de 137 tests rond de pm-sync groen.
- In de app (dev-server, 390 breed) op het regenboogvlag-event:
  - "Wie zit erachter?" toont VVD (Berghuis, Ullah), "Tweede Kamer → ANP → AD" en PVV via Wilders' framing bij de
    NOS (met bron, noemt de NOS);
  - PVV → AD, PVV ↔ De Telegraaf en "Tweede Kamer wordt belobbyd door NOS" zijn weg;
  - "Hoe hangen ze samen?" is leeg, dus het blok verdwijnt.

## Story 14.24: Wat ontbreekt? leesbaar, en Niet gevraagd als eigen tab

**Status**: ✅ Done (2026-10-14), nog niet gecommit

Eigenaar (2026-10-14): "Wat ontbreekt? Nog niet helemaal mooi leesbaar en geformat.. en is het wel mooi uitgevoerd en
zinnig?", "Vooral die text aan de onderkant beetje vaag" en "misschien apart tab voor niet gestelde vragen?"

Wat er mis was (event 9241, storing Albert Heijn):
- Onderaan stonden tellingen in plaats van inhoud: "5 niet gestelde vragen · NOS · 5 weggelaten perspectieven", ook
  "1 niet gestelde vragen". De vragen zelf zag je pas na een tik.
- NL Times stond er twee keer in (twee artikelen).
- "Weggelaten perspectieven" per bron herhaalde de ontbrekende stemmen erboven.
- Een rij met alleen een naam ("Medewerkers en distributiecentra"): wat er mist, stond pas achter een tik.
- Het debat uit de wetenschap had het lange onderwerp als vette kop en "andere visies niet genoemd" eronder.
- Ongeveer een op de vijf "ontbrekende stemmen" is geen stem maar ontbrekende context ("Oorsprong en onderbouwing van
  de cijfers", "Wat '40 jaar tot levenslang' concreet betekent"). Het beeld tekende die als lege ballon met een
  doorgestreepte microfoon. De prompt vraagt er zelf om ("historical context, international comparison").

Wat er veranderd is:
- **Nieuwe tab "Niet gevraagd"** (`vragen`, roze, na Wat ontbreekt?), `components/explore/map/VragenTab.tsx`:
  - een kaart per bron (de meeste vragen eerst): de naam, één regel over wat het weglaten met het verhaal doet
    (`framing_by_omission`, zonder zinnen over de tekst die de analyse had, `omissionText`), dan de vragen zelf;
  - één bevinding per vraag (`type: "question"`), dus elke vraag kan "Klopt niet" en "Bewaar"; dezelfde vraag van
    één bron (twee artikelen) staat er één keer;
  - "＋ Vraag" en je eigen vragen staan hier, bij de bron (of spreker) waaraan je ze stelde;
  - de bronballon zegt "Niet gevraagd · 5 vragen"; Vergelijk gebruikt de eerste vraag.
  - "Weggelaten perspectieven" per bron toont de app niet meer: Wat ontbreekt? en Wie praat? laten dat al zien.
- **Wat ontbreekt?** (`OntbreektTab.tsx`), elk in een eigen witte kaart met serif kop:
  - "Wie komt niet aan het woord?": de ontbrekende stemmen, met in de dichte rij twee regels over wat er mist;
  - "Welke context ontbreekt?": hetzelfde voor ontbrekende context. Die staat niet meer als lege ballon in het beeld
    en heeft geen nummer; "Wie had het kunnen zeggen" heet daar "Waar het te vinden is";
  - "Welk debat ontbreekt?": het onderwerp, zo gebracht, waarover discussie is, andere visies, oordeel.
- **Stem of context**: de kritische prompt vraagt per gap `kind` (`stem` of `context`, en nooit beide in één gap).
  Database en `critical_prompt.txt` zijn gelijk; de template volgt nu ook de database, waar `quote_analysis` al uit
  was. `CoverageGap.kind` in `backend/app/llm/schemas.py` (een onbekende waarde wordt `null`, de analyse faalt
  nooit). **Werkt pas na een herstart van de backend**; tot dan, en voor oudere analyses, beslissen de woorden van
  het label (`isContextGap` in `lib/explore/missing.ts`). Op de 475 labels van de laatste twee dagen: 96 context, die
  lijst klopt; een paar gemengde ("Verdediging en context bij het Nord Stream-proces") gaan naar context.

Tests:
- Jest: `__tests__/explore/missing.test.ts` (5), alle 332 frontend-tests groen; tsc en ESLint schoon.
- Pytest: `test_coverage_gap_kind.py` (3).
- Playwright (explore, 3 apparaten): 135 groen. De 6 die falen zijn twee netwerktests in `netwerk-bord.spec.ts`
  ("asks who has influence…", "edges explain the relation…"). Die falen ook op HEAD zonder deze wijziging.
- Screenshots op 390 en 1440 breed van event 9241: geen zijwaarts scrollen, geen consolefouten.

## Story 14.25: Wie zit erachter? — posities, geen contact

**Status**: ✅ Done (2026-10-14), nog niet gecommit

Eigenaar (2026-10-14), bij "Regenboogvlag hangt toch bij Tweede Kamer" en "Yeşilgöz noemt Rusland 'onze vijand'":
"dit is allemaal wel echt vergezocht.. mensen of partijen die ooit bronnen waren etc. die niks met dit verhaal te
maken hebben.. Wel relevant als ze posities in een bepaald medium hebben ofzo dat zegt nog wat over de kleuring".
Akkoord ("ok") met het voorstel:
- alleen posities en geld;
- een column of vaste rubriek is een positie, vaak als deskundige gevraagd worden is contact;
- het blok verdwijnt als er niets overblijft;
- het onderzoek in het propagandamodel gaat naar posities, bij alle partijen.

Waar het misging:
- Story 14.23 liet elk verband met een bron zien dat het medium noemt. Bijna al die verbanden zijn contact, en contact
  heeft elk medium met elke partij:
  - "PVV is bron voor De Telegraaf" (rel 127) rust op één interview uit 2017. De controle vond het citaat terug, dus
    stond er "stevig onderbouwd".
  - "Kati Piri werkte voor de Wiardi Beckman Stichting" (2011), en de WBS "levert experts aan de Volkskrant". Dat
    laatste rust op één Volkskrant-stuk uit 2013.
  - "Tweede Kamer wordt geadviseerd door Clingendael", en Clingendael "levert experts aan het AD".
  - "Tweede Kamer is bron voor het ANP", en het ANP "levert kant-en-klaar nieuws aan" elke krant: 22 regels in een
    week.
- Een tussenstation telde als het bij één van de uiteinden hoorde (`meaningfulRoute`), ook aan de kant van de
  partij. Een instituut waar iemand ooit werkte of dat de Kamer adviseert, maakte zo van contact een verband.

Wat het doet in de nieuws-app (`behindRoute`, `behindParties`, `lineTier` in `lib/explore/why.ts`):
- "Wie zit erachter?" laat zien wie áchter het medium zit, niet wie ervóór de microfoon stond. Wie in dít nieuws
  praat, laat "Wie praat?" zien.
- De stap naar het medium is een positie of geld:
  - positie: werkt of werkte er, column of programma, bestuur, advies, woordvoerder, ambt, overstap, keuze van de
    hoofdredacteur;
  - geld: eigenaar, financier, investeerder, zeggenschap, of een adverteerder die het medium betaalt.
- Via een persoon alleen als die een positie bij het medium heeft én bij de partij hoort. Bij de partij horen is: lid
  van een partij of groep, baan, bestuur, woordvoerder, advies, of een ambt dat meer is dan één van de vele zetels.
  Voorbeelden: Ullah, Berghuis, Frits Wester.
- Via een organisatie alleen langs de eigenaar: LINDA. en Trouw zijn allebei van DPG Media, of een bestuurder van de
  eigenaar.
- Weg:
  - contact: bron, deskundige, interview, ANP-kopij, agenda, aanval, druk;
  - twee redactiebanen: een journalist die bij NRC en de Volkskrant werkte;
  - de eigen verslaggever of columnist die alleen door zijn eigen medium genoemd wordt: hij brengt het nieuws
    (`soleOutlets` in `lib/explore/pm-seeds.ts`, uit `outlet_counts` en de sprekers per medium);
  - een route waarvan beide banden voorbij zijn: NRC en Trouw hadden tot 2009 dezelfde eigenaar.
- Een regel is zo sterk als zijn zwakste band. Die band staat voorop: het oordeel, het bewijs en het onderzoek naar
  dun bewijs gaan over hem. Bij gelijke steun staat de positie bij het medium voorop.
- Geld zonder band (een adverteerder) rust nog steeds op bewijs dat het medium noemt (`specificParties`).
- Blijft er niets over, ook niet in "Hoe hangen ze samen?", dan verdwijnt het blok. De zinnen "Geen partij uit dit
  nieuws in het propagandamodel." en "Geen verband binnen twee stappen …" zijn weg. Is er alleen "Hoe hangen ze
  samen?", dan is dat de kop.
- `meaningfulRoute` blijft voor "Waarom zo?" in het filterblad van het netwerk.

Doorgerekend op de afgelopen week. Dat zijn 933 nieuwsitems uit de lokale database, als benadering: namen uit het
nieuws, niet de sprekers uit de analyse, zonder het oordeel "onbewezen".
- Voorheen hadden 47 items samen 96 regels. Nu hebben 11 items 19 regels.
- Weg, per soort band met het medium (77 regels):
  - experts en duiders: 29;
  - ANP-kopij: 22;
  - bron en gezag: 9;
  - eigendom die voorbij is of via contact loopt: 7;
  - eigen mensen en collega's: 7;
  - aanval en druk: 2;
  - een NOS-programma via een bron: 1.
- Blijft:
  - Ullah (VVD, De Telegraaf);
  - Berghuis en Frits Wester (RTL Nieuws);
  - Weesie (PowNed, De Telegraaf);
  - LINDA. en Trouw;
  - de omroepen en de NOS via de NPO.
- Drie blijvers rusten op banden zonder datum (Marcel van Dam, Wolffensperger en Hillen, die als "1969–" open
  staat). Ze vallen weg zodra de datumzoeker van het propagandamodel ze dateert.

In het propagandamodel:
- Het model kent weinig posities. Mensen tussen redactie en partij staan er alleen in bij PvdA (vooral oud-NOS en
  oud-Volkskrant), CDA, VVD, D66 en PRO (Bolhuis). Zonder meer onderzoek zwijgt het blok bij PVV, JA21, BBB, SP, NSC
  enzovoort. Dat is een gat in het model, geen afwezigheid van banden.
- De acht doelen `redactieleiding:<medium>` (sinds 2026-10-09) waren nog niet opgepakt. Op prioriteit 80 gingen
  namen uit het nieuws (tot ± 87) steeds voor, en de scout pakte in zes dagen 21 doelen op.
  `scripts/nieuws_redactieleiding_doelen.py`:
  - prioriteit 88, onder spoed (≥ 90);
  - de opdracht vraagt ook columnisten en vaste commentatoren;
  - een column wordt een positie (`mediaplatform` met Podiumverlening, of `personeel` met functie columnist), nooit
    Expert legitimatie;
  - de scout zoekt banden bij alle partijen;
  - de acht doelen zijn opnieuw ingediend (open, 88). `missies/nieuws_scout_brief.md` § redactieleiding zegt
    hetzelfde.
- Ongeveer 25 columns, vaste rubrieken en vaste tafelgasten staan als `beinvloeding` / Expert legitimatie, onder meer
  Bolhuis → RTL Nieuws, Van Rossem → de Volkskrant en de columnisten van Buitenhof.
  - Voor het blok tellen alleen de twee bij een nieuwsmedium van de app. Die gaan langs de scout:
    `context.column_als_deskundige` van de doelen voor RTL Nieuws en de Volkskrant noemt ze, en de scout legt de
    column vast als positie. De oude deskundige-relatie blijft staan; de app slaat die over.
  - De rest (Buitenhof, Op1, BNR, De Groene …) telt alleen in het netwerk en staat nog open. De
    pm-governancesessie nam het omzetten niet op zich.

Tests:
- Jest, `__tests__/explore/why.test.ts`, met de voorbeelden van de eigenaar:
  - weg: PVV → De Telegraaf, Piri → WBS → Volkskrant, Kamer → Clingendael → AD, Kamer → ANP → AD, een Kamerlid bij
    de NOS;
  - blijft: Ullah, LINDA. en Trouw, een minister die bij de Volkskrant werkte, Clingendael via zijn bestuurder die de
    NOS adviseert;
  - weg: geschiedenis aan beide kanten, collega's, de eigen verslaggever, het medium als adverteerder;
  - de zwakste band voorop, en `soleOutlets`;
  - alle 336 frontend-tests groen, tsc en ESLint schoon.
- Playwright: "Wie zit erachter?" in `onderzoeksmodus.spec.ts` en `waarom-zo.spec.ts`. In de demo zijn RIVM en het
  PBL alleen bron, dus er is geen blok en geen zin.
- In de app (dev-server, 390 en 1440 breed):
  - "Regenboogvlag" toont VVD (Berghuis, Ullah), CDA (Wester, Hillen) en D66 (Wolffensperger);
  - "Yeşilgöz noemt Rusland 'onze vijand'" toont alleen "Hoe hangen ze samen?";
  - geen zijwaarts scrollen.
- Pm: `scripts/test_datumzoeker.py` groen.

## Story 14.26: Tijdlijn als één as

**Status**: ✅ Done (2026-10-14), nog niet gecommit

Eigenaar (2026-10-14): "Dezelfde mensen in ander nieuws beetje random bij tijdlijn en lelijk om wat troep text
daaronder te plaatsen.. maak het mooi strak overzichtelijk en passend allemaal"

Wat er mis was:
- "Dezelfde mensen in ander nieuws" toonde losse namen met een telling ("Dat · 1 nieuwsitem", "Tweede Kamer",
  "Spreidingswet"). Het nieuws zelf zag je pas na een tik. De namen komen uit de herkenning van namen, met ruis:
  `org:dat`, `org:server`, `org:me`, `person:vuurwerkverbod` staan tussen de meest gedeelde namen in
  `event_relations`.
- Losse kopjes zonder kaart, onder elkaar: Voorgeschiedenis, Eerder in dit verhaal, Dit nieuws, Tegelijk verschenen,
  Later in dit verhaal, een dichte rij "Waarom nu?".
- Momenten na het laatste artikel werden vastgezet op het einde van het nieuws, in de volgorde van de analyse: "1 apr
  2027" stond vóór "1 jan 2027".

Wat er veranderd is (`components/explore/map/TijdlijnTab.tsx`, `lib/explore/chronology.ts`):
- Eén witte kaart met één as. Links staat de tijd, op de lijn een punt, rechts wat er gebeurde:
  - erboven het verhaal ervóór: achtergrond (jaartallen) en eerdere nieuwsitems (link, aantal artikelen);
  - dan "Dit nieuws" op een zwarte lijn, per dag en per uur: wie publiceerde wanneer (met vertraging), wat er gebeurde,
    je eigen momenten;
  - eronder het verhaal erna: latere nieuwsitems en wat nog komt, elk op zijn eigen datum.
- Een vol punt is berichtgeving (artikel, nieuwsitem), een open punt is iets dat gebeurde. Zwart is dit nieuws,
  grijs het verhaal eromheen, gestippeld is van jou.
- Meer dan drie dingen ervóór: de oudste vouwen weg achter "Nog n eerder"; je eigen momenten blijven staan.
- "Waarom nu?" is een eigen kaart: waarom nu en wat komt eraan, met Klopt niet en Bewaar. "Wie heeft er baat bij?"
  (`cui_bono`) toont de app niet meer: het past niet bij de tijdlijn (eigenaar, 2026-10-14) en is vaak een gok ("Uit
  de tekst niet vast te stellen …"). De analyse levert het nog wel.
- "Dezelfde mensen in ander nieuws" is weg. Elke naam is aantikbaar en toont "Ook in ander nieuws". Een relatie
  met één gedeelde naam hoort niet bij het verhaal (`storyThread` heeft geen `people` meer).
- Een moment hoort bij dit nieuws als het tot een dag voor het eerste of na het laatste artikel valt (`partOf`).

Tests:
- Jest `__tests__/explore/figure.test.ts`: de as (ervoor, dit nieuws, erna) en momenten na het nieuws op hun eigen
  datum; alle 339 frontend-tests groen, tsc en ESLint schoon.
- Playwright `onderzoeksmodus.spec.ts` ("follows the story", "switches between the questions") groen op drie
  apparaten. "Wie zit erachter? shows real routes in the demo" faalt: de demo heeft sinds Story 14.25 geen blok.
- Screenshots op 390 en 1440 breed (demo, "Bart van den Brink vraagt hulp", "Meerdere explosies"): geen zijwaarts
  scrollen.

## Story 14.27: Zelfde tekst — persbureaukopij in een nieuwsitem

**Status**: ✅ Done (2026-10-16; in het beeld, herijkt en in de analyse 2026-10-19), nog niet gecommit; backend-herstart
nodig voor de nieuwe kanscurve en de analyse

Eigenaar (2026-10-16), na de vraag of veel nieuws een herschreven persbureaupakket is: "Kun een metric maken waarmee
we op de nieuwswebsite in een event nieuwsberichten kunnen clusteren die met een bepaalde waarschijnlijkheid copy
paste nieuws zijn van dezelfde persbureau?"

Waarom:
- Drie media met dezelfde ANP-tekst zijn één stem, geen drie. "Wie zegt wat?" telt ze nu als drie.
- Meting in de eigen database (oktober 2025 tot 16 oktober 2026, de acht hoofdbronnen): van de artikelen over nieuws
  dat ook een andere hoofdbron bracht, is ongeveer 1 op 6 voor minstens de helft dezelfde tekst als bij een ander
  medium. De Telegraaf 40-45 %, RTL Nieuws 18-33 %, AD 20 %, Het Parool 13-22 %, Trouw 14 %, de Volkskrant 0-5 %,
  NU.nl 2-3 % (herschrijft), NOS 0 %.
- Onderzoek: Boumans e.a. (2018, data 2014) vonden online 68 % ANP-kopij (NU.nl 75 %), papier 12-16 %; Welbers e.a.
  (2018) online 50-75 % (gedeeltelijke) kopie bij politiek nieuws.

Hoe het meet (`backend/app/services/copy_detection.py`, geen AI):
- Per paar artikelen van verschillende media in één nieuwsitem: welk deel van elke tekst woord voor woord in de andere
  staat, in passages van minstens 12 woorden in dezelfde volgorde (`cover`). Citaten tellen niet mee (media die zelf
  schrijven citeren dezelfde uitspraak), sitemeubilair ook niet ("Maak RTL je Google-favoriet", cookiemeldingen).
- De overlap is het deel van de meest bedekte tekst: een ingekorte kopie staat helemaal in het origineel.
- `copy_probability` maakt er een kans van dat het kopieën van één tekst zijn. Eerst geijkt op 33 paren die met de
  hand waren beoordeeld; sinds 2026-10-19 op de 93 blind beoordeelde paren (zie "Nauwkeurigheid"), gewogen naar de
  echte aantallen: 0,19 bij overlap 0,20, 0,50 bij 0,27, 0,87 bij 0,36 en 0,98 bij 0,45 (`PROBABILITY_MIDPOINT` 0,27,
  `PROBABILITY_SLOPE` 21; was 0,36 en 16). Opgeslagen kansen hebben `"v": 2`.

- Artikelen met een kans van minstens `COPY_CLUSTER_MIN_PROBABILITY` (0,5) vormen een groep (ook via een derde).
- Waar de tekst vandaan komt:
  - een tekst noemt ANP ("(ANP)", "ANP/AFP", "tegen het ANP"): persbureau, ANP;
  - media van verschillende eigenaren (`eigendom` in het propagandamodel; concurrenten kopiëren elkaar niet):
    persbureau, vermoedelijk ANP (het enige Nederlandse persbureau sinds de overname van Novum);
  - titels van één eigenaar met dezelfde artikelcode (ad.nl/…~a43d58b6/ en parool.nl/…~b43d58b6/): zelfde artikel
    van die uitgever;
  - titels van één eigenaar zonder gedeelde code: "zelfde tekst", bron open (zij nemen ook ANP-kopij af).
- Opslag per link in `event_articles.scoring_breakdown.copy` (groep, aandeel, beste match, kans, bron), zoals
  `found_voice`: geen migratie, de website leest het al mee in dezelfde query.

Job "Copy Detection" (elke 60 s, `COPY_DETECTION_*`): vergelijkt de nieuwsitems die in de laatste 72 uur een artikel
kregen en sinds de vorige keer veranderden (aantal links, laatste link, artikel-ids). Eerste run na een herstart: alle
929 nieuwsitems van 72 uur in 1,3 s. Beheer: `POST /admin/trigger/copy-detection` (`hours`, `force`,
`include_archived`, `dry_run`) en `POST /admin/trigger/copy-detection/{event_id}` (geeft de groepen terug).

Wat de lezer ziet. Eerst alleen onder "Alle bronnen en artikelen"; eigenaar (2026-10-19): "nu is het wel heel ver
verstopt". Sindsdien is zelfde tekst een bevinding zoals de andere, met een nummer (`=7`) na de tegenspraken
(`lib/explore/findings.ts`, `figure.ts`, `lib/explore/copies.ts`):
- "Wie zegt wat?": ballonnen met dezelfde tekst staan naast elkaar (de grootste groep eerst), met een grijze lijn
  ertussen en in het midden het nummer, zoals ⚡ bij een tegenspraak. Staan ze in verschillende invalshoeken, dan
  krijgt de ballon een chip "=7 zelfde als RTL Nieuws" (op een telefoon naast een tweede chip alleen "=7"). Een tik
  opent de kaart onder "Wie praat?" (`NewsFigure.tsx`).
- "Wie praat?": bovenaan per tekst een kaart met de herkomst als kop ("Zelfde persbureautekst (vermoedelijk ANP)",
  "Zelfde artikel van DPG Media"), de artikelen op volgorde van publicatie en per artikel "80% dezelfde tekst · kans
  99%" (`CopyCards.tsx`). Een artikel dat vooral iets anders is (een liveblog met het bericht erin) "bevat deze tekst".
  De kans staat nooit op 100 %.
- "Alle bronnen en artikelen": de kop zegt hoeveel artikelen dezelfde tekst zijn ("5 met dezelfde tekst"), en bij elk
  artikel opent een pil "=7 zelfde tekst" de kaart (`SourcesRow.tsx`).

Tests:
- Pytest `backend/tests/unit/test_copy_detection.py` (21): citaten en meubilair, ingekorte kopie, eigen woorden met
  hetzelfde citaat, passages in dezelfde volgorde, de ijking, herkomst (eigenaren, ANP, artikelcode), groepen via een
  derde, liveblog, de beheer-endpoints.
- Integratie `backend/tests/integration/test_copy_detection.py` (2) op een echte Postgres (`TEST_POSTGRES_URL`):
  opslaan, niets dubbel vergelijken, een vertrokken artikel, dry run, eigenaren uit het propagandamodel.
- Alle 775 andere backend-unittests groen, op `test_google_news` na (land van Times of Israel, staat los hiervan).
- Jest `__tests__/explore/copies.test.ts` (9, sinds 2026-10-19 ook nummering, lijnen tussen buren, chips bij ballonnen
  uit elkaar en drie media); alle 364 frontend-tests groen, tsc en ESLint schoon.
- Op de echte data (72 uur): 27 groepen in 929 nieuwsitems; screenshots op 390 breed (Nobelprijs: AD, Trouw, RTL
  Nieuws, De Telegraaf en Het Parool; Harry Styles: zelfde artikel van DPG Media).

### Nauwkeurigheid, blind gemeten (2026-10-16)

Opzet:
- 93 paren die bij de bouw en de ijking niet bekeken waren, gestratificeerd over alle 1.631 paren (verschillende media
  in één nieuwsitem, beide met genoeg tekst). Daaronder 25 paren zonder gedeelde passage, waarvan 15 met de meeste
  gedeelde woordgroepjes (de waarschijnlijkste missers). De uitkomsten zijn gewogen naar de echte aantallen per laag.
- Twee onafhankelijke beoordelaars (agents zonder kennis van de metric) zagen geen score, geen medium en geen tijd.
  "Kopie" betekent: meer dan de helft van de zinnen van de kortste tekst (buiten citaten) staat (bijna) letterlijk in
  de andere. Ze waren het over alle 93 paren eens (kappa 1,0). Het is wel één model, dus dat zegt minder dan twee
  mensen die het eens zijn.

| Overlap | Paren (populatie) | Beoordeeld | Kopie | Deels | Eigen | Voorspelde kans | Gemeten |
|---|---|---|---|---|---|---|---|
| 0 | 1.276 | 10 | 0 | 0 | 10 | 0,00 | 0,00 |
| 0, meeste woordgroepjes | 67 | 15 | 0 | 4 | 11 | 0,00 | 0,00 |
| 0-0,20 | 90 | 15 | 1 | 9 | 5 | 0,02 | 0,07 |
| 0,20-0,36 | 32 | 11 | 8 | 2 | 1 | 0,23 | 0,73 |
| 0,36-0,50 | 24 | 12 | 11 | 1 | 0 | 0,70 | 0,92 |
| 0,50-0,70 | 49 | 15 | 14 | 1 | 0 | 0,97 | 0,93 |
| ≥ 0,70 | 93 | 15 | 15 | 0 | 0 | 1,00 | 1,00 |

Uitkomst bij de drempel (kans ≥ 0,5, overlap ≥ 0,36), met 95%-intervallen (bootstrap):
- Precisie 97% (92-100): van wat de metric groepeert, is 97% echt dezelfde tekst.
- Recall 85% (78-90): 15% van de kopieën mist hij. Dat zijn licht herschreven ANP-teksten (NU.nl, RTL, De Telegraaf)
  met 20-36% letterlijk gelijke passages.
- Brier-score 0,015. De gewone accuracy (98%) zegt weinig: de meeste paren zijn overduidelijk verschillend.
- De kans is te laag tussen 0,2 en 0,5 (voorspeld 0,23 en 0,70, gemeten 0,73 en 0,92). De eigen ijking rekende licht
  herschreven tekst niet als kopie, de blinde beoordelaars wel.
- Met de drempel op overlap 0,20: precisie 93% (87-98), recall 97% (91-100).

Niet gemeten: of de herkomst klopt (ANP, uitgever), artikelen zonder tekst (betaalmuur), en kopieën die de clustering
in verschillende nieuwsitems zette.

### Herijkt en opnieuw gemeten (2026-10-19)

De curve is opnieuw geijkt op de 93 blinde oordelen (gewogen naar de echte aantallen per laag). Op die paren is de
precisie 97 % en de recall 92 %, met een Brier-score van 0,010. Omdat dat dezelfde paren zijn, is daarna opnieuw blind
gemeten:
- 72 nieuwe paren, nooit gebruikt bij het ijken: 61 uit dezelfde populatie en 11 van na 16 oktober. Ze zijn
  gestratificeerd over 1.580 paren en terug gewogen.
- Elk paar kreeg twee nieuwe beoordelaars, met dezelfde regels: geen score, medium of tijd.
- Over kopie of niet waren ze het bij alle 72 eens (kappa 1,0). Over de drie labels kopie, deels en eigen was dat 93 %
  (kappa 0,89).

| Overlap | Paren (populatie) | Beoordeeld | Kopie | Deels | Eigen | Voorspelde kans | Gemeten |
|---|---|---|---|---|---|---|---|
| 0 | 1.323 | 8 | 0 | 0 | 8 | 0,00 | 0,00 |
| 0, meeste woordgroepjes | 69 | 12 | 1 | 5 | 6 | 0,00 | 0,08 |
| 0-0,15 | 64 | 14 | 0 | 13 | 1 | 0,02 | 0,00 |
| 0,15-0,27 | 12 | 12 | 3 | 5 | 4 | 0,17 | 0,25 |
| 0,27-0,40 | 2 | 2 | 2 | 0 | 0 | 0,73 | 1,00 |
| 0,40-0,60 | 17 | 12 | 12 | 0 | 0 | 1,00 | 1,00 |
| ≥ 0,60 | 93 | 12 | 12 | 0 | 0 | 1,00 | 1,00 |

Uitkomst bij de drempel (kans ≥ 0,5, nu overlap ≥ 0,27), met 95%-intervallen (bootstrap per laag):
- Precisie 100 % (100-100): geen enkel paar boven de drempel was iets anders dan dezelfde tekst.
- Recall 93 % (84-99). Wat hij mist, zijn bewerkte kopieën:
  - een paar dat voor de helft letterlijk ANP is (overlap 0,26);
  - twee licht herschreven teksten (0,17 en 0,22);
  - een paar zonder één gelijke passage van 12 woorden, waarin alleen de zinnen tussen de citaten bijna gelijk zijn.
- Brier-score 0,005. Met de oude curve (drempel 0,36) waren de precisie 100 % en de recall 91 %.
- Met de drempel op overlap 0,20 is de recall 94 % en de precisie nog 100 %. Dat verschil is één paar, dus de drempel
  blijft bij een kans van 0,5.

### De analyse leest één tekst één keer (2026-10-19)

Waarom: de samenvatting schreef "Volgens De Telegraaf overleed Geel in juli…", terwijl RTL Nieuws, AD en De Telegraaf
dezelfde ANP-tekst brachten. Drie kopieën namen ook drie van de 16 plekken.

Hoe (`backend/app/llm/prompt_builder.py`, geen extra AI-aanroep):
- De promptbouwer leest de groepen uit `event_articles.scoring_breakdown.copy` in de lokale database.
- Van een groep wordt het eerste artikel in de gewone volgorde (het nieuwste per medium eerst) heel gelezen.
- Een kopie daarna brengt alleen de zinnen die nog niet in de prompt staan. Dat wordt per zin bepaald op de hele tekst:
  een zin telt als gelezen wanneer de helft van zijn reeksen van 6 woorden er al staat. Een kopie neemt pas een plek in
  vanaf 40 eigen woorden (`OWN_TEXT_MIN_WORDS`), en nooit de plek van een artikel dat er zonder dit wel in zat.
- Het eerste artikel toont "Tekst die ook bij AD en RTL Nieuws staat" en apart "Eigen tekst van De Telegraaf".
- Een kopie toont "Eigen tekst van AD (de rest staat bij artikel 1)", of "dezelfde als bij artikel 1, zonder eigen
  zinnen".
- Staat de gedeelde passage buiten wat de prompt van het eerste artikel leest (4.000 tekens, bijvoorbeeld bij een
  liveblog), dan blijft de kopie heel.
- Elk artikel van een groep krijgt de regel "Zelfde tekst als RTL Nieuws (artikel 3): persbureautekst (vermoedelijk
  ANP)", en de context krijgt "- Zelfde tekst bij De Telegraaf, AD en RTL Nieuws: …".
- Boven de artikelen staat wat dat betekent (`COPY_NOTE`): één bron, geen bevestiging door meer media; schrijf het toe
  aan de tekst die ze samen brengen. Dat staat in de data en niet in de prompt in de database, zodat de database en de
  templates gelijk blijven.
- Gemeten op de 13 nieuwsitems met kopieën van de laatste 72 uur:
  - geen enkel nieuwsitem raakte de grens van 16 artikelen (het grootste had er 13), dus er wordt niets extra gelezen
    en er valt geen medium weg;
  - de artikelblokken zijn 2 % korter;
  - de winst zit in de toeschrijving.
- Tests in `backend/tests/unit/test_prompt_builder.py` (5): één plek voor drie kopieën, een kopie zonder eigen zinnen,
  een kopie alleen in de prompt, de groepen uit de links en de liveblog.
- Dit geldt voor nieuwe analyses na een herstart van de backend; bestaande analyses blijven zoals ze zijn.

### Open
- Bewerkte kopieën mist de metric (7 % van de kopieën, zie de hermeting).
- Het eigen deel van AD en RTL Nieuws bevat soms paginarommel ("Interessant voor jou" met koppen van andere artikelen,
  "Lees meer over"). Dat zit al in de opgehaalde tekst en hoort daar weg.
- Oudere nieuwsitems: `POST /admin/trigger/copy-detection?hours=8760&include_archived=true&force=true`.

## Story 14.28: Ballonnen per invalshoek, niet per krant

**Status**: ✅ Done (2026-10-19)

Feedback eigenaar (2026-10-19): "moet niet per krant maar per invalshoek verdeeld zijn in ballonnen", en de naam van
een invalshoek noemt de krant niet ("Telegraaf: …"), ook niet als die krant de enige met die invalshoek is.

- "Wie zegt wat?" groepeert per invalshoek zodra er 2 Nederlandse bronnen zijn (was 3). Met 1 Nederlandse bron blijft
  het één groep met de sprekers als eigen ballon (`lib/explore/figure.ts`).
- De naam van een invalshoek zegt hoe het nieuws gebracht wordt, niet wie het brengt: de prompt (`prompt_factual`,
  database + `factual_prompt.txt`) verbiedt mediumnamen in `label`, en voor bestaande analyses haalt
  `lib/explore/angle.ts` de bronnen van het nieuws uit de naam ("Berichtgeving RTL Nieuws over X" → "Berichtgeving
  over X", "Recensie van de Volkskrant" → "Recensie"; blijft er niets over: "Berichtgeving"). Getoetst op alle 3.470
  labels van de laatste 30 dagen: 244 noemden een bron, alle 244 schoon, geen andere gewijzigd. Het finding-id houdt
  het oude label (bewaarde items blijven werken).
- Tests: `__tests__/explore/angle.test.ts`, `figure.test.ts` (twee bronnen per invalshoek).

## Story 14.29: Achtergrond uit overheidsstukken (Bron van Open State)

**Status**: ✅ Gebouwd (2026-10-21), nog niet gecommit. Eigenaar (2026-10-21): bouwen, in de Tijdlijn

Eigenaar (2026-10-19), over https://openstate.eu/projecten/: "Wat van deze projecten (databases of api's of front
ends whatever) kun je gebruiken om als er een nieuwe event is hier og meer relevante achtergrondinformatie over op te
zoeken?"

Wat bruikbaar is:
- Bruikbaar is alleen **Bron** (bron.live, broncode `openstate/jodal`, MIT). Daarin zitten PoliFLW, Woogle en Open
  Raadsinformatie al.
  - De zoek-API heeft geen sleutel: `GET https://api.bron.live/documents/search`, met `query` (Elasticsearch
    query_string), `filter` (`source:oor,woogle|published_from:2026-10-01`), `sort` (`_score:desc`,
    `published:desc`), `limit`, `includes`/`excludes`; ook `format=rss`.
  - Gebruiksvoorwaarden of een limiet heeft Open State nergens gepubliceerd.
- Wat erin zit (2026-10-20; totaal sinds de start, met de nieuwste datum):

  | `source` | Wat | Stukken | Nieuwste |
  |---|---|---|---|
  | `openbesluitvorming` | raadsstukken van gemeenten (= Open Raadsinformatie) | 4,9 mln | 2026-10-15 |
  | `woogle` | Woo-stukken | 1,5 mln | 2025-10-13 |
  | `poliflw` | nieuws van partijen, vrijwel alleen lokale afdelingen (landelijk: laatste in dec. 2025) | 706 dzd | 2026-10-19 |
  | `cvdr` | lokale regelgeving | 235 dzd | 2026-10-01 |
  | `obk` | officiële bekendmakingen van gemeenten | 215 dzd | 2026-10-19 |
  | `oor` | Woo-stukken van het Rijk (open.overheid.nl) | 42 dzd | 2025-04-10 |

- De rest van de lijst is niet bruikbaar:
  - Open Lobby en Open Rechtspraak zitten al in het propagandamodel (`tools/registers/agenda.py`,
    `rechtspraak.py`).
  - Open Spending heeft geen API gevonden.
  - Open Inkoop, VraagHetZe en Politwoops reageerden niet.
  - Woogle verhuisde naar woozm.nl, zonder API.
  - De andere projecten zijn campagnes, onderzoek of verkiezingshulp.

### Meting (2026-10-20)

Opzet:
- Twaalf binnenlandse nieuwsitems van 14-20 oktober met kans op overheidsstukken. Etos is de controle: daar zijn geen
  stukken te verwachten.
- Per item drie manieren om de zoekvraag te kiezen. Alleen de derde gebruikt een mens.
- De bovenste treffers (4-5 per groep bronnen) zijn beoordeeld op de vraag of een stuk over dit nieuws of het
  onderwerp ervan gaat. Dat deed één beoordelaar (Claude), niet blind. Het is een kleine steekproef: lees de cijfers
  als richting.

| Nieuwsitem | Automatisch: woorden of namen | Automatisch: zeldzaamste woord | Goed gekozen woord |
|---|---|---|---|
| Streekvervoer staakt opnieuw | – | – (Keolis: vervoerplannen) | – (streekvervoer + staking) |
| Onderhoud boven nieuwe wegen | – | – (Karremans: andere brieven) | ✓ Nedersaksenlijn: MIRT-afspraken, CDA over uitstel |
| Jetten vader via draagmoeder | – | ✓ draagmoeder: WODC "Het Gedragen Kind" | ✓ draagmoederschap: idem |
| PostNL wil extra geld | – | – | – (alleen late post in Haarlemmermeer) |
| Calandbrug blijft dicht | – | – | – |
| Angstcultuur asielschip Silja | – | – (asielschip: een ander schip) | ✓ Silja: raadsdebatten Rotterdam over de MS Silja |
| Statushouders en sociale huur | – | – | ✓ raadsvragen over voorrang statushouders |
| Arbeidsuitbuiting stijgt | – | – | ✓ "Samen tegen mensenhandel" (JenV), gemeentelijke aanpak |
| Geroofde Kandinsky verkocht | – | – (geroofde Joodse panden) | – (roofkunst algemeen) |
| Coalitie zoekt steun rechts | – | – | ✓ spreidingswet: contourennota intrekking, lokale partijen |
| Klaver nodigt Jetten uit | – | niet gemeten | niet gemeten |
| Etos online na cyberaanval (controle) | – | – | – |
| **Raak** | **0 van 12** | **1 van 11** | **6 van 11** |

Wat de meting zegt:
- **De zoekterm bepaalt alles.**
  - Woorden uit de tf-idf of namen uit het nieuws vinden niets bruikbaars. "werkgever", "Rob Jetten" en "FNV" staan
    in duizenden stukken.
  - Het zeldzaamste woord volgens Bron's eigen telling pakt ruis: "De Calandbrug", "syriër", "Delhaize".
  - Het woord dat een overheidsstuk zelf gebruikt werkt wel: een wet, een project, een plaats of een schip.
- **Een treffer met de zoekterm in de titel ging in deze steekproef over het onderwerp.** Treffers die de term alleen
  in de tekst hadden, waren meestal ruis. Een filter op de titel houdt de lijst dus zuiver, en geeft liever niets dan
  iets dat er niet over gaat.
- **Bron is lokaal.**
  - De treffers zijn raadsstukken en partijnieuws van gemeenten.
  - Rijksstukken stoppen in april 2025 (`oor`) en oktober 2025 (`woogle`).
  - Kamerstukken en Handelingen zitten er niet in.
  - Voor landelijk nieuws geeft Bron dus vooral oudere achtergrond, zoals het WODC-rapport van 2024.
- **De meeste grote nieuwsitems zijn buitenlands, sport of entertainment.** Van de 40 grootste van deze week (4+
  artikelen) gingen er twee over Nederlands beleid of bestuur (draagmoederschap, streekvervoer). Bron helpt alleen bij
  dat soort nieuws.

### Hoe het zou werken

Eén manier, zonder extra AI-aanroep (regel: extra AI alleen voor de beheerder):

1. **De zoekterm komt uit de feitenanalyse.** `prompt_factual` levert een nieuw veld `zoektermen`: hoogstens twee
   woorden die een overheidsstuk over dit nieuws zou gebruiken ("draagmoederschap", "Silja", "spreidingswet"). Bij
   buitenlands nieuws, sport en entertainment blijft het leeg. Het zit in dezelfde aanroep, dus er komt geen AI bij.
   Database en `factual_prompt.txt` gaan samen (zie CLAUDE.md, "LLM Prompts Updaten").
2. **Een job "Achtergrondstukken"** (elke 15 minuten, na de insights) draait voor nieuwsitems met zoektermen die nog
   niet gezocht zijn, of waarvan de termen veranderden. Per term is het één aanroep van Bron (`sort=_score:desc`,
   `limit=20`, de laatste drie jaar). Wat blijft:
   - alleen stukken met de term in de titel;
   - dezelfde titel maar één keer (Bron heeft dubbelen, bijvoorbeeld een stuk bij twee vergaderingen);
   - hoogstens 5 per nieuwsitem, de nieuwste eerst.

   Bij zo'n 150 binnenlandse items per dag zijn dat hoogstens 300 aanroepen naar Bron. Er gaat geen leesverkeer naar
   Supabase.
3. **Opslag** in een nieuwe tabel `event_documents` (migratie 021):
   - kolommen: nieuwsitem, term, bron, titel, url, datum, plaats of organisatie;
   - lokaal, en via `PUBLISHED_TABLES` ook in Supabase, met RLS en alleen SELECT voor anon.
4. **Tonen in de Tijdlijn**, in het verhaal ervóór (Story 14.26):
   - elk stuk op zijn datum, met een eigen punt;
   - waar het vandaan komt, bijvoorbeeld "Raadsdebat · Rotterdam" of "Woo-stuk · Ministerie van JenV";
   - de titel als link naar het stuk.

   Er staat alleen wat er is: geen "geen stukken gevonden".

### Besluit (eigenaar, 2026-10-21)
- Bouwen, in de Tijdlijn.
- Nog open: Open State vragen of de API zo gebruikt mag worden. Ze publiceren geen voorwaarden.

### Gebouwd (2026-10-21)
- **Zoektermen**: `prompt_factual` (database en `factual_prompt.txt`) vraagt `zoektermen`, hoogstens twee. Het schema
  (`FactualPayload.zoektermen`) neemt de eerste twee en laat de analyse nooit mislukken op dit veld. Ze staan in
  `llm_insights.prompt_metadata.zoektermen`, dat lokaal blijft.
- **Job "Background Documents"** (`backend/app/services/background_documents.py`, elke 15 minuten,
  `BACKGROUND_DOCUMENTS_*`):
  - pakt nieuwsitems die niet gearchiveerd zijn en waarvan de nieuwste analyse andere termen geeft dan de vorige
    zoekopdracht (`event_document_searches`, lokaal, migratie 022), hoogstens 20 per keer, de nieuwste eerst;
  - zoekt per term `title:"term"` in Bron, de laatste drie jaar, 20 treffers;
  - houdt alleen treffers met de term letterlijk in de titel, zonder het registratienummer ervoor
    ("[24bb002195] …");
  - houdt elke titel en URL één keer, hoogstens 5, de nieuwste eerst;
  - vervangt dan de stukken van dat nieuwsitem.

  Valt Bron uit, dan stopt de run zonder iets op te slaan. De volgende run probeert het opnieuw.
- **Opslag**: `event_documents` (migratie 021, op beide databases): lokaal geschreven, via `PUBLISHED_TABLES` in
  Supabase, met RLS en alleen SELECT voor anon.
- **Tijdlijn** (`lib/explore/chronology.ts`, `TijdlijnTab.tsx`):
  - elk stuk staat op zijn datum, vóór of na dit nieuws, met een klein grijs vierkant als punt (een stuk, geen
    moment of artikel);
  - erboven staat waar het vandaan komt, met `documentLabel`: Raadsstuk, Partijnieuws, Woo-stuk, Regelgeving of
    Bekendmaking, met de plaats of organisatie ("Raadsstuk · Rotterdam");
  - de titel linkt naar het stuk;
  - een stuk zonder datum staat er niet. Zonder stukken verandert er niets.
- **Beheer**: `POST /admin/trigger/background-documents?limit=20`, en `POST
  /admin/trigger/background-documents/{event_id}` voor één nieuwsitem, ook als het al gezocht is.
- **Tests**: `backend/tests/unit/test_background_documents.py` (termen, titelfilter, selectie, zoekvraag, schema,
  aanroep met een nep-Bron) en Jest `figure.test.ts` (stukken op de as, label).

### Open
- Actuele landelijke stukken zitten niet in Bron. Die vraag hoort in een eigen story, met deze bronnen:
  - Kamerbrieven en Kamervragen: officielebekendmakingen.nl (SRU) of de Tweede Kamer OData, die het propagandamodel
    al leest voor personen;
  - Woo-stukken van het Rijk: open.overheid.nl.
- Bijvangst van de meting (2026-10-20), los van deze story:
  - Sinds 2026-10-19 14:33 ontbrak de Chromium van Playwright (`chromium_headless_shell-1148`). Een
    Playwright-installatie elders had hem opgeruimd, omdat de backend-venv niet in `ms-playwright/.links` stond.
  - Elke fetch liet daardoor een node-driver achter: 2.523 stuks, en de Mac kon geen processen meer starten.
  - Volkskrant, Parool en Trouw kwamen niet binnen. AD, NU.nl, De Telegraaf, NieuwRechts en NineForNews kwamen binnen
    met alleen de RSS-samenvatting: 140 artikelen.
  - Hersteld: de drivers gestopt, de browser opnieuw geïnstalleerd (`.venv/bin/python -m playwright install
    chromium`), en `PlaywrightBrowserPool` stopt nu de driver van een mislukte start
    (`backend/tests/unit/test_playwright_fetch.py`). Die codewijziging werkt na een herstart van de backend.

## Story 14.30: Gelinkte bronnen (OSINT)

**Status**: ✅ Gebouwd (2026-11-15), nog niet gecommit. Eigenaar (2026-11-15): "doe nu de osint aanvullingen bouwen"

Aanleiding: een voorstel voor vier OSINT-automatiseringen (eigendom via OpenCorporates/OpenSanctions/Wikidata,
technische vingerafdrukken via RDAP/urlscan.io, bron- en citatie-analyse per artikel, coördinatie via
embeddings). Beoordeeld op 2026-11-15:
- **Coördinatie (embeddings > 85 %)**: niet gebouwd. Zelfde tekst (Story 14.27) vergelijkt woord voor woord en is
  gekalibreerd. Embeddings van hetzelfde nieuws lijken altijd op elkaar (de clustering gebruikt 0,70), en
  "gecoördineerd" is een oordeel.
- **Bron- en wederhoor-extractie per artikel met een LLM**: niet gebouwd. "Wie praat?", "Wat ontbreekt?" en "Niet
  gevraagd" doen dit per nieuwsitem; een aanroep per artikel botst met de regel dat extra AI alleen voor de beheerder
  is.
- **Technische vingerafdrukken**: niet gebouwd. Een gedeeld IP-adres zegt niets (Cloudflare, gedeelde hosting). Een
  gedeeld tracking-id is geen plek in het medium en geen geld (Story 14.25). Hooguit een spoor voor `nieuws-scout`.
- **OpenSanctions als register**: niet gebouwd. De data staat onder CC BY-NC 4.0 en de app heeft betaalde
  pro-codes, dus het gebruik is commercieel: daar is een licentie voor nodig. Wat OpenSanctions over Nederlandse
  ambtsdragers heeft, leest het propagandamodel al rechtstreeks uit de registers zelf (OO, Tweede Kamer, EP). Het
  is een eigenaarsbesluit.
- **Externe links in de artikeltekst**: gebouwd (hieronder). Deze stap gebruikt geen AI en de feiten staan letterlijk
  op de pagina.

### Wat er gebouwd is
- **Ophalen**: `extract_links` in `backend/app/ingestion/parser.py`. Trafilatura haalt de artikeltekst er nog een
  keer uit, nu met links (`include_links`). Alleen links in de tekst tellen; menu, footer en "lees ook" blijven buiten.
  - Weg blijven: links naar de eigen site (`site_of`), deelknoppen en "volg ons"-links (Google Nieuws, WhatsApp-kanaal).
  - Weg uit de link: trackingparameters en het `#`-deel. Een post op X wordt `x.com/<naam>/status/<id>`.
  - Hoogstens 20 links per artikel (`LINK_LIMIT`).
  - Opslag in `articles.source_metadata.links` (`article_repo.upsert_from_feed_item`). Dat veld wordt al
    gepubliceerd, dus er is geen migratie nodig.
- **Wat het oplevert** (2026-11-15, losse artikelen):
  - NieuwRechts linkt naar vier Kamerstukken (officielebekendmakingen.nl).
  - NineForNews linkt naar een post op X van Van Houwelingen.
  - De Dagelijkse Standaard linkt naar maurice.nl en parlement.com.
  - GeenStijl linkt naar ScienceDaily en het AD.
  - NOS en NU.nl linken zelden.
- **Nieuwspagina**: in "Alle bronnen en artikelen" (`SourcesRow`) staan onder elk artikel de sites waar het naar
  linkt (↗ rijksoverheid.nl). Een pagina waar artikelen van twee of meer bronnen naar linken, staat onder "Dezelfde
  pagina gelinkt" met die bronnen (`sharedLinks` in `frontend/lib/explore/links.ts`).
- Tests: `backend/tests/unit/test_parser.py`, `frontend/__tests__/explore/links.test.ts`.

### Open
- Alleen artikelen die sinds 2026-11-15 binnenkomen hebben links. Oudere artikelen krijgen ze niet: die pagina's
  worden niet opnieuw opgehaald.
- Een feed die zelf de volledige tekst geeft (GeenStijl, INDEPEN) levert alleen links op als de pagina wordt
  opgehaald.
- Wat de links verder opleveren staat in Story 14.31: gelinkte stukken in de Tijdlijn, en de links in de analyse.

## Story 14.31: Kamerstukken en gelinkte stukken als achtergrond

**Status**: ✅ Gebouwd (2026-11-15), nog niet gecommit. Eigenaar (2026-11-15): "doe 1 en 2"; 1 = gelinkte stukken
in de Tijdlijn en de links in de analyse, 2 = actuele Kamerstukken (het open punt van Story 14.29)

### Meting (2026-11-15)
De zoektermen van de feitenanalyse van 26 nieuwsitems uit oktober zijn gezocht in de titels bij
officielebekendmakingen.nl (SRU van KOOP, `repository.overheid.nl/sru`, geen sleutel). Het gaat om de laatste drie
jaar, de nieuwste eerst. Eén beoordelaar (Claude), niet blind:
- **Raak bij 13 van de 26.** Voorbeelden:
  - draagmoederschap: amendement, motie en Kamervragen;
  - Postwet: de routekaart voor de postmarkt;
  - World Economic Forum: de motie en de Kamervragen van Van Houwelingen;
  - Huize Soria: de Kamervragen en antwoorden van die week;
  - warmtepompplicht: de motie om haar te schrappen, en de Kamervragen;
  - Risicoanalyse Nationale Veiligheid: de Kamerbrief;
  - Songfestival: de motie en de Kamervragen.
- **Geen treffer bij 10 termen**, onder andere Floradorp, Silja, Jackdaw en noodopvang Loosdrecht. Dat is lokaal of
  buitenlands nieuws, waar Bron of niets past.
- **Ruis kwam uit de Staatscourant**: vergunningskennisgevingen bij "Calandbrug" en archiefbesluiten bij
  "Archiefwet". De Staatscourant blijft daarom weg, net als uitstelberichten ("Uitstel beantwoording", subrubriek
  Mededeling) en beslisnota's.

### Wat er gebouwd is
- **Kamerstukken** (`search_ob` in `backend/app/services/background_sources.py`): per zoekterm één SRU-aanroep.
  - Gezocht wordt in Kamerstukken, Kamervragen (met en zonder antwoord), Handelingen, het Staatsblad en
    niet-dossierstukken.
  - Een stuk blijft alleen als de term in de titel staat, vergeleken op woorden ("Handhaving- en Toezichtlocatie").
  - Hoogstens 5 per nieuwsitem, elke titel één keer.
  - Het label leest zoals een lezer het noemt: Motie, Amendement, Kamerbrief, Kamervragen, Antwoord op Kamervragen,
    Kamerdebat.
- **Gelinkte stukken** (`linked_documents`): de links in de artikeltekst (Story 14.30) naar een lijst van
  overheidsinstanties (`PUBLIC_SITES`).
  - Een officielebekendmakingen.nl-nummer wordt in de SRU opgezocht.
  - Een documentnummer van de Tweede Kamer (`?did=2026D57700`) wordt opgezocht in de open data van de Kamer.
  - Elke andere pagina geeft zelf titel en datum: `DCTERMS.issued`/`available`, Open Graph of een datum in de URL;
    nooit `modified`.
  - Hoogstens 6 per nieuwsitem; wat meer bronnen linken eerst.
  - Een pagina die niet te lezen is, of die doorverwijst naar de voorpagina, valt weg.
  - Een gelinkt stuk komt niet nog eens terug als zoektreffer.
- **Opnieuw zoeken**: een nieuwsitem wordt opnieuw gezocht als de zoektermen of de links veranderen
  (`event_document_searches.links`, migratie 023, alleen lokaal). Wat vóór deze story gezocht was, wordt één keer
  opnieuw gezocht, voor de Kamerstukken.
- **Tijdlijn**: "Motie · Tweede Kamer", "Europese Commissie" (gelinkte pagina), en onder het stuk "Gelinkt door
  De Dagelijkse Standaard" (`linkedBy` in `chronology`). De site vraagt hoogstens 16 stukken op.
- **Analyse**: elk artikel geeft in de prompt de pagina's waar zijn tekst naar linkt: hoogstens 5, die van
  overheidsinstanties eerst (`PROMPT_LINKS_PER_ARTICLE`). Er staat een korte uitleg bij (`LINK_NOTE`): een bewering
  die op een gelinkt stuk rust, is niet "zonder bron", maar het stuk zelf is niet gelezen. De prompt in de database is
  niet veranderd en er komt geen AI-aanroep bij.
- **Hersteld**: de site haalde `source_metadata.links` wel op, maar `getExploration` gaf ze niet door. De links
  onder "Alle bronnen en artikelen" (Story 14.30) bleven daardoor leeg.
- **Proef (2026-11-15)**:
  - WEF-nieuws (11348): de motie en Kamervragen van Van Houwelingen in de Tijdlijn; Bron vond niets.
  - De Dagelijkse Standaard (11574): drie gelinkte pagina's van de Europese Commissie, met "Gelinkt door". De twee
    EUR-Lex-links gaven geen titel en vielen weg.
- Tests: `backend/tests/unit/test_background_sources.py`, `test_prompt_builder.py`, `test_parser.py`,
  `frontend/__tests__/explore/figure.test.ts`, `links.test.ts`.

### Open
- Pagina's die hun inhoud met JavaScript laden (de persberichten van de Europese Commissie, uitspraken op
  rechtspraak.nl) geven geen datum. Ze staan dan niet in de Tijdlijn.
- De lijst van overheidsinstanties (`PUBLIC_SITES`) is met de hand gemaakt. Gemeenten staan er niet in.

## Stories 14.32–14.37: Sporen rond het nieuws (OSINT, vervolg)

**Status**: ✅ Gebouwd (2026-11-16), nog niet gecommit; de backend moet opnieuw starten voor de job en de koppen.
Eigenaar (2026-11-16): "bouw alles", na het advies over OSINT-technieken (koppen volgen, Kamervragen, citaten uit
persberichten, gelijktijdige publicatie, opdrachtgever van onderzoek); daarna (eigenaar: "ok") de geldregisters voor
"Wie betaalt" (Story 14.37).

### Meting (2026-11-16, lokale database, alleen gelezen)
- **Koppen**: van 376 artikelen die hooguit zes uur eerder waren opgehaald, had 5 % (18) in de feed al een andere
  kop. Van 16 bekeken: 3 spelling, 4 liveblogs, 9 een nieuwe kop boven hetzelfde artikel. Eén zondagavond, niet blind.
- **Kamervragen**: 31 % van 273 sets (3 oktober–14 november) noemt een bericht in de titel; over 2–21 oktober
  linkten 12 sets naar precies een artikel in de app.
- **Persberichten**: 59 berichten van de Rijksoverheid naast 5.694 artikelen. 13 kwamen woordelijk terug in 21
  artikelen; lopende tekst overnemen is zeldzaam (1 artikel, 47 %), een citaat van 8+ woorden uit het persbericht
  staat in 16 van de 21.
- **Tegelijk**: bij 7 van 221 nieuwsitems met drie of meer titels verschenen minstens drie binnen twee minuten.
- **Opdrachtgever**: 26 van 7.602 artikelen noemen in één zin wie het onderzoek bestelde.

### Wat er gebouwd is
Geen AI-aanroep in een van de vijf; elke regel zegt wat er staat, nooit waarom.
- **14.32 Koppen die veranderen**: elke poll vergelijkt de kop in de feed met die van artikelen die er al zijn
  (`record_title_changes` in `article_repo.py`, `backend/app/ingestion/headlines.py`). Een nieuwe kop wordt de titel
  en de oude gaat naar `source_metadata.title_history`; een kleine verbetering (spelling) wordt alleen de titel; een
  liveblog houdt zijn eerste kop. De Tijdlijn toont "NOS verandert de kop" met oud en nieuw, "Alle bronnen en
  artikelen" de eerdere kop. Geen extra verkeer: de feed wordt al elk kwartier gelezen.
- **14.33 Kamervragen en stemmingen** (job Official Sources, `parliament_citations.py`): nieuwe Kamervragen op
  officielebekendmakingen.nl (met en zonder antwoord) worden één keer gelezen (`parliament_questions_read`, lokaal,
  migratie 025); hun links worden vergeleken met de artikelen, ook later nog (`/admin/trigger/kamervragen-rematch`).
  Een treffer wordt een rij in `event_documents` (bron `kamervragen`, `details.cites`, `details.askers`): de
  Tijdlijn toont "Vragen van Ergin (DENK)" en "Over het bericht van NU.nl", het artikel "Kamervragen over dit
  artikel". Bij een motie of amendement in de Tijdlijn haalt de job de stemming uit de open data van de Kamer
  (`details.vote`: uitslag, fracties voor en tegen met zetels).
- **14.34 Citaat uit het persbericht** (`press_releases.py`): nieuwe nieuwsberichten van de Rijksoverheid (sitemap,
  CC0; `press_releases`, lokaal) worden woord voor woord vergeleken met de artikelen van de vier dagen eromheen, met
  de methode van Zelfde tekst. Een citaat van 8+ woorden dat letterlijk in het persbericht staat, of lopende tekst
  eruit, wordt `event_documents` (bron `persbericht`, `details.quoted_by`). De Tijdlijn toont "Letterlijk geciteerd
  door …", het artikel "Een citaat staat letterlijk in het persbericht". De analyse krijgt het per artikel te zien
  (`PRESS_NOTE` in `prompt_builder.py`): zo'n citaat telt niet als eigen gesprek. Het signaal "persberichten" in het
  propagandamodel en "Kopieergedrag" in de vergelijking rusten nu op deze meting en Zelfde tekst, niet op de schatting
  van de AI (`copy_paste_score`).
- **14.35 Tegelijk verschenen** (alleen website, `chronology.ts`): drie of meer bronnen die het nieuws binnen twee
  minuten brengen staan in de Tijdlijn als "4 bronnen verschijnen binnen 2 minuten: …".
- **14.36 Onderzoek in opdracht van** (`backend/app/nlp/sponsored_research.py`): zinnen met "in opdracht van" en
  een woord voor onderzoek; de opdrachtgever (en het bureau, als de zin het noemt) gaat naar
  `source_metadata.sponsored`, met de zin erbij. "Deze site" is de bron zelf. Nieuwe artikelen krijgen het bij het
  opslaan; `/admin/trigger/sponsored-research?days=60` doet de oude. "Alle bronnen en artikelen" toont het per artikel.
- **Opslag**: `event_documents.details` (migratie 024, beide databases, gepubliceerd); de achtergrondjob gooit de
  rijen van Official Sources niet weg bij opnieuw zoeken.
- **Proef (2026-11-16, laatste 45 dagen)**: 13 nieuwsitems met Kamervragen, 14 met een geciteerd persbericht, 1
  motie met stemuitslag; 25 artikelen met een opdrachtgever (na een correctie: "de toenmalige staatssecretaris"
  werd "de toenmalige", "een onbekende" telde mee).
- Tests: `test_headlines.py`, `test_article_repo_headlines.py`, `test_parliament_citations.py`,
  `test_press_releases.py`, `test_sponsored_research.py`, `test_background_documents.py`,
  `test_prompt_builder.py`; frontend `official.test.ts`, `model.test.ts`, `figure.test.ts`.

- **14.37 Wie betaalt uit de registers**: bij een geciteerde autoriteit toonde "Wie betaalt" wat de AI uit zijn
  geheugen wist, zonder bron.
  - **In het propagandamodel**: het register `subsidies` (`tools/registers/subsidies.py` en
    `subsidies_naar_model.py`, README daar) leest "Financiële instrumenten 2017–2024" van Rijksfinanciën. Dat bestand
    is weer te downloaden; het oude adres gaf in oktober 404. Het neemt per ontvanger het bedrag per jaar, alleen het
    instrument "Subsidies (regelingen)". Het plant ministerie → ontvanger (`financiering`, `overheidssubsidie_denktank` of
    `overheidssubsidie_ngo`), met de bedragen in `functie`.
  - **Wat telt**: alleen denktanks en maatschappelijke organisaties die al in het model staan. Gekoppeld wordt op de
    naam zonder rechtsvorm; noemt het bestand onder die naam meer KvK-nummers, dan is het een naamgenoot (Buitenhof,
    Radar) en blijft hij weg.
  - **Wat niet telt**: koepels van medeoverheden (VNG), alleen coronasteun, en samen minder dan € 25.000.
  - **Registercheck**: hij leidt elke recordregel opnieuw af uit de bewaarde csv; de uurronde keurt goed langs het
    structuurpad. Stap 17 van `scripts/test_registers.py`.
  - **Ingediend (2026-11-16)**: 56 verbanden met 67 argumenten; de registercheck vond ze allemaal kloppend. Voorbeelden:
    BZ → Cordaid (€ 413 mln), Oxfam Novib, Hivos, Free Press Unlimited, Atlantische Commissie; IenW/EZ → Deltares;
    VWS → Rathenau Instituut; BZK → Open State Foundation; OCW → VO-raad; SZW → AWVN, FNV, CNV. Het KvK-nummer van de
    KNAW staat ook bij het Rathenau Instituut en het NIOD; daarom is een record KvK-nummer plus naam.
  - **Nieuws-app**: "Wie betaalt" zoekt de autoriteit op in het propagandamodel en toont de financiers, met bedragen
    per jaar (`lib/explore/funding.ts`, `AuthorityFunding` in `FindingDetail.tsx`). Alleen zonder treffer staat het
    antwoord van de analyse er nog. Test: `frontend/__tests__/explore/funding.test.ts`. De verbanden komen op de site
    zodra de uurronde ze goedkeurt en de backend (Propagandamodel Sync) draait.

### Open
- Persberichten van gemeenten, de EU en bedrijven niet (Story 14.39 leest 17 afzenders).
- Geldregisters die nog niet gemeten zijn: ANBI-verantwoordingen en overheidsopdrachten (TenderNed).
- "Onafhankelijk?" en "Eerdere adviezen" komen nog uit de analyse.
- Niet gemeten: of citaten uit Kamerdebatten terug te vinden zijn in het debatverslag.
- De koppen zijn één avond gemeten; na een week draaien kijken hoeveel er echt veranderen.

## Story 14.38: Kaart — waar speelt het nieuws?

**Status**: ✅ Gebouwd (2026-11-16), nog niet gecommit; de backend moet opnieuw starten voor de haak en de
beheer-endpoints. Idee van de eigenaar (2026-11-16): "Wereldbol of kaart pagina met waar
nieuws vandaan komt zou cool zijn. Apart kaart voor binnenlands nieuws en buitenlands nieuws?"

Een pagina `/kaart` met twee beelden: Nederland (platte kaart, bollen per plaats) en Wereld (draaibare wereldbol,
landen getint). Een plek betekent: de kop of het begin van de Nederlandse artikelen noemt haar. Geen AI, geen
kaartdienst van buiten (eigen tekening met d3-geo). Alleen nieuws met een artikel van een hoofdbron, zoals de
voorpagina.

### Meting vooraf (2026-11-16, lokale database, alleen gelezen)
Proef: GPE/LOC-namen in de eerste 400 tekens van elk Nederlands artikel, opgezocht in GeoNames (NL-plaatsen,
steden vanaf 100.000 inwoners) en de landenlijst van de app; een plek telt als minstens de helft van de artikelen
van het nieuwsitem haar zo noemt.
- 4.294 nieuwsitems in 45 dagen: 691 (16 %) krijgen een Nederlandse plaats, 1.225 (29 %) een land of stad in het
  buitenland, 85 beide, 2.463 (57 %) geen plek.
- 60 items met de hand bekeken: ongeveer 85 % plausibel (niet blind, één beoordelaar).
- Foutsoorten: naamgenoten (Newcastle → Australië, Sint Maarten → dorp in Noord-Holland, Californië → gehucht in
  Limburg, Porto → Bordeaux via namen in andere talen), sportclubs als stad (Liverpool), verhalen met veel
  plaatsen, Engelse namen (The Hague), landen die de landenlijst mist (Verenigd Koninkrijk, Saudi-Arabië),
  regio's en wijken niet herkend (Texas, Sicilië, Floradorp), "Tel Aviv" in tweeën.
- De tekst begint niet bij elke bron met de kop (De Telegraaf en GeenStijl nooit): de kop wordt apart gelezen.

### Meting van de regel (blind, 2026-11-16)
Twee beoordelaars (agents) per steekproef, zonder de regel te kennen: speelt het nieuws op deze plek ("hier"),
wordt ze alleen genoemd, of is het de verkeerde plek? Een plek telt als half goed als één van de twee "hier" zegt.

| Steekproef | Nederland | Buitenland | Opmerking |
| --- | --- | --- | --- |
| 1 (eerste regel) | 77 % | 64 % | daarna bijgesteld op deze steekproef (92 % / 91 %) |
| 2 (nieuw, 217 plekken) | 88,6 % | 81,2 % | poort niet gehaald; fouten: landen als speler ("afhankelijk van de VS"), Den Haag als politiek, "Het Roer Om", "Brits", "The New York Times" |
| 3 (nieuw, 210 plekken, regel na steekproef 2) | **92,5 %** (87–97,5) | **88,0 %** (82–94) | eens in 203 van 210 oordelen; 0 % fout in Nederland, 2,9 % buitenland |
| 3 na twee naamgenoten (Newcastle, Virginia) | 92,5 % | 89,9 % | niet meer blind: bijgesteld op deze steekproef |

- De poort van 90 % is voor Nederland gehaald, voor het buitenland net niet blind (88 %, na bijstellen 89,9 %).
  Wat overblijft is vooral "genoemd": een herkomst, een bestemming, een land als vergelijking. Echt fout is
  ongeveer 1 op 35 buitenlandse plekken.
- Bijstellingen na steekproef 2: een land, een hoofdstad of Den Haag telt alleen met een voorzetsel van plaats
  ("in Rusland", niet "Rusland valt aan"); een naam in de kop die gevolgd wordt door een woord met een hoofdletter
  is een langere naam ("New York Times"); roer en brits zijn nooit een plek. Na steekproef 3: Newcastle kan ook
  Newcastle upon Tyne zijn (de landen van het nieuwsitem beslissen); een staat wint van een kleinere stad met
  dezelfde naam elders (Virginia).
- Dekking (45 dagen, 3.210 nieuwsitems met een analysetitel): 8 % krijgt een Nederlandse plek, 12 % een plek in
  het buitenland, 81 % geen. Liever geen stip dan een foute.
- Gevuld op 2026-11-16: 648 rijen voor 621 nieuwsitems, lokaal en in Supabase gelijk.

### Taken
- [x] Plaatsenlijst uit GeoNames (`scripts/build_gazetteer.py` → `backend/app/data/gazetteer/places.json`, 14.827
      plekken), alleen Nederlandse namen en een paar afkortingen, plus een kleine lijst met de hand (`extra.yaml`:
      nooit, alleen met voorzetsel, aliassen, ook-namen, eigen plekken)
- [x] Regel per nieuwsitem (`backend/app/services/event_places.py`), 30 tests (`test_event_places.py`)
- [x] Blinde meting (`scripts/measure_event_places.py`), zie hierboven
- [x] Tabel `event_places` (migratie 026 op beide databases, RLS, alleen lezen voor anon, gepubliceerd), berekend in
      de exploration refresh na de entiteiten; beheer: `/admin/trigger/event-places?days=45&dry_run=true` en
      `/admin/trigger/event-places/{event_id}`
- [x] Pagina `/kaart` (`frontend/components/kaart/`, `frontend/lib/kaart/data.ts` + jest): Nederland (provincies
      van CBS, bollen per plaats) en Wereld (wereldbol van Natural Earth, landen getint, kleine landen een stip),
      periode, categorie (zonder sport), nieuws per plek, keuze in de URL, link "Kaart" in de kop
- [x] Schermafbeeldingen 1440 en 390 px (geen horizontaal scrollen, geen fouten in de console), `CLAUDE.md`

### Open
- Filter per bron ("wat brengt NOS waar?"): `outlets` staat al in de tabel.
- Kaartje op de eventpagina en de voorpagina.
- Wijken, gebouwen en natuurgebieden (Floradorp, Vondelpark, Noordzee); plaatsregels uit de dateline.
- Meer dekking: meten of de hele tekst (niet alleen het begin) meer plekken geeft zonder fouten.

## Story 14.39: Persberichten van meer afzenders

**Status**: ✅ Gebouwd (2026-11-16), nog niet gecommit. Vraag van de eigenaar (2026-11-16): meten welke persberichten
van andere organisaties letterlijk worden overgenomen ("kijk naar meerdere mogelijkheden… andere velden"), daarna
een lezer voor de sites die met een sitemap te lezen zijn, "met" de politie.

### Meting (2026-11-16)
Persberichten van 6 tot 18 oktober tegen 8.118 Nederlandse artikelen (15 september tot 21 oktober), dezelfde
vergelijking als Story 14.34 (citaat van 8+ woorden of doorlopende tekst), standaardzinnen per afzender eruit,
controle met een venster tien dagen eerder.

- 733 persberichten van 44 van de 71 geprobeerde organisaties; 38 (5 %) komen letterlijk terug in 53 artikelen.
  Controle: 1. Van de 79 berichten waar de media over schreven (tf-idf ≥ 0,30) zijn er 38 overgenomen.
- Per afzender: Rijksoverheid 25 % (11 van 44), Koninklijk Huis 22 %, OM 15 % (3 van 20), Defensie 12 %, ProRail
  10 %, Politie 7 % (8 van 112), Rechtspraak 4 %, CBS 4 %. Het ANP-persportaal 2 % (2 van 106, commerciële pr);
  bedrijven, universiteiten, partijen en ngo's bijna nooit.
- Alle treffers met de hand nagekeken: echt, op één na (Ajax "Outlet Sale": tekst uit de zijbalk).
- Niet te lezen zonder eigen lezer: DNB, gemeenten, KNVB en andere sites die gewone verzoeken weigeren.

### Gebouwd
- `backend/app/services/release_sites.py`: 17 afzenders (`SITES`), drie soorten:
  - **platform** (het systeem van rijksoverheid.nl: genummerde sitemaps, nieuwste eerst, de dag in het adres,
    `DCTERMS.issued` op de pagina): Rijksoverheid, OM, Koninklijk Huis, NVWA, Algemene Rekenkamer, NCTV, IGJ. Alleen
    bij de Rijksoverheid noemt `DCTERMS.creator` de afzender (het ministerie); bij OM en Koninklijk Huis staat daar
    het ministerie erboven, dus die houden hun eigen naam.
  - **sitemap** (één sitemap of een nieuws-sitemap, `lastmod` of `news:publication_date`): Defensie, ProRail,
    Rechtspraak, CBS, Raad van State, Nationale ombudsman, Tweede Kamer, Rijkswaterstaat, Ajax. Grote sitemaps één
    keer per uur. Tijd: `DCTERMS.issued`, `article:published_time`, `datePublished`, de datum die trafilatura leest,
    het adres, `lastmod`. Een datum zonder tijd wordt middernacht UTC; de Tijdlijn toont dan geen klok.
  - **politie**: politie.nl weigert gewone HTTP-verzoeken (Akamai, ook robots.txt). De open-data-API
    (`api.politie.nl/v4/nieuws`, per dag, 25 per pagina) antwoordt wel aan de Playwright-browser, met de eigen
    user agent van die browser: de vaste Chrome 120 van de pool krijgt 403 (`get_context(own_user_agent=True)`).
    De API geeft de hele tekst; elke 30 minuten. Uit te zetten met `PRESS_RELEASES_POLITIE_ENABLED=false`.
- `press_releases.py`: leest per afzender (een afzender die faalt houdt de rest niet tegen, cijfers per afzender),
  hoogstens 40 nieuwe per afzender per ronde; een pagina zonder tekst wordt niet opnieuw opgehaald.
- **Standaardzinnen**: woordreeksen die in minstens 3 en 3 % van de laatste 200 berichten van een afzender staan
  (zoals de tiplijn van de politie) tellen niet als overgenomen tekst. Een citaat telt wel.
- **Stille afzender**: een afzender zonder nieuw bericht na `quiet_days` (politie 1 dag, NCTV 30) komt in het log
  (`press_release_sites_quiet`) en in het antwoord van `/admin/trigger/official-sources`: een lezer die stopt
  omdat een site haar pagina's veranderde, zegt anders niets.
- De analyse (`PRESS_NOTE`) spreekt van "een persbericht (van een ministerie, het OM, de politie of een andere
  afzender)". De app hoefde niet te veranderen: de Tijdlijn toont "Persbericht · {afzender}".
- Geen migratie: `press_releases.publisher` is de sleutel van de afzender, `organisation` de naam.
- Tests: `backend/tests/unit/test_release_sites.py` (afzenders, sitemaps, tijden, titels, politie-API,
  standaardzinnen, stille afzenders).
- Eerste ronde (2026-11-16, 21 dagen terug): 406 berichten gelezen, geen fouten; met wat er al was 646 berichten
  van 17 afzenders (politie 156, OM 44, Defensie 44, Koninklijk Huis 23, NVWA 28). Doordat de backend van 22 oktober
  tot 13 november uit stond, zijn alleen de laatste dagen te vergelijken: 7 berichten letterlijk terug in 10
  artikelen, waarvan 9 van de nieuwe afzenders, allemaal met de hand nagekeken en echt (NVWA over speelgoed bij AD
  en RTL Nieuws, de Rechtspraak over McDonald's bij de Volkskrant, de politie over de Kralingse Plas bij NU.nl en
  GeenStijl, de zin over de Cruyff Foundation uit het Ajax-bericht bij Het Parool en AD).
- Een oude pagina waarvan de `lastmod` veranderde (Ajax uit 2022) wordt met haar eigen datum bewaard: dan is ze
  bekend en wordt ze niet opnieuw opgehaald; vergelijken doet alleen recente berichten.

### Open
- Gemeenten, provincies, de EU en sites die alleen een browser toelaten (DNB, KNVB).
- Bedrijven en het ANP-persportaal: bijna nooit overgenomen, daarom niet gelezen.

