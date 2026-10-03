/**
 * Which outlets and actors of a news item are in the propaganda model. Shared by the network (its
 * starting point) and "Waarom zo?" in the outlet balloon (Epic 13), so both look at the same parties.
 * Pure: the matching itself is one pm_match call by the caller.
 */

import type { EntityKind, EntityResearch, EventEntity, PmMatch } from "@/lib/types";

import { entityPanelKey } from "./entity-linker";
import { DUTCH_OUTLETS } from "./media-landscape";
import { actorKeys } from "./normalize";
import { compatibleMatches, newsNodeId } from "./pm-graph";
import type { ExploreInput } from "./types";

export interface ActorAliases {
  aliases: string[];
  /** null = unknown (authorities from the analysis): any type matches */
  kind: EntityKind | null;
}

/** Outlets of this news that are in the model (not the international ones), in the order of the event. */
export function eventOutletSeeds(input: Pick<ExploreInput, "outlets">): { id: number; outletKey: string }[] {
  const seeds: { id: number; outletKey: string }[] = [];
  for (const outlet of input.outlets) {
    const id = outlet.profile?.pmEntityId;
    if (!outlet.isInternational && id && !seeds.some((seed) => seed.id === id)) seeds.push({ id, outletKey: outlet.key });
  }
  return seeds;
}

/** Every Dutch outlet the app follows that is in the model: also those that did not bring this news. */
export function followedOutletIds(): number[] {
  return Array.from(new Set(DUTCH_OUTLETS.map((outlet) => outlet.pmEntityId).filter((id): id is number => Boolean(id))));
}

/** Entity kinds that are actors: the names you can tap in the news (places, countries and events are not) */
const ACTOR_KINDS: ReadonlySet<EntityKind> = new Set(["person", "org", "group"]);

/** People, organisations and groups of this news (named entities and authorities from the analysis), as aliases to match. */
export function eventActorAliases(input: Pick<ExploreInput, "entities" | "insight">): ActorAliases[] {
  return [
    ...input.entities.filter((entity) => ACTOR_KINDS.has(entity.kind)).map((entity) => ({ aliases: entity.aliases, kind: entity.kind })),
    ...(input.insight?.authority_analysis ?? []).map((authority) => ({ aliases: actorKeys(authority.authority).aliases, kind: null })),
  ];
}

/** The people and organisations of this news, as keys for their "Wie is dit?" research. */
export function researchKeys(input: Pick<ExploreInput, "entities">): string[] {
  return input.entities.filter((entity) => entity.kind === "person" || entity.kind === "org").map((entity) => entity.entity_key);
}

/** Model ids that "Wie is dit?" research found for names of this news (also under another name than in the news). */
export function researchedIds(research: readonly EntityResearch[] | null, exclude: ReadonlySet<number> = new Set()): number[] {
  const ids: number[] = [];
  for (const row of research ?? []) {
    const id = row.pm_entity_id;
    if (id && !exclude.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** A person or organisation of the news that is not in the propaganda model (yet). */
export interface NewsEntity {
  /** Node id in the network */
  id: string;
  /** entity_key of the event entity ("person:sarah-dobbe") */
  key: string;
  /** Opens its entity panel (`entiteit:<panelKey>`) */
  panelKey: string;
  name: string;
  kind: "person" | "org";
  mentions: number;
  /** Outlets that name it, most mentions first */
  outlets: string[];
  /** Its "Wie is dit?" research, when there is any */
  research: EntityResearch | null;
}

/** Research judged it no public actor: a private person, or a name too vague to look up */
function noPublicActor(row: EntityResearch | undefined): boolean {
  if (!row) return false;
  return row.role_category === "prive" || (row.status === "overgeslagen" && (!row.role_category || row.role_category === "onbekend"));
}

/**
 * Every person and organisation of this news that is not in the model (no exact match, nothing found by
 * research): the network draws them around "Dit nieuws" all the same. Not the names research judged
 * private or too vague ("Lisa", "PRO"). Most prominent first.
 */
export function newsOnlyEntities(
  input: Pick<ExploreInput, "entities">,
  matches: readonly PmMatch[],
  research: readonly EntityResearch[] | null,
): NewsEntity[] {
  const rows = new Map((research ?? []).map((row) => [row.entity_key, row]));
  return input.entities
    .filter((entity): entity is EventEntity & { kind: "person" | "org" } => entity.kind === "person" || entity.kind === "org")
    .filter((entity) => compatibleMatches(matches.filter((match) => entity.aliases.includes(match.alias)), entity.kind).length === 0)
    .filter((entity) => !rows.get(entity.entity_key)?.pm_entity_id && !noPublicActor(rows.get(entity.entity_key)))
    .sort((a, b) => b.salience - a.salience || b.mention_count - a.mention_count)
    .map((entity) => ({
      id: newsNodeId(entity.entity_key),
      key: entity.entity_key,
      panelKey: entityPanelKey(entity),
      name: entity.name,
      kind: entity.kind,
      mentions: entity.mention_count,
      outlets: Object.entries(entity.outlet_counts ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([outlet]) => outlet),
      research: rows.get(entity.entity_key) ?? null,
    }));
}

/** Model ids of the actors (exact aliases only, no person <-> organisation mix-ups), first come first. */
export function matchActorIds(actors: ActorAliases[], matches: PmMatch[], exclude: ReadonlySet<number> = new Set()): number[] {
  const ids: number[] = [];
  for (const actor of actors) {
    const own = compatibleMatches(
      matches.filter((match) => actor.aliases.includes(match.alias)),
      actor.kind,
    );
    for (const match of own) {
      if (!exclude.has(match.entity_id) && !ids.includes(match.entity_id)) ids.push(match.entity_id);
    }
  }
  return ids;
}
