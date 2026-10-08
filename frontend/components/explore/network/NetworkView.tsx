"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Check, ChevronDown, Info, Loader2, Pin, Plus, Redo2, Search, SlidersHorizontal, Undo2, X } from "lucide-react";

import { pmSearch } from "@/lib/api";
import { nameAliases } from "@/lib/explore/coverage";
import {
  FILTERS,
  filterAsk,
  filterColor,
  filterLabel,
  frameLabel,
  labelSourceId,
  pmRelationLabel,
  pmTypeFamily,
  pmTypeLabel,
  relationWords,
} from "@/lib/explore/labels";
import { layoutNetwork, type Positions } from "@/lib/explore/layout/network";
import {
  bundleNodeId,
  bySpecificity,
  countBreakdown,
  displayFilter,
  isHistoric,
  isRelationVisible,
  newsEdgeId,
  otherEnd,
  pickHood,
  pmNodeId,
  PM_EVENT_NODE,
  PM_OTHER,
  relationFilterKeys,
  relationFilters,
  relationsOf,
  specificityOf,
  bundleEdgeId,
  onSide,
  type PmBundle,
  type PmDirection,
  type PmSceneNode,
} from "@/lib/explore/pm-graph";
import type { NewsEntity } from "@/lib/explore/pm-seeds";
import { usePmStore } from "@/lib/explore/pm-store";
import { researchCopy } from "@/lib/explore/research";
import type { PmEntity, PmRelation } from "@/lib/types";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { dossierIds, useExplore } from "../ExploreContext";
import { Chip, SubHeading, Tag } from "../ui/primitives";
import { useToast } from "../ui/Toast";
import type { CanvasEdge, CanvasNode } from "./NetworkCanvas";
import { CoverageTeaser } from "../entity/ArticleMentions";
import { WikiDescription } from "../entity/Wikipedia";
import { AutoApprovedTag } from "./MiniEgoNetwork";
import { PartySearch } from "./PartySearch";
import { PmAttribution } from "./PmSection";
import { bundleHoodKey, usePmExplorer } from "./usePmExplorer";
import { ScrollRow } from "../ui/ScrollRow";

const NetworkCanvas = dynamic(() => import("./NetworkCanvas"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-ink-500">Netwerk laden…</div>,
});

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

/** "Nog 12 via Eigendom", for a question one way "Nog 12 via Eigendom · invloed op DPG Media" */
function bundleTitle(bundle: Pick<PmBundle, "count" | "filter" | "side">, anchorName: string): string {
  const base = `Nog ${bundle.count} via ${filterLabel(bundle.filter)}`;
  return bundle.side === "any" ? base : `${base} · invloed ${bundle.side === "in" ? "op" : "van"} ${shortName(anchorName)}`;
}

function period(relation: Pick<PmRelation, "active_from" | "active_until">): string {
  if (!relation.active_from && !relation.active_until) return "";
  return `${relation.active_from ?? "?"}–${relation.active_until ?? "nu"}`;
}

/** Outline of a person or organisation of the news that is not in the model */
const NEWS_COLOR = "#9ca3af";

type Pmx = ReturnType<typeof usePmExplorer>;

