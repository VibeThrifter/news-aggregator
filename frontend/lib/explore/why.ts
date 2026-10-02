/**
 * Epic 13 "Waarom zo?": routes between the outlets and the parties of a news item (pm_paths), with
 * what sets an outlet apart first. A route that every outlet of the news shares (via the ANP, a
 * ministry, …) explains no difference between them. Pure.
 */

import type { PmPathRoute, PmPaths } from "@/lib/types";

/** Route cards per outlet in its balloon */
export const WHY_ROUTES_SHOWN = 3;

/** Kinds of relation that are about ownership: "bezit ≠ begunstigde" applies to them */
const OWNERSHIP_TYPES = new Set(["eigendom", "investering"]);

export interface WhyRoute {
  route: PmPathRoute;
  /** Other outlets of this news with the same explanation */
  sharedInNews: number[];
  /** The route runs through an ownership relation */
  ownership: boolean;
}

/** The routes of one outlet to the parties of the news: its own explanations first, then the shared ones. */
export function whyRoutesFor(
  paths: Pick<PmPaths, "routes" | "relations"> | null | undefined,
  outletId: number,
  newsOutletIds: readonly number[],
  max: number = WHY_ROUTES_SHOWN,
): WhyRoute[] {
  if (!paths) return [];
  const types = new Map(paths.relations.map((relation) => [relation.id, relation.relation_type]));
  return paths.routes
    .filter((route) => route.from === outletId)
    .map((route, index) => ({
      route,
      index,
      sharedInNews: route.shared_with.filter((id) => newsOutletIds.includes(id)),
      ownership: route.relations.some((id) => OWNERSHIP_TYPES.has(types.get(id) ?? "")),
    }))
    .sort((a, b) => a.sharedInNews.length - b.sharedInNews.length || a.index - b.index)
    .slice(0, max)
    .map(({ route, sharedInNews, ownership }) => ({ route, sharedInNews, ownership }));
}

export interface Touchpoint {
  outletId: number;
  /** The outlet brought this news (otherwise: it has a link with the news but did not report it) */
  covered: boolean;
  routes: PmPathRoute[];
}

/**
 * Per followed outlet its routes to the parties of the news: the outlets that brought the news first,
 * then those that did not ("zweeg"), each with most routes first.
 */
export function touchpoints(paths: Pick<PmPaths, "routes"> | null | undefined, newsOutletIds: readonly number[]): Touchpoint[] {
  if (!paths) return [];
  const byOutlet = new Map<number, PmPathRoute[]>();
  for (const route of paths.routes) byOutlet.set(route.from, [...(byOutlet.get(route.from) ?? []), route]);
  return Array.from(byOutlet.entries())
    .map(([outletId, routes]) => ({ outletId, covered: newsOutletIds.includes(outletId), routes }))
    .sort((a, b) => Number(b.covered) - Number(a.covered) || b.routes.length - a.routes.length || a.outletId - b.outletId);
}
