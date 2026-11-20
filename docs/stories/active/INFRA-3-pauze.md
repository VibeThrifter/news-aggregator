# INFRA-3: Pauze — de backend zoekt niets nieuws

## Overzicht

Eigenaarsvraag (2026-11-19): "In de instellingen voor admin moet het mogelijk zijn de backend uit te zetten op een
manier dat de website het wel doet maar dat hij geen nieuwe dingen meer moet zoeken om AI tokens te besparen."

De backend kan niet echt uit: hij publiceert naar Supabase en de schakelaar zelf loopt via de backend. Daarom een
pauze: het proces blijft draaien, maar haalt geen nieuws op en start geen AI-werk.

## Wat de pauze doet

| Stopt | Gaat door |
|---|---|
| RSS Feed Polling (met de catch-up: soort nieuws, koppelen) | Publish to Supabase |
| Insight Backfill (analyses) | Voice Search (Zoek met AI, op verzoek) |
| International Enrichment | Bias Requests (gekleurde zinnen, op verzoek) |
| Bias Analysis | Event Maintenance + Exploration Refresh (geen AI) |
| Article Digest | Local Database Backup, LLM Usage |
| Background Documents, Official Sources | Copy Detection (geen AI) |
| | Entity Research, Evidence Research, Propagandamodel Sync |
| | de admin-triggers (`/admin/trigger/...`) |

- Een job die al loopt, maakt zijn ronde af.
- Alles rond het propagandamodel loopt door (eigenaar 2026-11-19: "de wachtrij moet worden afgewerkt"): Entity
  Research en Evidence Research vullen de wachtrij aan uit het nieuws dat er is (vanzelf: nieuws van de laatste
  7 dagen) en halen de uitkomsten op; de pm-agents `nieuws-scout` (Sonnet) en `nieuws-bewijs` houden hun rondes,
  met hun eigen remmen (abonnement, dagmaximum). Dat kost dus wel tokens van het abonnement.
- De stand staat in `data/scheduler_state.json` (`paused_since`): een herstart blijft op pauze.
- Bij hervatten worden de feeds meteen gelezen; alleen nieuws van de laatste 24 uur komt binnen (de bestaande regel),
  wat tijdens een langere pauze verscheen komt niet meer.

## Acceptatiecriteria

- [x] Beheer heeft bovenaan de kaart "Nieuws ophalen" met een schakelaar en de stand ("Aan" / "Op pauze sinds …").
- [x] `GET /admin/pause` en `POST /admin/pause {"paused": true|false}`; de stand staat ook in
      `/admin/scheduler/status` (`pause`).
- [x] Op pauze hebben de jobs van `PAUSED_JOB_IDS` geen volgende run; de rest loopt door.
- [x] Een herstart blijft op pauze; hervatten plant de jobs weer in en leest de feeds meteen.
- [x] Het onderzoek voor het propagandamodel (wachtrij, pm-rondes, sync) loopt op pauze door.

## Bestanden

- `backend/app/core/scheduler.py` (`PAUSED_JOB_IDS`, `set_paused`, `pause_state`), `backend/app/routers/admin.py`
- `frontend/components/admin/PauseSwitch.tsx`, `frontend/lib/api.ts`, `frontend/app/admin/page.tsx`
- `backend/tests/unit/test_scheduler_pause.py`
