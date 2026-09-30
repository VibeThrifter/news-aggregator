/**
 * Demo data for Epic 12 "Wie is dit?" (behind NEXT_PUBLIC_ENABLE_DEMO), used by /event/demo and
 * /actor/...?demo=1.
 *
 * FICTIONAL, like the demo event: the research statuses, Anouk Verbeek's relations and the
 * organisations she is linked to do not exist. They show what the news pipeline adds to the
 * propaganda model (auto-approved, one source not yet reviewed). The real propaganda-model slice
 * (demo-pm.json) is never changed: these entities only connect to each other.
 *
 * Research is simulated client-side: a request returns the fixture status (or "wachtrij" for a new
 * name), and status lookups read the same in-memory table.
 */

import type { EntityCooccurrence, EntityResearch, EntityResearchKind, EntityResearchRequest } from "@/lib/types";

import type { PmSlice } from "../pm-local";

import { DEMO_EVENTS } from "./demo-event";

const QUEUED = "2026-09-30T06:00:00Z";
const DONE = "2026-09-30T08:40:00Z";

export const DEMO_RESEARCH: EntityResearch[] = [
  {
    entity_key: "person:anouk-verbeek",
    name: "Anouk Verbeek",
    kind: "person",
    status: "klaar",
    status_reason: null,
    role_category: "politicus",
    role_label: "wethouder Dijkerhoven",
    pm_entity_id: 900001,
    pm_degree: 2,
    found: { entities: 3, relations: 3, auto_approved: 2, pending: 1 },
    queued_at: QUEUED,
    researched_at: DONE,
    updated_at: DONE,
  },
  {
    entity_key: "org:nordvind",
    name: "NordVind",
    kind: "org",
    status: "bezig",
    status_reason: null,
    role_category: "organisatie",
    role_label: "windparkontwikkelaar",
    pm_entity_id: null,
    pm_degree: null,
    found: null,
    queued_at: QUEUED,
    researched_at: null,
    updated_at: "2026-09-30T09:10:00Z",
  },
  {
    entity_key: "org:stichting-stille-polder",
    name: "Stichting Stille Polder",
    kind: "org",
    status: "wachtrij",
    status_reason: null,
    role_category: "organisatie",
    role_label: "stichting van omwonenden",
    pm_entity_id: null,
    pm_degree: null,
    found: null,
    queued_at: "2026-09-30T09:00:00Z",
    researched_at: null,
    updated_at: "2026-09-30T09:00:00Z",
  },
  {
    entity_key: "org:nationale-adviesraad-windenergie",
    name: "Nationale Adviesraad Windenergie",
    kind: "org",
    status: "niets_gevonden",
    status_reason: null,
    role_category: "organisatie",
    role_label: "adviesorgaan",
    pm_entity_id: null,
    pm_degree: null,
    found: { entities: 0, relations: 0, auto_approved: 0, pending: 0 },
    queued_at: QUEUED,
    researched_at: "2026-09-30T07:55:00Z",
    updated_at: "2026-09-30T07:55:00Z",
  },
  {
    entity_key: "person:henk-de-boer",
    name: "Henk de Boer",
    kind: "person",
    status: "overgeslagen",
    status_reason: "prive",
    role_category: "prive",
    role_label: "omwonende",
    pm_entity_id: null,
    pm_degree: null,
    found: null,
    queued_at: null,
    researched_at: null,
    updated_at: "2026-09-30T06:00:00Z",
  },
];

