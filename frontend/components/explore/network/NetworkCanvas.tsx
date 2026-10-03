"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FloatingArrow, FloatingPortal, arrow, autoUpdate, flip, hide, offset, shift, size, useDismiss, useFloating, useInteractions } from "@floating-ui/react";

import { useFinePointer } from "@/lib/explore/hooks";

import { Favicon } from "../ui/primitives";
import { usePortalRoot } from "../ui/portal-root";

export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  size: number;
  color: string;
  /** Favicon (outlets) */
  favicon?: { name: string; domain?: string | null };
  /** Short text inside the circle when there is no favicon */
  glyph?: string;
  ghost?: boolean;
  /** A proposal: see-through until you tap it */
  pending?: boolean;
  /** Dashed outline (a name that is not in the model) */
  dashed?: boolean;
  selected?: boolean;
  ring?: string;
}

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  data: CanvasNodeData;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  color: string;
  dashed?: boolean;
  width?: number;
  /** Direction arrow: at the target, at both ends, or none (undirected) */
  arrow?: "end" | "both" | null;
  /** Leads to a proposal: see-through like it */
  faded?: boolean;
}

const LABEL_WIDTH = 116;

const centerHandle = (size: number) => ({
  left: "50%",
  top: size / 2,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  opacity: 0,
  border: 0,
  transform: "translate(-50%, -50%)",
  pointerEvents: "none" as const,
});

const BubbleNode = memo(function BubbleNode({ data }: NodeProps<Node<CanvasNodeData>>) {
  const { size, color } = data;
  return (
    <div
      className="flex flex-col items-center transition-opacity duration-200"
      style={{ width: LABEL_WIDTH, opacity: data.pending ? 0.35 : 1 }}
      data-pending={data.pending ? "true" : undefined}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={centerHandle(size)} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={centerHandle(size)} />
      <div
        className={`flex items-center justify-center rounded-full bg-white shadow-bubble transition-transform ${data.selected ? "scale-110" : ""}`}
        style={{
          width: size,
          height: size,
          border: `${data.ghost || data.dashed ? 2 : 3}px ${data.ghost || data.dashed ? "dashed" : "solid"} ${color}`,
          boxShadow: data.selected ? `0 0 0 4px ${color}44` : data.ring ? `0 0 0 3px ${data.ring}` : undefined,
        }}
      >
        {data.favicon ? (
          <Favicon name={data.favicon.name} domain={data.favicon.domain} size={Math.round(size * 0.5)} />
        ) : (
          <span className="px-1 text-center text-[11px] font-bold leading-none" style={{ color }}>
            {data.glyph ?? "?"}
          </span>
        )}
      </div>
      <span
        className={`mt-1 line-clamp-2 rounded bg-paper-50/85 px-1 text-center text-[11px] font-semibold leading-tight ${data.ghost ? "italic text-ink-500" : "text-ink-800"}`}
      >
        {data.label}
      </span>
    </div>
  );
});

const nodeTypes = { bubble: BubbleNode };

type ArrowEdgeData = { sourceRadius: number; targetRadius: number };

/**
 * Straight line between two circle centres, clipped at the circle borders so an arrowhead at the
 * end stays visible instead of disappearing under the node.
 */
function ArrowEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd, markerStart, interactionWidth }: EdgeProps<Edge<ArrowEdgeData>>) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const start = Math.min(data?.sourceRadius ?? 0, length / 3);
  const end = Math.min(data?.targetRadius ?? 0, length / 3);
  const path = `M ${sourceX + ux * start},${sourceY + uy * start} L ${targetX - ux * end},${targetY - uy * end}`;
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} markerStart={markerStart} interactionWidth={interactionWidth} />;
}

const edgeTypes = { arrow: ArrowEdge };

const arrowMarker = (color: string) => ({ type: MarkerType.ArrowClosed, color, width: 14, height: 14, markerUnits: "userSpaceOnUse" });

/** Point in flow coordinates with a radius (node circle) the tooltip keeps clear of. */
interface Anchor {
  x: number;
  y: number;
  radius: number;
}

