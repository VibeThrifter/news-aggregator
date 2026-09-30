/**
 * Epic 12 "Wie is dit?": every known name in a text becomes tappable.
 *
 * Builds the link targets of an event once (outlets, people/organisations/groups from NER, the
 * authorities of the analysis, and a person's surname on its own when no one else in the event has
 * it) and splits plain text into text/link segments. Matching is exact and case-sensitive, never
 * inside a word, longest name first and only the first occurrence per name in a text block
 * (see `linkifyText`). The summary sheet uses the same targets via `remarkEntityLinks`.
 */

import type { EntityKind, EventEntity } from "@/lib/types";

import { linkifyText, type LinkTarget } from "./entity-links";
import { actorKeys } from "./normalize";

export type EntityLinkKind = "outlet" | "entity";

export interface EntityLink extends LinkTarget {
  kind: EntityLinkKind;
  /** Outlet key (outlets) or the key for the entity panel (`entiteit:<key>`) */
  key: string;
  /** Canonical name (the panel's ?n=, also when the text is only a surname) */
  name: string;
}

export const OUTLET_HREF = "pluri:outlet:";
export const ENTITY_HREF = "pluri:entity:";

/** Entity kinds that are tappable in running text (places and countries would link almost every sentence) */
export const LINKED_ENTITY_KINDS: readonly EntityKind[] = ["person", "org", "group"];

export interface LinkerInput {
  outlets: { key: string; name: string; profile?: { aliases?: string[] } | null }[];
  entities: EventEntity[];
  /** Free-text authorities from the analysis ("Nationale Adviesraad Windenergie", "Minister De Jonge") */
  authorities?: string[];
}

/** The key the entity panel opens with (same as the summary sheet always used). */
export function entityPanelKey(entity: Pick<EventEntity, "aliases" | "entity_key">): string {
  return entity.aliases[0] ?? entity.entity_key;
}

/**
 * A person's surname: everything after the first name ("Anouk Verbeek" -> "Verbeek",
 * "Henk de Boer" -> "de Boer"). Null for single names or very short surnames.
 */
export function personSurname(name: string): string | null {
  const tokens = name.replace(/\(.*?\)/g, " ").trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const surname = tokens.slice(1).join(" ");
  const letters = surname.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 ? surname : null;
}

/** Dutch writes a surname on its own with a capital: "de Boer" -> also "De Boer". */
function surnameVariants(surname: string): string[] {
  const capital = surname.charAt(0).toUpperCase() + surname.slice(1);
  return Array.from(new Set([surname, capital]));
}

/**
 * All link targets of an event. Outlets come first (they keep their own balloon), then entities by
 * salience, then authorities; a text is only used once. `kinds` widens the entity kinds (the summary
 * sheet also links places and countries, as it always did).
 */
export function buildEntityLinks(input: LinkerInput, options: { kinds?: readonly EntityKind[] | "all" } = {}): EntityLink[] {
  const kinds = options.kinds === "all" ? null : new Set<EntityKind>(options.kinds ?? LINKED_ENTITY_KINDS);
  const links: EntityLink[] = [];
  const texts = new Set<string>();
  const add = (link: EntityLink) => {
    const text = link.text.trim();
    if (text.length < 2 || texts.has(text)) return;
    texts.add(text);
    links.push({ ...link, text });
  };

  for (const outlet of input.outlets) {
    for (const name of Array.from(new Set([outlet.name, ...(outlet.profile?.aliases ?? [])]))) {
      // "NU" is also a common word
      if (name !== "NU") add({ text: name, href: `${OUTLET_HREF}${outlet.key}`, kind: "outlet", key: outlet.key, name: outlet.name });
    }
  }

  const entities = [...input.entities]
    .filter((entity) => !kinds || kinds.has(entity.kind))
    .sort((a, b) => b.salience - a.salience);
  for (const entity of entities) {
    const key = entityPanelKey(entity);
    add({ text: entity.name, href: `${ENTITY_HREF}${key}`, kind: "entity", key, name: entity.name });
  }

  for (const authority of input.authorities ?? []) {
    const keys = actorKeys(authority);
    if (keys.slug) add({ text: keys.display, href: `${ENTITY_HREF}${keys.slug}`, kind: "entity", key: keys.slug, name: keys.display });
  }

  // Surnames last, so a full name of someone (or something) else always wins
  const persons = entities.filter((entity) => entity.kind === "person");
  const counts = new Map<string, number>();
  for (const person of persons) {
    const surname = personSurname(person.name)?.toLowerCase();
    if (surname) counts.set(surname, (counts.get(surname) ?? 0) + 1);
  }
  for (const person of persons) {
    const surname = personSurname(person.name);
    if (!surname || (counts.get(surname.toLowerCase()) ?? 0) > 1) continue;
    const key = entityPanelKey(person);
    for (const variant of surnameVariants(surname)) {
      add({ text: variant, href: `${ENTITY_HREF}${key}`, kind: "entity", key, name: person.name });
    }
  }
  return links;
}

export type TextSegment = { type: "text"; text: string } | { type: "link"; text: string; link: EntityLink };

/**
 * Split plain text into segments. `used` (hrefs already linked) lets a caller link a name only once
 * across several texts; by default every text block starts fresh.
 */
export function segmentText(text: string, links: EntityLink[], used: Set<string> = new Set()): TextSegment[] {
  if (!text) return [];
  if (links.length === 0) return [{ type: "text", text }];
  const byHref = new Map<string, EntityLink>();
  for (const link of links) {
    if (!byHref.has(link.href)) byHref.set(link.href, link);
  }
  return linkifyText(text, links, used).map((node): TextSegment => {
    if (node.type === "link" && node.url) {
      const link = byHref.get(node.url);
      const value = node.children?.[0]?.value ?? "";
      if (link) return { type: "link", text: value, link };
      return { type: "text", text: value };
    }
    return { type: "text", text: node.value ?? "" };
  });
}

/** True when the text contains at least one known name. */
export function hasEntityLinks(text: string | null | undefined, links: EntityLink[]): boolean {
  return Boolean(text) && segmentText(text as string, links).some((segment) => segment.type === "link");
}
