# Epic 12: Wie is dit? — klikbare namen, netwerk en onderzoek

## Overzicht

Elke naam in de nieuws-app (politicus, journalist, woordvoerder, bestuurder, expert, instelling, bedrijf) is aan te
tikken en leidt naar het netwerk erachter in het propagandamodel. Ontbreekt een naam in het propagandamodel, of heeft
hij minder dan drie verbanden, dan zoekt de propagandamodel-agent `nieuws-scout` hem uit (registers, nieuws,
LinkedIn) en komt het resultaat via een gecontroleerde automatische goedkeuring in de praktijklaag terecht.

**Best of both worlds**: de nieuws-app bepaalt *wie* onderzocht wordt (rol, belang, dekking) en toont het resultaat;
het onderzoek zelf doet de bestaande agent-infrastructuur van het propagandamodel (`scripts/agent_runner.py`,
LinkedIn-tool, REST-indienpad).

```
nieuws-app (Vercel)            nieuws-backend (lokaal)                     propagandamodel (lokaal :5000)
naam → EntitySheet ──RPC──►    entity_research ── enqueue ──────────────► POST /api/nieuws/doelen  (nieuws-agent)
/actor/[slug]                  ronde starten (subprocess) ──────────────► agent_runner.py → nieuws-scout
                               autokeur (subprocess) ────────────────────► nieuws_autokeur_service.py (nieuws-autokeur)
                               status terughalen ◄─────────────────────── GET /api/nieuws/doelen
                               pm-sync (bestaand) ◄────────────────────── propaganda_model.db (alleen-lezen)
```

### Besluiten (2026-09-30)

| Besluit | Keuze |
|---|---|
| Wie onderzoeken | Politici, journalisten, woordvoerders, bestuurders ("hoge piefen") eerst; dan organisaties en experts; privépersonen nooit |
| Hoe | Bestaande propagandamodel-agents + LinkedIn-scraper (niet opnieuw bouwen) |
| LinkedIn | Automatisch, max 2/uur en 10/dag, 08–22 uur, willekeurige pauzes, 24 uur stop bij captcha/inlogmuur, zichtbaar venster |
| Goedkeuren | Automatisch, via machine-account `nieuws-autokeur`, alleen neutrale structuurfeiten met bron-URL, terug te draaien |
| Demo | Ook in `/event/demo` en `/actor/...?demo=1` |

### Randvoorwaarden

- Alleen namen die in het eigen nieuws voorkomen worden onderzocht (geen willekeurige namen via de app).
- Privépersonen (bewoners, ooggetuigen, slachtoffers, verdachten, "Henk (61)") worden nooit onderzocht.
- Automatisch goedgekeurd: alleen `personeel`, `dienstverband`, `bestuurder`, `adviseur`, `woordvoerder_van`,
  `lidmaatschap`, `eigendom` met mechanisme en een bron met URL. Framing, beïnvloeding, flak en sourcing blijven
  mensenwerk. Argumenten worden niet automatisch gemerged (scores blijven op de vloer tot een mens merget).
- In de app zichtbaar als "automatisch toegevoegd"; bronnen van nog niet gemergede argumenten als "nog niet
  gecontroleerd".
- Verbruik: elke nieuws-scout-ronde is een Opus-sessie (~10 min); standaard max 4 rondes per dag.

---

## Contracten

### Accounts (propagandamodel)

| Account | Rol | Doel |
|---|---|---|
| `nieuws-agent` | bijdrager (agent) | Nieuws-backend: doelen in de wachtrij zetten |
| `nieuws-scout` | bijdrager (agent) | Missie-agent: onderzoek + indienen |
| `nieuws-autokeur` | reviewer (agent) | Automatisch goedkeuren (eigenaarsbesluit 2026-09-30) |

Tokens in `~/Workspace/propaganda-model/data/tokens/<account>.token`.

### Propagandamodel REST — wachtrij `nieuws_doelen`

Doel-object:

