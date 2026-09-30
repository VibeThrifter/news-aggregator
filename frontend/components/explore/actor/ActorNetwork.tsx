"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronRight, Info, Loader2, UserRound } from "lucide-react";

import { actorScene } from "@/lib/explore/actor-graph";
import { useUrlPanel } from "@/lib/explore/hooks";
import { FILTERS, filterColor, filterLabel, pmRelationLabel } from "@/lib/explore/labels";
import { layoutNetwork, type Positions } from "@/lib/explore/layout/network";
import { displayFilter, isHistoric, otherEnd, PM_OTHER, pmNodeId, relationFilters, relationsOf } from "@/lib/explore/pm-graph";
import { sortRelations } from "@/lib/explore/pm-local";
import { actorHref, kindForPmType } from "@/lib/explore/research";
import type { PmEntity, PmRelation } from "@/lib/types";

import NetworkCanvas, { type CanvasEdge, type CanvasNode } from "../network/NetworkCanvas";
import { AutoApprovedTag } from "../network/MiniEgoNetwork";
import { Chip, Tag } from "../ui/primitives";
import { ACTOR_EXPAND_LIMIT, useActorExplorer, type ActorExplorer } from "./useActorExplorer";

const LEGEND = [...FILTERS.map((filter) => ({ id: filter.id as string, label: filter.label, color: filter.color })), { id: PM_OTHER, label: "Overig", color: "#94a3b8" }];

function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function nodeSize(weight: number): number {
  return Math.round(Math.min(64, 34 + Math.sqrt(Math.max(weight, 0)) * 5));
}

function period(relation: Pick<PmRelation, "active_from" | "active_until">): string {
  if (!relation.active_from && !relation.active_until) return "";
  return `${relation.active_from ?? "?"}–${relation.active_until ?? "nu"}`;
}

/**
 * The actor's ego-network from the propaganda model on the actor page: tap a node for its facts,
 * "Breid uit" to grow the graph and "Meer weten" for sources; the relations are also listed below.
 */
