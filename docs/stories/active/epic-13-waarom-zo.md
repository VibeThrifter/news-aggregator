# Epic 13: Waarom zo? — verbanden vinden zonder kluwen

## Overzicht

Het propagandanetwerk liet tot nu toe **alles rond één knoop** zien: "Breid uit" haalde alle verbanden van een partij
binnen, gesorteerd op "meeste verbanden". Daardoor kwamen juist de partijen die aan alles hangen (ANP, Rijksoverheid)
bovenaan. Je zag veel, maar leerde weinig ("je vindt zo geen zinnige verbanden, wel veel clutter").

Deze epic draait dat om: **teken het netwerk tússen dingen, niet rond één ding**, en laat het een *verschil
verklaren*.

```
Verschil  ──►  Waarom zo?  ──►  Patroon?
"RTL bracht het     routes door de filters,      "gebeurt dit vaker?"
 persoonlijk, NOS   alleen wat A heeft en B      zelfde vergelijking over
 als conflict"      niet; "geen route" mag       alle artikelen, met N
```

## Achtergrond — wat we gemeten hebben (2026-09-30, alleen-lezen)

| Bevinding | Gevolg voor het ontwerp |
|---|---|
| Binnen 2 stappen van de NOS zit 41% van het propagandamodel (494 van ~1.200 partijen) | "Er is een verband" zegt niets; zoek routes *tussen* twee dingen en straf knooppunten af |
| Over alles verschillen media sterk (human interest: RTL 53%, NOS 18%; conflict: NieuwRechts 72%, RTL 23%) | … |
| … maar op dezelfde 70 events verdwijnt dat (human interest 13 vs 11×, conflict 29 vs 27×) | Het grote verschil is **selectie** (wat je brengt), niet framing van hetzelfde verhaal; frames worden nu per event gelabeld, niet per artikel |
| 92% van de events heeft één bron; 638 personen/organisaties staan bij ≥ 3 media, partijen en de EC bij 10 | Vergelijk media per **entiteit**, niet per event |
| Het propagandamodel zelf: eigendom is in NL de *zwakste* route ("bezit ≠ begunstigde"); sterk zijn sourcing (ANP 50–75% van het politieke nieuws, officiële stemmen) en ideologie (*markering*: wie heet "radicaal") | "Waarom zo?" wijst niet eerst naar eigenaren; sourcing- en ideologieroutes tellen even zwaar mee |
| De AI-analyse vond 3.465 citaten van 2.491 verschillende autoriteiten | Een lijst van alle bronnen leert niets: maak er een **bronnenprofiel** van |
| `best_path` in het propagandamodel bestaat alleen als CLI en werkt niet (alle invloedsgewichten op de vloer van 0,05) | Eigen routezoeker, scoren op soort band, zekerheid en bronnen |

Bronnen: `onderzoek/3_mechanismes-van-beinvloeding/eigendom-naar-bias/`, `.../transnationaal-naar-bias/`,
`onderzoek/1_in-voordeel-van-welke-eliten/00e_gemeten-bias-bevindingen.md`, `MEMEONDERZOEK_FRAMEWORK.md` (in
`~/Workspace/propaganda-model`).

## Besluiten

| Besluit | Keuze |
|---|---|
| Richting | Akkoord gebruiker 2026-10-01 ("ok") op: Epic 13 uitschrijven, beginnen met routes, raakvlakken en bronnenprofiel |
| Netwerk | Geen "alles uitklappen" meer: vragen per filter (max 3 nieuwe knopen), "Zoek verband", "Verbind met beeld" |
| Start van het netwerk | Dit nieuws + bronnen + actoren + alleen wat ze verbindt (≤ 2 stappen) |
| Wat is zinnig | Specifiek (knooppunten tellen minder), sterk (eigendom/geld/bestuur boven citeren), onderbouwd, actueel, relevant |
| Getallen | Routes krijgen een volgorde, nooit een score in beeld (datalicentie: geen meting of ranglijst) |

## Randvoorwaarden

- **Datalicentie propagandamodel:** nooit het hele model in één keer; `pm_paths` geeft maximaal 60 routes per aanroep
  en alleen wat op die routes ligt. Altijd de bronvermelding "Propagandamodel — NL-mediamachtsgraaf, dataset vX.Y.Z".
