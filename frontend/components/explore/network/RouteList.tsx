"use client";

import { Fragment, type ReactNode } from "react";
import { ArrowDown, Info } from "lucide-react";

import { filterColor, pmRelationLabel, pmRelationReverseLabel } from "@/lib/explore/labels";
import { displayFilter } from "@/lib/explore/pm-graph";
import { routeSteps } from "@/lib/explore/pm-paths";
import type { PmEntity, PmPathRoute, PmRelation } from "@/lib/types";

import { Tag } from "../ui/primitives";
import { AutoApprovedTag } from "./MiniEgoNetwork";

/**
 * Epic 13: routes as readable chains, one card per route: "NU.nl · is eigendom van · DPG Media ·
 * krijgt advertenties van · Shell". Every step can be opened for its sources.
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
        const steps = routeSteps(route, entities, relations);
        const sharers = route.shared_with.map((id) => entities.get(id)?.name).filter(Boolean);
        const extra = note?.(route) ?? null;
        return (
          <li key={`${route.from}-${route.to}-${route.relations.join(".")}`} className="rounded-2xl border border-paper-300 bg-paper-50 p-3">
            <p className="font-semibold leading-snug text-ink-900">{entities.get(route.from)?.name ?? route.from}</p>
            {steps.map((step) => {
              const filter = displayFilter(step.relation);
              return (
                <Fragment key={step.relation.id}>
                  <button
                    type="button"
                    onClick={() => onRelation(step.relation.id)}
                    className="my-0.5 flex min-h-[36px] w-full items-center gap-2 rounded-lg pl-1 text-left text-xs text-ink-600 hover:bg-paper-100"
                    aria-label={`Bronnen van ${step.from?.name ?? ""} ${step.forward ? pmRelationLabel(step.relation.relation_type) : pmRelationReverseLabel(step.relation.relation_type)} ${step.to?.name ?? ""}`}
                  >
                    <ArrowDown size={14} className="shrink-0" style={{ color: filterColor(filter) }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      {step.forward ? pmRelationLabel(step.relation.relation_type) : pmRelationReverseLabel(step.relation.relation_type)}
                      {step.relation.auto_approved ? <AutoApprovedTag className="ml-1.5 align-middle" /> : null}
                    </span>
                    <Info size={14} className="shrink-0 text-ink-400" aria-hidden="true" />
                  </button>
                  <p className="font-semibold leading-snug text-ink-900">{step.to?.name ?? ""}</p>
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
