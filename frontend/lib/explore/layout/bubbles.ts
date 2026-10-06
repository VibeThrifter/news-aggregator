/**
 * Invalshoekenkaart: floating speech bubbles, one per (perspective, outlet), grouped per lens.
 *
 * Pure and deterministic: positions come from a seeded d3-force simulation that is run
 * synchronously (no animation loop). The UI animates between results when the lens changes.
 */

import { forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

import { ArticleIndex } from "../input";
import { frameLabel } from "../labels";
import { perspectiveEstimates } from "../nearest";
import { lcg } from "../normalize";
import type { Finding, ExploreInput } from "../types";

export type HeroLens = "invalshoek" | "spectrum" | "frame" | "tegenspraak";

export interface Bubble {
  id: string;
  outletKey: string;
  /** Foreign outlet: only in the map when the reader adds it */
  isInternational: boolean;
  /** Not put in a perspective by the analysis; placed with the one its headlines lean to (estimate) */
  estimated: boolean;
  /** Perspective index (-1 when the event has no clusters) */
  perspectiveIndex: number;
  perspectiveFindingId: string | null;
  stance: string | null;
  articleCount: number;
  spectrum: number | null;
  isAlternative: boolean;
  /** Left-right position 0..10 (2D spectrum map) */
  x: number | null;
  /** -1 alternatief .. +1 gevestigd (2D spectrum map) */
  establishment: number | null;
  /** First own-framing frame type of this outlet */
  frameType: string | null;
  frameFindingId: string | null;
}

export interface BubbleGroup {
  key: string;
  label: string;
  findingId: string | null;
}

export interface ContradictionLine {
  findingId: string;
  topic: string;
  from: string;
  to: string;
  /** The outlets on either side (the line is drawn between one bubble of each) */
  outletsA: string[];
  outletsB: string[];
}

export interface BubbleScene {
  bubbles: Bubble[];
  /** Groups per lens */
  groupsByLens: Record<Exclude<HeroLens, "tegenspraak">, BubbleGroup[]>;
  contradictions: ContradictionLine[];
  internationalCount: number;
}

/** Build the bubbles of an event: one per (perspective, outlet), Dutch and foreign (see selectBubbles). */
export function buildBubbleScene(input: ExploreInput, findings: Finding[], index = new ArticleIndex(input)): BubbleScene {
  const perspectiveFindings = findings.filter((finding) => finding.body.type === "perspective");
  const frameFindings = findings.filter((finding) => finding.body.type === "frame");
  const outletFrame = new Map<string, { type: string; findingId: string }>();
  for (const finding of frameFindings) {
    if (finding.body.type !== "frame" || finding.body.frame.attribution === "geciteerd") continue;
    for (const key of finding.outletKeys) {
      if (!outletFrame.has(key)) outletFrame.set(key, { type: finding.body.frame.frame_type, findingId: finding.id });
    }
  }

  const bubbles: Bubble[] = [];
  const covered = new Set<string>();

  for (const finding of perspectiveFindings) {
    if (finding.body.type !== "perspective") continue;
    for (const stance of finding.body.stances) {
      const outlet = index.outlet(stance.outletKey);
      if (!outlet) continue;
      covered.add(outlet.key);
      bubbles.push({
        id: `${finding.body.index}:${outlet.key}`,
        outletKey: outlet.key,
        isInternational: outlet.isInternational,
        perspectiveIndex: finding.body.index,
        perspectiveFindingId: finding.id,
        estimated: false,
        // Shown right away; the perspective itself when the analysis gives no words for this outlet
        stance: stance.stance?.trim() || finding.body.cluster.label,
        articleCount: outlet.articleIds.length,
        spectrum: outlet.spectrum,
        isAlternative: outlet.isAlternative,
        x: outlet.x,
        establishment: outlet.establishment,
        frameType: outletFrame.get(outlet.key)?.type ?? null,
        frameFindingId: outletFrame.get(outlet.key)?.findingId ?? null,
      });
    }
  }
  // Outlets the analysis did not put in a perspective go with the one their headlines lean to; only
  // without a clear winner in the group "Nog niet ingedeeld"
  const estimates = perspectiveEstimates(input, findings, index);
  for (const outlet of input.outlets) {
    if (covered.has(outlet.key)) continue;
    const estimate = estimates.get(outlet.key);
    bubbles.push({
      id: `${estimate ? `e${estimate.index}` : "-1"}:${outlet.key}`,
      outletKey: outlet.key,
      isInternational: outlet.isInternational,
      estimated: Boolean(estimate),
      perspectiveIndex: estimate ? estimate.index : -1,
      perspectiveFindingId: null,
      stance: null,
      articleCount: outlet.articleIds.length,
      spectrum: outlet.spectrum,
      isAlternative: outlet.isAlternative,
      x: outlet.x,
      establishment: outlet.establishment,
      frameType: outletFrame.get(outlet.key)?.type ?? null,
      frameFindingId: outletFrame.get(outlet.key)?.findingId ?? null,
    });
  }

  const invalshoek: BubbleGroup[] = perspectiveFindings.map((finding) => ({
    key: `p${finding.body.type === "perspective" ? finding.body.index : 0}`,
    label: finding.body.type === "perspective" ? finding.body.cluster.label : "",
    findingId: finding.id,
  }));
  if (bubbles.some((bubble) => bubble.perspectiveIndex === -1)) {
    invalshoek.push({ key: "p-1", label: "Nog niet ingedeeld", findingId: null });
  }

  const frameGroups = new Map<string, BubbleGroup>();
  for (const bubble of bubbles) {
    const key = bubble.frameType ? `f:${bubble.frameType}` : "f:none";
    if (!frameGroups.has(key)) {
      frameGroups.set(key, {
        key,
        label: bubble.frameType ? frameLabel(bubble.frameType) : "Geen eigen frame",
        findingId: bubble.frameFindingId,
      });
    }
  }

  const contradictions: ContradictionLine[] = [];
  for (const finding of findings) {
    if (finding.body.type !== "contradiction") continue;
    const from = bubbles.find((bubble) => finding.body.type === "contradiction" && finding.body.outletsA.includes(bubble.outletKey));
    const to = bubbles.find(
      (bubble) =>
        finding.body.type === "contradiction" && finding.body.outletsB.includes(bubble.outletKey) && bubble.id !== from?.id,
    );
    if (from && to) {
      contradictions.push({
        findingId: finding.id,
        topic: finding.body.contradiction.topic,
        from: from.id,
        to: to.id,
        outletsA: finding.body.outletsA,
        outletsB: finding.body.outletsB,
      });
    }
  }

  return {
    bubbles,
    groupsByLens: {
      invalshoek,
      spectrum: [{ key: "s:main", label: "Spectrum", findingId: null }],
      frame: Array.from(frameGroups.values()),
    },
    contradictions,
    internationalCount: input.outlets.filter((outlet) => outlet.isInternational).length,
  };
}

/** Which outlets the reader put in the map: Dutch ones unless removed, foreign ones only when added. */
export interface SourceSelection {
  added: readonly string[];
  removed: readonly string[];
}

/**
 * Dutch outlets are in the picture unless left out; foreign ones only when added — except one that
 * was added to the news for a missing voice (it is there to be seen).
 */
export function isOutletShown(
  outlet: { key: string; isInternational: boolean; foundVoice?: boolean; own?: boolean },
  selection?: SourceSelection | null,
): boolean {
  // Foreign outlets are added by choice; one added for a missing voice or by the reader is in already
  return outlet.isInternational && !outlet.foundVoice && !outlet.own
    ? Boolean(selection?.added.includes(outlet.key))
    : !selection?.removed.includes(outlet.key);
}

/** The scene with only the chosen outlets: empty groups disappear, contradiction lines follow their outlets. */
export function selectBubbles(scene: BubbleScene, shown: (bubble: Bubble) => boolean): BubbleScene {
  const bubbles = scene.bubbles.filter(shown);
  const used = (lens: HeroLens) => new Set(bubbles.map((bubble) => bubbleGroupKey(bubble, lens)));
  const invalshoek = used("invalshoek");
  const frame = used("frame");
  return {
    ...scene,
    bubbles,
    groupsByLens: {
      invalshoek: scene.groupsByLens.invalshoek.filter((group) => invalshoek.has(group.key)),
      spectrum: scene.groupsByLens.spectrum,
      frame: scene.groupsByLens.frame.filter((group) => frame.has(group.key)),
    },
    contradictions: scene.contradictions.flatMap((line) => {
      const from = bubbles.find((bubble) => line.outletsA.includes(bubble.outletKey));
      const to = bubbles.find((bubble) => line.outletsB.includes(bubble.outletKey) && bubble.id !== from?.id);
      return from && to ? [{ ...line, from: from.id, to: to.id }] : [];
    }),
  };
}

export function bubbleGroupKey(bubble: Bubble, lens: HeroLens): string {
  switch (lens) {
    case "spectrum":
      return "s:main";
    case "frame":
      return bubble.frameType ? `f:${bubble.frameType}` : "f:none";
    default:
      return `p${bubble.perspectiveIndex}`;
  }
}

// --- Layout -----------------------------------------------------------------------------------

export interface BubbleBox {
  id: string;
  group: string;
  width: number;
  height: number;
  /** Optional horizontal target in [0, 1] (spectrum lens: links -> rechts) */
  xTarget?: number;
  /** Optional vertical target in [0, 1] (spectrum lens: gevestigd -> alternatief) */
  yTarget?: number;
}

export interface PlacedBubble {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedGroup {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Lines of the label (a long label wraps) */
  lines?: 1 | 2;
}

export interface BubbleLayout {
  width: number;
  height: number;
  bubbles: Map<string, PlacedBubble>;
  groups: PlacedGroup[];
}

/** With a perspective: favicon and what the outlet says (up to three lines), shown right away */
export const BUBBLE_OPEN = { width: 168, height: 64 };
/** Not put in a perspective (yet): favicon, name and "nog niet ingedeeld" */
export const BUBBLE_PLAIN = { width: 168, height: 46 };

const PAD = 6;
/** Halo around a group: this much around the bubbles on the sides and at the bottom */
const HALO_SIDE = 8;
/** The label pill straddles the halo's top edge: 12px sticks out above it (like a legend) */
const LABEL_ABOVE = 12;
/** Label pill: 11px text with tight leading, 2px padding; one or two lines */
const LABEL_LINE = 14;
const LABEL_PAD_Y = 6;
/** Between the label and the bubbles (they also float up 4px) */
const LABEL_AIR = 10;
/** The pill starts 12px in from the halo's left edge; keep 12px free on its right, plus slack for the estimate */
const LABEL_INSET = 24;
const LABEL_SLACK = 8;
/** Space between groups side by side, and between rows of groups */
const GROUP_GAP_X = 10;
const GROUP_GAP_Y = 12;
/** Groups keep this distance from the sides of the map */
const EDGE = 12;
/** Room above the bubbles of the 2D spectrum map (axis label) */
const PLOT_TOP = 26;
/** The map grows with its bubbles up to this height (2D spectrum map) */
const MAX_HEIGHT = 2000;
/** Plot margins of the 2D spectrum map (room for the axis labels) */
const PLOT_PAD_X = 44;
const PLOT_PAD_TOP = 40;
const PLOT_PAD_BOTTOM = 40;

interface SimNode extends SimulationNodeDatum {
  id: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** Horizontal position is data-driven (spectrum lens) */
  pinnedX: boolean;
  /** Vertical position is data-driven (spectrum lens) */
  pinnedY: boolean;
}

/** How much room a group's label needs: halo padding on top, and the halo's minimum width. */
export function groupLabelSpace(labelWidth: number, maxHaloWidth: number): { top: number; minWidth: number; lines: 1 | 2 } {
  const wanted = labelWidth + LABEL_INSET + LABEL_SLACK;
  const lines = wanted <= maxHaloWidth ? 1 : 2;
  return {
    top: lines * LABEL_LINE + LABEL_PAD_Y - LABEL_ABOVE + LABEL_AIR,
    minWidth: Math.min(wanted, maxHaloWidth),
    lines,
  };
}

/** Axis-aligned rectangle collision (bubbles are wider than tall). */
function rectCollide(padding: number, strength: number) {
  let nodes: SimNode[] = [];
  const force = () => {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const overlapX = (a.w + b.w) / 2 + padding - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 + padding - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX < overlapY) {
          const shift = (overlapX / 2) * strength * (dx < 0 ? -1 : 1);
          a.x = (a.x ?? 0) - shift;
          b.x = (b.x ?? 0) + shift;
        } else {
          const shift = (overlapY / 2) * strength * (dy < 0 ? -1 : 1);
          a.y = (a.y ?? 0) - shift;
          b.y = (b.y ?? 0) + shift;
        }
      }
    }
  };
  force.initialize = (initial: SimNode[]) => {
    nodes = initial;
  };
  return force;
}

