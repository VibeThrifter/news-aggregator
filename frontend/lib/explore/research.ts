/**
 * Epic 12 "Wie is dit?": which names can be researched, what their research status means (Dutch
 * copy) and how an actor page is addressed. Pure helpers, shared by the EntitySheet and /actor/[slug].
 */

import type { EntityKind, EntityResearch, EntityResearchKind, EntityResearchStatus } from "@/lib/types";

import { actorKeys, slugify } from "./normalize";

export type ResearchTone = "neutral" | "busy" | "good" | "warn" | "bad";

export interface ResearchCopy {
  title: string;
  body: string;
  tone: ResearchTone;
  /** Poll the status while it can still change by itself */
  polling: boolean;
}

/** Statuses that change without the user doing anything (the backend picks them up) */
export const POLLING_STATUSES: ReadonlySet<string> = new Set(["nieuw", "wachtrij", "bezig"]);

/** Poll every minute while the research is queued or running */
export const RESEARCH_POLL_MS = 60_000;

const PRIVATE_REASON = /^(prive|privé|privepersoon|privépersoon|private?)\b/i;

/** Human explanation of why a name is not researched (status_reason is a code or free text). */
export function skipReasonText(reason: string | null | undefined, roleCategory?: string | null): string {
  const value = (reason ?? "").trim();
  if (roleCategory === "prive" || PRIVATE_REASON.test(value)) return "Privépersoon — wordt niet uitgezocht.";
  if (/^(buitenland|foreign)/i.test(value)) return "Buitenlandse naam — valt buiten het Nederlandse netwerk.";
  if (/^(niet_nodig|al_bekend|bekend)/i.test(value)) return "Staat al in het propagandamodel.";
  if (/^(geen_rol|onbekend|te_vaag)/i.test(value)) return "Geen publieke rol gevonden in het nieuws — wordt niet uitgezocht.";
  if (!value || /^[a-z_]+$/.test(value)) return "Deze naam wordt niet uitgezocht.";
  return value;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 verbanden gevonden · 2 automatisch toegevoegd · 1 wacht op controle" */
export function foundSummary(found: EntityResearch["found"]): string {
  if (!found) return "";
  const parts: string[] = [];
  const relations = found.relations ?? 0;
  parts.push(relations > 0 ? `${plural(relations, "verband", "verbanden")} gevonden` : "geen verbanden gevonden");
  if (found.auto_approved) parts.push(`${found.auto_approved} automatisch toegevoegd`);
  if (found.pending) parts.push(`${found.pending} ${found.pending === 1 ? "wacht" : "wachten"} op controle`);
  return parts.join(" · ");
}

/** Dutch title and explanation for every research status. */
export function researchCopy(row: Pick<EntityResearch, "status" | "status_reason" | "role_category" | "found" | "name">): ResearchCopy {
  const name = row.name || "Deze naam";
  const status = row.status as EntityResearchStatus;
  switch (status) {
    case "nieuw":
      return { title: "Aangevraagd", body: `We kijken of ${name} uitgezocht kan worden.`, tone: "busy", polling: true };
    case "wachtrij":
      return {
        title: "In de wachtrij",
        body: `${name} staat in de wachtrij. Een onderzoeksagent zoekt in registers, nieuws en LinkedIn uit met wie ${name} verbonden is. Dat kan een paar uur duren.`,
        tone: "busy",
        polling: true,
      };
    case "bezig":
      return {
        title: "Wordt nu uitgezocht",
        body: `Een onderzoeksagent zoekt nu uit met wie ${name} verbonden is.`,
        tone: "busy",
        polling: true,
      };
    case "klaar": {
      const summary = foundSummary(row.found);
      return {
        title: "Uitgezocht",
        body: summary ? `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.` : `${name} is uitgezocht.`,
        tone: "good",
        polling: false,
      };
    }
    case "niets_gevonden":
      return {
        title: "Niets gevonden",
        body: `In openbare bronnen zijn geen controleerbare verbanden van ${name} gevonden.`,
        tone: "neutral",
        polling: false,
      };
    case "twijfel":
      return {
        title: "Twijfel",
        body: "Er zijn meerdere mensen of organisaties met deze naam. Een mens kijkt ernaar voordat er iets wordt toegevoegd.",
        tone: "warn",
        polling: false,
      };
    case "overgeslagen":
      return { title: "Wordt niet uitgezocht", body: skipReasonText(row.status_reason, row.role_category), tone: "neutral", polling: false };
    case "niet_nodig":
      return {
        title: "Al bekend",
        body: `${name} staat al met genoeg verbanden in het propagandamodel.`,
        tone: "good",
        polling: false,
      };
    case "fout":
      return { title: "Even mislukt", body: "Het uitzoeken is mislukt. Het wordt later opnieuw geprobeerd.", tone: "bad", polling: false };
    default:
      return { title: "Onbekende status", body: String(row.status), tone: "neutral", polling: false };
  }
}

/** Copy when there is no research row (yet). */
export function noResearchCopy(name: string, requesting: boolean): ResearchCopy {
  return requesting
    ? { title: "Aanvragen…", body: `We vragen of ${name} uitgezocht kan worden.`, tone: "busy", polling: false }
    : {
        title: "Nog niet uitgezocht",
        body: `${name} is nog niet onderzocht. Namen die in het nieuws voorkomen worden automatisch aangevraagd zodra je ze opent.`,
        tone: "neutral",
        polling: false,
      };
}

export interface ResearchTarget {
  /** entity_research key: "person:slug", "org:slug" or "actor:slug" */
  key: string;
  kind: EntityResearchKind;
}

/**
 * The entity_research key for a name in the news. NER entities keep their own key; only people and
 * organisations are researched (places, countries, groups and events never). Free-text actors
 * (authorities, quoted sources) get "person:"/"org:" with a kind hint, else "actor:".
 */
export function researchTarget(options: {
  entity?: { entity_key: string; kind: EntityKind } | null;
  panelKey: string;
  name: string;
  kindHint?: string | null;
}): ResearchTarget | null {
  const { entity, panelKey, name, kindHint } = options;
  if (entity) {
    if (entity.kind === "person" || entity.kind === "org") return { key: entity.entity_key, kind: entity.kind };
    return null;
  }
  const prefixed = /^(person|org):(.+)$/.exec(panelKey);
  if (prefixed) return { key: panelKey, kind: prefixed[1] as "person" | "org" };
  if (/^(place|country|group|event):/.test(panelKey)) return null;
  const slug = actorKeys(name, { person: kindHint === "person" }).slug || slugify(panelKey);
  if (!slug) return null;
  if (kindHint === "person" || kindHint === "org") return { key: `${kindHint}:${slug}`, kind: kindHint };
  return { key: `actor:${slug}`, kind: "unknown" };
}

/** Slug part of an entity key ("person:anouk-verbeek" -> "anouk-verbeek"). */
export function keySlug(key: string): string {
  const colon = key.indexOf(":");
  return colon === -1 ? key : key.slice(colon + 1);
}

/** Link to the standalone actor page. */
export function actorHref(slug: string, options: { kind?: string | null; name?: string | null; demo?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (options.kind === "person" || options.kind === "org") params.set("k", options.kind);
  if (options.name) params.set("n", options.name);
  if (options.demo) params.set("demo", "1");
  const query = params.toString();
  return `/actor/${encodeURIComponent(slug)}${query ? `?${query}` : ""}`;
}

/** Kind for an actor page from a propaganda-model type. */
export function kindForPmType(type: string | null | undefined): "person" | "org" | null {
  if (!type) return null;
  return type === "persoon" ? "person" : "org";
}

export interface ActorParams {
  slug: string;
  /** Propaganda-model id for "pm-<id>" slugs */
  pmId: number | null;
  kind: "person" | "org" | null;
  name: string;
  /** Alias slugs to match the propaganda model, news appearances and co-occurrence on */
  aliases: string[];
  /** entity_research keys to look up */
  researchKeys: string[];
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Resolve /actor/[slug]?k=&n= into lookup keys (pure; the page does the fetching). */
export function resolveActorParams(rawSlug: string, query: { k?: string | null; n?: string | null } = {}): ActorParams {
  const slug = rawSlug.trim();
  const kind = query.k === "person" || query.k === "org" ? query.k : null;
  const pm = /^pm-(\d+)$/.exec(slug);
  if (pm) {
    const name = query.n?.trim() || "";
    const aliases = name ? actorKeys(name, { person: kind === "person" }).aliases : [];
    return { slug, pmId: Number(pm[1]), kind, name, aliases, researchKeys: [] };
  }
  // Entity slugs are already slugs; only normalise free text (never re-slugify: "de-..." would lose its article)
  const clean = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? slug : slugify(slug) || slug;
  const name = query.n?.trim() || titleCase(clean);
  const keys = actorKeys(name, { person: kind === "person" });
  // The slug itself first: it is the most precise alias (entity key slug)
  const aliases = Array.from(new Set([clean, ...keys.aliases])).filter(Boolean);
  const researchKeys = kind ? [`${kind}:${clean}`] : [`person:${clean}`, `org:${clean}`, `actor:${clean}`];
  return { slug: clean, pmId: null, kind, name, aliases, researchKeys };
}

// --- "once per session per key" -----------------------------------------------------------------

const REQUESTED_KEY = "pluri:research-requested";
const requestedInMemory = new Set<string>();

function readRequested(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(REQUESTED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** True when this key was already requested in this browser session. */
export function wasRequested(key: string): boolean {
  if (requestedInMemory.has(key)) return true;
  if (typeof window === "undefined") return false;
  return readRequested().has(key);
}

export function markRequested(key: string): void {
  requestedInMemory.add(key);
  if (typeof window === "undefined") return;
  try {
    const all = readRequested();
    all.add(key);
    window.sessionStorage.setItem(REQUESTED_KEY, JSON.stringify(Array.from(all).slice(-300)));
  } catch {
    // Private mode or quota: the in-memory set still prevents repeats until a reload
  }
}

/** Test helper */
export function resetRequested(): void {
  requestedInMemory.clear();
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(REQUESTED_KEY);
  } catch {
    // ignore
  }
}