- **Woordkeus:** "aanwijzing", "mogelijke route", "geen route gevonden" is een geldige uitkomst; eigendom ≠ begunstigde.
- **Mobiel:** knoppen ≥ 44 px, alles tikbaar, niets hover-only; uitbreiden blijft *groeien* (niets vervaagt), met
  ongedaan maken / opnieuw.
- **Demo:** alles werkt ook in `/event/demo` (lokale implementatie over `demo-pm.json`).

---

## Contract: `pm_paths` (migratie 007)

```
pm_paths(p_from integer[], p_to integer[], p_max_hops integer DEFAULT 3,
         p_limit integer DEFAULT 2, p_at text DEFAULT NULL) RETURNS json
```

- `p_from`: eerste 12 ids, `p_to`: eerste 40 ids; ontdubbeld, onbekende ids vallen weg.
- `p_max_hops` 1..3, `p_limit` (routes per paar van–naar) 1..5, `p_at` = peildatum `YYYY-MM-DD` (standaard vandaag).
- Een route is een enkelvoudig pad (richting doet er niet toe bij het zoeken, wel bij het lezen). Tussenstations liggen
  nooit in `p_from ∪ p_to`. Verbanden met `active_from` na de peildatum tellen niet mee; verbanden met `active_until`
  vóór de peildatum zijn *historisch*.
- Datums: `YYYY` → van 1 jan / tot 31 dec, `YYYY-MM` → van de 1e / tot de 31e, anders de eerste 10 tekens.
- **Waardering** (alleen voor de volgorde, nooit zichtbaar), in deze volgorde vermenigvuldigd (float8 / double):
  per verband `w = sterkte(soort) × zekerheid × (0,5 als historisch)`, per tussenstation `h = 1 / √(1 + graad)`;
  route = `w1 × w2 × w3 × h1 × h2`. Alleen vermenigvuldigen, delen en worteltrekken, zodat SQL en TypeScript
  bit-voor-bit gelijk rekenen. Per (van, naar): beste eerst, dan minder stappen, dan relatie-ids oplopend. Routes met
  dezelfde reeks knopen tellen één keer (de beste).
- `shared_with`: de andere `p_from`-ids met een route naar hetzelfde doel met **dezelfde tussenstations en soorten
  verband** (dus dezelfde uitleg). Zo zie je of een route iets onderscheidt of door iedereen gedeeld wordt.
- Hoogstens 60 routes (beste eerst, dan minder stappen, relatie-ids, van, naar); `truncated` als er meer waren.

| Sterkte | Soorten verband |
|---|---|
| 1,0 | eigendom |
| 0,9 | financiering |
| 0,8 | investering, adverteerder, donor, bestuurder |
| 0,7 | personeel, dienstverband, woordvoerder_van, draaideur, mediaplatform |
| 0,6 | adviseur, bron_van, flak, censuur, intimidatie, cooptatie, lobbyt |
| 0,5 | lidmaatschap, citeert, framing, etikettering, zelfcensuur, regulering, alliantie, oppositie |
| 0,4 | beinvloeding, algoritmische_filtering, al het andere |

Zekerheid: onderbouwd 1,0 · aannemelijk 0,85 · onzeker of leeg 0,7.

```json
{
  "routes": [{"from": 7, "to": 123, "rank": 1, "hops": 2, "nodes": [7, 1, 123],
              "relations": [101, 555], "historic": false, "shared_with": [3, 4]}],
  "entities": [{"id", "name", "type", "role", "primary_filter", "degree", "active_from", "active_until", "auto_approved"}],
  "relations": [{"id", "source_id", "target_id", "relation_type", "mechanism", "filter", "filters", "aard",
                 "certainty_label", "active_from", "active_until", "source_count", "bidirectional", "auto_approved"}],
  "truncated": false, "max_hops": 3, "at": "2026-10-01"
}
```

Dezelfde regels staan in TypeScript in `frontend/lib/explore/pm-paths.ts` (demo en tests); de SQL-functie is daar
tegen gevalideerd op het echte model.

---

## Story 13.1: Routezoeker `pm_paths`

**Status**: ✅ Done (2026-10-01) · **Prioriteit**: Must Have · **Complexiteit**: Large

