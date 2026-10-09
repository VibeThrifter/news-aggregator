# Epic 15: Besluitvorming in het netwerk

## Overzicht

Eigenaarsbesluit (2026-10-07), in het propagandamodel (`~/Workspace/propaganda-model`):
- "Propagandamodel uitbreiden met meer politieke lagen, hoge ambtenaren, ngo's en bedrijven etc. zodat alle
  besluitvorming ook in de kaart komt behalve alleen media gerelateerd."
- "Dit moet hetzelfde netwerk zijn als het propagandamodel … andere categorieën en categorieën kunnen ook
  overlappen … het is in de echte wereld deel van hetzelfde netwerk."

Het propagandamodel heeft daarom naast de vijf filters vijf categorieën voor besluitvorming (naar Domhoff), in
hetzelfde veld en met overlap. Controle blijft `tegenmacht`.

| Categorie | Label | Vraag |
|---|---|---|
| `formele_macht` | Formele macht | Wie mag hierover besluiten? |
| `belangen` | Belangen | Wie heeft er belang bij, en hoe komt het binnen? |
| `kennis_advies` | Kennis & advies | Wie levert de kennis en het advies? |
| `polder` | Polder | Wie zit er aan tafel? |
| `werving` | Werving | Wie komt waar terecht, en via wie? |

Nieuwe relatietypes: `ambt` (persoon → overheidsorganisatie), `zeggenschap` (organisatie → organisatie),
`controle` en `geschenk`. Nieuwe velden: `bestuurslaag` (eu/rijk/provincie/gemeente/waterschap/caribisch/regio) bij
organisaties en `functie` (de ambtstitel zoals het register hem geeft) bij verbanden. De registers zitten erin:
ministeries met hun directoraten-generaal, zbo's, adviescolleges, gemeenten, provincies, waterschappen, hun
ambtsdragers, de 150 Kamerleden met nevenfuncties, loopbaan en geschenken, de Nederlandse Europarlementariërs en
de lobbyisten met een vaste toegangspas.

Deze epic brengt dat naar de nieuws-app, zonder dat er iets grijs "overig" wordt.

### Volgorde (plan 2026-10-07)

1. **Vlag eerst (klaar 2026-10-07):** `PROPAGANDA_SYNC_BESTUUR` (standaard uit) houdt bestuursverbanden uit de
   `pm_*`-tabellen; de live app ziet wat hij al zag.
2. **Story 15.1 — basis:** sync format 8, migratie 016, de frontend kent de categorieën en relatietypes. Daarna gaat
   de vlag aan.
3. **Story 15.2 — tonen:** vragen per categorie en richting in het netwerk, het ambt bij "Wie is dit?", bestuursroutes
   in "Wie zit erachter?", en lokale bestuurders uit het nieuws koppelen aan hun registerknoop.

---

## Story 15.1: Basis — sync, migratie, frontend kent de categorieën

**Status**: ✅ Done (2026-10-08)

- Sync (`backend/app/services/propaganda_model_sync.py`), format 8:
  - de vijf categorieën in de filterlijsten; de primaire categorie rekent over alle categorieën;
  - de nieuwe relatietypes in de volgorde en de weergavenamen van de nieuwe rollen en mechanismen;
  - `bestuurslaag` en de Wikidata-id bij entiteiten, `functie` bij verbanden;
  - "automatisch goedgekeurd" herkent ook de automatische beoordeling van het propagandamodel.
- Migratie `016_besluitvorming.sql` (pas na akkoord van de eigenaar):
  - kolommen `pm_entities.bestuurslaag`, `pm_entities.wikidata`, `pm_relations.functie`;
  - de filterlijst in `pm_neighborhood`, de sterkte per relatietype in `pm_paths` (laag voor `ambt` en
    `zeggenschap`, tegen hub-ruis), de richting in `pm_influence_side`, de uitsluitingen in
    `request_relation_research` (registerfeiten hoeven geen extra bewijs).
- Frontend: `PmFilter`, de categorieën met vraag en kleur (`labels.ts`), relatielabels, en de spiegels van
  `pm_paths`/`pm_influence_side` in `pm-paths.ts`/`pm-graph.ts`.
- Opslag meten vóór en na (verwacht 10–20 MB op 265 MB).