```json
{"id": 1, "sleutel": "person:anouk-verbeek", "naam": "Anouk Verbeek", "soort": "persoon",
 "rol_categorie": "politicus", "rol_hint": "wethouder Dijkerhoven",
 "context": {"events": [{"titel": "...", "url": "..."}],
             "artikelen": [{"url": "...", "bron": "NOS", "datum": "2026-09-28", "titel": "..."}],
             "organisaties": ["NordVind"], "rolzinnen": ["Wethouder Anouk Verbeek zegt ..."]},
 "prioriteit": 95.0, "entity_id": null, "status": "open", "vervolg": null,
 "verslag": null, "resultaat": null, "aangevraagd_door": "nieuws-agent",
 "geclaimd_door": null, "geclaimd_op": null, "pogingen": 0,
 "aangemaakt": "2026-09-30T12:00:00", "bijgewerkt": "2026-09-30T12:00:00"}
```

- `soort` ∈ `persoon | organisatie`
- `status` ∈ `open | bezig | klaar | niets_gevonden | overgeslagen | twijfel | fout`
- `vervolg` ∈ `null | linkedin`
- `resultaat` = `{"entity_ids": [], "relation_ids": [], "source_ids": [], "argument_ids": []}`

| Endpoint | Wie | Gedrag |
|---|---|---|
| `POST /api/nieuws/doelen` | `nieuws-agent`, maintainer | Upsert op `sleutel`. Nieuw → 201 `{doel}`. Bestaat en `open`/`bezig` → 200 `{doel, bijgewerkt: true}` (prioriteit = max, context/rol bijgewerkt). Afgerond → 409 `{error, doel}`, tenzij `"opnieuw": true` → heropend (`open`), 200 |
| `GET /api/nieuws/doelen?status=a,b&limit=50&bijgewerkt_na=ISO&sleutel=` | elk account | `{doelen: [...]}`, prioriteit aflopend |
| `GET /api/nieuws/doelen/<id>` | elk account | `{doel}` |
| `POST /api/nieuws/doelen/claim_volgende?limit=3` | `nieuws-scout`, maintainer | Claimt atomair de hoogste open doelen (ook `bezig` ouder dan 3 uur) → `{doelen: [...]}` |
| `POST /api/nieuws/doelen/<id>/claim` | `nieuws-scout`, maintainer | `open` → `bezig`, anders 409 |
| `PATCH /api/nieuws/doelen/<id>` | `nieuws-scout`, maintainer | `{status?, verslag?, resultaat?, entity_id?, vervolg?}` → 200 `{doel}` |

### Propagandamodel — automatisch goedkeuren

- `POST /api/nieuws/autokeur/<tabel>/<id>` (`tabel` ∈ `entities | relations`; reviewer) → 200
  `{goedgekeurd: true}` of 409 `{goedgekeurd: false, redenen: [...]}`. 503 bij `PROPAGANDA_NIEUWS_AUTOKEUR=0`,
  429 boven het dagplafond (standaard 60).
- `POST /api/nieuws/autokeur/intrekken` `{tabel, id, motivatie}` (maintainer) → terug naar `voorgesteld`.
- edit_log bij goedkeuring: `changed_by='nieuws-autokeur'`, `new_value={"status": "goedgekeurd"}`,
  `reason` begint met `auto-keur nieuws-pijplijn`.
- `python3 scripts/nieuws_autokeur_service.py --once --json` print
  `{"goedgekeurd": {"entities": [ids], "relations": [ids]}, "geparkeerd": [{"tabel", "id", "redenen"}], "doelen": [ids]}`.

### Propagandamodel — runner en LinkedIn

- `python3 scripts/agent_runner.py --agent nieuws-scout --label nieuws-scout --brief missies/nieuws_scout_brief.md
  --skip-permissions --model opus --effort high --alleen-bij-open-doelen`: exit 0 zonder claude als er geen open
  doelen zijn of als er al een ronde loopt (lock `data/locks/nieuws-scout.lock`).
- `python3 tools/linkedin/snelheidsrem.py status --json` →
  `{"automatisch": true, "actief_nu": true, "geblokkeerd_tot": null, "reden": null,
    "profiel": {"uur": 0, "dag": 0, "max_uur": 2, "max_dag": 10}, "zoek": {...}, "volgende_kans": "ISO|null"}`.
- `scrape_profile.py`: exit 75 = snelheidsrem, 76 = blokkade (captcha/checkpoint).

### Supabase (migratie 006 + aanpassingen 004/005)

Tabel `entity_research` (geen anon-toegang; alleen via RPC):
`entity_key` (pk, `person:slug` | `org:slug` | `actor:slug`), `name`, `kind` (`person|org|unknown`),
`role_category`, `role_label`, `is_foreign`, `priority`, `prominence` (jsonb), `pm_entity_id`, `pm_degree`,
`pm_doel_id`, `status`, `status_reason`, `summary`, `found` (jsonb), `request_event_slug`, `requested_count`,
`last_requested_at`, `queued_at`, `researched_at`, `created_at`, `updated_at`.

