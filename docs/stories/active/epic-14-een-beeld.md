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