Uitgevoerd:
- Migratie 016 staat live (2026-10-08): de drie `ALTER TABLE`s elk in een eigen transactie met `lock_timeout` 1 s, daarna
  de functies, rechten en de controle in één keer.
- De sync schrijft format 8. Met de vlag uit liet hij bestuursverbanden weg; entiteiten zonder enig goedgekeurd verband
  (registerknopen waarvan de verbanden nog wachten op het dagplafond van het propagandamodel) kwamen wel mee.
- Frontend: `PmFilter`, `FilterId` en `FILTERS` met `group` (`media` / `besluitvorming`); de categorieën staan standaard
  uit in het netwerk (zoals advertentie, flak en tegenmacht); relatielabels voor ambt, zeggenschap, controle en geschenk;
  `TYPE_PRIORITY` en `RELATION_STRENGTH` gelijk aan migratie 016. Signalen uit de analyse van één event blijven bij de
  zes mediafilters (`eventFilterSignals`); in "De filters in dit nieuws" verschijnt een besluitvormingscategorie alleen als
  het netwerk dat je bouwde er verbanden in heeft.
- "Automatisch toegevoegd" geldt nu ook voor wat de automatische beoordeling van het propagandamodel goedkeurt
  (account `merge-service`).
- Tests: `test_propaganda_model_sync.py` (o.a. het contract van migratie 016), `test_pm_auto_approval_sync.py`,
  `test_pm_demo_slice.py`; Jest `pm.test.ts`, `why.test.ts`, `model.test.ts`.

## Story 15.2: Tonen — vragen, ambten, routes

**Status**: ✅ Done (2026-10-08), één punt open

Klaar (2026-10-08):
- Een ambt leest met de functie uit het register: "is secretaris-generaal bij", "heeft als Kamerlid, fractievoorzitter"
  (`pmRelationLabel`/`pmRelationReverseLabel`/`relationWords` met `functie`, in het netwerk, de lijsten en de sheets).
- "Over het propagandamodel" heeft naast de vijf filters een blok "Besluitvorming" (naar Domhoff) met de vijf categorieën.
- De vragen in het netwerk gaan vanzelf per categorie en per richting: `filter_counts` en `direction_counts` van
  `pm_neighborhood` hebben de nieuwe categorieën (migratie 016).

- "Hoe hangen ze samen?" onder "Wie zit erachter?": routes van hoogstens twee stappen tussen de partijen uit
  hetzelfde nieuws die door de besluitvorming lopen (ambt, zeggenschap, controle, geschenk, lobbytoegang of een
  verband in een besluitvormingscategorie), per paar één, wat nu geldt vóór wat historisch is. Collega's via een hub
  ("beiden Kamerlid", "beiden in de VVD": twee keer hetzelfde verband en hetzelfde ambt via een knoop met 25 of meer
  verbanden) zeggen niets en blijven weg (`governanceRoutes` in `lib/explore/why.ts`, `useBetweenRoutes`).
- Lokale bestuurders uit het nieuws koppelen aan hun registerknoop ("B.C.M. Vostermans (burgemeester Peel en
  Maas)"): achternaam plus ambt plus eerste voorletter of plaats, nooit de naam alleen; een veelvoorkomende achternaam
  (drie of meer ambtsdragers) alleen met de plaats (`PmCoverageIndex.lookup_official`). De triage koppelt bij elke
  cyclus ook namen die eerder werden beoordeeld (`_link_register_officials`); met genoeg verbanden is onderzoek niet
  meer nodig. Het paneel van een naam en de actorpagina tonen dan het netwerk van die knoop (via
  `entity_research.pm_entity_id`, zonder migratie). Op echte data (2026-10-08): Melanie van der Horst, Elise Moeskops
  (wethouders Amsterdam) en Tanja Haseloop-Amsing (burgemeester Oldebroek) gekoppeld, geen foute koppeling.

Open:
- `pm_match` kent de koppeling via het onderzoek nog niet: in "Wie zit erachter?" en het netwerk van een event telt
  een lokale bestuurder pas mee als hij onder zijn naam in het model staat (een uitbreiding van `pm_match` vergt een
  migratie).
- Epic 12-triage: een lokale bestuurder in het nieuws koppelt aan zijn registerknoop via achternaam, eerste
  voorletter, rol (burgemeester, wethouder) en plaats.
- Alles in de stijl van Epic 14: serif kopjes in zinsnotatie, pills, geen uitleg-zinnen.
