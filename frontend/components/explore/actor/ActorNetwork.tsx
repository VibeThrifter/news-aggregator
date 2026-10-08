"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Check, ChevronRight, Info, Loader2, Route, UserRound } from "lucide-react";

import { getEntityCooccurrence, pmMatch } from "@/lib/api";
import { actorScene } from "@/lib/explore/actor-graph";
import { useUrlPanel } from "@/lib/explore/hooks";
import { FILTERS, filterAsk, filterColor, filterLabel, labelSourceId, pmRelationLabel } from "@/lib/explore/labels";
import { layoutNetwork, type Positions } from "@/lib/explore/layout/network";
import { actorKeys } from "@/lib/explore/normalize";
import {
  bestMatch,
  bySpecificity,
  compatibleMatches,
  displayFilter,
  isHistoric,
  otherEnd,
  PM_OTHER,
  pmNodeId,
  relationFilterKeys,
  relationFilters,
  relationsOf,
  specificityOf,
} from "@/lib/explore/pm-graph";
import { actorHref, kindForPmType } from "@/lib/explore/research";
import type { EntityKind, PmEntity, PmRelation } from "@/lib/types";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import NetworkCanvas, { type CanvasEdge, type CanvasNode } from "../network/NetworkCanvas";
import { AutoApprovedTag } from "../network/MiniEgoNetwork";
import { PartySearch } from "../network/PartySearch";
import { RouteList } from "../network/RouteList";
import { Chip, SubHeading, Tag } from "../ui/primitives";
import { useActorExplorer, type ActorExplorer } from "./useActorExplorer";
import { ScrollRow } from "../ui/ScrollRow";

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

/** "HCSS (The Hague Centre for Strategic Studies)" → "HCSS" */
function shortName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*/g, " ").trim() || name;
}

/**
 * The actor's network from the propaganda model on the actor page (Epic 12, reworked in Epic 13): per
 * filter only the most specific ties, a question per party instead of unfolding everything, routes to
 * another party ("Zoek verband met …") and to who is in the news together with the actor. The full
 * list of relations stays below the network.
 */
export function ActorNetwork({ pmId, demo, aliases = [] }: { pmId: number; slug?: string; demo: boolean; aliases?: string[] }) {
  const pmx = useActorExplorer(pmId, demo);
  const panel = useUrlPanel();
  const [hiddenFilters, setHiddenFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const positionsRef = useRef<Positions | undefined>(undefined);
  const hidden = useMemo(() => new Set(hiddenFilters), [hiddenFilters]);

  const scene = useMemo(
    () => actorScene(pmx.merged, pmId, pmx.asked, { hiddenFilters: hidden, routeNodes: pmx.routeNodes, routeRelations: pmx.routeRelations }),
    [pmx.merged, pmId, pmx.asked, hidden, pmx.routeNodes, pmx.routeRelations],
  );

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

  // The view glides to the last step: a party you asked about with what it brought, or new routes
  const fitIds = useMemo(() => {
    const ids = new Set(scene.nodes.map((node) => node.id));
    const latest = pmx.latest;
    if (!latest) return null;
    if (latest.kind === "routes") {
      const nodes = pmx.latestRoutes?.routes.flatMap((route) => route.nodes) ?? [];
      return Array.from(new Set(nodes.map(pmNodeId))).filter((id) => ids.has(id));
    }
    return [pmNodeId(latest.id), ...relationsOf(pmx.merged, latest.id).map((relation) => pmNodeId(otherEnd(relation, latest.id)))].filter((id) => ids.has(id));
  }, [pmx.latest, pmx.latestRoutes, pmx.merged, scene.nodes]);

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
      <ScrollRow className="-mx-4 gap-1.5 px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Filters aan/uit">
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
      </ScrollRow>

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
      <p className="text-xs text-ink-500">
        Per filter de drie meest specifieke verbanden
        {scene.hidden > 0 ? `; de andere ${scene.hidden} staan in de lijst hieronder` : ""}. Tik op een naam om een vraag te stellen of een verband te
        zoeken.
      </p>

      {center && pmx.ready ? <NewsRoutes center={center} pmx={pmx} aliases={aliases} demo={demo} onRelation={(id) => panel.open(`pm:relation:${id}`)} /> : null}

      {center ? <RelationList center={center} pmx={pmx} demo={demo} hidden={hidden} onDetails={(id) => panel.open(`pm:relation:${id}`)} /> : null}
    </div>
  );
}