### Subtaken
- [x] `lib/explore/pm-paths.ts`: puur, deterministisch, volgens het contract; `findPaths`, `relationStrength`,
      `hubFactor`, peildatum-regels, `shared_with`, `pickRoutes`, `routeSteps`
- [x] Demo: `pm-local.ts` → `paths(...)`; `lib/api.ts` → `pmPaths(from, to, {maxHops, limit, at, demo})`; types
- [x] Migratie `007_waarom_zo.sql`: `pm_paths` (SECURITY DEFINER, alleen `anon`/`authenticated` mogen uitvoeren,
      verificatieblok)
- [x] Jest-tests (kleine graaf met bekende uitkomsten; grenzen, historisch, gedeelde routes, determinisme)
- [x] Validatie: SQL tegen TypeScript op het echte model (wegwerp-Postgres), 0 verschillen

### Acceptatiecriteria
- [x] Zelfde uitkomst in SQL en TypeScript (volgorde, `shared_with`, `truncated`)
- [x] Route via een knooppunt dat aan alles hangt (ANP, Rijksoverheid) komt ná een specifieke route van gelijke lengte
- [x] Nooit meer dan 60 routes per aanroep

### Implementatiedetails
- Validatie (2026-10-01): lokale PostgreSQL 14, migraties 005 → 007, echte sync-snapshot (1.195 actoren, 2.091
  relaties), 195 queries als `anon` (buitenlands/ongeldig/dubbel/leeg, 1–3 stappen, 1–5 per paar, zes peildata):
  **4.404 routes, 0 verschillen** met `findPaths`; 55 aanroepen afgekapt op 60. Zwaarste aanroep (12 grootste
  knooppunten × 40 volgende) 34 ms. `anon` kan de `pm_*`-tabellen zelf niet lezen.
- Knooppunt-straf is `1/√(1+graad)` (niet log): wortels en delingen zijn in beide talen correct afgerond, dus
  bit-gelijke volgordes zonder afronden.
- Voorbeelden uit het echte model: *RTL Nieuws ← personeel – Kees Berghuis – woordvoerder van → VVD (historisch)*,
  *de Volkskrant ← beïnvloeding – Teldersstichting ← financiering – VVD*, *Het Parool ← eigendom – DPG Media ←
  adverteerder – Shell (geldt ook voor RTL Nieuws)*; de HCSS/Defensie-route delen vijf media (geen verklaring
  voor een verschil).

## Story 13.2: Netwerk — tussen, niet rond

**Status**: ✅ Done (2026-10-01) · **Prioriteit**: Must Have · **Complexiteit**: Large · **Depends on**: 13.1

### Beschrijving
- **Start**: Dit nieuws, de bronnen en de actoren, en alleen wat hen verbindt (routes van ≤ 2 stappen). Geen losse
  buren meer rond elke bron.
- **Vragen per knoop** in plaats van "Breid uit": *Wie bezit wat? · Wie betaalt? · Wie praat mee? · Wie valt aan? ·
  Welke kringen? · Wie spreekt tegen?* (met telling). Een vraag tekent de **3 meest specifieke** buren; de rest wordt
  de bestaande "+N"-bundel.
- **Verbind met beeld**: alleen routes (≤ 3 stappen) naar wat al in beeld staat; zegt het eerlijk als er geen is.
- **Zoek verband met…**: kies een partij; alleen de beste routes ertussen (ook vanuit de zoekbalk: een gezochte partij
  wordt verbonden met het beeld in plaats van uitgeklapt).
- Alles is één stap om ongedaan te maken.

### Acceptatiecriteria
- [x] Het startbeeld van een event bevat geen buren die niets met het nieuws verbinden
- [x] Een vraag voegt hoogstens 3 partijen toe plus één knoop (de laatste partij of een "+N"-bundel), plus partijen
      die al getekende knopen verbinden
- [x] Binnen een filter staan specifieke partijen vóór knooppunten (niet meer op aantal verbanden)
- [x] Routes en vragen werken in de demo; ongedaan maken / opnieuw werkt voor elke stap