/**
 * Tooltip balloon pinned to a point in the graph: follows pan and zoom, flips to stay on screen and
 * hides when its anchor scrolls out of the canvas.
 */
function CanvasTip({
  anchor,
  label,
  interactive,
  onClose,
  width = 300,
  insetTop = 0,
  children,
}: {
  anchor: Anchor;
  label: string;
  interactive: boolean;
  onClose?: () => void;
  width?: number;
  /** Space at the top of the canvas the tooltip must keep free (overlays) */
  insetTop?: number;
  children: ReactNode;
}) {
  const transform = useStore((state) => state.transform);
  const domNode = useStore((state) => state.domNode);
  const portalRoot = usePortalRoot();
  const arrowRef = useRef<SVGSVGElement | null>(null);

  const { refs, floatingStyles, context, middlewareData } = useFloating({
    open: true,
    onOpenChange: (open) => (!open ? onClose?.() : undefined),
    placement: "top",
    whileElementsMounted: autoUpdate,
    // Stay inside the canvas: never over the header or the explored path
    middleware: [
      offset(10),
      flip({ padding: { top: 8 + insetTop, right: 8, bottom: 8, left: 8 }, boundary: domNode ?? undefined }),
      shift({ padding: { top: 8 + insetTop, right: 8, bottom: 8, left: 8 }, boundary: domNode ?? undefined }),
      size({
        padding: { top: 8 + insetTop, right: 8, bottom: 8, left: 8 },
        boundary: domNode ?? undefined,
        apply({ availableHeight, availableWidth, elements }) {
          elements.floating.style.maxHeight = `${Math.max(140, Math.min(availableHeight, 420))}px`;
          elements.floating.style.maxWidth = `${Math.min(width, availableWidth)}px`;
        },
      }),
      arrow({ element: arrowRef }),
      hide({ strategy: "referenceHidden", boundary: domNode ?? undefined }),
    ],
  });
  const { getFloatingProps } = useInteractions([useDismiss(context, { outsidePress: false, enabled: interactive })]);

  useLayoutEffect(() => {
    if (!domNode) return;
    const [tx, ty, zoom] = transform;
    refs.setPositionReference({
      contextElement: domNode,
      getBoundingClientRect() {
        const rect = domNode.getBoundingClientRect();
        const x = rect.left + tx + anchor.x * zoom;
        const y = rect.top + ty + anchor.y * zoom;
        const r = anchor.radius * zoom;
        return { x: x - r, y: y - r, left: x - r, top: y - r, right: x + r, bottom: y + r, width: 2 * r, height: 2 * r };
      },
    });
  }, [domNode, transform, anchor, refs]);

  return (
    <FloatingPortal root={portalRoot}>
      <div
        ref={refs.setFloating}
        role={interactive ? "dialog" : "tooltip"}
        aria-label={label}
        data-explore
        style={{ ...floatingStyles, width, visibility: middlewareData.hide?.referenceHidden ? "hidden" : "visible" }}
        className={`z-balloon outline-none ${interactive ? "" : "pointer-events-none"}`}
        {...getFloatingProps()}
      >
        <div className="max-h-[inherit] overflow-y-auto overscroll-contain rounded-2xl border border-paper-300 bg-paper-50 p-3 text-sm text-ink-700 shadow-balloon">
          {children}
        </div>
        <FloatingArrow ref={arrowRef} context={context} fill="#ffffff" stroke="#eeeeee" strokeWidth={1} width={16} height={8} />
      </div>
    </FloatingPortal>
  );
}

