"use client";

import { Fragment, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";

import { filterColor, pmRelationLabel, pmRelationReverseLabel } from "@/lib/explore/labels";
import { displayFilter } from "@/lib/explore/pm-graph";
import { entityName, readableRoute, typeLookup, type ReadStep } from "@/lib/explore/why";
import type { PmEntity, PmPathRoute, PmRelation } from "@/lib/types";

import { Tag } from "../ui/primitives";
import { AutoApprovedTag } from "./MiniEgoNetwork";

const FLOW_ICONS = { down: ArrowDown, up: ArrowUp, both: ArrowUpDown } as const;

/** "is vaste bron voor" / "leunt als bron op": a step in reading order, by its mechanism. */
export function stepLabel(step: Pick<ReadStep, "relation" | "forward">): string {
  const { relation_type: type, mechanism } = step.relation;
  return step.forward ? pmRelationLabel(type, mechanism) : pmRelationReverseLabel(type, mechanism);
}

/**
 * Epic 13: routes as readable chains, one card per route, read with the influence: "RIVM ↓ is vaste
 * bron voor ↓ DPG Media ↓ bepaalt de redactiecultuur van ↓ NU.nl". The arrow shows who has the
 * influence. Every step can be opened for its sources.
 */
export function RouteList({
  routes,
  entities,
  relations,
  onRelation,
  label,
  note,
}: {
  routes: PmPathRoute[];
  entities: ReadonlyMap<number, PmEntity>;
  relations: ReadonlyMap<number, PmRelation>;
  onRelation: (relationId: number) => void;
  label: string;
  /** Extra tag per route (e.g. "alleen NU.nl") */
  note?: (route: PmPathRoute) => ReactNode;
}) {
  return (
    <ol className="space-y-2" aria-label={label}>
      {routes.map((route) => {
        const steps = readableRoute(route, relations, typeLookup(entities));
        if (steps.length === 0) return null;
        const sharers = route.shared_with.map((id) => entities.get(id)?.name).filter(Boolean);
        const extra = note?.(route) ?? null;
        return (
          <li key={`${route.from}-${route.to}-${route.relations.join(".")}`} className="rounded-2xl border border-paper-300 bg-paper-50 p-3">
            <p className="font-semibold leading-snug text-ink-900">{entityName(entities, steps[0].from)}</p>
            {steps.map((step) => {
              const Arrow = FLOW_ICONS[step.flow];
              const words = stepLabel(step);
              return (
                <Fragment key={step.relation.id}>
                  <button
                    type="button"
                    onClick={() => onRelation(step.relation.id)}
                    className="my-0.5 flex min-h-[36px] w-full items-center gap-2 rounded-lg pl-1 text-left text-xs text-ink-600 hover:bg-paper-100"
                    aria-label={`Bronnen van ${entityName(entities, step.from)} ${words} ${entityName(entities, step.to)}`}
                  >
                    <Arrow size={14} className="shrink-0" style={{ color: filterColor(displayFilter(step.relation)) }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      {words}
                      {step.relation.auto_approved ? <AutoApprovedTag className="ml-1.5 align-middle" /> : null}
                    </span>
                    <Info size={14} className="shrink-0 text-ink-400" aria-hidden="true" />
                  </button>
                  <p className="font-semibold leading-snug text-ink-900">{entityName(entities, step.to)}</p>
                </Fragment>
              );
            })}
            {route.historic || sharers.length || extra ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {extra}
                {route.historic ? <Tag>historisch verband</Tag> : null}
                {sharers.length ? <Tag tone="orange">geldt ook voor {sharers.join(", ")}</Tag> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
