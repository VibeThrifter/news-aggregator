/**
 * Radial layout for the mini ego-network in the entity panel ("Netwerk & onderzoek"): the entity in
 * the middle and at most ten neighbours on a circle, one relation each (the most informative one).
 * Pure and deterministic: the same neighbourhood always gives the same picture, whatever the order
 * of the rows that came back.
 */

import type { PmEntity, PmNeighborhood, PmRelation } from "@/lib/types";

import { displayFilter, isHistoric, otherEnd } from "./pm-graph";
import { relationRank } from "./pm-local";

export interface EgoNode {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  /** Relation that connects it to the centre */
  relation: PmRelation;
  /** Centre -> neighbour ("A is eigenaar van B" read from the centre) */
  outgoing: boolean;
  /** Filter the edge is drawn in (legend palette) */
  filter: string | null;
  historic: boolean;
  autoApproved: boolean;
}

export interface EgoLayout {
  size: number;
  center: PmEntity & { x: number; y: number };
  nodes: EgoNode[];
  /** Neighbours that did not fit */
  hidden: number;
}

function compareRelations(a: PmRelation, b: PmRelation): number {
  return relationRank(a) - relationRank(b) || b.source_count - a.source_count || a.id - b.id;
}

export function egoLayout(
  hood: PmNeighborhood,
  options: { max?: number; size?: number; hiddenFilters?: ReadonlySet<string>; now?: Date } = {},
): EgoLayout {
  const max = options.max ?? 10;
  const size = options.size ?? 300;
  const centerId = hood.center.id;
  const entities = new Map(hood.entities.map((entity) => [entity.id, entity]));

  // One relation per neighbour: the most informative
  const best = new Map<number, PmRelation>();
  for (const relation of [...hood.relations].sort(compareRelations)) {
    const other = otherEnd(relation, centerId);
    if (other === centerId || !entities.has(other) || best.has(other)) continue;
    best.set(other, relation);
  }

  const ordered = Array.from(best.entries()).sort(
    ([idA, a], [idB, b]) =>
      compareRelations(a, b) ||
      (entities.get(idA)?.name ?? "").localeCompare(entities.get(idB)?.name ?? "", "nl") ||
      idA - idB,
  );
  const shown = ordered.slice(0, max);
  const middle = size / 2;
  const radius = size * 0.36;

  const nodes: EgoNode[] = shown.map(([id, relation], i) => {
    const entity = entities.get(id) as PmEntity;
    // Start at the top, clockwise
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(shown.length, 1);
    return {
      id,
      name: entity.name,
      type: entity.type,
      x: Math.round((middle + radius * Math.cos(angle)) * 10) / 10,
      y: Math.round((middle + radius * Math.sin(angle)) * 10) / 10,
      relation,
      outgoing: relation.source_id === centerId,
      filter: displayFilter(relation, { hidden: options.hiddenFilters }),
      historic: isHistoric(relation, options.now),
      autoApproved: Boolean(relation.auto_approved),
    };
  });

  return {
    size,
    center: { ...hood.center, x: middle, y: middle },
    nodes,
    hidden: Math.max(0, ordered.length - shown.length),
  };
}
