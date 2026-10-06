/**
 * "Van anderen" (Epic 14, Story 14.15): what other readers shared about this news, the way you
 * browse it. The same entry shared by several readers is one row; rows are ordered by how many
 * readers have them (shared or taken over) or by how new they are, and found by words. What you
 * share and what you take over is converted here. Pure: the database calls are in lib/shared.ts.
 */

import type { ShareFields, SharedEntry } from "@/lib/shared";

import { fallacyLabel } from "./labels";
import { normalizeUrl, urlHost } from "./normalize";
import { OWN_KINDS } from "./own";
import type { SpeakerModel } from "./speakers";
import type { OwnEntry, TabId } from "./types";

export interface SharedGroup {
  /** What makes entries the same: kind, what they hang on, the words */
  key: string;
  /** The one you take over: someone else's that most readers took over, else the first shared */
  lead: SharedEntry;
  entries: SharedEntry[];
  /** Readers that have it: who shared it plus who took it over */
  readers: number;
  /** When it was last shared */
  newest: string;
  /** You shared it */
  mine: boolean;
  /** You took it over */
  adopted: boolean;
}

export type SharedOrder = "lezers" | "nieuw";

/** Words to compare: lower case, without accents, punctuation or a leading article. */
export function normalizeWords(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(de|het|een) /, "");
}

/** Entries with the same key are the same entry, whoever shared it. */
export function sharedKey(entry: Pick<SharedEntry, "kind" | "text" | "anchor" | "against" | "about" | "fallacy" | "url" | "date">): string {
  if (entry.kind === "source" && entry.url) return `source|${normalizeUrl(entry.url)}`;
  // A contradiction is the same whichever side was chosen first
  const sides = [entry.anchor ?? "", entry.against ?? ""].sort().join("|");
  return [entry.kind, sides, entry.about ?? "", entry.fallacy ?? "", entry.date ?? "", normalizeWords(entry.text)].join("|");
}

const time = (value: string) => Date.parse(value) || 0;

/** One row per entry, however many readers shared it. `adoptedIds`: ids taken over on this device. */
export function groupShared(entries: readonly SharedEntry[], adoptedIds: ReadonlySet<string> = new Set()): SharedGroup[] {
  const byKey = new Map<string, SharedEntry[]>();
  for (const entry of entries) {
    const key = sharedKey(entry);
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }
  return Array.from(byKey.entries()).map(([key, list]) => {
    const ranked = [...list].sort((a, b) => b.adopted - a.adopted || time(a.created_at) - time(b.created_at));
    return {
      key,
      lead: ranked.find((entry) => !entry.mine) ?? ranked[0],
      entries: list,
      readers: list.length + list.reduce((sum, entry) => sum + entry.adopted, 0),
      newest: list.reduce((latest, entry) => (time(entry.created_at) > time(latest) ? entry.created_at : latest), list[0].created_at),
      mine: list.some((entry) => entry.mine),
      adopted: list.some((entry) => entry.adopted_by_me || adoptedIds.has(String(entry.id))),
    };
  });
}

export function sortGroups(groups: readonly SharedGroup[], order: SharedOrder): SharedGroup[] {
  return [...groups].sort((a, b) =>
    order === "nieuw" ? time(b.newest) - time(a.newest) || b.readers - a.readers : b.readers - a.readers || time(b.newest) - time(a.newest),
  );
}

/** Does a row hold all the words you search for (its texts, the kind of fallacy, the site, who it is about)? */
export function matchesQuery(group: SharedGroup, query: string, describe?: (entry: SharedEntry) => string | null): boolean {
  const words = normalizeWords(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const text = normalizeWords(
    group.entries
      .flatMap((entry) => [
        entry.text,
        entry.detail,
        entry.quote,
        entry.title,
        entry.fallacy ? fallacyLabel(entry.fallacy) : null,
        entry.url ? urlHost(entry.url) : null,
        describe?.(entry) ?? null,
      ])
      .filter(Boolean)
      .join(" "),
  );
  return words.every((word) => text.includes(word));
}

/** The rows of one tab. */
export function groupsInTab(groups: readonly SharedGroup[], tab: TabId): SharedGroup[] {
  return groups.filter((group) => OWN_KINDS[group.lead.kind]?.tab === tab);
}

/** The rows about one speaker or outlet (`speaker:<id>`, `outlet:<key>`), also as the other side of a contradiction. */
export function groupsAbout(groups: readonly SharedGroup[], anchor: string): SharedGroup[] {
  return groups.filter((group) => group.lead.anchor === anchor || group.lead.against === anchor);
}

const SHARED_QUOTE = 300;

/**
 * What is shared of an own entry. A speaker you added exists only on your device, so what hangs on
 * them hangs on their outlet for others; a quote stays short.
 */
export function shareFields(entry: OwnEntry, speakers: Pick<SpeakerModel, "byId">): ShareFields {
  const portable = (anchor: string | undefined) => {
    if (!anchor?.startsWith("speaker:")) return anchor;
    const speaker = speakers.byId.get(anchor.slice("speaker:".length));
    return speaker?.ownId ? `outlet:${speaker.outletKey}` : anchor;
  };
  let anchor = portable(entry.anchor);
  let against = portable(entry.against);
  // Two sides that became the same outlet: keep what the reader chose
  if (against && anchor === against) {
    anchor = entry.anchor;
    against = entry.against;
  }
  const quote = entry.quote && entry.quote.length > SHARED_QUOTE ? `${entry.quote.slice(0, SHARED_QUOTE - 1)}…` : entry.quote;
  const fields: ShareFields = {
    id: entry.id,
    kind: entry.kind,
    text: entry.text,
    detail: entry.detail,
    quote,
    anchor,
    against,
    about: entry.about,
    fallacy: entry.fallacy,
    url: entry.url,
    title: entry.title,
    date: entry.date,
  };
  for (const key of Object.keys(fields) as (keyof ShareFields)[]) if (fields[key] === undefined) delete fields[key];
  return fields;
}

/** Taking over: the same entry as one of your own, which remembers where it came from. */
export function adoptionOf(shared: SharedEntry): Omit<OwnEntry, "id" | "createdAt"> {
  const value = (text: string | null) => text ?? undefined;
  return {
    kind: shared.kind,
    text: shared.text,
    detail: value(shared.detail),
    quote: value(shared.quote),
    anchor: value(shared.anchor),
    against: value(shared.against),
    about: value(shared.about),
    fallacy: value(shared.fallacy),
    url: value(shared.url),
    title: value(shared.title),
    date: value(shared.date),
    from: String(shared.id),
  };
}
