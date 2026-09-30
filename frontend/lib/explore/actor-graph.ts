/**
 * Epic 12: the explorable ego-network on /actor/[slug]. A deliberately small scene builder next to
 * the event network's `pmScene`: the actor in the middle, the neighbours of every expanded node
 * (most connected first, up to a cap) and the relations between what is drawn. Pure and
 * deterministic.
 */

import type { PmEntity, PmRelation } from "@/lib/types";

import { displayFilter, isDirected, isHistoric, isRelationVisible, otherEnd, pmNodeId, relationFilters, type PmMerged } from "./pm-graph";

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
  /** Node it was expanded from (layout starts it nearby) */
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
  /** Neighbours that did not fit under the cap */
  hidden: number;
}

export function actorScene(
  merged: PmMerged,
  centerId: number,
  expanded: ReadonlySet<number>,
  options: { hiddenFilters?: ReadonlySet<string>; maxNodes?: number; now?: Date } = {},
): ActorScene {
  const hidden = options.hiddenFilters ?? new Set<string>();
  const maxNodes = options.maxNodes ?? 60;
  if (!merged.entities.has(centerId)) return { nodes: [], edges: [], hidden: 0 };

  const relations = Array.from(merged.relations.values())
    .filter((relation) => isRelationVisible(relation, hidden))
    .sort((a, b) => a.id - b.id);
  const anchors = [centerId, ...Array.from(expanded).filter((id) => id !== centerId && merged.entities.has(id)).sort((a, b) => a - b)];
  const anchorSet = new Set(anchors);

  // Candidates: neighbours of anchors, with the anchor they hang from (first anchor wins: the centre)
  const parentOf = new Map<number, number>();
  for (const anchor of anchors) {
    for (const relation of relations) {
      if (relation.source_id !== anchor && relation.target_id !== anchor) continue;
      const other = otherEnd(relation, anchor);
      if (anchorSet.has(other) || !merged.entities.has(other) || parentOf.has(other)) continue;
      parentOf.set(other, anchor);
    }
  }
  const degree = (id: number) => merged.entities.get(id)?.degree ?? 0;
  const name = (id: number) => merged.entities.get(id)?.name ?? "";
  const candidates = Array.from(parentOf.keys()).sort(
    (a, b) =>
      Number(parentOf.get(b) === centerId) - Number(parentOf.get(a) === centerId) || degree(b) - degree(a) || name(a).localeCompare(name(b), "nl") || a - b,
  );
  const room = Math.max(0, maxNodes - anchors.length);
  const kept = new Set<number>([...anchors, ...candidates.slice(0, room)]);

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

  return { nodes, edges, hidden: Math.max(0, candidates.length - room) };
}