/** What the demo research "added" to the propaganda model: Anouk Verbeek with two auto-approved relations. */
export const DEMO_PM_ADDITIONS: Partial<Omit<PmSlice, "meta">> = {
  entities: [
    {
      id: 900001,
      name: "Anouk Verbeek",
      slug: "anouk-verbeek",
      type: "persoon",
      role: "wethouder Dijkerhoven",
      primary_filter: "sourcing",
      degree: 2,
      auto_approved: true,
      description: "Verzonnen demo-persoon: wethouder van Dijkerhoven. Automatisch toegevoegd door de nieuws-pijplijn.",
      active_from: null,
      active_until: null,
    },
    {
      id: 900002,
      name: "Gemeente Dijkerhoven",
      slug: "gemeente-dijkerhoven",
      type: "overheid",
      role: null,
      primary_filter: "sourcing",
      degree: 1,
      auto_approved: true,
      description: "Verzonnen demo-gemeente.",
      active_from: null,
      active_until: null,
    },
    {
      id: 900003,
      name: "Dijkerhoven Vooruit",
      slug: "dijkerhoven-vooruit",
      type: "politieke partij",
      role: null,
      primary_filter: "ideologie",
      degree: 1,
      auto_approved: true,
      description: "Verzonnen lokale demo-partij.",
      active_from: null,
      active_until: null,
    },
  ],
  relations: [
    {
      id: 900101,
      source_id: 900001,
      target_id: 900002,
      relation_type: "dienstverband",
      mechanism: "Bestuurlijke functie",
      filter: "sourcing",
      filters: ["sourcing"],
      aard: "direct",
      certainty_label: "onderbouwd",
      active_from: "2022",
      active_until: null,
      bidirectional: false,
      source_count: 1,
      auto_approved: true,
      description: "Anouk Verbeek is sinds 2022 wethouder van Dijkerhoven (verzonnen demo).",
    },
    {
      id: 900102,
      source_id: 900001,
      target_id: 900003,
      relation_type: "lidmaatschap",
      mechanism: "Partijlidmaatschap",
      filter: "ideologie",
      filters: ["ideologie"],
      aard: "direct",
      certainty_label: "aannemelijk",
      active_from: "2018",
      active_until: null,
      bidirectional: false,
      source_count: 1,
      auto_approved: true,
      description: "Anouk Verbeek is lid van Dijkerhoven Vooruit (verzonnen demo).",
    },
  ],
  sources: {
    "relation:900101": [
      {
        title: "Samenstelling college van B&W (verzonnen demo-bron)",
        url: "https://example.org/dijkerhoven/college",
        publisher: "Gemeente Dijkerhoven (verzonnen)",
        published_at: "2022-06-01",
        quote: null,
      },
    ],
    "relation:900102": [
      {
        title: "Kandidatenlijst Dijkerhoven Vooruit (verzonnen demo-bron)",
        url: "https://example.org/dijkerhoven-vooruit/kandidaten",
        publisher: "Dijkerhoven Vooruit (verzonnen)",
        published_at: "2022-01-20",
        quote: null,
        unreviewed: true,
      },
    ],
    "entity:900001": [
      {
        title: "Nieuws-pijplijn: rol uit het nieuws (verzonnen demo-bron)",
        url: "https://example.org/nieuws/dijkerhoven-windpark",
        publisher: "Pluriformiteit demo",
        published_at: "2026-09-29",
        quote: "Wethouder Anouk Verbeek zegt dat Dijkerhoven niet kan achterblijven.",
        unreviewed: true,
      },
    ],
  },
  aliases: [
    { alias: "anouk-verbeek", entity_id: 900001 },
    { alias: "gemeente-dijkerhoven", entity_id: 900002 },
    { alias: "dijkerhoven-vooruit", entity_id: 900003 },
  ],
};

// --- simulated research table ------------------------------------------------------------------

const table = new Map<string, EntityResearch>(DEMO_RESEARCH.map((row) => [row.entity_key, { ...row }]));

/** request_entity_research, simulated: known names keep their status, new ones join the queue. */
export function demoRequestResearch(key: string, name: string, kind: EntityResearchKind): EntityResearchRequest {
  const existing = table.get(key);
  if (existing) return { ok: true, status: existing.status, reason: existing.status_reason ?? null };
  const now = new Date().toISOString();
  table.set(key, {
    entity_key: key,
    name,
    kind,
    status: "wachtrij",
    status_reason: null,
    role_category: "onbekend",
    role_label: null,
    pm_entity_id: null,
    pm_degree: null,
    found: null,
    queued_at: now,
    researched_at: null,
    updated_at: now,
  });
  return { ok: true, status: "wachtrij", reason: null };
}

/** entity_research_status, simulated. */
export function demoResearchStatus(keys: string[]): EntityResearch[] {
  return keys.map((key) => table.get(key)).filter((row): row is EntityResearch => Boolean(row)).map((row) => ({ ...row }));
}

/** Test helper: forget simulated requests */
export function resetDemoResearch(): void {
  table.clear();
  for (const row of DEMO_RESEARCH) table.set(row.entity_key, { ...row });
}

const PRIVATE_KEYS = new Set(DEMO_RESEARCH.filter((row) => row.role_category === "prive").map((row) => row.entity_key));

/**
 * entity_cooccurrence, computed from the demo events: people and organisations that appear in the
 * same news as any of the aliases (never the entity itself, never private persons).
 */
export function demoCooccurrence(aliases: string[], limit = 20): EntityCooccurrence[] {
  const wanted = new Set(aliases.filter(Boolean));
  const rows = new Map<string, EntityCooccurrence>();
  for (const demo of Object.values(DEMO_EVENTS)) {
    const own = demo.entities.filter((entity) => entity.aliases.some((alias) => wanted.has(alias)));
    if (own.length === 0) continue;
    const ownKeys = new Set(own.map((entity) => entity.entity_key));
    const title = demo.insight?.summary?.split("\n")[0] ?? `Event ${demo.event.id}`;
    for (const entity of demo.entities) {
      if (ownKeys.has(entity.entity_key) || PRIVATE_KEYS.has(entity.entity_key)) continue;
      if (entity.kind !== "person" && entity.kind !== "org") continue;
      const seen = demo.event.last_updated_at;
      const row = rows.get(entity.entity_key);
      if (!row) {
        rows.set(entity.entity_key, {
          entity_key: entity.entity_key,
          name: entity.name,
          kind: entity.kind,
          shared_events: 1,
          last_event_slug: demo.event.slug,
          last_event_title: title,
          last_seen: seen,
        });
      } else {
        row.shared_events += 1;
        if (String(seen ?? "") > String(row.last_seen ?? "")) {
          row.last_event_slug = demo.event.slug;
          row.last_event_title = title;
          row.last_seen = seen;
        }
      }
    }
  }
  return Array.from(rows.values())
    .sort((a, b) => b.shared_events - a.shared_events || String(b.last_seen ?? "").localeCompare(String(a.last_seen ?? "")) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit));
}