function totalOverlap(nodes: SimNode[]): number {
  let overlap = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const ox = (a.w + b.w) / 2 - Math.abs((b.x ?? 0) - (a.x ?? 0));
      const oy = (a.h + b.h) / 2 - Math.abs((b.y ?? 0) - (a.y ?? 0));
      if (ox > 0 && oy > 0) overlap += Math.min(ox, oy);
    }
  }
  return overlap;
}

/** The bubbles of one group as a small floating cluster around (0, 0), at most `maxWidth` wide. */
function clusterGroup(boxes: BubbleBox[], maxWidth: number, seed: number) {
  const random = lcg(seed);
  const nodes: SimNode[] = boxes.map((box) => ({
    id: box.id,
    w: box.width,
    h: box.height,
    ax: 0,
    ay: 0,
    pinnedX: false,
    pinnedY: false,
    x: (random() - 0.5) * 30,
    y: (random() - 0.5) * 30,
  }));
  if (nodes.length > 1) {
    // Pulled harder sideways than up and down: clusters grow into narrow stacks that fit a column
    const simulation = forceSimulation<SimNode>(nodes)
      .randomSource(random)
      .force("x", forceX<SimNode>(0).strength(0.2))
      .force("y", forceY<SimNode>(0).strength(0.05))
      .force("collide", rectCollide(PAD, 0.8))
      .stop();
    for (let tick = 0; tick < 240; tick += 1) {
      simulation.tick();
      for (const node of nodes) {
        const limit = Math.max(0, maxWidth / 2 - node.w / 2);
        node.x = Math.min(Math.max(node.x ?? 0, -limit), limit);
      }
    }
  } else if (nodes.length === 1) {
    nodes[0].x = 0;
    nodes[0].y = 0;
  }
  const minX = Math.min(...nodes.map((node) => (node.x ?? 0) - node.w / 2));
  const maxX = Math.max(...nodes.map((node) => (node.x ?? 0) + node.w / 2));
  const minY = Math.min(...nodes.map((node) => (node.y ?? 0) - node.h / 2));
  const maxY = Math.max(...nodes.map((node) => (node.y ?? 0) + node.h / 2));
  return { nodes, minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Invalshoek and frame lenses: every group is a floating cluster of bubbles in a halo with its label;
 * the groups are laid out in rows, so halos and labels never overlap.
 */
function layoutGrouped(boxes: BubbleBox[], groups: string[], width: number, options: LayoutOptions): BubbleLayout {
  const columns = options.columns ?? (groups.length <= 1 ? 1 : width < 420 ? 2 : 3);
  // A label never makes a halo wider than its column: longer labels wrap to two lines
  const maxHaloWidth = Math.max(120, (width - 2 * EDGE) / Math.min(columns, Math.max(groups.length, 1)) - GROUP_GAP_X);
  const blocks = groups.map((group, index) => {
    const members = boxes.filter((box) => box.group === group);
    const room = groupLabelSpace(options.labelWidths?.[group] ?? 0, maxHaloWidth);
    const widest = Math.max(...members.map((box) => box.width));
    const cluster = clusterGroup(members, Math.min(width - 2 * EDGE - 2 * HALO_SIDE, Math.max(maxHaloWidth - 2 * HALO_SIDE, widest)), options.seed + index * 101);
    const haloWidth = Math.min(width - 2 * EDGE, Math.max(cluster.width + 2 * HALO_SIDE, room.minWidth));
    return { group, room, cluster, width: haloWidth, height: LABEL_ABOVE + room.top + cluster.height + HALO_SIDE, x: 0, y: 0 };
  });

  // Rows of groups, spread evenly across the width
  const rows: (typeof blocks)[] = [];
  for (const block of blocks) {
    const row = rows[rows.length - 1];
    const used = row ? row.reduce((sum, item) => sum + item.width, 0) + row.length * GROUP_GAP_X : 0;
    if (row && used + block.width <= width - 2 * EDGE) row.push(block);
    else rows.push([block]);
  }
  let cursor = EDGE;
  for (const row of rows) {
    const free = width - 2 * EDGE - row.reduce((sum, item) => sum + item.width, 0);
    const spacing = free / (row.length + 1);
    let x = EDGE + spacing;
    for (const block of row) {
      block.x = x;
      block.y = cursor;
      x += block.width + spacing;
    }
    cursor += Math.max(...row.map((block) => block.height)) + GROUP_GAP_Y;
  }
  const content = cursor - GROUP_GAP_Y + EDGE;
  const height = Math.max(options.minHeight ?? 220, content);
  const offsetY = (height - content) / 2;

  const bubbles = new Map<string, PlacedBubble>();
  const placedGroups: PlacedGroup[] = [];
  for (const block of blocks) {
    const haloTop = block.y + offsetY + LABEL_ABOVE;
    const left = block.x + (block.width - block.cluster.width) / 2;
    const top = haloTop + block.room.top;
    for (const node of block.cluster.nodes) {
      bubbles.set(node.id, {
        x: left + (node.x ?? 0) - block.cluster.minX,
        y: top + (node.y ?? 0) - block.cluster.minY,
        width: node.w,
        height: node.h,
      });
    }
    placedGroups.push({
      key: block.group,
      x: block.x,
      y: haloTop,
      width: block.width,
      height: block.room.top + block.cluster.height + HALO_SIDE,
      lines: block.room.lines,
    });
  }
  return { width, height, bubbles, groups: placedGroups };
}

/** 2D spectrum map: positions come from the data (links–rechts, gevestigd–alternatief); collisions resolved. */
function layoutPlotted(boxes: BubbleBox[], groups: string[], width: number, options: LayoutOptions): BubbleLayout {
  const maxHeight = options.maxHeight ?? MAX_HEIGHT;
  const area = boxes.reduce((sum, box) => sum + (box.width + PAD * 2) * (box.height + PAD * 2), 0);
  let height = Math.min(maxHeight, Math.max(options.minHeight ?? 220, (area * 1.9) / width + PLOT_TOP + 40));
  let nodes: SimNode[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const random = lcg(options.seed + attempt);
    nodes = boxes.map((box) => {
      const ax = box.xTarget !== undefined ? PLOT_PAD_X + box.xTarget * (width - 2 * PLOT_PAD_X) : width / 2;
      const ay = box.yTarget !== undefined ? PLOT_PAD_TOP + box.yTarget * (height - PLOT_PAD_TOP - PLOT_PAD_BOTTOM) : height / 2;
      return {
        id: box.id,
        w: box.width,
        h: box.height,
        ax,
        ay,
        pinnedX: box.xTarget !== undefined,
        pinnedY: box.yTarget !== undefined,
        x: ax + (random() - 0.5) * 40,
        y: ay + (random() - 0.5) * 40,
      };
    });
    const simulation = forceSimulation<SimNode>(nodes)
      .randomSource(random)
      .force("x", forceX<SimNode>((node) => node.ax).strength((node) => (node.pinnedX ? 0.6 : 0.12)))
      .force("y", forceY<SimNode>((node) => node.ay).strength((node) => (node.pinnedY ? 0.6 : 0.12)))
      .force("collide", rectCollide(PAD, 0.8))
      .stop();
    for (let tick = 0; tick < 300; tick += 1) {
      simulation.tick();
      for (const node of nodes) {
        node.x = Math.min(Math.max(node.x ?? 0, node.w / 2 + EDGE), width - node.w / 2 - EDGE);
        node.y = Math.min(Math.max(node.y ?? 0, node.h / 2 + PLOT_TOP), height - node.h / 2 - 4);
      }
    }
    if (totalOverlap(nodes) <= 2 || height >= maxHeight) break;
    height = Math.min(maxHeight, height * 1.3);
  }

  const bubbles = new Map<string, PlacedBubble>();
  for (const node of nodes) bubbles.set(node.id, { x: node.x ?? 0, y: node.y ?? 0, width: node.w, height: node.h });
  const groupOf = new Map(boxes.map((box) => [box.id, box.group]));
  const placedGroups: PlacedGroup[] = groups.map((group) => {
    const members = nodes.filter((node) => groupOf.get(node.id) === group);
    const minX = Math.min(...members.map((node) => (node.x ?? 0) - node.w / 2));
    const maxX = Math.max(...members.map((node) => (node.x ?? 0) + node.w / 2));
    const minY = Math.min(...members.map((node) => (node.y ?? 0) - node.h / 2));
    const maxY = Math.max(...members.map((node) => (node.y ?? 0) + node.h / 2));
    return { key: group, x: minX - HALO_SIDE, y: minY - HALO_SIDE, width: maxX - minX + 2 * HALO_SIDE, height: maxY - minY + 2 * HALO_SIDE };
  });
  return { width, height, bubbles, groups: placedGroups };
}

interface LayoutOptions {
  width: number;
  seed: number;
  minHeight?: number;
  maxHeight?: number;
  columns?: number;
  /** Width of each group's label on one line: halos get room for it (wrapping to two lines when needed) */
  labelWidths?: Record<string, number>;
}

/**
 * Place bubbles inside a container of the given width. Height grows with the content.
 * Deterministic for the same input and seed.
 */
export function layoutBubbles(boxes: BubbleBox[], groupOrder: string[], options: LayoutOptions): BubbleLayout {
  const width = Math.max(200, options.width);
  const groups = groupOrder.filter((group) => boxes.some((box) => box.group === group));
  const plotted = boxes.some((box) => box.xTarget !== undefined || box.yTarget !== undefined);
  return plotted ? layoutPlotted(boxes, groups, width, options) : layoutGrouped(boxes, groups, width, options);
}

/** Convenience: boxes for a lens (bubbles with a perspective are larger: they show it). */
export function bubbleBoxes(scene: BubbleScene, lens: HeroLens): BubbleBox[] {
  return scene.bubbles.map((bubble) => {
    const size = bubble.perspectiveFindingId ? BUBBLE_OPEN : BUBBLE_PLAIN;
    const box: BubbleBox = { id: bubble.id, group: bubbleGroupKey(bubble, lens), width: size.width, height: size.height };
    if (lens === "spectrum") {
      // 2D map: links (0) -> rechts (10) and gevestigd (+1, top) -> alternatief (-1, bottom)
      box.xTarget = bubble.x !== null ? bubble.x / 10 : 0.5;
      box.yTarget = bubble.establishment !== null ? (1 - bubble.establishment) / 2 : 0.5;
    }
    return box;
  });
}