function FitOnChange({
  signature,
  focus,
  fitIds,
  center,
  nodes,
}: {
  signature: string;
  focus?: { x: number; y: number } | null;
  fitIds?: string[] | null;
  center?: { id: string; nonce: number } | null;
  nodes: CanvasNode[];
}) {
  const flow = useReactFlow();
  const fitKey = fitIds?.join("|") ?? "";
  const shown = useRef<Set<string> | null>(null);
  useEffect(() => {
    const before = shown.current;
    const ids = new Set(signature ? signature.split("|") : []);
    shown.current = ids;
    // Taking nodes away (proposals you did not keep, a node you removed) leaves the view where it is
    if (before && ids.size < before.size && Array.from(ids).every((id) => before.has(id))) return;
    const timer = window.setTimeout(() => {
      if (fitIds && fitIds.length > 1) {
        flow.fitView({ nodes: fitIds.map((id) => ({ id })), padding: 0.22, duration: 350, maxZoom: 1.3 });
      } else if (focus) {
        flow.setCenter(focus.x, focus.y, { zoom: 1.1, duration: 300 });
      } else {
        flow.fitView({ padding: 0.18, duration: 300, maxZoom: 1.2 });
      }
    }, 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, fitKey]);
  useEffect(() => {
    if (!center) return;
    const node = nodes.find((candidate) => candidate.id === center.id);
    if (node) flow.setCenter(node.x, node.y, { zoom: Math.max(flow.getZoom(), 0.9), duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.nonce]);
  return null;
}

interface EdgeTip {
  id: string;
  anchor: Anchor;
  pinned: boolean;
}

export function NetworkCanvas({
  nodes,
  edges,
  onSelect,
  selectedId = null,
  focusId,
  fitIds,
  center,
  renderNodeTip,
  renderEdgeTip,
  tipInsetTop = 0,
  interactive = true,
}: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  onSelect: (id: string | null) => void;
  selectedId?: string | null;
  focusId?: string | null;
  /** Fit these nodes into view whenever they change (explored neighbours) */
  fitIds?: string[] | null;
  /** Pan to a node (bump the nonce to repeat) */
  center?: { id: string; nonce: number } | null;
  /** Tooltip for the selected node: [accessible label, content] */
  renderNodeTip?: (id: string, close: () => void) => [string, ReactNode] | null;
  /** Tooltip for a hovered (preview) or tapped (pinned) edge */
  renderEdgeTip?: (id: string, pinned: boolean, close: () => void) => [string, ReactNode] | null;
  tipInsetTop?: number;
  interactive?: boolean;
}) {
  const finePointer = useFinePointer();
  const [edgeTip, setEdgeTip] = useState<EdgeTip | null>(null);

  // A node tooltip replaces an edge tooltip and vice versa
  useEffect(() => {
    if (selectedId) setEdgeTip(null);
  }, [selectedId]);
  // Edges can disappear (filters, lens): drop a tooltip that points at nothing
  useEffect(() => {
    setEdgeTip((tip) => (tip && edges.some((edge) => edge.id === tip.id) ? tip : null));
  }, [edges]);

  const activeEdge = edgeTip?.id ?? null;
  const hasEdgeTips = Boolean(renderEdgeTip);
  const flowNodes = useMemo<Node<CanvasNodeData>[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "bubble",
        position: { x: node.x - LABEL_WIDTH / 2, y: node.y - node.data.size / 2 },
        data: node.data,
        draggable: false,
        connectable: false,
        selectable: true,
        style: { transition: "transform 380ms ease" },
      })),
    [nodes],
  );
  const flowEdges = useMemo<Edge<ArrowEdgeData>[]>(() => {
    // Circle radius incl. border and a little air, so arrowheads touch the rim
    const radius = new Map(nodes.map((node) => [node.id, node.data.size / 2 + 4]));
    return edges.map((edge) => {
        const active = edge.id === activeEdge;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "arrow",
          data: { sourceRadius: radius.get(edge.source) ?? 0, targetRadius: radius.get(edge.target) ?? 0 },
          markerEnd: edge.arrow ? arrowMarker(edge.color) : undefined,
          markerStart: edge.arrow === "both" ? arrowMarker(edge.color) : undefined,
          focusable: false,
          selectable: false,
          interactionWidth: 22,
          zIndex: active ? 1 : 0,
          style: {
            stroke: edge.color,
            strokeWidth: (edge.width ?? 2) + (active ? 2 : 0),
            strokeDasharray: edge.dashed ? "6 5" : undefined,
            opacity: active ? 1 : edge.faded ? 0.25 : 0.85,
            transition: "opacity 200ms",
            cursor: hasEdgeTips ? "pointer" : undefined,
          },
        };
      });
  }, [nodes, edges, activeEdge, hasEdgeTips]);
  const signature = useMemo(() => nodes.map((node) => node.id).sort().join("|"), [nodes]);
  const focus = focusId ? nodes.find((node) => node.id === focusId) : null;
  const selectedNode = selectedId ? nodes.find((node) => node.id === selectedId) : null;
  const nodeTip = selectedNode && renderNodeTip ? renderNodeTip(selectedNode.id, () => onSelect(null)) : null;
  const edgeTipContent = edgeTip && renderEdgeTip ? renderEdgeTip(edgeTip.id, edgeTip.pinned, () => setEdgeTip(null)) : null;

  return (
    <ReactFlowProvider>
      <div className="h-full w-full" style={{ overscrollBehavior: "contain" }}>
        <FlowInner
          flowNodes={flowNodes}
          flowEdges={flowEdges}
          interactive={interactive}
          onSelect={onSelect}
          finePointer={finePointer}
          hasEdgeTips={hasEdgeTips}
          edgeTip={edgeTip}
          setEdgeTip={setEdgeTip}
        >
          <FitOnChange signature={signature} focus={focus ? { x: focus.x, y: focus.y } : null} fitIds={fitIds} center={center} nodes={nodes} />
          {selectedNode && nodeTip ? (
            <CanvasTip
              key={`node:${selectedNode.id}`}
              anchor={{ x: selectedNode.x, y: selectedNode.y, radius: selectedNode.data.size / 2 + 4 }}
              label={nodeTip[0]}
              interactive
              onClose={() => onSelect(null)}
              width={320}
              insetTop={tipInsetTop}
            >
              {nodeTip[1]}
            </CanvasTip>
          ) : null}
          {edgeTip && edgeTipContent && !selectedNode ? (
            <CanvasTip
              key={`edge:${edgeTip.id}:${edgeTip.pinned}`}
              anchor={edgeTip.anchor}
              label={edgeTipContent[0]}
              interactive={edgeTip.pinned}
              onClose={() => setEdgeTip(null)}
              width={edgeTip.pinned ? 290 : 250}
              insetTop={tipInsetTop}
            >
              {edgeTipContent[1]}
            </CanvasTip>
          ) : null}
        </FlowInner>
      </div>
    </ReactFlowProvider>
  );
}