- `status` ∈ `nieuw | niet_nodig | overgeslagen | wachtrij | bezig | klaar | niets_gevonden | twijfel | fout`
- `role_category` ∈ `politicus | journalist | woordvoerder | bestuurder | organisatie | expert | overig | prive | onbekend`
- `found` = `{"entities": n, "relations": n, "auto_approved": n, "pending": n}`

RPC's (json):

| Functie | Resultaat |
|---|---|
| `request_entity_research(p_key text, p_name text, p_kind text, p_event_slug text DEFAULT NULL)` | `{ok, status, reason?}`; max 60 aanvragen per uur totaal, 10 min afkoeltijd per sleutel |
| `entity_research_status(p_keys text[])` | `[{entity_key, name, kind, status, status_reason, role_category, role_label, pm_entity_id, pm_degree, found, queued_at, researched_at, updated_at}]` (max 50 sleutels) |
| `entity_cooccurrence(p_aliases text[], p_limit int DEFAULT 20)` | `[{entity_key, name, kind, shared_events, last_event_slug, last_event_title, last_seen}]` (alleen person/org, zonder de entiteit zelf) |
| `pm_match` (005, aangepast) | `[{alias, entity_id, name, type, degree}]` |
| `pm_neighborhood` / `pm_details` (005, aangepast) | entiteiten en relaties met `auto_approved`; bronnen met `unreviewed` |

---

## Story 12.1: Propagandamodel — wachtrij `nieuws_doelen` en accounts

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Medium

- [x] `scripts/migrate_add_nieuws_doelen.py` (backup → migreren, via de SQLite-backup-API) + `schema.sql`; gedraaid op de echte DB
- [x] Endpoints volgens het contract (atomaire `claim_volgende`, verouderde claims > 3 uur tellen als open)
- [x] Accounts `nieuws-agent`, `nieuws-scout` (bijdrager) en `nieuws-autokeur` (reviewer) met tokens
- [x] `scripts/test_nieuws_doelen.py`

Extra: de wachtrij weigert `rol_categorie: "prive"` (400); wachtrij-endpoints vallen buiten de schrijflimiet (procesmetadata).

## Story 12.2: Propagandamodel — LinkedIn automatisch met snelheidsrem

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Medium

- [x] `tools/linkedin/snelheidsrem.py` (2/uur, 10/dag per soort, 08–22, stroomonderbreker 24 uur → max 7 dagen;
      env-overrides kunnen alleen strenger; `uit`/`aan`/`status`/`mag`/`reset-blokkade`)
- [x] `scrape_profile.py`: rem vóór/na elk profiel en elke zoekopdracht (exit 75), blokkadedetectie (exit 76), subcommando `zoek`
- [x] `extract.py`: willekeurige pauzes + blokkadedetectie
- [x] Beleid J4 bijgewerkt (pm-`CLAUDE.md`, LinkedIn-README, `scout_brief`, `linkedin_scout_brief`, `missies/README.md`)
- [x] `tools/linkedin/test_snelheidsrem.py`

## Story 12.3: Propagandamodel — missie `nieuws-scout`

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Medium

- [x] `missies/nieuws_scout_brief.md`
- [x] `agent_schedule.py`: `nieuws-scout` (runner, `--alleen-bij-open-doelen --max-rondes-per-dag 4 --actieve-uren 8-22`)
      en `nieuws-autokeur` (script, elke 30 min)
- [x] `agent_runner.py`: lock per label, `--alleen-bij-open-doelen`, `--max-rondes-per-dag`, `--actieve-uren`,
      `linkedin_rem`/`linkedin_blokkade` in het run-record; `scout_indienen.py --resultaat-json`

## Story 12.4: Propagandamodel — automatisch goedkeuren

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Large

- [x] `_modereer_kern` (refactor, gedrag ongewijzigd en getest)
- [x] `nieuws_autokeur_toegestaan` + endpoints + kill-switch + dagplafond + intrekken (+ alleen-lezen predikaatcheck en log)
- [x] `scripts/nieuws_autokeur_service.py` + `data/nieuws_autokeur_log.jsonl`
- [x] `scripts/admin.py`: `autokeur-log`, `intrekken`
- [x] `scripts/test_nieuws_autokeur.py`; bestaande gates groen

