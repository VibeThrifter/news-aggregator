"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Network } from "lucide-react";

import { whyRoutesFor } from "@/lib/explore/why";

import { useExplore } from "../ExploreContext";
import { RouteList } from "../network/RouteList";
import { Eyebrow, Tag } from "../ui/primitives";
import { useWhyRoutes } from "./useWhyRoutes";

/**
 * Epic 13 "Waarom zo?" in the outlet balloon: routes (at most two steps) between this outlet and the
 * parties of this news in the propaganda model, its own explanations before the ones every outlet
 * shares. "Geen route" is an outcome too; ownership is no proof of steering.
 */
export function WhyRoutes({ outletKey }: { outletKey: string }) {
  const { exploration, panel, eventId } = useExplore();
  const outlet = exploration.index.outlet(outletKey);
  const pmId = outlet && !outlet.isInternational ? outlet.profile?.pmEntityId ?? null : null;
  const why = useWhyRoutes(pmId !== null);
  const routes = useMemo(() => (pmId !== null ? whyRoutesFor(why.paths, pmId, why.newsOutletIds) : []), [pmId, why.paths, why.newsOutletIds]);
  const entities = useMemo(() => new Map((why.paths?.entities ?? []).map((entity) => [entity.id, entity])), [why.paths]);
  const relations = useMemo(() => new Map((why.paths?.relations ?? []).map((relation) => [relation.id, relation])), [why.paths]);
  if (!outlet || pmId === null || why.unavailable) return null;

  const networkHref = `/event/${encodeURIComponent(exploration.input.event.slug ?? String(eventId))}/netwerk?focus=${encodeURIComponent(`pm:${pmId}`)}`;
  const ownName = outlet.name;
  return (
    <div className="space-y-1.5" aria-busy={why.loading}>
      <Eyebrow>Waarom zo? Verbanden met dit nieuws</Eyebrow>
      {why.loading ? <p className="text-sm text-ink-500">Zoeken naar verbanden in het propagandamodel…</p> : null}
      {!why.loading && why.noActors ? <p className="text-sm text-ink-600">Geen partijen uit dit nieuws in het propagandamodel.</p> : null}
      {!why.loading && !why.noActors && routes.length === 0 ? (
        <p className="text-sm text-ink-600">
          Geen route binnen twee stappen tussen {ownName} en de partijen in dit nieuws. Dat is ook een uitkomst.
        </p>
      ) : null}
      {routes.length ? (
        <RouteList
          routes={routes.map((item) => item.route)}
          entities={entities}
          relations={relations}
          onRelation={(id) => panel.open(`pm:relation:${id}`)}
          label={`Verbanden van ${ownName} met dit nieuws`}
          note={(route) => (route.shared_with.some((id) => why.newsOutletIds.includes(id)) ? null : <Tag tone="blue">alleen {ownName} in dit nieuws</Tag>)}
        />
      ) : null}
      {routes.some((item) => item.ownership) ? (
        <p className="text-xs text-ink-500">Eigendom zegt nog niet dat de eigenaar de berichtgeving stuurt: bezit is geen bewijs van invloed.</p>
      ) : null}
      {!why.loading ? (
        <Link
          href={networkHref}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 bg-paper-100 px-3 py-1 text-xs font-medium text-ink-700 hover:bg-paper-200"
        >
          <Network size={14} aria-hidden="true" /> Toon in netwerk
        </Link>
      ) : null}
    </div>
  );
}