function FlowInner({
  flowNodes,
  flowEdges,
  interactive,
  onSelect,
  finePointer,
  hasEdgeTips,
  edgeTip,
  setEdgeTip,
  children,
}: {
  flowNodes: Node<CanvasNodeData>[];
  flowEdges: Edge<ArrowEdgeData>[];
  interactive: boolean;
  onSelect: (id: string | null) => void;
  finePointer: boolean;
  hasEdgeTips: boolean;
  edgeTip: EdgeTip | null;
  setEdgeTip: (tip: EdgeTip | null | ((tip: EdgeTip | null) => EdgeTip | null)) => void;
  children: ReactNode;
}) {
  const flow = useReactFlow();
  const at = (event: React.MouseEvent): Anchor => ({ ...flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), radius: 4 });
  const hover = hasEdgeTips && finePointer;

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => {
        onSelect(null);
        setEdgeTip(null);
      }}
      onEdgeClick={
        hasEdgeTips
          ? (event, edge) => {
              onSelect(null);
              setEdgeTip({ id: edge.id, anchor: at(event), pinned: true });
            }
          : undefined
      }
      onEdgeMouseEnter={hover ? (event, edge) => setEdgeTip((tip) => (tip?.pinned ? tip : { id: edge.id, anchor: at(event), pinned: false })) : undefined}
      onEdgeMouseMove={
        hover
          ? (event, edge) => setEdgeTip((tip) => (tip?.pinned || (tip && tip.id !== edge.id) ? tip : { id: edge.id, anchor: at(event), pinned: false }))
          : undefined
      }
      onEdgeMouseLeave={hover ? () => setEdgeTip((tip) => (tip?.pinned ? tip : null)) : undefined}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={interactive}
      zoomOnDoubleClick={false}
      minZoom={0.25}
      maxZoom={2.2}
      proOptions={{ hideAttribution: false }}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.2 }}
    >
      {children}
    </ReactFlow>
  );
}

export default NetworkCanvas;