### Implementatiedetails
- `pm-graph.ts`: `SHOWN_PER_FILTER = {expanded: 3, collapsed: 0}`, `specificityOf`/`bySpecificity` (vervangt
  "meeste verbanden"), `routeParts`, `pmScene({routeNodes, routeRelations})`; bundel pas vanaf 2 (een "+1" wordt
  gewoon getekend).
- `pm-store.ts`: `routeSets`, `activeRoutes`, `latestRoutes` (ongedaan maken / opnieuw); `usePmExplorer.ts`: start
  met `pm_paths(zaden, zaden, 2 stappen)` (beste 10, onderscheidend eerst), `ask`, `connect`, `connectTo`,
  `addAndConnect`; focus uit de URL = routes naar dit nieuws.
- `NetworkView.tsx`: tooltip met "Verbind met beeld", "Zoek verband met…" (`PartySearch`), "Meer weten" en de
  vragen (`FILTERS[].ask`, `filterAsk`); zoekbalk verbindt in plaats van uit te klappen.
- Demo (Dijkerhoven): start 15 knopen (7 bronnen, 1 actor, 6 verbinders + dit nieuws); NOS ↔ DPG Media: 3 routes via
  adverteerders (Unilever, Shell, Albert Heijn).
- Tests: Jest (`pm.test.ts`, `pm-paths.test.ts`), Playwright `netwerk-bord.spec.ts` groen op desktop, Pixel 7,
  iPhone 13.

## Story 13.3: Actorpagina — zelfde aanpak

**Status**: ✅ Done (2026-10-01) · **Prioriteit**: Must Have · **Complexiteit**: Medium · **Depends on**: 13.2

- [x] Niet meer tot 60 buren op aantal verbanden: per filter de 3 meest specifieke, de rest als telling
- [x] Vragen, "Zoek verband met…" en **routes naar wie samen met deze persoon in het nieuws staat**

### Implementatiedetails
- `actor-graph.ts` (`actorScene(merged, center, asked, {routeNodes, routeRelations})`), `useActorExplorer.ts`
  (`ask`, `connectTo`, `connectNews`, `countsOf`, `totalOf`), `ActorNetwork.tsx` (vragen, `PartySearch`, sectie
  "Hoe hangt X samen met wie samen in het nieuws staat?" met `RouteList`, lijst op specificiteit met telling per
  filter uit het model). Epic 12-labels ("automatisch toegevoegd") blijven in lijst, tooltips en routes.
- Demo NOS: 15 knopen i.p.v. tot 60. `wie-is-dit.spec.ts` groen op alle drie de apparaten.

## Story 13.4: Waarom zo? — raakvlakken en verschil-routes in het event

**Status**: 🟡 Grotendeels klaar (2026-10-01) · **Prioriteit**: Must Have · **Complexiteit**: Large · **Depends on**: 13.1

- [x] Raakvlak: een bron is binnen 2 stappen verbonden met een partij uit het nieuws → overzicht "Raakvlakken met dit
      nieuws" in het filterpaneel van het netwerk (i.p.v. een aanwijzingskaart: aanwijzingen zijn synchroon, routes
      niet) en "Waarom zo?" in de bronballon