/**
 * "Hoe hangt X samen met wie samen in het nieuws staat?": routes (at most three steps) from the actor
 * to the people and organisations that appear in the same news, as far as they are in the model.
 */
function NewsRoutes({
  center,
  pmx,
  aliases,
  demo,
  onRelation,
}: {
  center: PmEntity;
  pmx: ActorExplorer;
  aliases: string[];
  demo: boolean;
  onRelation: (relationId: number) => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [found, setFound] = useState(0);
  // Same key as "Samen in het nieuws" on this page: one request
  const together = useSWR(
    aliases.length ? ["cooccurrence", aliases.join("|"), demo] : null,
    () => getEntityCooccurrence(aliases, { demo, limit: 12 }),
    exploreAuxSwrOptions,
  );
  const rows = useMemo(() => together.data ?? [], [together.data]);
  const candidates = useMemo(
    () =>
      rows.map((row) => {
        const kind: EntityKind | null = row.kind === "person" || row.kind === "org" ? row.kind : null;
        return { name: row.name, kind, aliases: actorKeys(row.name, { person: kind === "person" }).aliases };
      }),
    [rows],
  );
  const matches = useSWR(
    candidates.length ? ["actor-news-match", candidates.map((item) => item.aliases.join(",")).join("|"), demo] : null,
    () => pmMatch(candidates.flatMap((item) => item.aliases), { demo }),
    exploreAuxSwrOptions,
  );
  const targets = useMemo(() => {
    const ids: number[] = [];
    for (const item of candidates) {
      const own = compatibleMatches((matches.data ?? []).filter((match) => item.aliases.includes(match.alias)), item.kind);
      const best = bestMatch(own, item.aliases);
      if (best && best.entity_id !== center.id && !ids.includes(best.entity_id)) ids.push(best.entity_id);
    }
    return ids;
  }, [candidates, matches.data, center.id]);

  // Reset when the actor changes
  useEffect(() => {
    setState("idle");
    setFound(0);
  }, [center.id]);

  const newsRoutes = pmx.routeResults.filter((result) => result.routes.some((route) => targets.includes(route.to)));
  const routes = newsRoutes.flatMap((result) => result.routes).filter((route) => targets.includes(route.to));

  if (!aliases.length || (together.data && rows.length === 0)) return null;
  const name = shortName(center.name);
  return (
    <section className="space-y-2 rounded-2xl border border-paper-300 bg-paper-50 p-3" aria-labelledby="actor-news-routes">
      <div className="flex items-start gap-2">
        <Route size={18} className="mt-0.5 shrink-0 text-accent-blue" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 id="actor-news-routes" className="font-semibold text-ink-900">
            Hoe hangt {name} samen met wie samen in het nieuws staat?
          </h3>
          <p className="text-xs text-ink-500">
            {together.isLoading || matches.isLoading
              ? "Zoeken wie er in het model staat…"
              : targets.length
                ? `${targets.length} van de ${rows.length} namen uit hetzelfde nieuws staan in het model.`
                : "Niemand uit hetzelfde nieuws staat (nog) in het model."}
          </p>
        </div>
      </div>
      {targets.length && state !== "done" ? (
        <Chip
          tone="blue"
          disabled={state === "loading"}
          icon={state === "loading" ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" /> : undefined}
          onClick={() => {
            setState("loading");
            void pmx.connectNews(targets).then((count) => {
              setFound(count);
              setState("done");
            });
          }}
        >
          Zoek de routes
        </Chip>
      ) : null}
      {state === "done" && found === 0 ? (
        <p className="text-sm text-ink-600">Geen route binnen drie stappen. Dat is ook een uitkomst: in het model hangen ze niet (direct) samen.</p>
      ) : null}
      {routes.length ? <RouteList routes={routes} entities={pmx.merged.entities} relations={pmx.merged.relations} onRelation={onRelation} label={`Routes van ${name}`} /> : null}
    </section>
  );
}

/** Tooltip of a node: questions per filter (three most specific each), a route to another party, facts and profile. */
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
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { peek } = pmx;
  useEffect(() => {
    if (!isCenter) peek(entity.id);
  }, [peek, entity.id, isCenter]);

  const counts = pmx.countsOf(entity.id) ?? {};
  const asked = pmx.asked.get(entity.id);
  const questions = isCenter
    ? []
    : [...FILTERS.map((filter) => ({ id: filter.id as string, color: filter.color })), { id: PM_OTHER, color: "#94a3b8" }]
        .map((filter) => ({ ...filter, count: counts[filter.id] ?? 0, done: Boolean(asked?.has(filter.id)) }))
        .filter((filter) => filter.count > 0);

  const connectTo = (target: PmEntity) => {
    setFinding(false);
    setMessage(null);
    void pmx.connectTo(target.id).then((found) => {
      if (found) close();
      else setMessage(`Geen route binnen drie stappen naar ${shortName(target.name)}.`);
    });
  };

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
        <Chip tone="blue" onClick={() => setFinding((open) => !open)} aria-expanded={finding}>
          Zoek verband met…
        </Chip>
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
      {message ? <p className="text-xs text-ink-500">{message}</p> : null}
      {finding ? (
        <PartySearch
          exclude={entity.id}
          onPick={(target) => (isCenter || target.id !== entity.id ? connectTo(target) : undefined)}
          label={`Verband tussen ${shortName(entity.name)} en…`}
          demo={demo}
        />
      ) : null}
      {questions.length ? (
        <div className="space-y-1.5">
          <SubHeading>Of stel een vraag</SubHeading>
          <div role="group" aria-label="Vragen" className="flex flex-wrap gap-1.5">
            {questions.map((question) => (
              <button
                key={question.id}
                type="button"
                disabled={question.done}
                onClick={() => {
                  close();
                  pmx.ask(entity.id, question.id);
                }}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 px-2.5 text-xs font-semibold text-ink-800 hover:bg-paper-100 disabled:border-transparent disabled:bg-paper-100 disabled:text-ink-500"
              >
                {question.done ? <Check size={12} aria-hidden="true" /> : <span className="h-2 w-2 rounded-full" style={{ backgroundColor: question.color }} aria-hidden="true" />}
                {filterAsk(question.id)} · {question.count}
              </button>
            ))}
          </div>
        </div>
      ) : !isCenter && pmx.isLoading(entity.id) ? (
        <p className="text-xs text-ink-500">Tellen…</p>
      ) : null}
    </div>
  );
}