Extra poorten: alleen gewone bewijsargumenten, een tegenargument parkeert de relatie, wat een maintainer introk wordt nooit
opnieuw automatisch goedgekeurd, een relatie pas na goedkeuring van beide entiteiten; intrekken van een entiteit trekt de
automatisch goedgekeurde relaties mee in.

## Story 12.5: Nieuws-app — database en sync

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Medium

- [x] `006_entity_research.sql` (tabel + 3 RPC's; zet `event_entities.aliases` om naar `TEXT[]` als `create_all()` het
      als `VARCHAR[]` maakte; server-defaults voor tabellen van `create_all()`)
- [x] 005: `auto_approved` (entiteiten, relaties), `unreviewed` (bronnen), `pm_match.degree`, vlaggen in `pm_neighborhood`/`pm_details`
      (004 had `article_ids` al)
- [x] Sync: `auto_approved` uit het edit_log, bronnen van niet-gemergede argumenten van `nieuws-scout` bij automatisch
      goedgekeurde elementen (`SNAPSHOT_FORMAT` 4)

Geverifieerd tegen een lokale PostgreSQL 14: 004 → 005 → 006 twee keer achter elkaar na `create_all()`, alle RPC's als `anon`
(limieten, afkoeltijd, validatie, geen directe tabeltoegang).

## Story 12.6: Nieuws-backend — triage (rol en belang)

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Large

- [x] `services/entity_research/roles.py` (titel vóór de naam, titel in de NER-span, bijstelling, partij tussen haakjes,
      NOS-byline, leeftijd = privé, buitenlandse demonymen, LLM-autoriteiten), `priority.py`, `pm_coverage.py`
- [x] Pytest met Nederlandse voorbeeldzinnen

## Story 12.7: Nieuws-backend — orkestratie

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Large

- [x] `pm_client.py`, `runner.py`, `service.py`, `repositories/entity_research_repo.py`, model `EntityResearch`, config
- [x] Scheduler-job "Entity research" (15 min) + admin-endpoints (`/admin/trigger/entity-research[/{key}]`, `/admin/entity-research/status`)
- [x] Pytest ≥ 80% op de nieuwe modules (93–100%)

