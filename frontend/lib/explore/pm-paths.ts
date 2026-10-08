/**
 * Epic 13 "Waarom zo?": routes between two sets of propaganda-model entities — the network drawn
 * *between* things instead of *around* one node. Pure and deterministic.
 *
 * This module is the contract of the SQL function pm_paths (migration 007): the demo
 * (pm-local.ts) runs it in the browser, Supabase runs the SQL version. Both use only
 * multiplication, division and square roots in the same order, so they rank routes identically
 * (validated on the real model). Keep them in sync.
 */

import type { PmEntity, PmPathRoute, PmPaths, PmRelation } from "@/lib/types";

/** Input caps: at most 12 `from` ids, 40 `to` ids, 3 hops, 5 routes per pair and 60 routes per call. */
export const PATH_LIMITS = { from: 12, to: 40, maxHops: 3, perPair: 5, routes: 60 } as const;

/**
 * How strongly a kind of relation ties two parties. Only orders routes; never shown (data licence:
 * no scores). Everything not listed (beinvloeding, algoritmische_filtering, …) counts 0.4.
 */
export const RELATION_STRENGTH: Readonly<Record<string, number>> = {
  eigendom: 1.0,
  financiering: 0.9,
  investering: 0.8,
  adverteerder: 0.8,
  donor: 0.8,
  bestuurder: 0.8,
  personeel: 0.7,
  dienstverband: 0.7,
  woordvoerder_van: 0.7,
  draaideur: 0.7,
  mediaplatform: 0.7,
  adviseur: 0.6,
  bron_van: 0.6,
  flak: 0.6,
  censuur: 0.6,
  intimidatie: 0.6,
  cooptatie: 0.6,
  lobbyt: 0.6,
  lidmaatschap: 0.5,
  citeert: 0.5,
  framing: 0.5,
  etikettering: 0.5,
  zelfcensuur: 0.5,
  regulering: 0.5,
  alliantie: 0.5,
  oppositie: 0.5,
  // Epic 15 (migration 016): a gift ties two parties; offices and hierarchy are weak, because
  // ministries, councils and the Kamer connect everything
  geschenk: 0.5,
  controle: 0.4,
  ambt: 0.35,
  zeggenschap: 0.35,
};
export const DEFAULT_STRENGTH = 0.4;

export const CERTAINTY_FACTOR: Readonly<Record<string, number>> = { onderbouwd: 1.0, aannemelijk: 0.85 };
export const DEFAULT_CERTAINTY = 0.7;

/** A relation that ended before the reference date still counts, at half strength */
export const HISTORIC_FACTOR = 0.5;

export function relationStrength(type: string): number {
  return RELATION_STRENGTH[type] ?? DEFAULT_STRENGTH;
}

/** A party linked to everything explains nothing: 1/√(1 + degree) for every intermediate station. */
export function hubFactor(degree: number | null | undefined): number {
  return 1 / Math.sqrt(1 + Math.max(0, degree ?? 0));
}

/** First day of a (partial) date: "2020" → "2020-01-01", "2020-04" → "2020-04-01". */
export function periodStart(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text.length === 4) return `${text}-01-01`;
  if (text.length === 7) return `${text}-01`;
  return text.slice(0, 10);
}

/** Last day of a (partial) date: "2020" → "2020-12-31", "2020-04" → "2020-04-31" (compared as text). */
export function periodEnd(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text.length === 4) return `${text}-12-31`;
  if (text.length === 7) return `${text}-31`;
  return text.slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The reference date: a valid YYYY-MM-DD, else today (UTC). */
export function referenceDate(at?: string | null, now: Date = new Date()): string {
  return at && ISO_DATE.test(at) ? at : now.toISOString().slice(0, 10);
}

/** Weight of a relation at a date: null when it did not exist yet, historic when it had ended. */
export function relationWeight(
  relation: Pick<PmRelation, "relation_type" | "certainty_label" | "active_from" | "active_until">,
  at: string,
): { weight: number; historic: boolean } | null {
  const start = periodStart(relation.active_from);
  if (start !== null && start > at) return null;
  const end = periodEnd(relation.active_until);
  const historic = end !== null && end < at;
  const certainty = CERTAINTY_FACTOR[relation.certainty_label ?? ""] ?? DEFAULT_CERTAINTY;
  return { weight: relationStrength(relation.relation_type) * certainty * (historic ? HISTORIC_FACTOR : 1), historic };
}

