/**
 * Which outlets and actors of a news item are in the propaganda model. Shared by the network (its
 * starting point) and "Waarom zo?" in the outlet balloon (Epic 13), so both look at the same parties.
 * Pure: the matching itself is one pm_match call by the caller.
 */

import type { EntityKind, PmMatch } from "@/lib/types";

import { DUTCH_OUTLETS } from "./media-landscape";
import { actorKeys } from "./normalize";
import { compatibleMatches } from "./pm-graph";
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

/** People and organisations of this news (named entities and authorities from the analysis), as aliases to match. */
export function eventActorAliases(input: Pick<ExploreInput, "entities" | "insight">): ActorAliases[] {
  return [
    ...input.entities
      .filter((entity) => entity.kind === "person" || entity.kind === "org")
      .map((entity) => ({ aliases: entity.aliases, kind: entity.kind as EntityKind })),
    ...(input.insight?.authority_analysis ?? []).map((authority) => ({ aliases: actorKeys(authority.authority).aliases, kind: null })),
  ];
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