export function NetworkView() {
  const { exploration } = useExplore();
  const { input, index } = exploration;
  const params = useSearchParams();
  // The network is the propaganda model only (Epic 14): the event lenses live on the event page
  const lens = "propaganda";
  const selected = usePmStore((state) => state.selected);
  const selectNode = usePmStore((state) => state.select);
  const positionsRef = useRef<Record<string, Positions>>({});
  const [center, setCenter] = useState<{ id: string; nonce: number } | null>(null);

  // Focus from the URL: `pm:<id>`, or `outlet:<key>` of an outlet that is in the model
  const rawFocus = params?.get("focus") ?? null;
  const focusParam = rawFocus?.startsWith("outlet:")
    ? (() => {
        const pmId = index.outlet(rawFocus.slice("outlet:".length))?.profile?.pmEntityId;
        return pmId ? `pm:${pmId}` : null;
      })()
    : rawFocus;
  const focusPmId = focusParam?.startsWith("pm:") ? Number(focusParam.slice(3)) || null : null;

  const pmx = usePmExplorer(exploration, focusPmId);

  /** Tapping a proposal keeps it (and opens it like any node) */
  const select = (nodeId: string | null) => {
    if (nodeId && pmx.proposals.nodes.includes(nodeId)) pmx.keep(nodeId);
    selectNode(nodeId);
  };

  // --- Build the scene for the current lens ---
  const ghosts = pmx.proposals.ghosts;
  const scene = useMemo(() => {
    {
      const pm = pmx.scene;
      const drawnIds = new Set(pm.nodes.map((node) => node.id));
      const outletBySeed = new Map(pmx.seeds.filter((seed) => seed.outletKey).map((seed) => [pmNodeId(seed.id), seed.outletKey as string]));
      const parentOf = (node: PmSceneNode): string | undefined => {
        if (node.bundle) return pmNodeId(node.bundle.anchorId);
        if (node.news) return PM_EVENT_NODE;
        if (node.pmId === null) return undefined;
        for (const edge of pm.edges) {
          if (edge.target === node.id && pmx.expanded.has(Number(edge.source.slice(3)))) return edge.source;
          if (edge.source === node.id && pmx.expanded.has(Number(edge.target.slice(3)))) return edge.target;
        }
        return undefined;
      };
      return {
        labels: new Map(
          pm.nodes.map((node) => [
            node.id,
            node.bundle ? bundleTitle(node.bundle, pmx.merged.entities.get(node.bundle.anchorId)?.name ?? "") : node.label,
          ]),
        ),
        bundles: pm.bundles,
        // After a question the view glides to that node, its new neighbours and bundles; after a
        // route search to the route
        fitIds: pmx.latestRouteNodes
          ? pmx.latestRouteNodes.map(pmNodeId).filter((id) => drawnIds.has(id))
          : pmx.latest
            ? pm.latestIds
            : null,
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
                pending: ghosts.has(node.id),
              },
            };
          }
          if (node.news) {
            return {
              id: node.id,
              weight: node.weight,
              parent: parentOf(node),
              pin: undefined,
              data: { label: node.label, size: 34, color: NEWS_COLOR, glyph: initials(node.label), dashed: true },
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
              pending: ghosts.has(node.id),
            },
          };
        }),
        edges: pm.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          color: edge.kind === "seed" || edge.kind === "news" ? "#cbd5e1" : filterColor(edge.filter),
          dashed: edge.historic || edge.kind === "bundle" || edge.kind === "news",
          width: edge.kind === "relation" ? 2.5 : 1.5,
          arrow: edge.directed ? ("end" as const) : null,
          faded: ghosts.has(edge.source) || ghosts.has(edge.target),
        })),
      };
    }
  }, [pmx.scene, pmx.merged.entities, pmx.seeds, pmx.expanded, pmx.latest, pmx.latestRouteNodes, ghosts, index]);

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
  const toast = useToast();
  /** Propaganda-model ids on screen (not the proposals you did not keep), the news' own outlets and actors first (targets for routes) */
  const screenIds = useMemo(() => {
    const onScreen = scene.nodes
      .map((node) => node.id)
      .filter((id) => id.startsWith("pm:") && !ghosts.has(id))
      .map((id) => Number(id.slice(3)));
    const seeds = pmx.seeds.map((seed) => seed.id).filter((id) => onScreen.includes(id));
    return Array.from(new Set([...seeds, ...onScreen]));
  }, [scene, ghosts, pmx.seeds]);

  /** A party from the search bar: in the graph with only its routes to what is on screen */
  const addFromSearch = (id: number, name: string) => {
    void pmx.addAndConnect(id, screenIds).then((found) => {
      // With routes the view glides to them; without, open the party so you can ask about it
      if (found) return;
      goTo(pmNodeId(id));
      toast(`${shortName(name)} staat erin, maar zonder route binnen drie stappen naar wat in beeld staat. Stel er een vraag over.`);
    });
  };

  /** Select a node and pan to it (from lists and the path) */
  const goTo = (nodeId: string) => {
    select(nodeId);
    setCenter((current) => ({ id: nodeId, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const renderNodeTip = (nodeId: string, close: () => void): [string, ReactNode] | null => {
    const label = scene.labels.get(nodeId) ?? "Knoop";
    {
      if (nodeId === PM_EVENT_NODE) {
        return [
          input.event.title,
          <p key="event" className="text-sm text-ink-700">
            {pmx.seeds.length} {pmx.seeds.length === 1 ? "bron of partij" : "bronnen en partijen"} uit dit nieuws in het propagandamodel
            {pmx.news.length ? `, ${pmx.news.length} ${pmx.news.length === 1 ? "naam" : "namen"} nog niet` : ""}.
          </p>,
        ];
      }
      if (nodeId.startsWith("news:")) {
        const news = pmx.news.find((item) => item.id === nodeId);
        return news ? [news.name, <NewsNodeTip key={nodeId} news={news} />] : null;
      }
      if (nodeId.startsWith("bundle:")) {
        const bundle = scene.bundles.find((item) => bundleNodeId(item.anchorId, item.filter, item.side) === nodeId);
        if (!bundle || !pmx.merged.entities.has(bundle.anchorId)) return null;
        return [label, <PmBundleTip key={nodeId} bundle={bundle} pmx={pmx} sceneIds={sceneIds} goTo={goTo} close={close} />];
      }
      const pmId = Number(nodeId.slice(3));
      if (!pmx.merged.entities.has(pmId)) return null;
      const bundles = scene.bundles.filter((item) => item.anchorId === pmId);
      return [label, <PmNodeTip key={nodeId} pmId={pmId} pmx={pmx} sceneIds={sceneIds} screenIds={screenIds} bundles={bundles} goTo={goTo} close={close} />];
    }
  };

  const renderEdgeTip = (edgeId: string, pinned: boolean, close: () => void): [string, ReactNode] | null => {
    {
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
      if (edgeId.startsWith("news-edge:")) {
        const news = pmx.news.find((item) => newsEdgeId(item.id) === edgeId);
        if (!news) return null;
        return [
          `${news.name} en dit nieuws`,
          <p key={edgeId} className="text-sm text-ink-700">
            <span className="font-semibold text-ink-900">{news.name}</span> komt voor in dit nieuws{mentionText(news)}.
          </p>,
        ];
      }
      if (edgeId.startsWith("bundle-edge:")) {
        const bundle = scene.bundles.find((item) => bundleEdgeId(item.anchorId, item.filter, item.side) === edgeId);
        const name = bundle ? pmx.merged.entities.get(bundle.anchorId)?.name ?? "" : "";
        if (!bundle) return null;
        const via = filterLabel(bundle.filter).toLowerCase();
        return [
          bundleTitle(bundle, name),
          <p key={edgeId} className="text-sm text-ink-700">
            {bundle.side === "in" ? (
              <>
                Nog {bundle.count} met invloed op <span className="font-semibold text-ink-900">{name}</span> via {via}.
              </>
            ) : bundle.side === "out" ? (
              <>
                Nog {bundle.count} waarop <span className="font-semibold text-ink-900">{name}</span> invloed heeft via {via}.
              </>
            ) : (
              <>
                <span className="font-semibold text-ink-900">{name}</span> heeft nog {bundle.count} verbanden via {via}.
              </>
            )}
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
  };

  return (
    <div data-explore className="fixed inset-0 z-40 flex flex-col bg-paper-100">
      <NetworkHeader onPick={addFromSearch} />

      <div className="relative min-h-0 flex-1">
        <HistoryControls pmx={pmx} />
        {pmx.ready && pmx.seeds.length === 0 && pmx.loading.size === 0 ? (
          <div className="absolute inset-x-4 top-16 z-10 rounded-2xl border border-paper-300 bg-paper-50 p-4 text-sm text-ink-700">
            Geen bronnen of partijen van dit nieuws in het propagandamodel.
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2">
          {pmx.loading.size > 0 ? (
            <div className="flex items-center gap-2 rounded-full bg-paper-50 px-3 py-1.5 text-xs text-ink-600 shadow">
              <Loader2 size={14} className="animate-spin" /> Laden…
            </div>
          ) : (
            <span />
          )}
          <ProposalControls pmx={pmx} />
        </div>
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
          tipInsetTop={56}
        />
      </div>

      <div className="border-t border-paper-300 bg-paper-50 px-4 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2">
        <PmAttribution />
      </div>
    </div>
  );
}

function NetworkHeader({ onPick }: { onPick: (id: number, name: string) => void }) {
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
          <p className="text-xs font-medium text-ink-500">Wie zit erachter?</p>
          <p className="truncate text-sm font-semibold text-ink-900">{input.event.title}</p>
        </div>
        <button
          type="button"
          onClick={() => panel.open("filters")}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-paper-200"
          aria-label="De vijf filters in dit nieuws"
        >
          <SlidersHorizontal size={18} />
        </button>
        <button
          type="button"
          onClick={() => panel.open("model")}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-paper-200"
          aria-label="Over het propagandamodel"
        >
          <Info size={18} />
        </button>
      </div>
      <PmSearchBar onPick={onPick} />
      <FilterLegend />
    </header>
  );
}

function FilterLegend() {
  const hidden = usePmStore((state) => state.hiddenFilters);
  const toggle = usePmStore((state) => state.toggleFilter);
  const items = [...FILTERS.map((filter) => ({ id: filter.id, label: filter.label, color: filter.color })), { id: PM_OTHER, label: "Overig", color: "#94a3b8" }];
  return (
    <ScrollRow fade="paper-50" className="-mx-3 gap-1.5 px-3 pb-1" aria-label="Filters aan/uit">
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
    </ScrollRow>
  );
}

/**
 * What a step added is see-through: tap what stays. "Rest weg" (or any next step) takes the rest
 * away, "Houd alle" keeps everything. Shown while there is something see-through.
 */
function ProposalControls({ pmx }: { pmx: Pmx }) {
  const { ghosts, kept, withdraws } = pmx.proposals;
  if (ghosts.size === 0) return null;
  const button = "flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold";
  return (
    <div role="group" aria-label="Nieuw in het netwerk" className="pointer-events-auto ml-auto flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50/95 p-1 shadow">
      <button type="button" onClick={pmx.keepAll} className={`${button} text-ink-800 hover:bg-paper-200`}>
        Houd alle
      </button>
      <button type="button" onClick={pmx.dropRest} className={`${button} bg-ink-900 text-white hover:bg-ink-700`}>
        {kept > 0 && !withdraws ? "Rest weg" : "Alles weg"}
      </button>
    </div>
  );
}

/** "· 4× genoemd door NOS en NU.nl" */
function mentionText(news: NewsEntity): string {
  const outlets = news.outlets.slice(0, 3);
  const by = outlets.length ? ` door ${outlets.length > 1 ? `${outlets.slice(0, -1).join(", ")} en ${outlets[outlets.length - 1]}` : outlets[0]}` : "";
  return news.mentions > 1 ? ` (${news.mentions}× genoemd${by})` : by ? ` (genoemd${by})` : "";
}

/**
 * Tooltip of a person or organisation of the news that is not in the propaganda model (yet): who it
 * is, what "Wie is dit?" found out so far, and the way to everything about it.
 */
function NewsNodeTip({ news }: { news: NewsEntity }) {
  const { panel } = useExplore();
  const research = news.research ? researchCopy({ ...news.research, name: news.research.name || news.name }) : null;
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p className="font-serif text-base font-bold leading-snug text-ink-900">{news.name}</p>
        <p className="text-xs text-ink-500">
          {news.kind === "person" ? "Persoon" : "Organisatie"} · niet in het propagandamodel{research ? ` · ${research.title.toLowerCase()}` : ""}
        </p>
        <WikiDescription name={news.name} />
      </div>
      <p className="text-sm text-ink-700">
        Komt voor in dit nieuws{mentionText(news)}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Chip tone="blue" onClick={() => panel.open(`entiteit:${news.panelKey}`, { n: news.name })}>
          Meer weten
        </Chip>
      </div>
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

function PmSearchBar({ onPick }: { onPick: (id: number, name: string) => void }) {
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
          placeholder="Zoek iemand en zie hoe die verbonden is…"
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
                  onPick(entity.id, entity.name);
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
 * Tooltip of a propaganda-model node (Epic 13). Instead of unfolding everything around it you ask a
 * question ("Wie betaalt?": the three most specific parties, the rest in a "+N" bundle), connect it
 * to what is already on screen, or look for a route to another party. The graph only grows; every
 * step can be undone.
 */
function PmNodeTip({
  pmId,
  pmx,
  sceneIds,
  screenIds,
  bundles,
  goTo,
  close,
}: {
  pmId: number;
  pmx: Pmx;
  sceneIds: ReadonlySet<string>;
  /** Propaganda-model ids on screen, seeds first (targets for "Verbind met beeld") */
  screenIds: number[];
  bundles: PmBundle[];
  goTo: (nodeId: string) => void;
  close: () => void;
}) {
  const { exploration, panel, pin } = useExplore();
  const toast = useToast();
  const [listOpen, setListOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const entity = pmx.merged.entities.get(pmId) as PmEntity;
  const { peek } = pmx;

  // Counts per filter for the questions (one cheap call, cached)
  useEffect(() => {
    void peek(pmId, null);
  }, [peek, pmId]);

  const ownHoods = Object.values(pmx.neighborhoods).filter((hood) => hood.center.id === pmId);
  const counts = ownHoods.find((hood) => hood.filter_counts)?.filter_counts ?? {};
  // Per filter how many relations go each way (migration 008): two questions instead of one
  const directionCounts = ownHoods.find((hood) => hood.direction_counts)?.direction_counts ?? null;
  const asked = pmx.expandedFilters.get(pmId);
  const questionsFor = (direction: PmDirection | null) =>
    [...FILTERS.map((filter) => ({ id: filter.id as string, color: filter.color })), { id: PM_OTHER, color: "#94a3b8" }]
      .map((filter) => ({
        ...filter,
        direction,
        count: (direction ? directionCounts?.[filter.id]?.[direction] : counts[filter.id]) ?? 0,
        // Asked, and nothing of the answer taken away (asking again brings that back)
        done:
          pmx.expanded.has(pmId) &&
          Boolean(asked?.has(direction ? `${filter.id}@${direction}` : filter.id)) &&
          !pmx.recallable(pmId, filter.id, direction),
      }))
      .filter((filter) => filter.count > 0);
  const short = shortName(entity.name);
  const plain = questionsFor(null);
  // One row per filter with both ways side by side: the difference at a glance
  const ways = questionsFor("in").concat(questionsFor("out"));
  const wayRows = plain
    .map((filter) => ({ ...filter, in: ways.find((item) => item.id === filter.id && item.direction === "in"), out: ways.find((item) => item.id === filter.id && item.direction === "out") }))
    .filter((row) => row.in || row.out);
  const questionLabel = (id: string, direction: PmDirection) =>
    direction === "in" ? `Wie heeft invloed op ${short} via ${filterLabel(id)}?` : `Op wie heeft ${short} invloed via ${filterLabel(id)}?`;
  const loading = pmx.isLoading(pmId);
  const inView = relationsOf(pmx.merged, pmId).filter(
    (relation) =>
      sceneIds.has(pmNodeId(otherEnd(relation, pmId))) && (isRelationVisible(relation, pmx.hiddenFilters) || pmx.routeRelations.has(relation.id)),
  );
  const bundled = bundles.reduce((sum, bundle) => sum + bundle.count, 0);
  const others = screenIds.filter((id) => id !== pmId);
  // The news' own parties and the nodes you asked about stay; anything else can go
  const removable = !pmx.scene.anchors.has(pmId);

  const connect = async () => {
    setConnecting(true);
    setMessage(null);
    const found = await pmx.connect(pmId, others).catch(() => 0);
    setConnecting(false);
    if (found > 0) close();
    else setMessage("Geen verband binnen drie stappen met wat in beeld staat. Stel een vraag of zoek een verband met iemand anders.");
  };

  const connectTo = (target: PmEntity) => {
    close();
    void pmx.connectTo(pmId, target.id).then((found) => {
      // With routes the view glides to them; without, show the other party so you can ask about it
      if (found) return;
      goTo(pmNodeId(target.id));
      toast(`Geen route binnen drie stappen tussen ${shortName(entity.name)} en ${shortName(target.name)}.`);
    });
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

      <div className="flex flex-wrap gap-2">
        <Chip
          tone="blue"
          onClick={() => void connect()}
          disabled={connecting || others.length === 0}
          icon={connecting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : undefined}
        >
          Verbind met beeld
        </Chip>
        <Chip onClick={() => setFinding((open) => !open)} aria-expanded={finding}>
          Zoek verband met…
        </Chip>
        <Chip onClick={() => panel.open(`pm:entity:${pmId}`)}>Meer weten</Chip>
        {removable ? (
          <Chip
            onClick={() => {
              close();
              pmx.remove(pmNodeId(pmId));
            }}
          >
            Weghalen
          </Chip>
        ) : null}
      </div>
      {message ? <p className="text-xs text-ink-500">{message}</p> : null}
      {finding ? (
        <PartySearch exclude={pmId} onPick={connectTo} label={`Verband tussen ${shortName(entity.name)} en…`} demo={exploration.input.event.isDemo} />
      ) : null}

      <div className="space-y-1.5">
        <SubHeading>Of stel een vraag</SubHeading>
        {(directionCounts ? wayRows.length : plain.length) === 0 ? (
          <p className="text-xs text-ink-500">{loading ? "Tellen…" : "Geen verbanden in het model."}</p>
        ) : directionCounts ? (
          <table className="w-full border-separate border-spacing-y-1 text-xs" aria-label="Vragen">
            <thead>
              <tr className="align-bottom text-[11px] leading-tight text-ink-500">
                <th scope="col" className="text-left font-normal">
                  <span className="sr-only">Filter</span>
                </th>
                <th scope="col" className="w-[31%] px-1 font-semibold">
                  Invloed op {short}
                </th>
                <th scope="col" className="w-[31%] px-1 font-semibold">
                  Invloed van {short}
                </th>
              </tr>
            </thead>
            <tbody>
              {wayRows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="text-left font-semibold text-ink-800">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden="true" />
                      {filterLabel(row.id)}
                    </span>
                  </th>
                  {(["in", "out"] as const).map((direction) => {
                    const question = row[direction];
                    return (
                      <td key={direction} className="text-center">
                        {question ? (
                          <button
                            type="button"
                            disabled={question.done}
                            aria-label={`${questionLabel(row.id, direction)} ${question.count}`}
                            onClick={() => {
                              close();
                              void pmx.ask(pmId, row.id, direction);
                            }}
                            className="inline-flex min-h-[36px] min-w-[52px] items-center justify-center gap-1 rounded-full border border-paper-300 px-2.5 font-semibold text-ink-800 hover:bg-paper-100 disabled:border-transparent disabled:bg-paper-100 disabled:text-ink-500"
                          >
                            {question.done ? <Check size={12} aria-hidden="true" /> : null}
                            {question.count}
                          </button>
                        ) : (
                          <span className="text-ink-300" aria-label="geen">
                            –
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div role="group" aria-label="Vragen" className="flex flex-wrap gap-1.5">
            {plain.map((question) => (
              <button
                key={question.id}
                type="button"
                disabled={question.done}
                onClick={() => {
                  close();
                  void pmx.ask(pmId, question.id);
                }}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 px-2.5 text-xs font-semibold text-ink-800 hover:bg-paper-100 disabled:border-transparent disabled:bg-paper-100 disabled:text-ink-500"
              >
                {question.done ? <Check size={12} aria-hidden="true" /> : <span className="h-2 w-2 rounded-full" style={{ backgroundColor: question.color }} aria-hidden="true" />}
                {filterAsk(question.id)} · {question.count}
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-ink-400">Per vraag de drie meest specifieke; de rest in een bundel.</p>
      </div>

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
                const outgoing = labelSourceId(relation, (id) => pmx.merged.entities.get(id)?.type) === pmId;
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
                          {outgoing ? `${pmRelationLabel(relation.relation_type, relation.mechanism, relation.functie)} →` : `← ${pmRelationLabel(relation.relation_type, relation.mechanism, relation.functie)}`}
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
                <li key={bundleNodeId(bundle.anchorId, bundle.filter, bundle.side)}>
                  <button
                    type="button"
                    onClick={() => goTo(bundleNodeId(bundle.anchorId, bundle.filter, bundle.side))}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-left text-sm hover:bg-paper-100"
                  >
                    <span
                      className="flex h-6 min-w-[28px] shrink-0 items-center justify-center rounded-full border-2 border-dashed px-1 text-[10px] font-bold"
                      style={{ borderColor: filterColor(bundle.filter), color: filterColor(bundle.filter) }}
                      aria-hidden="true"
                    >
                      +{bundle.count}
                    </span>
                    <span className="font-semibold text-ink-900">{bundleTitle(bundle, entity.name)}</span>
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
function relationPhrase(relation: PmRelation, anchor: PmEntity, neighbour: PmEntity): string {
  const typeOf = (id: number) => (id === anchor.id ? anchor.type : id === neighbour.id ? neighbour.type : null);
  return `${relationWords(relation, neighbour.id, typeOf)} ${shortName(anchor.name)}`;
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
  const { anchorId, filter, side } = bundle;
  const direction = side === "any" ? null : side;
  const anchor = pmx.merged.entities.get(anchorId) as PmEntity;
  const { loadBundle } = pmx;

  // The full list behind the bundle (cache only: opening it changes nothing in the graph)
  useEffect(() => {
    void loadBundle(anchorId, filter, direction);
  }, [loadBundle, anchorId, filter, direction]);

  // Everything fetched about this node: the graph, the list behind the bundle, earlier loads
  const hoods = Object.values(pmx.neighborhoods).filter((hood) => hood.center.id === anchorId);
  const entities = new Map<number, PmEntity>();
  const relations = new Map<number, PmRelation>();
  for (const hood of hoods) {
    hood.entities.forEach((entity) => entities.set(entity.id, entity));
    hood.relations.forEach((relation) => relations.set(relation.id, relation));
  }
  const viaFilter = Array.from(relations.values()).filter((relation) => relationFilterKeys(relation).includes(filter) && onSide(relation, anchorId, side));

  // Not drawn: per party with its relations, the most specific first
  const byParty = new Map<number, PmRelation[]>();
  for (const relation of viaFilter) {
    const other = otherEnd(relation, anchorId);
    if (sceneIds.has(pmNodeId(other)) || !entities.has(other)) continue;
    byParty.set(other, [...(byParty.get(other) ?? []), relation]);
  }
  const rows = Array.from(byParty.entries())
    .map(([id, list]) => ({ entity: entities.get(id) as PmEntity, relations: list, rank: specificityOf(entities.get(id), id, list) }))
    .sort((x, y) => bySpecificity(x.rank, y.rank));

  // With whom and how, over all relations via this filter (and this way) in the model, or what is loaded
  const breakdown =
    hoods.find((hood) => hood.breakdown && (hood.direction ?? null) === direction)?.breakdown?.[filter] ??
    countBreakdown(viaFilter, anchorId, (id) => entities.get(id)?.type)[filter];
  const inModel =
    (direction
      ? hoods.find((hood) => hood.direction_counts)?.direction_counts?.[filter]?.[direction]
      : hoods.find((hood) => hood.filter_counts)?.filter_counts?.[filter]) ?? viaFilter.length;
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
  const loading = pmx.loading.has(bundleHoodKey(anchorId, filter, direction));
  const selected = families.find((item) => item.id === family);

  const reveal = (picked: typeof rows) => {
    const [key, hood] = pickHood(
      anchor,
      picked.flatMap((row) => row.relations),
      picked.map((row) => row.entity),
      filter,
      direction,
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
          {side === "any" ? `${shortName(anchor.name)}: nog ${bundle.count} via ${filterLabel(filter)}` : bundleTitle(bundle, anchor.name)}
        </p>
        <p className="text-xs text-ink-500">
          {inModel} {side === "in" ? `met invloed op ${shortName(anchor.name)}` : side === "out" ? `waarop ${shortName(anchor.name)} invloed heeft` : "verbanden"} via{" "}
          {filterLabel(filter).toLowerCase()} in het model, {Math.max(0, inModel - bundle.count)} in beeld.
        </p>
      </div>

      {families.length ? (
        <div className="space-y-1.5">
          <SubHeading>Met wie?</SubHeading>
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
                    {pmTypeLabel(row.entity.type)} · {relationPhrase(row.relations[0], anchor, row.entity)}
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
        <div>
          <Chip
            onClick={() => {
              close();
              pmx.remove(bundleNodeId(anchorId, filter, side));
            }}
          >
            Weghalen
          </Chip>
        </div>
        {unlisted > 0 && !loading ? <p className="text-xs text-ink-400">Nog {unlisted} in het model die niet in deze lijst passen.</p> : null}
      </div>
    </div>
  );
}

function PmEdgeTip({ relation, pmx, pinned, goTo }: { relation: PmRelation; pmx: Pmx; pinned: boolean; goTo: (nodeId: string) => void }) {
  const { panel } = useExplore();
  const first = labelSourceId(relation, (id) => pmx.merged.entities.get(id)?.type);
  const last = otherEnd(relation, first);
  const source = pmx.merged.entities.get(relation.source_id);
  const target = pmx.merged.entities.get(relation.target_id);
  const filters = relationFilters(relation);
  const when = period(relation);
  return (
    <div className="space-y-2">
      <p className="text-sm leading-snug">
        <span className="font-semibold text-ink-900">{pmx.merged.entities.get(first)?.name ?? first}</span>{" "}
        <span className="text-ink-600">{pmRelationLabel(relation.relation_type, relation.mechanism, relation.functie)}</span>{" "}
        <span className="font-semibold text-ink-900">{pmx.merged.entities.get(last)?.name ?? last}</span>
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