/** Element-wise, then shorter first (the order of int[] in PostgreSQL). */
export function compareIds(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** The first `cap` ids, without duplicates and unknown ids (the order of the SQL function). */
function cleanIds(ids: readonly number[] | null | undefined, cap: number, known: ReadonlySet<number>): number[] {
  return Array.from(new Set((ids ?? []).slice(0, cap).filter((id) => Number.isInteger(id) && known.has(id)))).sort((a, b) => a - b);
}

const clamp = (value: number | null | undefined, low: number, high: number, fallback: number) =>
  Math.min(Math.max(Number.isFinite(value) ? Math.trunc(value as number) : fallback, low), high);

interface Candidate {
  from: number;
  to: number;
  nodes: number[];
  relations: number[];
  types: string[];
  score: number;
  historic: boolean;
}

/** Best first, then fewer hops, then relation ids (the order within one pair). */
const byQuality = (a: Candidate, b: Candidate) =>
  b.score - a.score || a.relations.length - b.relations.length || compareIds(a.relations, b.relations);

/** The same explanation: same kinds of relation through the same intermediate stations. */
const signature = (candidate: Candidate) => `${candidate.types.join(",")}|${candidate.nodes.slice(1, -1).join(",")}`;

export interface PathOptions {
  maxHops?: number;
  /** Routes per (from, to) pair */
  limit?: number;
  /** Reference date YYYY-MM-DD (default: today) */
  at?: string | null;
  now?: Date;
}

/**
 * All simple routes of at most `maxHops` relations from any `from` to any `to` entity. Intermediate
 * stations are never one of the given entities. Per pair the best `limit` routes, at most 60 in all.
 */
export function findPaths(
  entities: readonly PmEntity[],
  relations: readonly PmRelation[],
  fromIds: readonly number[],
  toIds: readonly number[],
  options: PathOptions = {},
): PmPaths {
  const maxHops = clamp(options.maxHops, 1, PATH_LIMITS.maxHops, 3);
  const limit = clamp(options.limit, 1, PATH_LIMITS.perPair, 2);
  const at = referenceDate(options.at, options.now);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const known = new Set(entityById.keys());
  const from = cleanIds(fromIds, PATH_LIMITS.from, known);
  const to = cleanIds(toIds, PATH_LIMITS.to, known);
  const empty: PmPaths = { routes: [], entities: [], relations: [], truncated: false, max_hops: maxHops, at };
  if (from.length === 0 || to.length === 0) return empty;

  const endpoints = new Set([...from, ...to]);
  const targets = new Set(to);
  const relationById = new Map<number, PmRelation>();
  const adjacency = new Map<number, { other: number; relation: PmRelation; weight: number; historic: boolean }[]>();
  for (const relation of relations) {
    if (relation.source_id === relation.target_id) continue;
    if (!known.has(relation.source_id) || !known.has(relation.target_id)) continue;
    const weighed = relationWeight(relation, at);
    if (!weighed) continue;
    relationById.set(relation.id, relation);
    for (const [a, b] of [
      [relation.source_id, relation.target_id],
      [relation.target_id, relation.source_id],
    ]) {
      const list = adjacency.get(a) ?? [];
      list.push({ other: b, relation, ...weighed });
      adjacency.set(a, list);
    }
  }

  // Depth-first from every `from`; stop at any given entity (never an intermediate station)
  const candidates = new Map<string, Candidate>();
  for (const start of from) {
    const walk = (node: number, nodes: number[], rels: number[], types: string[], weights: number[], hubs: number[], historic: boolean) => {
      for (const step of adjacency.get(node) ?? []) {
        if (nodes.includes(step.other)) continue;
        const nextNodes = [...nodes, step.other];
        const nextRels = [...rels, step.relation.id];
        const nextTypes = [...types, step.relation.relation_type];
        const nextWeights = [...weights, step.weight];
        const nextHistoric = historic || step.historic;
        if (targets.has(step.other) && step.other !== start) {
          // Same order of operations as the SQL function: w1 × w2 × w3 × h1 × h2
          let score = nextWeights[0];
          for (let i = 1; i < nextWeights.length; i++) score = score * nextWeights[i];
          for (const hub of hubs) score = score * hub;
          const candidate: Candidate = { from: start, to: step.other, nodes: nextNodes, relations: nextRels, types: nextTypes, score, historic: nextHistoric };
          const key = `${start}>${step.other}>${nextNodes.join(",")}`;
          const existing = candidates.get(key);
          if (!existing || byQuality(candidate, existing) < 0) candidates.set(key, candidate);
        }
        if (endpoints.has(step.other) || nextRels.length >= maxHops) continue;
        walk(step.other, nextNodes, nextRels, nextTypes, nextWeights, [...hubs, hubFactor(entityById.get(step.other)?.degree)], nextHistoric);
      }
    };
    walk(start, [start], [], [], [], [], false);
  }

  // Who else has the same explanation to the same target
  const sharers = new Map<string, Set<number>>();
  candidates.forEach((candidate) => {
    const key = `${candidate.to}|${signature(candidate)}`;
    sharers.set(key, (sharers.get(key) ?? new Set<number>()).add(candidate.from));
  });

  // Per pair the best `limit`, then at most 60 in all
  const byPair = new Map<string, Candidate[]>();
  candidates.forEach((candidate) => {
    const key = `${candidate.from}>${candidate.to}`;
    byPair.set(key, [...(byPair.get(key) ?? []), candidate]);
  });
  const ranked: (Candidate & { rank: number })[] = [];
  byPair.forEach((list) => {
    list
      .sort(byQuality)
      .slice(0, limit)
      .forEach((candidate, index) => ranked.push({ ...candidate, rank: index + 1 }));
  });
  ranked.sort((a, b) => byQuality(a, b) || a.from - b.from || a.to - b.to);
  const kept = ranked.slice(0, PATH_LIMITS.routes);

  const routes: PmPathRoute[] = kept.map((candidate) => ({
    from: candidate.from,
    to: candidate.to,
    rank: candidate.rank,
    hops: candidate.relations.length,
    nodes: candidate.nodes,
    relations: candidate.relations,
    historic: candidate.historic,
    shared_with: Array.from(sharers.get(`${candidate.to}|${signature(candidate)}`) ?? [])
      .filter((id) => id !== candidate.from)
      .sort((a, b) => a - b),
  }));
  const nodeIds = Array.from(new Set(kept.flatMap((candidate) => candidate.nodes))).sort((a, b) => a - b);
  const relationIds = Array.from(new Set(kept.flatMap((candidate) => candidate.relations))).sort((a, b) => a - b);
  return {
    routes,
    entities: nodeIds.map((id) => entityById.get(id) as PmEntity),
    relations: relationIds.map((id) => relationById.get(id) as PmRelation),
    truncated: ranked.length > kept.length,
    max_hops: maxHops,
    at,
  };
}

/** Relation ids of a route, resolved (missing ones skipped). */
export function routeRelations(route: Pick<PmPathRoute, "relations">, relations: ReadonlyMap<number, PmRelation>): PmRelation[] {
  return route.relations.map((id) => relations.get(id)).filter((relation): relation is PmRelation => Boolean(relation));
}

/** One undirected edge per unordered pair: routes a→b and b→a with the same nodes count once. */
export function uniqueRoutes(routes: readonly PmPathRoute[]): PmPathRoute[] {
  const seen = new Set<string>();
  const result: PmPathRoute[] = [];
  for (const route of routes) {
    const forward = route.nodes.join(",");
    const backward = [...route.nodes].reverse().join(",");
    if (seen.has(forward) || seen.has(backward)) continue;
    seen.add(forward);
    result.push(route);
  }
  return result;
}

/**
 * The best `max` routes, one per pair of nodes (a route and its mirror count once); explanations that
 * few others share first, so what distinguishes comes before what everyone has. Keeps only the
 * entities and relations on the chosen routes.
 */
export function pickRoutes(paths: PmPaths, max: number): PmPaths {
  const routes = uniqueRoutes(paths.routes)
    .map((route, index) => ({ route, index }))
    .sort((a, b) => a.route.shared_with.length - b.route.shared_with.length || a.index - b.index)
    .slice(0, max)
    .map((item) => item.route);
  const nodes = new Set(routes.flatMap((route) => route.nodes));
  const relations = new Set(routes.flatMap((route) => route.relations));
  return {
    ...paths,
    routes,
    entities: paths.entities.filter((entity) => nodes.has(entity.id)),
    relations: paths.relations.filter((relation) => relations.has(relation.id)),
  };
}

/** One step of a route, read from the route's start: "NU.nl ← is eigenaar van — DPG Media". */
export interface RouteStep {
  from: PmEntity | undefined;
  to: PmEntity | undefined;
  relation: PmRelation;
  /** The relation points along the route (from → to); otherwise it points back */
  forward: boolean;
}

/** The steps of a route with the entities and relations it needs (missing relations are skipped). */
export function routeSteps(
  route: Pick<PmPathRoute, "nodes" | "relations">,
  entities: ReadonlyMap<number, PmEntity>,
  relations: ReadonlyMap<number, PmRelation>,
): RouteStep[] {
  const steps: RouteStep[] = [];
  route.relations.forEach((id, index) => {
    const relation = relations.get(id);
    if (!relation) return;
    const fromId = route.nodes[index];
    steps.push({ from: entities.get(fromId), to: entities.get(route.nodes[index + 1]), relation, forward: relation.source_id === fromId });
  });
  return steps;
}
