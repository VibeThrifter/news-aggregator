/**
 * Which nodes and edges each event lens shows in the network view, after fog-of-war,
 * plus "ghost" nodes that count what is still hidden per spoor.
 */

import { SPOOR_BY_ID } from "./labels";
import type { Clue, EdgeKind, ExploreGraph, GraphNode, NodeKind, SpoorId } from "./types";
import { visibleGraph } from "./visibility";

export type EventLens = "actoren" | "frames" | "tegenspraak" | "gerelateerd";

const LENS_KINDS: Record<EventLens, NodeKind[]> = {
  actoren: ["event", "outlet", "actor", "entity"],
  frames: ["event", "outlet", "frame"],
  tegenspraak: ["outlet", "contradiction", "claim", "actor", "entity", "fallacy", "statistic"],
  gerelateerd: ["event", "related", "entity", "country"],
};

const LENS_EDGES: Record<EventLens, EdgeKind[]> = {
  actoren: ["reports", "quotes", "mentions"],
  frames: ["reports", "frames"],
  tegenspraak: ["contradicts", "claims", "publishes_claim", "fallacy", "statistic"],
  gerelateerd: ["related", "involves"],
};

export interface SceneNode {
  id: string;
  kind: NodeKind | "ghost";
  label: string;
  weight: number;
  graphNode?: GraphNode;
  ghost?: { spoor: SpoorId; count: number };
}

export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  attribution?: "eigen_framing" | "geciteerd" | null;
}

export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
}

export function eventLensScene(
  graph: ExploreGraph,
  clues: Clue[],
  revealed: ReadonlySet<string>,
  lens: EventLens,
  options: { revealAll?: boolean; includeInternational?: boolean } = {},
): Scene {
  const kinds = new Set(LENS_KINDS[lens]);
  const edgeKinds = new Set(LENS_EDGES[lens]);
  const visible = visibleGraph(graph, clues, revealed, { revealAll: options.revealAll });

  const lensEdges = visible.edges.filter((edge) => edgeKinds.has(edge.kind));
  const connected = new Set<string>();
  for (const edge of lensEdges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  const nodes: SceneNode[] = visible.nodes
    .filter((node) => kinds.has(node.kind))
    // Outlets/entities only when they take part in this lens (keeps the view calm)
    .filter((node) => node.kind === "event" || connected.has(node.id) || (lens === "actoren" && node.kind === "outlet"))
    .filter((node) => options.includeInternational || node.kind !== "outlet" || !node.iso || node.iso === "NL")
    .map((node) => ({ id: node.id, kind: node.kind, label: node.label, weight: node.weight, graphNode: node }));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: SceneEdge[] = lensEdges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, label: edge.label, attribution: edge.attribution }));

  // Ghosts: hidden nodes of this lens, grouped by the spoor that reveals them
  if (!options.revealAll) {
    const clueById = new Map(clues.map((clue) => [clue.id, clue]));
    const hidden = new Map<SpoorId, number>();
    for (const node of graph.nodes) {
      if (!kinds.has(node.kind) || nodeIds.has(node.id) || node.baseline) continue;
      if (node.clueIds.some((id) => revealed.has(id))) continue;
      const spoor = node.clueIds.map((id) => clueById.get(id)?.spoor).find(Boolean);
      if (spoor) hidden.set(spoor, (hidden.get(spoor) ?? 0) + 1);
    }
    const anchor = nodes.find((node) => node.kind === "event") ?? nodes[0];
    for (const [spoor, count] of Array.from(hidden.entries())) {
      const id = `ghost:${spoor}`;
      nodes.push({
        id,
        kind: "ghost",
        label: `? ${count} verborgen · ${SPOOR_BY_ID[spoor].question}`,
        weight: 1,
        ghost: { spoor, count },
      });
      if (anchor) {
        edges.push({ id: `ghost|${anchor.id}|${id}`, source: anchor.id, target: id, kind: "involves" });
      }
    }
  }

  return { nodes, edges };
}
