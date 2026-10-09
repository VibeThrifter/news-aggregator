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
- `lib/explore/figure.ts`: groepen per bron (≤ 2 NL-bronnen) of per invalshoek (≥ 3), Buitenland (via de
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
  latere afleveringen, "Waarom nu?", dezelfde mensen in ander nieuws. Relaties met alleen thema/categorie/land vallen
  weg; ijkpunt is het eerste NL-artikel (oude buitenlandse artikelen maakten de eventstart soms maanden te vroeg).
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
  - `/event/demo-verbeek`: ander nieuws met de wethouder ("Dezelfde mensen in ander nieuws").
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
  - job "Voice Search", elke minuut, maximaal 2 zoektochten (`VOICE_SEARCH_*`), via
    `backend/app/services/voice_search.py`;
  - stappen: plan (LLM) → eigen database (A) + hetzelfde nieuws op Google News (D) → teksten (betaalmuur telt als
    geen tekst, ANP-kopieën één keer) → controle (LLM). Niets gevonden bij een concrete groep of context? Dan de twee
    zoekopdrachten (B);
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

### Later
- Elk gevonden artikel tegen álle ontbrekende stemmen van het item controleren: één artikel beantwoordt soms een
  andere stem.
- Tekst achter cookiemuren ophalen met de toestemming van de feedlezers (DPG, Telegraaf, NU.nl).
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
| Klopt het? | Tegenspraak | waarover · wie zegt het één · wie het andere · wat zeggen ze · bron | gestippelde ⚡-lijn tussen de twee ballonnen |
| Klopt het? | Fout | wat is er fout · waar · wat klopt wel · bron | ✕ naast het nummer dat hij verbetert |
| Wie praat? | Bron | link · wat brengt deze bron · kop · wie komt er aan het woord | een eigen ballon |

- **Fout**: "Klopt niet" bij elke bevinding van de analyse opent het formulier met die bevinding erboven (`about`).
  De ✕ komt op dezelfde ballon als die bevinding. Die rij krijgt het label "fout volgens jou" en toont wat je
  schreef.
- **Tegenspraak**: alleen als er twee kanten te kiezen zijn. Een spreker zonder eigen ballon (bij groepen per
  invalshoek, of een buitenlandse bron) telt als zijn bron. Staat er maar één kant in het beeld, dan komt het
  nummer op die kant.
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
- De backend is om 22:31 herstart (hij draait zonder auto-reload). De andere 29 komen via de backfill, vanaf de ronde
  van 22:46, in porties binnen de time-out van 10 minuten per ronde.

### Open
- De oude eventpagina (`EventDetailScreen` met `CriticalAnalysis` en dergelijke) heeft nog de oude stijl. Vercel
  toont hem niet (`NEXT_PUBLIC_EXPLORE_UI=1`); opruimen hoort bij Story 11.15.

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
  - Een Blik op de NOS levert sinds 24 december 2025 niets. De X-API weigert de sleutel (403, "keys and tokens from
    a developer App that is attached to a Project"). Herstel vraagt een X-ontwikkelaarsaccount van de eigenaar.
- **Gevonden door een andere sessie**: hetzelfde verhaal staat vaak los in twee nieuwsitems, bijvoorbeeld 8079 "Messi
  eert Maradona" (NU.nl) en 7973 "Messi neemt afscheid" (2 bronnen). Van de 120 items op pagina 1 hebben er maar 7
  twee of meer Nederlandse bronnen. Dat ligt aan de clustering en is nog open.

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

## Story 14.23: Wat ertoe doet — Wie zit erachter? en Hoe hangen ze samen?

**Status**: 🔄 In uitvoering (2026-10-09). Nieuws-app gebouwd en getest; nog niet gecommit. Wacht op een OK voor
migratie 017. Het deel in het propagandamodel (stemtoets, specificiteit, opruimen) is in een git-worktree in de maak.

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
