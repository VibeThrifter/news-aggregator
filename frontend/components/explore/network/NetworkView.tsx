"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Check, ChevronDown, Info, Loader2, Pin, Plus, Redo2, Search, SlidersHorizontal, Undo2, X } from "lucide-react";

import { pmSearch } from "@/lib/api";
import { revealedTitle } from "@/lib/explore/clues";
import { nameAliases } from "@/lib/explore/coverage";
import {
  FILTERS,
  filterColor,
  filterLabel,
  frameLabel,
  pmRelationLabel,
  pmRelationReverseLabel,
  pmTypeFamily,
  pmTypeLabel,
} from "@/lib/explore/labels";
import { layoutNetwork, type Positions } from "@/lib/explore/layout/network";
import { eventLensScene, type EventLens, type SceneEdge, type SceneNode } from "@/lib/explore/network-scene";
import {
  ALL_FILTER_KEYS,
  bundleNodeId,
  byProminence,
  countBreakdown,
  displayFilter,
  hoodKey,
  isHistoric,
  isRelationVisible,
  otherEnd,
  pickHood,
  pmNodeId,
  pmScene,
  PM_EVENT_NODE,
  PM_OTHER,
  prominenceOf,
  relationFilterKeys,
  relationFilters,
  relationsOf,
  type PmBundle,
  type PmSceneNode,
} from "@/lib/explore/pm-graph";
import { usePmStore } from "@/lib/explore/pm-store";
import { useExploreStore, type NetworkLens } from "@/lib/explore/store";
import type { PmEntity, PmRelation } from "@/lib/types";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { SPOOR_COLORS, dossierIds, useExplore } from "../ExploreContext";
import { OutletCard } from "../outlet/OutletCard";
import { Chip, Eyebrow, Tag } from "../ui/primitives";
import type { CanvasEdge, CanvasNode } from "./NetworkCanvas";
import { CoverageTeaser } from "../entity/ArticleMentions";
import { WikiDescription } from "../entity/Wikipedia";
import { AutoApprovedTag } from "./MiniEgoNetwork";
import { PmAttribution } from "./PmSection";
import { bundleHoodKey, usePmExplorer } from "./usePmExplorer";

const NetworkCanvas = dynamic(() => import("./NetworkCanvas"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-ink-500">Netwerk laden…</div>,
});

const LENSES: { id: NetworkLens; label: string }[] = [
  { id: "propaganda", label: "Propagandamodel" },
  { id: "actoren", label: "Actoren" },
  { id: "frames", label: "Frames" },
  { id: "tegenspraak", label: "Tegenspraak" },
  { id: "gerelateerd", label: "Gerelateerd" },
];

const KIND_STYLE: Record<string, { color: string; glyph: string }> = {
  event: { color: "#1a1a1a", glyph: "★" },
  outlet: { color: "#1F75CE", glyph: "" },
  actor: { color: "#b7791f", glyph: "A" },
  entity: { color: "#0f766e", glyph: "E" },
  frame: { color: "#7c3aed", glyph: "F" },
  contradiction: { color: "#E30613", glyph: "⚡" },
  claim: { color: "#E30613", glyph: "!" },
  fallacy: { color: "#f59e0b", glyph: "↯" },
  statistic: { color: "#f59e0b", glyph: "%" },
  gap: { color: "#0f766e", glyph: "∅" },
  country: { color: "#0369a1", glyph: "🌍" },
  related: { color: "#475569", glyph: "↗" },
  ghost: { color: "#94a3b8", glyph: "?" },
};

const EDGE_COLORS: Record<string, string> = {
  contradicts: "#E30613",
  frames: "#7c3aed",
  quotes: "#1F75CE",
  mentions: "#94a3b8",
  claims: "#f87171",
  publishes_claim: "#f87171",
  related: "#475569",
  involves: "#0f766e",
  reports: "#cbd5e1",
  fallacy: "#f59e0b",
  statistic: "#f59e0b",
};

/** Event-lens edges whose direction means something (outlet → what it quotes, claims, frames) */
const DIRECTED_KINDS = new Set(["perspective", "quotes", "frames", "claims", "publishes_claim", "fallacy", "statistic"]);

/** How an edge of an event lens reads: "source … target" */
const EDGE_LABELS: Record<string, string> = {
  perspective: "brengt de invalshoek",
  contradicts: "spreekt tegen",
  frames: "gebruikt het frame",
  quotes: "citeert",
  mentions: "noemt",
  claims: "beweert",
  publishes_claim: "publiceert de bewering",
  related: "hangt samen met",
  involves: "betreft",
  reports: "bericht over",
  fallacy: "bevat de drogreden",
  statistic: "gebruikt de statistiek",
};

function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function nodeSize(weight: number): number {
  return Math.round(Math.min(64, 34 + Math.sqrt(Math.max(weight, 0)) * 5));
}

/** A bundle grows a little with what is in it */
function bundleSize(count: number): number {
  return Math.round(38 + Math.min(14, Math.sqrt(count) * 2));
}

/** Short name for sentences: "HCSS (The Hague Centre for Strategic Studies)" → "HCSS" */
function shortName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*/g, " ").trim() || name;
}

function period(relation: Pick<PmRelation, "active_from" | "active_until">): string {
  if (!relation.active_from && !relation.active_until) return "";
  return `${relation.active_from ?? "?"}–${relation.active_until ?? "nu"}`;
}