function ActorEdgeTip({ relation, pmx, pinned, onDetails }: { relation: PmRelation; pmx: ActorExplorer; pinned: boolean; onDetails: () => void }) {
  const first = labelSourceId(relation, (id) => pmx.merged.entities.get(id)?.type);
  const last = otherEnd(relation, first);
  const when = period(relation);
  return (
    <div className="space-y-2">
      <p className="text-sm leading-snug">
        <span className="font-semibold text-ink-900">{pmx.merged.entities.get(first)?.name ?? first}</span>{" "}
        <span className="text-ink-600">{pmRelationLabel(relation.relation_type, relation.mechanism, relation.functie)}</span>{" "}
        <span className="font-semibold text-ink-900">{pmx.merged.entities.get(last)?.name ?? last}</span>
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

/** The actor's relations as a list, the most telling first (also the accessible way through the network). */
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
  const relations = relationsOf(pmx.merged, center.id)
    .map((relation) => ({ relation, rank: specificityOf(pmx.merged.entities.get(otherEnd(relation, center.id)), relation.id, [relation]) }))
    .sort((x, y) => bySpecificity(x.rank, y.rank))
    .map((item) => item.relation);
  if (relations.length === 0) return <p className="text-sm text-ink-500">Nog geen verbanden in het model.</p>;
  const shown = all ? relations : relations.slice(0, 8);
  // Per filter over all relations in the model (the list itself holds what was loaded)
  const counts = pmx.countsOf(center.id);
  const perFilter = new Map<string, number>();
  if (counts) {
    [...FILTERS.map((filter) => filter.id as string), PM_OTHER].forEach((key) => {
      if (counts[key]) perFilter.set(key, counts[key]);
    });
  } else {
    relations.forEach((relation) => relationFilterKeys(relation).forEach((key) => perFilter.set(key, (perFilter.get(key) ?? 0) + 1)));
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-ink-500">
        Verbanden van {center.name} ({pmx.totalOf(center.id) ?? relations.length}), de meest specifieke eerst
      </p>
      <p className="text-xs text-ink-500">
        {Array.from(perFilter.entries())
          .map(([key, count]) => `${filterLabel(key)} ${count}`)
          .join(" · ")}
      </p>
      <ul className="divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-paper-50">
        {shown.map((relation) => {
          const otherId = otherEnd(relation, center.id);
          const other = pmx.merged.entities.get(otherId);
          const outgoing = labelSourceId(relation, (id) => pmx.merged.entities.get(id)?.type) === center.id;
          const label = pmRelationLabel(relation.relation_type, relation.mechanism, relation.functie);
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
