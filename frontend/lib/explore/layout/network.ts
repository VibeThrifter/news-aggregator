/**
 * Force layout for the network view (event lenses and the propaganda-model explorer).
 * Pure and deterministic; incremental: existing nodes keep their previous positions as a start
 * (and optionally stay pinned), new nodes start next to the node they were expanded from.
 */

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import { lcg } from "../normalize";

export interface NetNode {
  id: string;
  /** Relative size (degree, articles, ...) */
  weight?: number;
  /** Node it was expanded from (new nodes start near it) */
  parent?: string;
  /** Fixed position (e.g. the event in the centre) */
  pin?: { x: number; y: number };
  /** Optional attraction point */
  anchor?: { x: number; y: number; strength?: number };
}

export interface NetEdge {
  source: string;
  target: string;
  /** Preferred length */
  distance?: number;
}

export type Positions = Map<string, { x: number; y: number }>;

interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
  anchor?: NetNode["anchor"];
}

export function nodeRadius(weight = 1): number {
  return Math.min(46, 18 + Math.sqrt(Math.max(weight, 0)) * 5);
}

export function layoutNetwork(
  nodes: NetNode[],
  edges: NetEdge[],
  options: { seed: number; previous?: Positions; keepPrevious?: boolean; ticks?: number } = { seed: 1 },
): Positions {
  const random = lcg(options.seed);
  const previous = options.previous ?? new Map();
  const ids = new Set(nodes.map((node) => node.id));

  const simNodes: SimNode[] = nodes.map((node, i) => {
    const prior = previous.get(node.id);
    const parent = node.parent ? previous.get(node.parent) : undefined;
    const angle = random() * Math.PI * 2;
    const start = node.pin
      ? node.pin
      : prior
        ? prior
        : parent
          ? { x: parent.x + Math.cos(angle) * 90, y: parent.y + Math.sin(angle) * 90 }
          : { x: Math.cos((i / Math.max(nodes.length, 1)) * Math.PI * 2) * 160, y: Math.sin((i / Math.max(nodes.length, 1)) * Math.PI * 2) * 160 };
    const simNode: SimNode = { id: node.id, r: nodeRadius(node.weight), x: start.x, y: start.y, anchor: node.anchor };
    if (node.pin) {
      simNode.fx = node.pin.x;
      simNode.fy = node.pin.y;
    } else if (prior && options.keepPrevious) {
      simNode.fx = prior.x;
      simNode.fy = prior.y;
    }
    return simNode;
  });

  const links: SimulationLinkDatum<SimNode>[] & { distance?: number }[] = edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target)
    .map((edge) => ({ source: edge.source, target: edge.target, distance: edge.distance }));

  const simulation = forceSimulation<SimNode>(simNodes)
    .randomSource(random)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode> & { distance?: number }>(links)
        .id((node) => node.id)
        .distance((link) => link.distance ?? 110)
        .strength(0.35),
    )
    .force("charge", forceManyBody<SimNode>().strength(-260).distanceMax(520))
    .force("collide", forceCollide<SimNode>((node) => node.r + 14).iterations(2))
    .force("x", forceX<SimNode>((node) => node.anchor?.x ?? 0).strength((node) => node.anchor?.strength ?? 0.03))
    .force("y", forceY<SimNode>((node) => node.anchor?.y ?? 0).strength((node) => node.anchor?.strength ?? 0.03))
    .stop();

  const ticks = options.ticks ?? (previous.size ? 160 : 300);
  for (let i = 0; i < ticks; i += 1) {
    simulation.tick();
  }

  const positions: Positions = new Map();
  for (const node of simNodes) {
    positions.set(node.id, { x: Math.round(node.x ?? 0), y: Math.round(node.y ?? 0) });
  }
  return positions;
}
