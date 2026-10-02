/**
 * Epic 12/13: the explorable ego-network on /actor/[slug]. A deliberately small scene builder next to
 * the event network's `pmScene`: the actor in the middle with, per filter, only its most *specific*
 * neighbours (Epic 13: not the hubs with the most relations), the parties you asked about with the
 * three most specific per question, the routes you asked for, and the relations between what is
 * drawn. Pure and deterministic.
 */

import type { PmEntity, PmRelation } from "@/lib/types";

import {
  bySpecificity,
  displayFilter,
  isDirected,
  isHistoric,
  isRelationVisible,
  otherEnd,
  pmNodeId,
  relationFilterKeys,
  relationFilters,
  specificityOf,
  type PmMerged,
} from "./pm-graph";
import { referenceDate } from "./pm-paths";

/** Neighbours drawn per filter around the actor and per question around a party you asked about */
export const ACTOR_SHOWN_PER_FILTER = 3;

export interface ActorSceneNode {
  id: string;
  pmId: number;
  label: string;
  type: string;
  filter: string | null;
  weight: number;
  expanded: boolean;
  isCenter: boolean;
  autoApproved: boolean;
  /** Node it hangs from (layout starts it nearby) */
  parent?: string;
}

export interface ActorSceneEdge {
  id: string;
  relationId: number;
  source: string;
  target: string;
  type: string;
  filter: string | null;
  filters: string[];
  historic: boolean;
  directed: boolean;
  autoApproved: boolean;
}

export interface ActorScene {
  nodes: ActorSceneNode[];
  edges: ActorSceneEdge[];
  /** Neighbours of the actor that are not drawn (they are in the list below the network) */
  hidden: number;
}

export function actorScene(
  merged: PmMerged,
  centerId: number,
  asked: ReadonlyMap<number, ReadonlySet<string>>,
  options: {
    hiddenFilters?: ReadonlySet<string>;
    /** On routes you asked for: always drawn, relations always visible */
    routeNodes?: ReadonlySet<number>;
    routeRelations?: ReadonlySet<number>;
    maxNodes?: number;
    now?: Date;
  } = {},
): ActorScene {
  const hidden = options.hiddenFilters ?? new Set<string>();
  const routeNodes = options.routeNodes ?? new Set<number>();
  const routeRelations = options.routeRelations ?? new Set<number>();
  const maxNodes = options.maxNodes ?? 60;
  const at = referenceDate(null, options.now);
  if (!merged.entities.has(centerId)) return { nodes: [], edges: [], hidden: 0 };

  const relations = Array.from(merged.relations.values())
    .filter((relation) => isRelationVisible(relation, hidden) || routeRelations.has(relation.id))
    .sort((a, b) => a.id - b.id);
  const anchors = [centerId, ...Array.from(asked.keys()).filter((id) => id !== centerId && merged.entities.has(id)).sort((a, b) => a - b)];
  const anchorSet = new Set(anchors);

  // Per anchor and filter the most specific neighbours: every filter around the actor, only the asked
  // ones around other parties
  const kept = new Set<number>(anchors);
  const parentOf = new Map<number, number>();
  const centerNeighbours = new Set<number>();
  for (const anchor of anchors) {
    const groups = new Map<string, Map<number, PmRelation[]>>();
    for (const relation of relations) {
      if (relation.source_id !== anchor && relation.target_id !== anchor) continue;
      const other = otherEnd(relation, anchor);
      if (!merged.entities.has(other)) continue;
      if (anchor === centerId) centerNeighbours.add(other);
      for (const filter of relationFilterKeys(relation)) {
        if (hidden.has(filter)) continue;
        if (anchor !== centerId && !asked.get(anchor)?.has(filter)) continue;
        const group = groups.get(filter) ?? new Map<number, PmRelation[]>();
        group.set(other, [...(group.get(other) ?? []), relation]);
        groups.set(filter, group);
      }
    }
    Array.from(groups.keys())
      .sort()
      .forEach((filter) => {
        Array.from((groups.get(filter) as Map<number, PmRelation[]>).entries())
          .map(([id, list]) => specificityOf(merged.entities.get(id), id, list, at))
          .sort(bySpecificity)
          .slice(0, ACTOR_SHOWN_PER_FILTER)
          .forEach(({ id }) => {
            kept.add(id);
            if (!parentOf.has(id) && !anchorSet.has(id)) parentOf.set(id, anchor);
          });
      });
  }
  routeNodes.forEach((id) => {
    if (merged.entities.has(id)) kept.add(id);
  });

  // Safety cap: drop the least specific optional nodes (never anchors or route nodes)
  const optional = Array.from(kept).filter((id) => !anchorSet.has(id) && !routeNodes.has(id));
  const excess = kept.size - maxNodes;
  if (excess > 0) {
    optional
      .map((id) => specificityOf(merged.entities.get(id), id, relations.filter((relation) => relation.source_id === id || relation.target_id === id), at))
      .sort(bySpecificity)
      .reverse()
      .slice(0, excess)
      .forEach(({ id }) => kept.delete(id));
  }

  const nodes: ActorSceneNode[] = Array.from(kept).map((id) => {
    const entity = merged.entities.get(id) as PmEntity;
    const parent = parentOf.get(id);
    return {
      id: pmNodeId(id),
      pmId: id,
      label: entity.name,
      type: entity.type,
      filter: (entity.primary_filter as string | null) ?? null,
      weight: id === centerId ? 8 : 1 + Math.min(entity.degree ?? 0, 60) / 4,
      expanded: anchorSet.has(id),
      isCenter: id === centerId,
      autoApproved: Boolean(entity.auto_approved),
      parent: parent !== undefined ? pmNodeId(parent) : undefined,
    };
  });

  const edges: ActorSceneEdge[] = relations
    .filter((relation) => kept.has(relation.source_id) && kept.has(relation.target_id))
    .map((relation: PmRelation) => ({
      id: `pmrel:${relation.id}`,
      relationId: relation.id,
      source: pmNodeId(relation.source_id),
      target: pmNodeId(relation.target_id),
      type: relation.relation_type,
      filter: displayFilter(relation, { hidden }),
      filters: relationFilters(relation),
      historic: isHistoric(relation, options.now),
      directed: isDirected(relation),
      autoApproved: Boolean(relation.auto_approved),
    }));

  const drawnNeighbours = Array.from(centerNeighbours).filter((id) => kept.has(id)).length;
  return { nodes, edges, hidden: Math.max(0, centerNeighbours.size - drawnNeighbours) };
}
