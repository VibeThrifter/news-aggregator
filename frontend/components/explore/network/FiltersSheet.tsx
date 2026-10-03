"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

import { FILTERS } from "@/lib/explore/labels";
import { mergeNeighborhoods, relationsByFilter } from "@/lib/explore/pm-graph";
import { usePmStore } from "@/lib/explore/pm-store";
import { eventFilterSignals } from "@/lib/explore/propaganda";
import { touchpoints } from "@/lib/explore/why";

import { useExplore } from "../ExploreContext";
import { useWhyRoutes } from "../why/useWhyRoutes";
import { Eyebrow, Tag } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";
import { PmAttribution } from "./PmSection";
import { RouteList } from "./RouteList";

/**
 * The five filters (+ tegenmacht) for this news item: structural relations from the propaganda model
 * around the outlets and actors, and signals from the AI analysis. Evidence, not a verdict.
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
          return (
            <section key={filter.id} className="space-y-2 rounded-2xl border border-paper-300 bg-paper-50 p-3" style={{ borderLeftColor: filter.color, borderLeftWidth: 4 }}>
              <div>
                <p className="font-semibold text-ink-900">{filter.label}</p>
                <p className="text-xs text-ink-500">{filter.question}</p>
              </div>
              <div className="space-y-1">
                <Eyebrow>In het netwerk</Eyebrow>
                {relations.length ? (
                  <ul className="space-y-1 text-sm">
                    {relations.slice(0, 5).map((relation) => (
                      <li key={relation.id}>
                        <button
                          type="button"
                          onClick={() => panel.open(`pm:relation:${relation.id}`)}
                          className="min-h-[36px] w-full text-left text-ink-800 hover:underline"
                        >
                          {merged.entities.get(relation.source_id)?.name ?? relation.source_id}{" "}
                          <span className="text-ink-500">{relation.relation_type}</span>{" "}
                          {merged.entities.get(relation.target_id)?.name ?? relation.target_id}
                        </button>
                      </li>
                    ))}
                    {relations.length > 5 ? <li className="text-xs text-ink-500">+{relations.length - 5} meer in het netwerk</li> : null}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-500">Geen verbanden geladen.</p>
                )}
              </div>
              <div className="space-y-1">
                <Eyebrow>In dit nieuws</Eyebrow>
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
    <section className="space-y-2 rounded-2xl border border-paper-300 bg-paper-50 p-3" aria-labelledby="raakvlakken">
      <div>
        <p id="raakvlakken" className="font-semibold text-ink-900">
          Media verbonden met dit nieuws
        </p>
      </div>
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