Details: artikeltekst alleen voor personen (eerste 6000 tekens, via de read-session/SQLite-cache), incrementeel via een
watermerk op `event_entities.computed_at` (egress); onderzoeksstatus rechtstreeks uit de pm-SQLite (alleen-lezen);
schrijven alleen via de REST-API. Een aangetikte naam zonder publieke rol krijgt `overgeslagen` ("Geen publieke rol
gevonden…"); de admin kan zo'n naam toch laten uitzoeken (de agent controleert de rol), privé/buitenland blijft geblokkeerd.

Bijgesteld na een proef op echte data (2026-09-30): "president"/"kanselier" zonder bijvoeglijk naamwoord telt als
buitenlands ("Trump"), personen met alleen een voor- of achternaam worden overgeslagen ("Milan", "Beune"), en de
missie-brief slaat BN'ers zonder rol in het netwerk over (artiesten, sporters, verdachten, Koninklijk Huis).
`PM_API_BASE_URL` is `http://127.0.0.1:5000`: op macOS hangt httpx op `localhost:5000` (IPv6, AirPlay-ontvanger).

## Story 12.8: Frontend — klikbare namen overal

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Medium

- [x] `lib/explore/entity-linker.ts`, `EntityText`/`EntityLinks` + provider in `ExploreShell`
- [x] Toegepast in teaser, aanwijzingskaarten, bias-deck (spreker + uitleg), tijdlijn, "Zelfde persoon"-chips; achternaam
      alleen als die uniek is in het event, eerste vermelding per blok

## Story 12.9: Frontend — netwerk & onderzoek in de EntitySheet

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Medium

- [x] `PmSection` → "Netwerk & onderzoek" (mini-netwerk bij ≥ 3 verbanden, anders automatische aanvraag + status, pollt per minuut)
- [x] `MiniEgoNetwork` (SVG, deterministisch, lijst ernaast)

## Story 12.10: Frontend — `/actor/[slug]`

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Large

- [x] Route + pm-egonetwerk (uitklappen, filterlegenda, relatielijst), samen in het nieuws, ook in het nieuws, Wikipedia,
      onderzoeksstatus, labels "automatisch toegevoegd" / "nog niet gecontroleerd"
- [x] Labels ook in de tooltips en "Meer weten" van het event-netwerk (`NetworkView`/`PmDetailsSheet`), plus een link
      "Profiel van …" naar `/actor/pm-<id>`

Afwijking: geen `scopeId`/`PmEnv`-refactor (bestanden waren in gebruik door de Epic 11-sessie). De actor-pagina heeft een
eigen verkenner (`useActorExplorer.ts`, `lib/explore/actor-graph.ts`, `ActorPanels.tsx`) en hergebruikt `NetworkCanvas`
en de pure helpers; het event-netwerk is ongewijzigd. Bundel: `/actor/[slug]` 7,3 kB (222 kB First Load).

## Story 12.11: Demo en E2E

**Status**: ✅ Done (2026-09-30) · **Prioriteit**: Must Have · **Complexiteit**: Medium

- [x] `fixtures/demo-research.ts`: Anouk Verbeek klaar (3 verbanden, 2 automatisch), NordVind bezig, Stichting Stille Polder
      wachtrij, Nationale Adviesraad Windenergie niets gevonden, fictieve omwonende Henk de Boer (61) overgeslagen
- [x] Jest (168 tests groen) + Playwright `tests/explore/wie-is-dit.spec.ts` groen op desktop, Pixel 7 en iPhone 13

## Story 12.12: Documentatie en handmatige stappen

**Status**: 🟡 Documentatie klaar, handmatige stappen open · **Prioriteit**: Must Have · **Complexiteit**: Small

- [x] `CLAUDE.md`, `docs/architecture.md`, `database/README.md`, `.env.example`, propagandamodel-`CLAUDE.md`
- [x] Migraties 004 → 005 → 006 in Supabase gedraaid (2026-09-30); pm-sync (1.195 actoren, 2.091 relaties) en
      exploration-backfill (32.615 entiteitrijen, 62.482 relaties) gedaan
- [x] Propagandamodel-server als LaunchAgent `nl.propaganda.server` (KeepAlive); alleen de jobs
      `nl.propaganda.agent-nieuws-scout` (elke 2 uur, alleen bij open doelen) en `nl.propaganda.agent-nieuws-autokeur`
      (elke 30 min) geladen — de overige pm-agents bewust niet
- [x] LinkedIn-sessie gecontroleerd: geldig (geen nieuwe login nodig)
- [x] Vercel: `NEXT_PUBLIC_ENABLE_DEMO=true` en `NEXT_PUBLIC_EXPLORE_UI=1` op Production + Preview (werkt bij de
      volgende deploy van code die deze vlaggen kent)
- [ ] Nieuws-backend draaien (`make backend-dev`): pas dan komt er nieuw nieuws binnen en start de triage vanzelf

### Verificatie (2026-09-30)
- End-to-end tegen een kopie van de pm-database: doel inplannen (201/200, privé → 400) → claimen → bron, entiteit,
  relatie en argument indienen als `nieuws-scout` → doel `klaar` → `nieuws_autokeur_service.py` keurt entiteit en
  relatie goed → status "klaar · 1 automatisch toegevoegd · LinkedIn volgt" → sync met `auto_approved` en een
  `unreviewed` bron → intrekken werkt.
- Backend: 132 nieuwe tests groen; volledige suite 562 groen (4 bestaande, omgevingsafhankelijke fouten in
  `test_google_news`/`test_prompt_builder`, niet gerelateerd).
- Propagandamodel: nieuwe testscripts + `validate_model.py --strict`, `test_scoring`, `test_auth_smoke`,
  `test_fresh_build`, `test_auto_merge`, `test_fase2` groen.

## Risico's

| Risico | Mitigatie |
|---|---|
| Verkeerde persoon (naamgenoot) | Agent zet `twijfel`; autokeur alleen voor doelen met status `klaar`; intrekken mogelijk |
| LinkedIn-blokkade | Snelheidsrem + stroomonderbreker + zichtbaar venster onder eigen sessie |
| Juridisch (art. 43, smaad) | Alleen neutrale structuurfeiten automatisch; bronnen zichtbaar; label "automatisch toegevoegd" |
| Verbruik | Max 4 rondes/dag, alleen bij open doelen, 08–22 uur |
