/**
 * Fog-of-war: which graph nodes and edges are visible given the revealed clues.
 */

import type { Clue, ExploreGraph, GraphEdge, GraphNode, SpoorId } from "./types";

export interface VisibleGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Hidden nodes adjacent to a visible node, counted per spoor that can reveal them */
  hiddenBySpoor: Map<SpoorId, number>;
  hiddenCount: number;
}

export function isNodeVisible(node: GraphNode, revealed: ReadonlySet<string>, revealAll = false): boolean {
  return revealAll || node.baseline || node.clueIds.some((id) => revealed.has(id));
}

export function visibleGraph(
  graph: ExploreGraph,
  clues: Clue[],
  revealed: ReadonlySet<string>,
  options: { revealAll?: boolean } = {},
): VisibleGraph {
  const revealAll = Boolean(options.revealAll);
  const visibleIds = new Set(
    graph.nodes.filter((node) => isNodeVisible(node, revealed, revealAll)).map((node) => node.id),
  );
  const edges = graph.edges.filter(
    (edge) =>
      visibleIds.has(edge.source) &&
      visibleIds.has(edge.target) &&
      (revealAll || edge.clueIds.length === 0 || edge.clueIds.some((id) => revealed.has(id))),
  );

  const clueById = new Map(clues.map((clue) => [clue.id, clue]));
  const hiddenBySpoor = new Map<SpoorId, number>();
  let hiddenCount = 0;
  if (!revealAll) {
    const adjacentToVisible = new Set<string>();
    for (const edge of graph.edges) {
      if (visibleIds.has(edge.source) && !visibleIds.has(edge.target)) adjacentToVisible.add(edge.target);
      if (visibleIds.has(edge.target) && !visibleIds.has(edge.source)) adjacentToVisible.add(edge.source);
    }
    for (const node of graph.nodes) {
      if (visibleIds.has(node.id) || !adjacentToVisible.has(node.id)) continue;
      hiddenCount += 1;
      const spoor = node.clueIds.map((id) => clueById.get(id)?.spoor).find(Boolean);
      if (spoor) hiddenBySpoor.set(spoor, (hiddenBySpoor.get(spoor) ?? 0) + 1);
    }
  }

  return {
    nodes: graph.nodes.filter((node) => visibleIds.has(node.id)),
    edges,
    hiddenBySpoor,
    hiddenCount,
  };
}

/** Progress per spoor: revealed / total. */
export function spoorProgress(clues: Clue[], revealed: ReadonlySet<string>): Map<SpoorId, { revealed: number; total: number }> {
  const progress = new Map<SpoorId, { revealed: number; total: number }>();
  for (const clue of clues) {
    const entry = progress.get(clue.spoor) ?? { revealed: 0, total: 0 };
    entry.total += 1;
    if (revealed.has(clue.id)) entry.revealed += 1;
    progress.set(clue.spoor, entry);
  }
  return progress;
}
