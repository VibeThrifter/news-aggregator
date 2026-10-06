"use client";

import { memo, useMemo } from "react";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getStraightPath,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { DossierEdge, DossierItem } from "@/lib/explore/store";
import type { Suggestion } from "@/lib/explore/suggestions";

import { Favicon } from "../ui/primitives";

const KIND_COLORS: Record<DossierItem["kind"], string> = {
  outlet: "#1F75CE",
  actor: "#b7791f",
  entity: "#0f766e",
  finding: "#7c3aed",
  event: "#1a1a1a",
  pm: "#e74c3c",
  note: "#f59e0b",
  bias: "#9b59b6",
  country: "#0369a1",
};

const KIND_LABELS: Record<DossierItem["kind"], string> = {
  outlet: "Bron",
  actor: "Actor",
  entity: "Entiteit",
  finding: "Bevinding",
  event: "Event",
  pm: "Propagandamodel",
  note: "Notitie",
  bias: "Bias",
  country: "Land",
};

interface CardData extends Record<string, unknown> {
  item: DossierItem;
  selected: boolean;
}

const handleStyle = { width: 22, height: 22, borderRadius: 999, background: "#ffffff", border: "2px solid #94a3b8" };

const CardNode = memo(function CardNode({ data }: NodeProps<Node<CardData>>) {
  const { item, selected } = data;
  const color = KIND_COLORS[item.kind];
  return (
    <div
      className={`w-[220px] rounded-2xl border border-paper-300 bg-white p-3 shadow-card ${selected ? "ring-4" : ""}`}
      style={selected ? { ["--tw-ring-color" as string]: `${color}44` } : undefined}
    >
      <Handle type="target" position={Position.Top} style={{ ...handleStyle, top: -11 }} />
      <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
        {item.outletKey ? <Favicon name={item.title} size={14} /> : <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
        {KIND_LABELS[item.kind]}
      </div>
      <p className="mt-1 line-clamp-3 text-sm font-semibold leading-snug text-ink-900">{item.title}</p>
      {item.subtitle ? <p className="mt-0.5 line-clamp-1 text-xs text-ink-500">{item.subtitle}</p> : null}
      {item.eventTitle ? <p className="mt-1.5 line-clamp-1 text-[11px] italic text-ink-400">↳ {item.eventTitle}</p> : null}
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle, bottom: -11 }} />
    </div>
  );
});

interface StringEdgeData extends Record<string, unknown> {
  label?: string;
  suggestion?: boolean;
}

function StringEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<StringEdgeData>>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const suggestion = Boolean(data?.suggestion);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={28}
        style={{ stroke: suggestion ? "#FF6600" : "#b91c1c", strokeWidth: suggestion ? 2 : 2.5, strokeDasharray: suggestion ? "7 6" : undefined }}
      />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-none absolute rounded-full px-2 py-0.5 text-[10px] font-semibold ${suggestion ? "bg-orange-50 text-orange-700" : "bg-red-50 text-red-800"}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { card: CardNode };
const edgeTypes = { string: StringEdge };

export function BoardCanvas({
  items,
  positions,
  edges,
  suggestions,
  selectedId,
  onSelect,
  onMove,
  onConnect,
  onEdgeTap,
}: {
  items: DossierItem[];
  positions: Map<string, { x: number; y: number }>;
  edges: DossierEdge[];
  suggestions: Suggestion[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onConnect: (source: string, target: string) => void;
  onEdgeTap: (edgeId: string) => void;
}) {
  const nodes = useMemo<Node<CardData>[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        type: "card",
        position: item.position ?? positions.get(item.id) ?? { x: 0, y: 0 },
        data: { item, selected: item.id === selectedId },
      })),
    [items, positions, selectedId],
  );
  const flowEdges = useMemo<Edge<StringEdgeData>[]>(
    () => [
      ...edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: "string", data: { label: edge.label } })),
      ...suggestions.map((suggestion) => ({
        id: `suggestion:${suggestion.key}`,
        source: suggestion.source,
        target: suggestion.target,
        type: "string",
        data: { label: suggestion.label, suggestion: true },
      })),
    ],
    [edges, suggestions],
  );

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_, node) => onMove(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })}
        onConnect={(connection: Connection) => {
          if (connection.source && connection.target) onConnect(connection.source, connection.target);
        }}
        onEdgeClick={(_, edge) => onEdgeTap(edge.id)}
        connectOnClick
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.8}
        zoomOnDoubleClick={false}
      >
        <Background gap={24} color="#e2e8f0" />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

export default BoardCanvas;
