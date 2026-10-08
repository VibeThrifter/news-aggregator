"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

import { FILTERS, labelSourceId, pmRelationLabel } from "@/lib/explore/labels";
import { mergeNeighborhoods, otherEnd, relationsByFilter } from "@/lib/explore/pm-graph";
import { usePmStore } from "@/lib/explore/pm-store";
import { eventFilterSignals } from "@/lib/explore/propaganda";
import { touchpoints } from "@/lib/explore/why";
import type { PmEntity, PmRelation } from "@/lib/types";

import { useExplore } from "../ExploreContext";
import { useWhyRoutes } from "../why/useWhyRoutes";
import { Tag } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";
import { PmAttribution } from "./PmSection";
import { RouteList } from "./RouteList";

/**
 * The five filters (+ tegenmacht) for this news item: structural relations from the propaganda model
 * around the outlets and actors, and signals from the AI analysis. Evidence, not a verdict. The
 * decision-making categories (Epic 15) only appear when the network you built has relations in them.
 */
export function FiltersSheet() {
  const { exploration, panel } = useExplore();
  const neighborhoods = usePmStore((state) => state.neighborhoods);
  const active = usePmStore((state) => state.active);
  // Only what is in the graph you built (not the cache)
  const merged = useMemo(() => mergeNeighborhoods(active.map((key) => neighborhoods[key]).filter(Boolean)), [active, neighborhoods]);
  const structural = useMemo(() => relationsByFilter(merged), [merged]);
  const signals = useMemo(() => eventFilterSignals(exploration.input, exploration.findings, exploration.index), [exploration]);
  const eventHref = `/event/${encodeURIComponent(exploration.input.event.slug ?? String(exploration.input.event.id))}`;

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title="De filters in dit nieuws"
      icon={<SlidersHorizontal size={22} />}
    >
      <div className="space-y-5">
        <Touchpoints />
        {FILTERS.map((filter) => {
          const relations = structural.get(filter.id) ?? [];
          const eventSignals = signals.find((entry) => entry.filter === filter.id)?.signals ?? [];
          // Epic 15: a decision-making category has no signals from the analysis; only when the
          // network you built has relations in it
          const media = filter.group === "media";
          if (!media && relations.length === 0) return null;
          return (
            <section key={filter.id} className="space-y-3 rounded-2xl border border-paper-300 bg-paper-50 p-4">
              <div>
                <p className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: filter.color }} />
                  {filter.label}
                </p>
                <p className="text-sm text-ink-500">{filter.question}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ink-700">In het netwerk</p>
                {relations.length ? (
                  <ul className="space-y-1 text-sm">
                    {relations.slice(0, 5).map((relation) => (
                      <li key={relation.id}>
                        <button
                          type="button"
                          onClick={() => panel.open(`pm:relation:${relation.id}`)}
                          className="min-h-[36px] w-full text-left text-ink-800 hover:underline"
                        >
                          <RelationSentence relation={relation} entities={merged.entities} />
                        </button>
                      </li>
                    ))}
                    {relations.length > 5 ? <li className="text-xs text-ink-500">+{relations.length - 5} meer in het netwerk</li> : null}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-500">Geen verbanden geladen.</p>
                )}
              </div>
              {media ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ink-700">In dit nieuws</p>
                {eventSignals.length ? (
                  <ul className="space-y-1 text-sm">
                    {eventSignals.map((signal, i) => {
                      const findingId = signal.findingIds[0];
                      const finding = findingId ? exploration.findingById.get(findingId) : undefined;
                      return (
                        <li key={i}>
                          {finding ? (
                            <Link
                              href={`${eventHref}?f=${encodeURIComponent(finding.id)}`}
                              className="flex min-h-[36px] w-full items-center text-left text-ink-800 hover:underline"
                            >
                              {signal.text}
                            </Link>
                          ) : (
                            <span className="text-ink-800">{signal.text}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-500">Geen signalen.</p>
                )}
              </div>
              ) : null}
            </section>
          );
        })}
        <PmAttribution />
      </div>
    </Sheet>
  );
}

/**
 * Epic 13: which followed outlets are linked (at most two steps) to the parties of this news, the ones
 * that brought it first and then those that did not. Tap an outlet for its routes.
 */
function Touchpoints() {
  const { panel } = useExplore();
  const why = useWhyRoutes();
  const [open, setOpen] = useState<number | null>(null);
  const list = useMemo(() => touchpoints(why.paths, why.newsOutletIds), [why.paths, why.newsOutletIds]);
  const entities = useMemo(() => new Map((why.paths?.entities ?? []).map((entity) => [entity.id, entity])), [why.paths]);
  const relations = useMemo(() => new Map((why.paths?.relations ?? []).map((relation) => [relation.id, relation])), [why.paths]);
  if (why.unavailable) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-paper-300 bg-paper-50 p-4" aria-labelledby="raakvlakken">
      <p id="raakvlakken" className="font-serif text-lg font-bold text-ink-900">
        Media verbonden met dit nieuws
      </p>
      {why.loading ? <p className="text-sm text-ink-500">Zoeken…</p> : null}
      {!why.loading && why.noActors ? <p className="text-sm text-ink-500">Geen partijen uit dit nieuws in het propagandamodel.</p> : null}
      {!why.loading && !why.noActors && list.length === 0 ? (
        <p className="text-sm text-ink-500">Geen raakvlakken binnen twee stappen.</p>
      ) : null}
      <ul className="space-y-1">
        {list.map((item) => {
          const name = entities.get(item.outletId)?.name ?? String(item.outletId);
          const expanded = open === item.outletId;
          return (
            <li key={item.outletId}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : item.outletId)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-left text-sm hover:bg-paper-100"
              >
                <span className="flex-1 font-semibold text-ink-900">{name}</span>
                <Tag tone={item.covered ? "neutral" : "orange"}>{item.covered ? "bracht dit nieuws" : "bracht dit nieuws niet"}</Tag>
                <span className="text-xs text-ink-500">{item.routes.length === 1 ? "1 route" : `${item.routes.length} routes`}</span>
                <ChevronDown size={14} className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {expanded ? (
                <RouteList
                  routes={item.routes.slice(0, 3)}
                  entities={entities}
                  relations={relations}
                  onRelation={(id) => panel.open(`pm:relation:${id}`)}
                  label={`Routes van ${name}`}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Heinen is lid van VVD": a relation read from the end its label starts with. */
function RelationSentence({ relation, entities }: { relation: PmRelation; entities: ReadonlyMap<number, PmEntity> }) {
  const first = labelSourceId(relation, (id) => entities.get(id)?.type);
  const last = otherEnd(relation, first);
  return (
    <>
      {entities.get(first)?.name ?? first} <span className="text-ink-500">{pmRelationLabel(relation.relation_type, relation.mechanism, relation.functie)}</span>{" "}
      {entities.get(last)?.name ?? last}
    </>
  );
}