- [x] "Waarom zo?" in de bronballon: max 3 routekaarten (elke stap één zin, tik = bronnen), eigen uitleg ("alleen
      NU.nl in dit nieuws") vóór gedeelde; "Geen route gevonden" als uitkomst; "Toon in netwerk" (`?focus=pm:<id>`)
- [ ] Hetzelfde in de Bronvergelijker (A vs B)
- [x] Ook bronnen die het nieuws *niet* brachten maar wel een raakvlak hebben ("bracht dit nieuws niet")
- [x] Tekst "bezit is geen bewijs van invloed" bij eigendomsroutes

### Implementatiedetails
- `lib/explore/pm-seeds.ts` (bronnen/actoren van het nieuws in het model; gedeeld met de netwerkstart),
  `lib/explore/why.ts` (`whyRoutesFor`, `touchpoints`), `outlet/useWhyRoutes.ts` (één `pm_paths`-aanroep per
  nieuws: alle gevolgde NL-bronnen → partijen, ≤ 2 stappen, 2 per paar), `outlet/WhyRoutes.tsx` (in `OutletCard`,
  na "Wat schreef …?"), `network/RouteList.tsx` (`note`), `FiltersSheet` (`Touchpoints`).
- De demo laat "geen route" zien: van de partijen in het verzonnen verhaal staat alleen Anouk Verbeek (met
  verzonnen verbanden) in het model. Bewust geen verzonnen verbanden met echte bedrijven.
- Tests: `why.test.ts`; Playwright `waarom-zo.spec.ts` (bronballon, raakvlakken, "Toon in netwerk"); volledige
  explore-suite 83 groen op desktop, Pixel 7 en iPhone 13.

## Story 13.5: Bronnenprofiel

**Status**: 🔲 To Do · **Prioriteit**: Should Have · **Complexiteit**: Medium

- [ ] Backend: per medium de geciteerde autoriteiten (`authority_analysis` met `article_url`) ingedeeld in families
      (overheid & instanties, politie & justitie, politiek, bedrijfsleven, wetenschap & experts, maatschappelijke
      organisaties, media, buitenland, burgers), met top-3 namen en het gemiddelde van alle media; tabel + RPC
- [ ] Frontend: profielbalk in de bronballon en in de netwerkbundel "Wie praat mee?"

## Story 13.6: Wie schrijft hoe over X?

**Status**: 🔲 To Do · **Prioriteit**: Should Have · **Complexiteit**: Medium

- [ ] RPC per entiteit: per medium aantal artikelen, eigen frames en toon; en **wie zwijgt** (verwacht aandeel naar
      totale productie in dezelfde periode vs. werkelijk)
- [ ] Uitbreiding van "Per medium" in EntitySheet, actorpagina en netwerktooltip met hoe (frame/toon) en raakvlak
      (route medium → X)

## Story 13.7: Patroon?

**Status**: 🔲 Later · **Prioriteit**: Could Have

- [ ] "Gebeurt dit vaker?": dezelfde vergelijking (frame, toon, selectie) over alle artikelen per entiteit of per soort
      raakvlak, met N en "te weinig om iets te zeggen"

## Story 13.8: Beter meten (besluit gebruiker nodig)

**Status**: 🔲 Later · **Prioriteit**: Could Have

- [ ] Frames per artikel i.p.v. per event (extra Mistral-kosten), of *markering* per persoon (woordkeus) via de
      bias-per-zin-pijplijn (staat uit: 0 analyses in Supabase)
- [ ] Eventueel meme-overdracht zoals in `MEMEONDERZOEK_FRAMEWORK.md` (wie zei het eerst, wie nam het over)

## Story 13.9: Documentatie en handmatige stappen

**Status**: 🔲 To Do

- [ ] `CLAUDE.md`, `docs/architecture.md`, `database/README.md`
- [x] Gebruiker: migratie `007_waarom_zo.sql` in Supabase draaien (na 004 → 005 → 006) — gedraaid 2026-10-01,
      verificatieblok geslaagd; als `anon` geeft Marjolein Moorman (505) → NOS (11) 2 routes van 3 stappen
      (via Tweede Kamer → CIDI en via Tweede Kamer → Radboud Universiteit); `pm_*`-tabellen blijven dicht voor `anon`
- [ ] Gebruiker: migratie `008_invloed_richting.sql` in Supabase draaien (na 007). Tot die tijd toont het netwerk de
      vragen zonder richting (zoals voorheen); de demo heeft de richting al

## Story 13.10: Kiezen wat blijft, alle namen, invloed per richting

**Status**: ✅ Done (2026-10-03, wacht op migratie 008 in Supabase) · **Prioriteit**: Must Have · **Depends on**: 13.2

Wensen van de gebruiker (2026-10-03):
- "Maak de nieuwe dingen doorzichtig en dan klik je de gene aan die blijven en de nodes weg die weer weg mogen,
  anders worden het teveel nodes soms."
- "Die bol met +n erin gaat niet meer weg."
- "Voeg sowieso ook alle entiteiten in het evenement die ontdekt zijn toe aan het netwerk."
- "Wie heeft invloed op DPG Media en op wie heeft DPG Media invloed."

### Acceptatiecriteria
- [x] Wat een stap toevoegt is doorzichtig: een vraag, "Verbind met beeld", "Zoek verband met…" of de zoekbalk.
      Het gaat om partijen en de "+N"-bundel. Een partij die je zelf kiest (zoekbalk, uit een bundel) is meteen vast.
- [x] Aantikken = houden (en openen). Wat je niet aantikt gaat weg bij de volgende stap, met "Rest weg"/"Alles weg"
      of met "Houd alle".
- [x] Houd je niets van een vraag, dan wordt de vraag ingetrokken: het beeld is zoals ervoor en je kunt hem opnieuw
      stellen.
- [x] Opnieuw vragen brengt het weggehaalde antwoord terug, als voorstel.
- [x] Weggehaalde partijen rekenen mee in de bundel en schuiven geen volgende partij naar voren.
- [x] "Weghalen" in de tooltip werkt voor partijen die niet van het nieuws zelf zijn en voor bundels.
- [x] Alles is één stap om ongedaan te maken. Weghalen beweegt het beeld niet.
- [x] Het netwerk krijgt alle partijen van het nieuws, zonder maximum van 12:
  - bronnen, personen, organisaties en groepen uit het model (exacte alias);
  - wat "Wie is dit?" vond (`pm_entity_id`);
  - personen en organisaties die er (nog) niet in staan, als grijze gestippelde knoop aan "Dit nieuws" met "Meer
    weten". Niet de namen die het onderzoek privé of te vaag vond.
- [x] Per knoop een tabel met per filter twee vragen: *Invloed op X* en *Invloed van X* (aantallen naast elkaar).
  - Een vraag in één richting heeft eigen antwoorden en een eigen bundel.
  - De lijn naar die bundel wijst van wie invloed heeft naar wie die ondergaat.

### Implementatiedetails
- **Richting:** `influenceOf` in `pm-graph.ts`. Meestal heeft de bron invloed op het doel.
  - Omgekeerd: `personeel`, `dienstverband`, `woordvoerder_van`, `lidmaatschap` en `citeert`.
  - Beide kanten: `alliantie`, `oppositie`, `draaideur` en `bidirectional`.
  - Dezelfde regels staan als `pm_influence_side` in migratie `008_invloed_richting.sql`.
- **Migratie 008:** `pm_neighborhood(p_entity_id, p_limit, p_filters, p_direction)` met `direction_counts`.
  - Validatie in een wegwerp-Postgres op de demoslice: 6000 aanroepen, 0 verschillen met `pm-local.ts`.
  - Zonder 008 geeft `pmNeighborhood` dezelfde antwoorden (ophalen + filteren in de app) en toont de tooltip de oude
    vragen.
- **Voorstellen:** `pm-store.ts` houdt de lopende stap bij (`pending`: basis, gehouden, beeld ervoor) en
  `dismissed`/`dismissedBundles`.
  - `pmScene` geeft per knoop de redenen (`reasonKey`). Een weggehaalde knoop komt pas terug als er een nieuwe reden
    is (een nieuwe route, een andere vraag).
  - `proposalsOf` bepaalt wat doorzichtig is.
- **Namen:** `pm-seeds.ts` (`researchKeys`, `researchedIds`, `newsOnlyEntities`). Startroutes worden in batches van
  12 opgevraagd (`pm_paths` neemt 12 startpunten).
- **Tests:** Jest `pm.test.ts`. Playwright `netwerk-bord.spec.ts` (voorstellen, alle namen, invloed per richting)
  is groen op desktop, Pixel 7 en iPhone 13.

---

## Risico's

| Risico | Mitigatie |
|---|---|
| Een route leest als beschuldiging | Woordkeus "mogelijke route", bronnen per stap, "bezit ≠ begunstigde", geen scores |
| Routes via knooppunten verklaren niets | Knooppunt-straf, `shared_with` (gedeeld door iedereen = geen verklaring) |
| Model mist actuele feiten (bijv. DPG → NU.nl staat nog als *voorgesteld*) | Eerlijke "geen route gevonden"; voorstellen goedkeuren in `/overleg` |
| SQL en TypeScript lopen uiteen | Eén contract, validatie op het echte model, tests met vaste uitkomsten |

## Definition of Done (Epic)
- [ ] Stories 13.1–13.6 en 13.9 afgerond; Jest, pytest, lint en typecheck groen; Playwright op mobiel groen
- [ ] Demo op Vercel laat routes, vragen en raakvlakken zien