export function ActorNetwork({ pmId, demo }: { pmId: number; slug?: string; demo: boolean }) {
  const pmx = useActorExplorer(pmId, demo);
  const panel = useUrlPanel();
  const [hiddenFilters, setHiddenFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const positionsRef = useRef<Positions | undefined>(undefined);
  const hidden = useMemo(() => new Set(hiddenFilters), [hiddenFilters]);

  const scene = useMemo(() => actorScene(pmx.merged, pmId, pmx.expanded, { hiddenFilters: hidden }), [pmx.merged, pmId, pmx.expanded, hidden]);

  const canvasNodes = useMemo<CanvasNode[]>(() => {
    const previous = positionsRef.current;
    const positions = layoutNetwork(
      scene.nodes.map((node) => ({ id: node.id, weight: node.weight, parent: node.parent, pin: node.isCenter ? { x: 0, y: 0 } : undefined })),
      scene.edges.map((edge) => ({ source: edge.source, target: edge.target })),
      { seed: pmId, previous, keepPrevious: Boolean(previous) },
    );
    positionsRef.current = positions;
    return scene.nodes.map((node) => {
      const position = positions.get(node.id) ?? { x: 0, y: 0 };
      return {
        id: node.id,
        x: position.x,
        y: position.y,
        data: {
          label: node.label,
          size: nodeSize(node.weight),
          color: node.isCenter ? "#1a1a1a" : filterColor(node.filter),
          glyph: initials(node.label),
          ring: node.expanded && !node.isCenter ? "#1a1a1a22" : undefined,
          selected: node.id === selected,
        },
      };
    });
  }, [scene, pmId, selected]);

  const canvasEdges = useMemo<CanvasEdge[]>(
    () =>
      scene.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        color: filterColor(edge.filter),
        dashed: edge.historic,
        width: 2.5,
        arrow: edge.directed ? ("end" as const) : null,
      })),
    [scene],
  );

  const fitIds = useMemo(() => {
    if (pmx.latest === null) return null;
    const ids = new Set(scene.nodes.map((node) => node.id));
    return [pmNodeId(pmx.latest), ...relationsOf(pmx.merged, pmx.latest).map((relation) => pmNodeId(otherEnd(relation, pmx.latest as number)))].filter((id) =>
      ids.has(id),
    );
  }, [pmx.latest, pmx.merged, scene.nodes]);

  const center = pmx.merged.entities.get(pmId);
  const toggle = (id: string) => setHiddenFilters((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));

  const renderNodeTip = (nodeId: string, close: () => void): [string, ReactNode] | null => {
    const id = Number(nodeId.slice(3));
    const entity = pmx.merged.entities.get(id);
    if (!entity) return null;
    return [entity.name, <ActorNodeTip key={nodeId} entity={entity} pmx={pmx} isCenter={id === pmId} demo={demo} close={close} onDetails={() => panel.open(`pm:entity:${id}`)} />];
  };

  const renderEdgeTip = (edgeId: string, pinned: boolean): [string, ReactNode] | null => {
    const relation = pmx.merged.relations.get(Number(edgeId.slice("pmrel:".length)));
    if (!relation) return null;
    return [
      "Verband in het propagandamodel",
      <ActorEdgeTip key={edgeId} relation={relation} pmx={pmx} pinned={pinned} onDetails={() => panel.open(`pm:relation:${relation.id}`)} />,
    ];
  };

  if (pmx.failed && !pmx.ready) {
    return (
      <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>Het netwerk kon niet geladen worden.</p>
        <button type="button" onClick={pmx.retry} className="min-h-[44px] rounded-full border border-red-300 bg-white px-4 font-semibold">
          Opnieuw proberen
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Filters aan/uit">
        {LEGEND.map((filter) => {
          const off = hidden.has(filter.id);
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

      <div
        className="relative h-[58vh] max-h-[620px] min-h-[360px] overflow-hidden rounded-2xl border border-paper-300 bg-paper-100"
        data-testid="actor-network-canvas"
      >
        {!pmx.ready ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-500">
            <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" /> Netwerk laden…
          </div>
        ) : (
          <NetworkCanvas
            nodes={canvasNodes}
            edges={canvasEdges}
            onSelect={setSelected}
            selectedId={selected}
            fitIds={fitIds && fitIds.length > 1 ? fitIds : null}
            renderNodeTip={renderNodeTip}
            renderEdgeTip={renderEdgeTip}
          />
        )}
        {pmx.loadingAny && pmx.ready ? (
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-full bg-paper-50 px-3 py-1.5 text-xs text-ink-600 shadow">
            <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" /> Laden…
          </div>
        ) : null}
      </div>
      {scene.hidden > 0 ? <p className="text-xs text-ink-500">{scene.hidden} minder verbonden namen zijn weggelaten; breid een knoop uit of zie de lijst.</p> : null}

      {center ? <RelationList center={center} pmx={pmx} demo={demo} hidden={hidden} onDetails={(id) => panel.open(`pm:relation:${id}`)} /> : null}
    </div>
  );
}

function ActorNodeTip({
  entity,
  pmx,
  isCenter,
  demo,
  close,
  onDetails,
}: {
  entity: PmEntity;
  pmx: ActorExplorer;
  isCenter: boolean;
  demo: boolean;
  close: () => void;
  onDetails: () => void;
}) {
  const expanded = pmx.expanded.has(entity.id);
  const loading = pmx.isLoading(entity.id);
  const total = pmx.hoods[entity.id]?.total ?? entity.degree;
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="font-serif text-base font-bold leading-snug text-ink-900">{entity.name}</p>
        <p className="text-xs text-ink-500">
          {[entity.type, entity.role].filter(Boolean).join(" · ")} · {entity.degree} verbanden in het model
        </p>
        {entity.auto_approved ? <AutoApprovedTag /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!isCenter ? (
          <button
            type="button"
            disabled={expanded || loading}
            onClick={() => {
              close();
              pmx.expand(entity.id);
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-ink-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" /> : expanded ? <Check size={14} aria-hidden="true" /> : null}
            {expanded ? "Uitgebreid" : `Breid uit · ${Math.min(total, ACTOR_EXPAND_LIMIT)}`}
          </button>
        ) : null}
        <Chip onClick={onDetails}>Meer weten</Chip>
        {!isCenter ? (
          <Link
            href={actorHref(`pm-${entity.id}`, { kind: kindForPmType(entity.type), name: entity.name, demo })}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 bg-paper-100 px-3 py-1 text-xs font-medium text-ink-700 hover:bg-paper-200"
          >
            <UserRound size={14} aria-hidden="true" /> Profiel
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function ActorEdgeTip({ relation, pmx, pinned, onDetails }: { relation: PmRelation; pmx: ActorExplorer; pinned: boolean; onDetails: () => void }) {
  const source = pmx.merged.entities.get(relation.source_id);
  const target = pmx.merged.entities.get(relation.target_id);
  const when = period(relation);
  return (
    <div className="space-y-2">
      <p className="text-sm leading-snug">
        <span className="font-semibold text-ink-900">{source?.name ?? relation.source_id}</span>{" "}
        <span className="text-ink-600">{pmRelationLabel(relation.relation_type)}</span>{" "}
        <span className="font-semibold text-ink-900">{target?.name ?? relation.target_id}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {relationFilters(relation).map((filter) => (
          <span key={filter} className="inline-flex items-center gap-1 rounded-full border border-paper-300 px-2 py-0.5 text-[11px] font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: filterColor(filter) }} aria-hidden="true" />
            {filterLabel(filter)}
          </span>
        ))}
        {relation.mechanism ? <Tag tone="purple">{relation.mechanism}</Tag> : null}
        {when ? <Tag>{isHistoric(relation) ? `historisch · ${when}` : when}</Tag> : null}
        <Tag>{relation.source_count === 1 ? "1 bron" : `${relation.source_count} bronnen`}</Tag>
        {relation.auto_approved ? <AutoApprovedTag /> : null}
      </div>
      {pinned ? (
        <Chip tone="blue" onClick={onDetails}>
          Meer weten
        </Chip>
      ) : (
        <p className="text-xs text-ink-400">Tik voor bronnen en details</p>
      )}
    </div>
  );
}

/** The actor's relations as a list (also the accessible way through the network). */
function RelationList({
  center,
  pmx,
  demo,
  hidden,
  onDetails,
}: {
  center: PmEntity;
  pmx: ActorExplorer;
  demo: boolean;
  hidden: ReadonlySet<string>;
  onDetails: (relationId: number) => void;
}) {
  const [all, setAll] = useState(false);
  const relations = sortRelations(relationsOf(pmx.merged, center.id));
  if (relations.length === 0) return <p className="text-sm text-ink-500">Nog geen verbanden in het model.</p>;
  const shown = all ? relations : relations.slice(0, 8);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-ink-500">
        Verbanden van {center.name} ({pmx.hoods[center.id]?.total ?? relations.length})
      </p>
      <ul className="divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-paper-50">
        {shown.map((relation) => {
          const otherId = otherEnd(relation, center.id);
          const other = pmx.merged.entities.get(otherId);
          const outgoing = relation.source_id === center.id;
          const label = pmRelationLabel(relation.relation_type);
          return (
            <li key={relation.id} className="flex items-center gap-1 pr-1">
              <Link
                href={actorHref(`pm-${otherId}`, { kind: kindForPmType(other?.type), name: other?.name ?? null, demo })}
                className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-paper-100"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: filterColor(displayFilter(relation, { hidden })) }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink-500">{outgoing ? `${label} →` : `← ${label}`}</span>
                  <span className="font-semibold text-ink-900">{other?.name ?? otherId}</span>
                  {relation.auto_approved ? <AutoApprovedTag className="ml-1.5 align-middle" /> : null}
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => onDetails(relation.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500 hover:bg-paper-100"
                aria-label={`Bronnen van het verband met ${other?.name ?? otherId}`}
              >
                <Info size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {relations.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className="min-h-[44px] text-sm font-semibold text-accent-blue">
          Toon alle ({relations.length})
        </button>
      ) : null}
    </div>
  );
}
