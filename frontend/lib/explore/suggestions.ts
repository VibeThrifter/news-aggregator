/**
 * Suggested connections on the research board: items that share a key (same outlet, same person,
 * same propaganda-model actor, same country, ...), preferably across different events.
 */

import type { DossierEdge, DossierItem } from "./store";

export interface Suggestion {
  /** Stable key for dismissing: "a|b" with a < b */
  key: string;
  source: string;
  target: string;
  label: string;
  score: number;
  sharedKey: string;
}

const MAX_KEY_ITEMS = 8;

/** Node kinds that only mean something inside one event (never match across events). */
const EVENT_LOCAL = new Set(["perspective", "claim", "contradiction", "fallacy", "statistic", "gap", "event", "related"]);

/**
 * Normalise dossier keys so the same thing matches however it was saved:
 * actor:x / alias:x / entity:<kind>:x -> name:x. Event-local keys are dropped.
 */
export function normalizeKey(key: string): string | null {
  const colon = key.indexOf(":");
  if (colon === -1) return null;
  const kind = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  if (EVENT_LOCAL.has(kind)) return null;
  if (kind === "actor" || kind === "alias") return `name:${rest}`;
  if (kind === "entity") {
    const inner = rest.indexOf(":");
    const entityKind = inner === -1 ? "" : rest.slice(0, inner);
    const slug = inner === -1 ? rest : rest.slice(inner + 1);
    return entityKind === "country" ? `country:${slug}` : `name:${slug}`;
  }
  return `${kind}:${rest}`;
}

export function suggestionLabel(sharedKey: string, items: DossierItem[]): string {
  const kind = sharedKey.slice(0, sharedKey.indexOf(":"));
  const outletName = items.find((item) => item.kind === "outlet")?.title;
  switch (kind) {
    case "outlet":
      return outletName ? `Zelfde bron: ${outletName}` : "Zelfde bron";
    case "pm":
      return "Zelfde actor in het propagandamodel";
    case "name":
    case "entity":
    case "alias":
    case "actor": {
      const named = items.find((item) => item.kind === "entity" || item.kind === "actor")?.title;
      return named ? `Zelfde naam: ${named}` : "Zelfde naam";
    }
    case "country":
      return "Zelfde land";
    case "frame":
      return "Zelfde frame";
    case "bias":
      return "Zelfde soort bias";
    default:
      return "Hebben iets gemeen";
  }
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function computeSuggestions(
  items: DossierItem[],
  edges: DossierEdge[],
  dismissed: string[],
  options: { max?: number } = {},
): Suggestion[] {
  const byKey = new Map<string, DossierItem[]>();
  for (const item of items) {
    for (const key of new Set(item.keys.map(normalizeKey).filter((value): value is string => Boolean(value)))) {
      const list = byKey.get(key) ?? [];
      list.push(item);
      byKey.set(key, list);
    }
  }

  const existing = new Set(edges.map((edge) => pairKey(edge.source, edge.target)));
  const dismissedSet = new Set(dismissed);
  const best = new Map<string, Suggestion>();

  for (const [key, members] of Array.from(byKey.entries())) {
    if (members.length < 2 || members.length > MAX_KEY_ITEMS) continue;
    const weight = 1 / Math.log2(1 + members.length);
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i];
        const b = members[j];
        const pk = pairKey(a.id, b.id);
        if (existing.has(pk) || dismissedSet.has(pk)) continue;
        // Across events counts double: that is where the interesting connections are
        const crossEvent = a.eventId !== b.eventId && (a.eventId !== null || b.eventId !== null);
        const score = weight * (crossEvent ? 2 : 1);
        const current = best.get(pk);
        if (!current || score > current.score) {
          best.set(pk, {
            key: pk,
            source: a.id,
            target: b.id,
            label: suggestionLabel(key, [a, b]),
            score: current ? current.score + score : score,
            sharedKey: key,
          });
        } else {
          current.score += score;
        }
      }
    }
  }

  return Array.from(best.values())
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, options.max ?? 20);
}

/** Grid placement for items without a position, grouped per event (one column per event). */
export function autoPlace(items: DossierItem[]): Map<string, { x: number; y: number }> {
  const columns = new Map<string, DossierItem[]>();
  for (const item of items) {
    if (item.position) continue;
    const key = item.eventId === null ? "none" : String(item.eventId);
    const list = columns.get(key) ?? [];
    list.push(item);
    columns.set(key, list);
  }
  const placed = new Map<string, { x: number; y: number }>();
  let column = 0;
  const occupiedMaxX = Math.max(0, ...items.filter((item) => item.position).map((item) => (item.position?.x ?? 0) + 260));
  for (const list of Array.from(columns.values())) {
    list.forEach((item, row) => {
      placed.set(item.id, { x: occupiedMaxX + column * 260, y: row * 150 });
    });
    column += 1;
  }
  return placed;
}