type Pmx = ReturnType<typeof usePmExplorer>;

export function NetworkView() {
  const { exploration, revealed, revealAll } = useExplore();
  const { input, graph, clues, index } = exploration;
  const params = useSearchParams();
  const lens = useExploreStore((state) => state.prefs.networkLens);
  const setPref = useExploreStore((state) => state.setPref);
  const selected = usePmStore((state) => state.selected);
  const select = usePmStore((state) => state.select);
  const positionsRef = useRef<Record<string, Positions>>({});
  const [center, setCenter] = useState<{ id: string; nonce: number } | null>(null);

  // Lens and focus from the URL (e.g. links from balloons)
  const focusParam = params?.get("focus") ?? null;
  useEffect(() => {
    const fromUrl = params?.get("lens") as NetworkLens | null;
    if (fromUrl && LENSES.some((item) => item.id === fromUrl)) setPref("networkLens", fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const focusPmId = focusParam?.startsWith("pm:") ? Number(focusParam.slice(3)) || null : null;

  const pmx = usePmExplorer(exploration, focusPmId);

  // --- Build the scene for the current lens ---
  const scene = useMemo(() => {
    if (lens === "propaganda") {
      const pm = pmScene(pmx.merged, pmx.seeds, pmx.expanded, {
        hiddenFilters: pmx.hiddenFilters,
        expandedFilters: pmx.expandedFilters,
        revealed: pmx.revealed,
        eventLabel: "Dit nieuws",
        latest: pmx.latest,
      });
      const outletBySeed = new Map(pmx.seeds.filter((seed) => seed.outletKey).map((seed) => [pmNodeId(seed.id), seed.outletKey as string]));
      const parentOf = (node: PmSceneNode): string | undefined => {
        if (node.bundle) return pmNodeId(node.bundle.anchorId);
        if (node.pmId === null) return undefined;
        for (const edge of pm.edges) {
          if (edge.target === node.id && pmx.expanded.has(Number(edge.source.slice(3)))) return edge.source;
          if (edge.source === node.id && pmx.expanded.has(Number(edge.target.slice(3)))) return edge.target;
        }
        return undefined;
      };
      return {
        labels: new Map(
          pm.nodes.map((node) => [node.id, node.bundle ? `Nog ${node.bundle.count} via ${filterLabel(node.bundle.filter)}` : node.label]),
        ),
        eventEdges: null,
        bundles: pm.bundles,
        // After an expansion the view glides to that node, its new neighbours and bundles
        fitIds: pmx.latest ? pm.latestIds : null,
        nodes: pm.nodes.map((node) => {
          if (node.bundle) {
            return {
              id: node.id,
              weight: 1,
              parent: parentOf(node),
              pin: undefined,
              data: {
                label: filterLabel(node.bundle.filter),
                size: bundleSize(node.bundle.count),
                color: filterColor(node.filter),
                glyph: `+${node.bundle.count}`,
                ghost: true,
              },
            };
          }
          const outletKey = outletBySeed.get(node.id);
          const outlet = outletKey ? index.outlet(outletKey) : null;
          return {
            id: node.id,
            weight: node.weight,
            parent: parentOf(node),
            pin: node.isEvent ? { x: 0, y: 0 } : undefined,
            data: {
              label: node.label,
              size: nodeSize(node.weight),
              color: node.isEvent ? "#1a1a1a" : filterColor(node.filter),
              favicon: outlet ? { name: outlet.name, domain: outlet.domain } : undefined,
              glyph: node.isEvent ? "★" : initials(node.label),
              ring: node.expanded && !node.isEvent ? "#1a1a1a22" : undefined,
            },
          };
        }),
        edges: pm.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          color: edge.kind === "seed" ? "#cbd5e1" : filterColor(edge.filter),
          dashed: edge.historic || edge.kind === "bundle",
          width: edge.kind === "relation" ? 2.5 : 1.5,
          arrow: edge.directed ? ("end" as const) : null,
        })),
      };
    }
    const eventScene = eventLensScene(graph, clues, revealed, lens as EventLens, { revealAll });
    return {
      labels: new Map(eventScene.nodes.map((node) => [node.id, node.kind === "frame" ? frameLabel(node.label) : node.label])),
      eventEdges: new Map(eventScene.edges.map((edge) => [edge.id, edge])),
      bundles: [] as PmBundle[],
      fitIds: null,
      nodes: eventScene.nodes.map((node: SceneNode) => {
        const style = KIND_STYLE[node.kind] ?? KIND_STYLE.entity;
        const outlet = node.kind === "outlet" && node.graphNode?.outletKey ? index.outlet(node.graphNode.outletKey) : null;
        return {
          id: node.id,
          weight: node.weight,
          pin: node.kind === "event" ? { x: 0, y: 0 } : undefined,
          data: {
            label: node.label,
            size: node.kind === "ghost" ? 40 : nodeSize(node.weight),
            color: node.ghost ? SPOOR_COLORS[node.ghost.spoor] : style.color,
            favicon: outlet ? { name: outlet.name, domain: outlet.domain } : undefined,
            glyph: node.kind === "entity" || node.kind === "actor" ? initials(node.label) : style.glyph,
            ghost: node.kind === "ghost",
          },
        };
      }),
      edges: eventScene.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        color: EDGE_COLORS[edge.kind] ?? "#94a3b8",
        dashed: edge.attribution === "geciteerd" || edge.source.startsWith("ghost") || edge.target.startsWith("ghost"),
        arrow: DIRECTED_KINDS.has(edge.kind) && !edge.source.startsWith("ghost") && !edge.target.startsWith("ghost") ? ("end" as const) : null,
      })),
    };
  }, [lens, pmx.merged, pmx.seeds, pmx.expanded, pmx.expandedFilters, pmx.revealed, pmx.hiddenFilters, pmx.latest, graph, clues, revealed, revealAll, index]);

  const canvasNodes = useMemo<CanvasNode[]>(() => {
    const previous = positionsRef.current[lens];
    const positions = layoutNetwork(
      scene.nodes.map((node) => ({ id: node.id, weight: node.weight, parent: (node as { parent?: string }).parent, pin: node.pin })),
      // Bundles stay close to their node
      scene.edges.map((edge) => ({ source: edge.source, target: edge.target, distance: edge.id.startsWith("bundle-edge:") ? 72 : undefined })),
      { seed: Math.abs(input.event.id) + lens.length, previous, keepPrevious: Boolean(previous) },
    );
    positionsRef.current[lens] = positions;
    return scene.nodes.map((node) => {
      const position = positions.get(node.id) ?? { x: 0, y: 0 };
      return { id: node.id, x: position.x, y: position.y, data: { ...node.data, selected: node.id === selected } };
    });
  }, [scene, lens, input.event.id, selected]);

  const canvasEdges: CanvasEdge[] = scene.edges;
  const sceneIds = useMemo(() => new Set(scene.nodes.map((node) => node.id)), [scene]);

  /** Select a node and pan to it (from lists and the path) */
  const goTo = (nodeId: string) => {
    select(nodeId);
    setCenter((current) => ({ id: nodeId, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const renderNodeTip = (nodeId: string, close: () => void): [string, ReactNode] | null => {
    const label = scene.labels.get(nodeId) ?? "Knoop";
    if (lens === "propaganda") {
      if (nodeId === PM_EVENT_NODE) {
        return [label, <p key="event" className="text-sm text-ink-700">Dit nieuws. Van hieruit lopen lijnen naar de bronnen en actoren die in het propagandamodel staan.</p>];
      }
      if (nodeId.startsWith("bundle:")) {
        const bundle = scene.bundles.find((item) => bundleNodeId(item.anchorId, item.filter) === nodeId);
        if (!bundle || !pmx.merged.entities.has(bundle.anchorId)) return null;
        return [label, <PmBundleTip key={nodeId} bundle={bundle} pmx={pmx} sceneIds={sceneIds} goTo={goTo} close={close} />];
      }
      const pmId = Number(nodeId.slice(3));
      if (!pmx.merged.entities.has(pmId)) return null;
      const bundles = scene.bundles.filter((item) => item.anchorId === pmId);
      return [label, <PmNodeTip key={nodeId} pmId={pmId} pmx={pmx} sceneIds={sceneIds} bundles={bundles} goTo={goTo} close={close} />];
    }
    const content = <EventNodeTip nodeId={nodeId} close={close} />;
    return [label, content];
  };

  const renderEdgeTip = (edgeId: string, pinned: boolean, close: () => void): [string, ReactNode] | null => {
    if (lens === "propaganda") {
      if (edgeId.startsWith("seed:")) {
        const id = Number(edgeId.slice(5));
        const seed = pmx.seeds.find((item) => item.id === id);
        const name = pmx.merged.entities.get(id)?.name ?? "";
        return [
          `${name} en dit nieuws`,
          <p key={edgeId} className="text-sm text-ink-700">
            <span className="font-semibold text-ink-900">{name}</span> {seed?.reason === "outlet" ? "bericht over dit nieuws." : "komt voor in dit nieuws."}
          </p>,
        ];
      }
      if (edgeId.startsWith("bundle-edge:")) {
        const bundle = scene.bundles.find((item) => `bundle-edge:${item.anchorId}:${item.filter}` === edgeId);
        const name = bundle ? pmx.merged.entities.get(bundle.anchorId)?.name ?? "" : "";
        if (!bundle) return null;
        return [
          `Nog ${bundle.count} via ${filterLabel(bundle.filter)}`,
          <p key={edgeId} className="text-sm text-ink-700">
            <span className="font-semibold text-ink-900">{name}</span> heeft nog {bundle.count} verbanden via {filterLabel(bundle.filter).toLowerCase()}. Tik op de bundel
            om te zien met wie.
          </p>,
        ];
      }
      const relation = pmx.merged.relations.get(Number(edgeId.slice("pmrel:".length)));
      if (!relation) return null;
      return [
        "Verband in het propagandamodel",
        <PmEdgeTip key={edgeId} relation={relation} pmx={pmx} pinned={pinned} goTo={(id) => { close(); goTo(id); }} />,
      ];
    }
    const edge = scene.eventEdges?.get(edgeId);
    if (!edge) return null;
    return [EDGE_LABELS[edge.kind] ?? edge.kind, <EventEdgeTip key={edgeId} edge={edge} labels={scene.labels} pinned={pinned} />];
  };

  return (
    <div data-explore className="fixed inset-0 z-40 flex flex-col bg-paper-100">
      <NetworkHeader lens={lens} onLens={(id) => { setPref("networkLens", id); select(null); }} onPick={(id) => void pmx.addAndExpand(id).then(() => goTo(pmNodeId(id)))} />

      <div className="relative min-h-0 flex-1">
        {lens === "propaganda" ? <HistoryControls pmx={pmx} /> : null}
        {lens === "propaganda" && pmx.ready && pmx.seeds.length === 0 && pmx.loading.size === 0 ? (
          <div className="absolute inset-x-4 top-16 z-10 rounded-2xl border border-paper-300 bg-paper-50 p-4 text-sm text-ink-700">
            Geen bronnen of actoren van dit nieuws gevonden in het propagandamodel. Zoek hierboven naar een actor om te beginnen.
          </div>
        ) : null}
        {pmx.loading.size > 0 && lens === "propaganda" ? (
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-full bg-paper-50 px-3 py-1.5 text-xs text-ink-600 shadow">
            <Loader2 size={14} className="animate-spin" /> Laden…
          </div>
        ) : null}
        <NetworkCanvas
          nodes={canvasNodes}
          edges={canvasEdges}
          onSelect={select}
          selectedId={selected}
          focusId={focusParam}
          fitIds={scene.fitIds}
          center={center}
          renderNodeTip={renderNodeTip}
          renderEdgeTip={renderEdgeTip}
          tipInsetTop={lens === "propaganda" ? 56 : 0}
        />
      </div>

      {lens === "propaganda" ? (
        <div className="border-t border-paper-300 bg-paper-50 px-4 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2">
          <PmAttribution />
        </div>
      ) : null}
    </div>
  );
}

function NetworkHeader({ lens, onLens, onPick }: { lens: NetworkLens; onLens: (lens: NetworkLens) => void; onPick: (id: number) => void }) {
  const { exploration, panel } = useExplore();
  const { input } = exploration;
  return (
    <header className="space-y-2 border-b border-paper-300 bg-paper-50 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+8px)]">
      <div className="flex items-center gap-2">
        <Link
          href={`/event/${encodeURIComponent(input.event.slug ?? String(input.event.id))}`}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-paper-200"
          aria-label="Terug naar het event"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Netwerk</p>
          <p className="truncate text-sm font-semibold text-ink-900">{input.event.title}</p>
        </div>
        {lens === "propaganda" ? (
          <button
            type="button"
            onClick={() => panel.open("filters")}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-paper-200"
            aria-label="De vijf filters in dit nieuws"
          >
            <SlidersHorizontal size={18} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => panel.open("model")}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-paper-200"
          aria-label="Over het propagandamodel"
        >
          <Info size={18} />
        </button>
      </div>
      <div role="radiogroup" aria-label="Lens" className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1">
        {LENSES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={lens === item.id}
            onClick={() => onLens(item.id)}
            className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-semibold ${
              lens === item.id ? "bg-ink-900 text-white" : "border border-paper-300 bg-paper-50 text-ink-600"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {lens === "propaganda" ? <PmSearchBar onPick={onPick} /> : null}
      {lens === "propaganda" ? <FilterLegend /> : null}
    </header>
  );
}

function FilterLegend() {
  const hidden = usePmStore((state) => state.hiddenFilters);
  const toggle = usePmStore((state) => state.toggleFilter);
  const items = [...FILTERS.map((filter) => ({ id: filter.id, label: filter.label, color: filter.color })), { id: PM_OTHER, label: "Overig", color: "#94a3b8" }];
  return (
    <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1" aria-label="Filters aan/uit">
      {items.map((filter) => {
        const off = hidden.includes(filter.id);
        return (
          <button
            key={filter.id}
            type="button"
            aria-pressed={!off}
            onClick={() => toggle(filter.id)}
            className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${off ? "border-paper-300 text-ink-400 line-through" : "border-paper-300 bg-paper-50 text-ink-800"}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: off ? "#cbd5e1" : filter.color }} aria-hidden="true" />
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}

/** Undo/redo for building the graph (expansions, filters, search), also with ⌘Z / ⇧⌘Z / Ctrl+Y. */
function HistoryControls({ pmx }: { pmx: Pmx }) {
  const { undo, redo, canUndo, canRedo } = pmx;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div role="group" aria-label="Stappen" className="absolute left-3 top-3 z-10 flex gap-0.5 rounded-full border border-paper-300 bg-paper-50/95 p-0.5 shadow">
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Ongedaan maken"
        title="Ongedaan maken (⌘Z)"
        className="flex h-11 w-11 items-center justify-center rounded-full text-ink-700 hover:bg-paper-200 disabled:text-ink-200 disabled:hover:bg-transparent"
      >
        <Undo2 size={18} />
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Opnieuw"
        title="Opnieuw (⇧⌘Z)"
        className="flex h-11 w-11 items-center justify-center rounded-full text-ink-700 hover:bg-paper-200 disabled:text-ink-200 disabled:hover:bg-transparent"
      >
        <Redo2 size={18} />
      </button>
    </div>
  );
}

function PmSearchBar({ onPick }: { onPick: (id: number) => void }) {
  const { exploration } = useExplore();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const demo = exploration.input.event.isDemo;
  const { data, isLoading } = useSWR(query.trim().length >= 2 ? ["pm-search", query.trim(), demo] : null, () => pmSearch(query, { demo }), exploreAuxSwrOptions);
  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-full border border-paper-300 bg-paper-50 px-3">
        <Search size={16} className="text-ink-400" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          placeholder="Zoek een persoon, bedrijf of medium…"
          className="min-h-[40px] w-full bg-transparent text-base outline-none sm:text-sm"
          aria-label="Zoek in het propagandamodel"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} className="flex h-9 w-9 items-center justify-center" aria-label="Wis zoekopdracht">
            <X size={14} />
          </button>
        ) : null}
      </label>
      {open && query.trim().length >= 2 ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-paper-300 bg-paper-50 p-1 shadow-balloon">
          {isLoading ? <li className="p-3 text-sm text-ink-500">Zoeken…</li> : null}
          {(data ?? []).map((entity: PmEntity) => (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(entity.id);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-paper-100"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: filterColor(entity.primary_filter as string) }} aria-hidden="true" />
                <span className="flex-1 font-medium">{entity.name}</span>
                <span className="text-xs text-ink-500">{entity.type}</span>
              </button>
            </li>
          ))}
          {!isLoading && data && data.length === 0 ? <li className="p-3 text-sm text-ink-500">Niets gevonden</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Tooltip of a propaganda-model node. One tap on "Breid uit" loads its neighbours via the filters that
 * are switched on in the legend; ▾ offers "alleen via …" for any other filter. The graph just grows:
 * a few neighbours per filter, the rest in a bundle ("+84").
 */
function PmNodeTip({
  pmId,
  pmx,
  sceneIds,
  bundles,
  goTo,
  close,
}: {
  pmId: number;
  pmx: Pmx;
  sceneIds: ReadonlySet<string>;
  bundles: PmBundle[];
  goTo: (nodeId: string) => void;
  close: () => void;
}) {
  const { panel, pin } = useExplore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const entity = pmx.merged.entities.get(pmId) as PmEntity;
  const { peek, visibleFilters } = pmx;
  const setKey = hoodKey(pmId, visibleFilters);

  // How many neighbours "Breid uit" would show, and the counts per filter for the ▾ menu
  useEffect(() => {
    void peek(pmId, visibleFilters);
  }, [peek, pmId, visibleFilters, setKey]);

  const setHood = pmx.neighborhoods[setKey];
  const allHood = pmx.neighborhoods[hoodKey(pmId, null)];
  const known = relationsOf(pmx.merged, pmId, visibleFilters).filter((relation) => isRelationVisible(relation, pmx.hiddenFilters));
  const total = setHood?.total ?? (allHood && !allHood.truncated ? known.length : undefined);
  const counts = Object.values(pmx.neighborhoods).find((hood) => hood.center.id === pmId && hood.filter_counts)?.filter_counts ?? {};
  // Done when expanded along every filter that is switched on and has relations
  const via = pmx.expandedFilters.get(pmId);
  const wanted = visibleFilters ?? ALL_FILTER_KEYS.filter((key) => !pmx.hiddenFilters.has(key));
  const done = pmx.expanded.has(pmId) && wanted.every((filter) => via?.has(filter) || !((counts[filter] ?? 0) > 0));
  const options = [...FILTERS.map((filter) => ({ id: filter.id, label: filter.label, color: filter.color })), { id: PM_OTHER, label: "Overig", color: "#94a3b8" }].filter(
    (filter) => (counts[filter.id] ?? 0) > 0,
  );
  const loading = pmx.isLoading(pmId);
  const nothingVisible = total === 0;
  const inView = known.filter((relation) => sceneIds.has(pmNodeId(otherEnd(relation, pmId))));
  const bundled = bundles.reduce((sum, bundle) => sum + bundle.count, 0);

  const expand = (only?: string) => {
    close();
    void pmx.expand(pmId, only);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-serif text-base font-bold leading-snug text-ink-900">{entity.name}</p>
          <p className="text-xs text-ink-500">
            {pmTypeLabel(entity.type)} · {entity.degree} verbanden in het model
            {entity.auto_approved ? <AutoApprovedTag className="ml-1.5 align-middle" /> : null}
          </p>
          <WikiDescription name={entity.name} />
        </div>
        <button
          type="button"
          aria-label="Bewaar in dossier"
          onClick={() =>
            pin({
              id: dossierIds.pm(pmId),
              kind: "pm",
              eventId: null,
              refId: String(pmId),
              title: entity.name,
              subtitle: `Propagandamodel · ${entity.type}`,
              keys: [`pm:${pmId}`],
            })
          }
          className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-500 hover:bg-paper-100"
        >
          <Pin size={16} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-full bg-ink-900 text-white">
          <button
            type="button"
            onClick={() => expand()}
            disabled={done || nothingVisible || loading}
            className="inline-flex min-h-[40px] items-center gap-1.5 pl-4 pr-3 text-sm font-semibold disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : done ? <Check size={14} aria-hidden="true" /> : null}
            {done ? "Uitgebreid" : `Breid uit${total !== undefined ? ` · ${total}` : ""}`}
          </button>
          <button
            type="button"
            aria-expanded={menuOpen || nothingVisible}
            aria-label="Uitbreiden via één filter"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex min-h-[40px] w-11 items-center justify-center border-l border-white/20 hover:bg-white/10"
          >
            <ChevronDown size={16} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
        <Chip onClick={() => panel.open(`pm:entity:${pmId}`)}>Meer weten</Chip>
      </div>

      {nothingVisible ? <p className="text-xs text-ink-500">Geen verbanden via de filters die aan staan. Kies er een:</p> : null}
      {done && bundles.length ? (
        <p className="text-xs text-ink-500">De belangrijkste staan erin; de rest zit in {bundles.length === 1 ? "de bundel" : "de bundels"} met een +.</p>
      ) : null}

      {menuOpen || nothingVisible ? (
        <div role="group" aria-label="Alleen via" className="flex flex-wrap gap-1.5">
          {options.length === 0 ? <p className="text-xs text-ink-500">Tellen…</p> : null}
          {options.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => expand(filter.id)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold hover:bg-paper-100 ${
                pmx.hiddenFilters.has(filter.id) ? "border-dashed border-paper-300 text-ink-500" : "border-paper-300 text-ink-800"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: filter.color }} aria-hidden="true" />
              {filter.label} · {counts[filter.id]}
            </button>
          ))}
        </div>
      ) : null}

      <CoverageTeaser aliases={nameAliases(entity.name)} onOpen={() => panel.open(`pm:entity:${pmId}`)} />

      {inView.length || bundles.length ? (
        <div>
          <button
            type="button"
            aria-expanded={listOpen}
            onClick={() => setListOpen((open) => !open)}
            className="flex min-h-[36px] w-full items-center justify-between rounded-lg px-1 text-left text-xs font-semibold text-ink-500 hover:bg-paper-100"
          >
            {`In beeld (${inView.length})${bundled ? ` · ${bundled} in bundels` : ""}`}
            <ChevronDown size={14} className={`transition-transform ${listOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {listOpen ? (
            <ul className="space-y-0.5">
              {inView.slice(0, 40).map((relation) => {
                const otherId = otherEnd(relation, pmId);
                const other = pmx.merged.entities.get(otherId);
                const outgoing = relation.source_id === pmId;
                const filter = displayFilter(relation, { hidden: pmx.hiddenFilters });
                return (
                  <li key={relation.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => goTo(pmNodeId(otherId))}
                      className="flex min-h-[44px] flex-1 items-center gap-2 rounded-xl px-1 text-left text-sm hover:bg-paper-100"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: filterColor(filter) }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-ink-500">
                          {outgoing ? `${pmRelationLabel(relation.relation_type)} →` : `← ${pmRelationLabel(relation.relation_type)}`}
                        </span>
                        <span className="font-semibold text-ink-900">{other?.name ?? otherId}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => panel.open(`pm:relation:${relation.id}`)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500 hover:bg-paper-100"
                      aria-label={`Meer over dit verband met ${other?.name ?? otherId}`}
                    >
                      <Info size={16} />
                    </button>
                  </li>
                );
              })}
              {bundles.map((bundle) => (
                <li key={bundle.filter}>
                  <button
                    type="button"
                    onClick={() => goTo(bundleNodeId(bundle.anchorId, bundle.filter))}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-left text-sm hover:bg-paper-100"
                  >
                    <span
                      className="flex h-6 min-w-[28px] shrink-0 items-center justify-center rounded-full border-2 border-dashed px-1 text-[10px] font-bold"
                      style={{ borderColor: filterColor(bundle.filter), color: filterColor(bundle.filter) }}
                      aria-hidden="true"
                    >
                      +{bundle.count}
                    </span>
                    <span className="font-semibold text-ink-900">
                      Nog {bundle.count} via {filterLabel(bundle.filter)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "is bron voor NOS" / "is eigendom van DPG Media": how a neighbour relates to the node, read from the neighbour. */
function relationPhrase(relation: PmRelation, anchor: PmEntity): string {
  const label = relation.source_id === anchor.id ? pmRelationReverseLabel(relation.relation_type) : pmRelationLabel(relation.relation_type);
  return `${label} ${shortName(anchor.name)}`;
}

/**
 * Tooltip of a bundle ("+84"): with whom (kinds of parties) and how (mechanisms) an expanded node is
 * linked via one filter, and what is not drawn; tap one to put it in the network.
 */
function PmBundleTip({
  bundle,
  pmx,
  sceneIds,
  goTo,
  close,
}: {
  bundle: PmBundle;
  pmx: Pmx;
  sceneIds: ReadonlySet<string>;
  goTo: (nodeId: string) => void;
  close: () => void;
}) {
  const { panel } = useExplore();
  const [family, setFamily] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const { anchorId, filter } = bundle;
  const anchor = pmx.merged.entities.get(anchorId) as PmEntity;
  const { loadBundle } = pmx;

  // The full list behind the bundle (cache only: opening it changes nothing in the graph)
  useEffect(() => {
    void loadBundle(anchorId, filter);
  }, [loadBundle, anchorId, filter]);

  // Everything fetched about this node: the graph, the list behind the bundle, earlier loads
  const hoods = Object.values(pmx.neighborhoods).filter((hood) => hood.center.id === anchorId);
  const entities = new Map<number, PmEntity>();
  const relations = new Map<number, PmRelation>();
  for (const hood of hoods) {
    hood.entities.forEach((entity) => entities.set(entity.id, entity));
    hood.relations.forEach((relation) => relations.set(relation.id, relation));
  }
  const viaFilter = Array.from(relations.values()).filter((relation) => relationFilterKeys(relation).includes(filter));

  // Not drawn: per party with its relations, the hubs of the model first
  const byParty = new Map<number, PmRelation[]>();
  for (const relation of viaFilter) {
    const other = otherEnd(relation, anchorId);
    if (sceneIds.has(pmNodeId(other)) || !entities.has(other)) continue;
    byParty.set(other, [...(byParty.get(other) ?? []), relation]);
  }
  const rows = Array.from(byParty.entries())
    .map(([id, list]) => ({ entity: entities.get(id) as PmEntity, relations: list, rank: prominenceOf(entities.get(id), id, list) }))
    .sort((x, y) => byProminence(x.rank, y.rank));

  // With whom and how, over all relations via this filter in the model (or what is loaded, on an older database)
  const breakdown =
    hoods.find((hood) => hood.breakdown)?.breakdown?.[filter] ??
    countBreakdown(Array.from(relations.values()), anchorId, (id) => entities.get(id)?.type)[filter];
  const inModel = hoods.find((hood) => hood.filter_counts)?.filter_counts?.[filter] ?? viaFilter.length;
  const familyCounts = new Map<string, { id: string; label: string; color: string; count: number }>();
  for (const [type, count] of Object.entries(breakdown?.types ?? {})) {
    const item = pmTypeFamily(type);
    const entry = familyCounts.get(item.id) ?? { id: item.id, label: item.label, color: item.color, count: 0 };
    entry.count += count;
    familyCounts.set(item.id, entry);
  }
  const families = Array.from(familyCounts.values()).sort((a, b) => b.count - a.count);
  const familyTotal = families.reduce((sum, item) => sum + item.count, 0) || 1;
  const mechanisms = Object.entries(breakdown?.mechanisms ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const filtered = family ? rows.filter((row) => pmTypeFamily(row.entity.type).id === family) : rows;
  const shown = all ? filtered : filtered.slice(0, 8);
  const listed = rows.reduce((sum, row) => sum + row.relations.length, 0);
  const unlisted = Math.max(0, bundle.count - listed);
  const loading = pmx.loading.has(bundleHoodKey(anchorId, filter));
  const selected = families.find((item) => item.id === family);

  const reveal = (picked: typeof rows) => {
    const [key, hood] = pickHood(
      anchor,
      picked.flatMap((row) => row.relations),
      picked.map((row) => row.entity),
      filter,
    );
    pmx.reveal(
      picked.map((row) => row.entity.id),
      { [key]: hood },
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="font-serif text-base font-bold leading-snug text-ink-900">
          {shortName(anchor.name)}: nog {bundle.count} via {filterLabel(filter)}
        </p>
        <p className="text-xs text-ink-500">
          {inModel} verbanden via {filterLabel(filter).toLowerCase()} in het model, {Math.max(0, inModel - bundle.count)} in beeld.
        </p>
      </div>

      {families.length ? (
        <div className="space-y-1.5">
          <Eyebrow>Met wie?</Eyebrow>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-paper-200" aria-hidden="true">
            {families.map((item) => (
              <span key={item.id} style={{ width: `${(item.count / familyTotal) * 100}%`, backgroundColor: item.color }} />
            ))}
          </div>
          <div role="group" aria-label="Soort partij" className="flex flex-wrap gap-1.5">
            {families.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={family === item.id}
                onClick={() => {
                  setFamily(family === item.id ? null : item.id);
                  setAll(false);
                }}
                className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${
                  family === item.id ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 text-ink-700 hover:bg-paper-100"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                {item.label} · {item.count}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mechanisms.length ? (
        <p className="text-xs leading-relaxed text-ink-600">
          <span className="font-semibold text-ink-800">Hoe: </span>
          {mechanisms.map(([name, count]) => `${name} (${count})`).join(" · ")}
        </p>
      ) : null}

      <div className="space-y-1">
        <p className="text-xs font-semibold text-ink-500">{selected ? `${selected.label}, niet in beeld` : "Niet in beeld"} · tik om toe te voegen</p>
        {loading && rows.length === 0 ? <p className="text-xs text-ink-500">Laden…</p> : null}
        <ul className="space-y-0.5">
          {shown.map((row) => (
            <li key={row.entity.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  reveal([row]);
                  close();
                  goTo(pmNodeId(row.entity.id));
                }}
                className="flex min-h-[44px] flex-1 items-center gap-2 rounded-xl px-1 text-left text-sm hover:bg-paper-100"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: pmTypeFamily(row.entity.type).color }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug text-ink-900">{row.entity.name}</span>
                  <span className="block text-xs text-ink-500">
                    {pmTypeLabel(row.entity.type)} · {relationPhrase(row.relations[0], anchor)}
                  </span>
                </span>
                <Plus size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => panel.open(`pm:relation:${row.relations[0].id}`)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500 hover:bg-paper-100"
                aria-label={`Meer over het verband met ${row.entity.name}`}
              >
                <Info size={16} />
              </button>
            </li>
          ))}
        </ul>
        {filtered.length > shown.length ? (
          <button type="button" onClick={() => setAll(true)} className="min-h-[40px] text-sm font-semibold text-accent-blue">
            Toon alle {filtered.length}
          </button>
        ) : null}
        {selected && filtered.length > 1 ? (
          <Chip tone="blue" onClick={() => reveal(filtered)}>
            Zet deze {filtered.length} in het netwerk
          </Chip>
        ) : null}
        {unlisted > 0 && !loading ? <p className="text-xs text-ink-400">Nog {unlisted} in het model die niet in deze lijst passen.</p> : null}
      </div>
    </div>
  );
}

function PmEdgeTip({ relation, pmx, pinned, goTo }: { relation: PmRelation; pmx: Pmx; pinned: boolean; goTo: (nodeId: string) => void }) {
  const { panel } = useExplore();
  const source = pmx.merged.entities.get(relation.source_id);
  const target = pmx.merged.entities.get(relation.target_id);
  const filters = relationFilters(relation);
  const when = period(relation);
  return (
    <div className="space-y-2">
      <p className="text-sm leading-snug">
        <span className="font-semibold text-ink-900">{source?.name ?? relation.source_id}</span>{" "}
        <span className="text-ink-600">{pmRelationLabel(relation.relation_type)}</span>{" "}
        <span className="font-semibold text-ink-900">{target?.name ?? relation.target_id}</span>
        {relation.bidirectional ? <span className="text-ink-500"> (wederzijds)</span> : null}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {filters.map((filter) => (
          <span key={filter} className="inline-flex items-center gap-1 rounded-full border border-paper-300 px-2 py-0.5 text-[11px] font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: filterColor(filter) }} aria-hidden="true" />
            {filterLabel(filter)}
          </span>
        ))}
        {relation.mechanism ? <Tag tone="purple">{relation.mechanism}</Tag> : null}
        {when ? <Tag>{isHistoric(relation) ? `historisch · ${when}` : when}</Tag> : null}
        {relation.certainty_label ? <Tag>{relation.certainty_label}</Tag> : null}
        <Tag>{relation.source_count === 1 ? "1 bron" : `${relation.source_count} bronnen`}</Tag>
        {relation.auto_approved ? <AutoApprovedTag /> : null}
      </div>
      {pinned ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Chip tone="blue" onClick={() => panel.open(`pm:relation:${relation.id}`)}>
            Meer weten
          </Chip>
          {source ? <Chip onClick={() => goTo(pmNodeId(source.id))}>Naar {source.name}</Chip> : null}
          {target ? <Chip onClick={() => goTo(pmNodeId(target.id))}>Naar {target.name}</Chip> : null}
        </div>
      ) : (
        <p className="text-xs text-ink-400">Klik voor bronnen en details</p>
      )}
    </div>
  );
}

function EventEdgeTip({ edge, labels, pinned }: { edge: SceneEdge; labels: ReadonlyMap<string, string>; pinned: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-sm leading-snug">
        <span className="font-semibold text-ink-900">{labels.get(edge.source) ?? "?"}</span>{" "}
        <span className="text-ink-600">{EDGE_LABELS[edge.kind] ?? edge.kind}</span>{" "}
        <span className="font-semibold text-ink-900">{labels.get(edge.target) ?? "?"}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {edge.label ? <Tag>{edge.label}</Tag> : null}
        {edge.attribution === "geciteerd" ? <Tag tone="orange">geciteerd, niet eigen framing</Tag> : null}
        {edge.attribution === "eigen_framing" ? <Tag tone="purple">eigen framing</Tag> : null}
      </div>
      {!pinned ? null : <p className="text-xs text-ink-400">Tik op een knoop om verder te zoeken.</p>}
    </div>
  );
}

/** Tooltip of a node in the event lenses (outlets, actors, frames, clues, ghosts). */
function EventNodeTip({ nodeId, close }: { nodeId: string; close: () => void }) {
  const { exploration, panel } = useExplore();
  const { graph, clues, index } = exploration;
  const node = graph.nodeById.get(nodeId as never);

  if (nodeId.startsWith("ghost:")) {
    const spoor = nodeId.slice("ghost:".length);
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-700">Hier zit nog iets verborgen. Onderzoek het spoor om het netwerk te laten groeien.</p>
        <Chip
          tone="blue"
          onClick={() => {
            close();
            panel.open(`spoor:${spoor}`);
          }}
        >
          Open het spoor
        </Chip>
      </div>
    );
  }
  if (node?.kind === "outlet" && node.outletKey) return <OutletCard outletKey={node.outletKey} />;
  if (node && (node.kind === "entity" || node.kind === "actor")) {
    const key = node.entityKey
      ? exploration.input.entities.find((entity) => entity.entity_key === node.entityKey)?.aliases[0] ?? node.id.slice(node.id.indexOf(":") + 1)
      : node.id.slice("actor:".length);
    return (
      <div className="space-y-2">
        <p className="font-serif text-base font-bold text-ink-900">{node.label}</p>
        <Chip tone="blue" onClick={() => panel.open(`entiteit:${key}`, { n: node.label })}>
          Meer over {node.label}
        </Chip>
      </div>
    );
  }
  if (node?.kind === "related") {
    return (
      <div className="space-y-2">
        <p className="font-serif text-base font-bold text-ink-900">{node.label}</p>
        <Link
          href={`/event/${encodeURIComponent(node.relatedSlug ?? String(node.relatedEventId))}`}
          className="inline-flex min-h-[44px] items-center rounded-full bg-ink-900 px-4 text-sm font-semibold text-white"
        >
          Naar dit nieuws
        </Link>
      </div>
    );
  }
  if (node) {
    const clue = clues.find((candidate) => candidate.links.includes(node.id));
    return (
      <div className="space-y-2">
        <p className="font-serif text-base font-bold text-ink-900">{node.kind === "frame" ? frameLabel(node.label) : node.label}</p>
        {clue ? (
          <>
            <p className="text-sm text-ink-600">{revealedTitle(clue, index)}</p>
            <Chip tone="blue" onClick={() => panel.open(`spoor:${clue.spoor}`, { c: clue.id })}>
              Open de aanwijzing
            </Chip>
          </>
        ) : null}
      </div>
    );
  }
  return <p className="text-sm text-ink-700">{exploration.input.event.title}</p>;
}
