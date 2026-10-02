/**
 * Propaganda-model exploration: merge step-by-step neighbourhoods into one growing graph and turn it
 * into a scene for the network view.
 */

import type { EntityKind, PmBreakdown, PmEntity, PmMatch, PmNeighborhood, PmPaths, PmRelation } from "@/lib/types";

import { FILTERS } from "./labels";
import { hubFactor, referenceDate, relationWeight } from "./pm-paths";

export interface PmSeed {
  id: number;
  /** Outlet of this event that maps to this entity */
  outletKey?: string;
  /** Why it is a seed: outlet of the event, actor in the event, or chosen by the user */
  reason: "outlet" | "actor" | "focus";
}

/** Only keep matches whose type fits the entity kind (no person <-> organisation mix-ups). */
export function compatibleMatches(matches: PmMatch[], kind: EntityKind | null): PmMatch[] {
  const unique = matches.filter((match, i) => matches.findIndex((other) => other.entity_id === match.entity_id) === i);
  if (!kind) return unique;
  if (kind === "person") return unique.filter((match) => match.type === "persoon");
  return unique.filter((match) => match.type !== "persoon");
}

/**
 * The most likely propaganda-model entity for a name: an exact match on the preferred alias first,
 * then the best connected one (degree), then the order of the aliases. Deterministic.
 */
export function bestMatch(matches: PmMatch[], aliases: string[]): PmMatch | null {
  if (matches.length === 0) return null;
  const rank = (match: PmMatch) => {
    const index = aliases.indexOf(match.alias);
    return index === -1 ? aliases.length : index;
  };
  return [...matches].sort(
    (a, b) =>
      Number(rank(b) === 0) - Number(rank(a) === 0) ||
      (b.degree ?? -1) - (a.degree ?? -1) ||
      rank(a) - rank(b) ||
      a.entity_id - b.entity_id,
  )[0];
}

/** An entity counts as "in the network" from this many relations; fewer = the research block */
export const MIN_NETWORK_DEGREE = 3;

/** Relations without any of the six filters */
export const PM_OTHER = "overig";

const REAL_FILTERS = new Set<string>(FILTERS.map((filter) => filter.id));

/** Filters shown when you open the network; the others can be switched on in the legend or by exploring along them. */
export const DEFAULT_VISIBLE_FILTERS = ["eigendom", "sourcing", "ideologie"];
export const DEFAULT_HIDDEN_FILTERS = [...FILTERS.map((filter) => filter.id).filter((id) => !DEFAULT_VISIBLE_FILTERS.includes(id)), PM_OTHER];

/** All filters of a relation: its primary filter plus those of its mechanism (mechanism_filters). */
export function relationFilters(relation: Pick<PmRelation, "filter" | "filters">): string[] {
  const list = [relation.filter, ...(relation.filters ?? [])].filter((filter): filter is string => Boolean(filter) && REAL_FILTERS.has(filter as string));
  return Array.from(new Set(list));
}

/** Keys a relation counts and hides under ("overig" when it has no filter). */
export function relationFilterKeys(relation: Pick<PmRelation, "filter" | "filters">): string[] {
  const list = relationFilters(relation);
  return list.length ? list : [PM_OTHER];
}

export function isRelationVisible(relation: Pick<PmRelation, "filter" | "filters">, hidden: ReadonlySet<string>): boolean {
  return relationFilterKeys(relation).some((key) => !hidden.has(key));
}

/** The filter an edge is drawn in: the explored filter, else the primary one, else the first visible one. */
export function displayFilter(
  relation: Pick<PmRelation, "filter" | "filters">,
  options: { prefer?: string | null; hidden?: ReadonlySet<string> } = {},
): string | null {
  const filters = relationFilters(relation);
  if (options.prefer && filters.includes(options.prefer)) return options.prefer;
  const visible = filters.filter((filter) => !options.hidden?.has(filter));
  if (relation.filter && visible.includes(relation.filter)) return relation.filter;
  return visible[0] ?? filters[0] ?? null;
}

/** Number of relations per filter key (a relation with several filters counts under each). */
export function countFilters(relations: Pick<PmRelation, "filter" | "filters">[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const relation of relations) {
    for (const key of relationFilterKeys(relation)) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Per filter key: with whom (type of the other party) and how (mechanism) the relations touching an
 * entity are. Same contract as `breakdown` of pm_neighborhood; most frequent first.
 */
export function countBreakdown(
  relations: Pick<PmRelation, "source_id" | "target_id" | "filter" | "filters" | "mechanism">[],
  centerId: number,
  typeOf: (id: number) => string | null | undefined,
): Record<string, PmBreakdown> {
  const types: Record<string, Record<string, number>> = {};
  const mechanisms: Record<string, Record<string, number>> = {};
  const add = (counts: Record<string, Record<string, number>>, key: string, value: string) => {
    counts[key] = counts[key] ?? {};
    counts[key][value] = (counts[key][value] ?? 0) + 1;
  };
  for (const relation of relations) {
    const type = typeOf(relation.source_id === centerId ? relation.target_id : relation.source_id) || "onbekend";
    for (const key of relationFilterKeys(relation)) {
      add(types, key, type);
      if (relation.mechanism?.trim()) add(mechanisms, key, relation.mechanism);
    }
  }
  const sorted = (counts: Record<string, number> = {}) =>
    Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return Object.fromEntries(
    Object.keys(types)
      .sort()
      .map((key) => [key, { types: sorted(types[key]), mechanisms: sorted(mechanisms[key]) }]),
  );
}

/** Every filter key of the legend: the six filters and "overig". */
export const ALL_FILTER_KEYS = [...FILTERS.map((filter) => filter.id), PM_OTHER];

/** Filter keys switched on in the legend. */
export function visibleFilterKeys(hidden: ReadonlySet<string> | readonly string[]): string[] {
  const off = new Set(hidden);
  return ALL_FILTER_KEYS.filter((key) => !off.has(key));
}

/** The filters an expansion loads: those switched on (null = all, no restriction needed). */
export function expansionFilters(hidden: ReadonlySet<string> | readonly string[]): string[] | null {
  const visible = visibleFilterKeys(hidden);
  return visible.length === ALL_FILTER_KEYS.length ? null : visible;
}

/** A relation belongs to one of these filters (null/empty = every relation). */
export function matchesFilters(relation: Pick<PmRelation, "filter" | "filters">, filters?: readonly string[] | null): boolean {
  return !filters?.length || relationFilterKeys(relation).some((key) => filters.includes(key));
}

/** Store key of a neighbourhood request: entity + (sorted) filter set. */
export const hoodKey = (id: number, filters?: readonly string[] | null) =>
  filters?.length ? `${id}:${Array.from(new Set(filters)).sort().join(",")}` : String(id);

/** The filters of a store key ("12:eigendom,sourcing" → both; "12" → null = all). */
export function hoodKeyFilters(key: string): string[] | null {
  const colon = key.indexOf(":");
  return colon === -1 ? null : key.slice(colon + 1).split(",").filter(Boolean);
}

/** A complete neighbourhood restricted to some filters (so a full download is reused instead of fetched again). */
export function filterNeighborhood(hood: PmNeighborhood, filters: readonly string[]): PmNeighborhood {
  const relations = hood.relations.filter((relation) => matchesFilters(relation, filters));
  const ids = new Set(relations.map((relation) => otherEnd(relation, hood.center.id)));
  return {
    ...hood,
    entities: hood.entities.filter((entity) => ids.has(entity.id)),
    relations,
    total: relations.length,
    truncated: false,
    filters: [...filters],
  };
}

/**
 * A small neighbourhood with only these relations of `center`: how nodes taken out of a bundle join
 * the graph without pulling in the rest of the list behind it. No counts, so it never overrides them.
 */
export function pickHood(center: PmEntity, relations: PmRelation[], entities: PmEntity[], filter: string): [string, PmNeighborhood] {
  const ids = Array.from(new Set(relations.map((relation) => otherEnd(relation, center.id)))).sort((a, b) => a - b);
  return [
    `${hoodKey(center.id, [filter])}#${ids.join(",")}`,
    {
      center,
      entities: entities.filter((entity) => ids.includes(entity.id)),
      relations,
      total: relations.length,
      truncated: true,
      filters: [filter],
    },
  ];
}

/** The last expansion: the view glides to this node and its new neighbours. */
export interface PmExpansion {
  id: number;
  filters: string[] | null;
}

export interface PmMerged {
  entities: Map<number, PmEntity>;
  relations: Map<number, PmRelation>;
  /** Total number of relations per expanded entity (may exceed what is loaded) */
  totals: Map<number, number>;
  /** Relations per filter for every entity whose neighbourhood was requested */
  filterCounts: Map<number, Record<string, number>>;
}

/** One graph from loaded neighbourhoods plus routes (Epic 13); routes add no counts. */
export function mergeNeighborhoods(neighborhoods: PmNeighborhood[], paths: PmPaths[] = []): PmMerged {
  const entities = new Map<number, PmEntity>();
  const relations = new Map<number, PmRelation>();
  const totals = new Map<number, number>();
  const filterCounts = new Map<number, Record<string, number>>();
  for (const hood of neighborhoods) {
    entities.set(hood.center.id, hood.center);
    if (!hood.filters?.length) totals.set(hood.center.id, hood.total);
    if (hood.filter_counts) filterCounts.set(hood.center.id, hood.filter_counts);
    for (const entity of hood.entities) {
      if (!entities.has(entity.id)) entities.set(entity.id, entity);
    }
    for (const relation of hood.relations) {
      relations.set(relation.id, relation);
    }
  }
  for (const result of paths) {
    for (const entity of result.entities) {
      if (!entities.has(entity.id)) entities.set(entity.id, entity);
    }
    for (const relation of result.relations) {
      relations.set(relation.id, relation);
    }
  }
  return { entities, relations, totals, filterCounts };
}

/** Everything on some routes: drawn whatever the filters or bundles say, because you asked for it. */
export function routeParts(paths: PmPaths[]): { nodes: Set<number>; relations: Set<number> } {
  const nodes = new Set<number>();
  const relations = new Set<number>();
  for (const result of paths) {
    for (const route of result.routes) {
      route.nodes.forEach((id) => nodes.add(id));
      route.relations.forEach((id) => relations.add(id));
    }
  }
  return { nodes, relations };
}

/** Loaded relations that touch an entity, optionally only via some filters. */
export function relationsOf(merged: PmMerged, id: number, filters: readonly string[] | null = null): PmRelation[] {
  return Array.from(merged.relations.values()).filter(
    (relation) => (relation.source_id === id || relation.target_id === id) && matchesFilters(relation, filters),
  );
}

export const otherEnd = (relation: Pick<PmRelation, "source_id" | "target_id">, id: number) =>
  relation.source_id === id ? relation.target_id : relation.source_id;

/**
 * Neighbours drawn per filter around a node (Epic 13): none around a node you only see (only what
 * connects it to the rest is drawn), three around a node you asked about (along that filter). The
 * rest of an asked node goes into a bundle ("+84").
 */
export const SHOWN_PER_FILTER = { expanded: 3, collapsed: 0 } as const;

export const bundleKey = (anchorId: number, filter: string) => `${anchorId}:${filter}`;
export const bundleNodeId = (anchorId: number, filter: string) => `bundle:${bundleKey(anchorId, filter)}`;

/** The relations of an expanded node via one filter that are not drawn, summarised as one "+N" node. */
export interface PmBundle {
  anchorId: number;
  filter: string;
  /** Relations via this filter in the model that are not drawn (loaded or not) */
  count: number;
  /** The loaded ones, most prominent first */
  members: PmRelation[];
}

/**
 * Ranking inside a filter (Epic 13): the most *specific* neighbours first — a strong, well-founded,
 * current tie with a party that is not linked to everything — then the best documented relation,
 * then by name. The old ranking (most relations first) put the hubs that explain nothing on top.
 */
export interface Specificity {
  id: number;
  score: number;
  sources: number;
  name: string;
}

export const bySpecificity = (x: Specificity, y: Specificity) =>
  y.score - x.score || y.sources - x.sources || x.name.localeCompare(y.name, "nl");

export function specificityOf(
  entity: Pick<PmEntity, "id" | "degree" | "name"> | undefined,
  id: number,
  relations: Pick<PmRelation, "relation_type" | "certainty_label" | "active_from" | "active_until" | "source_count">[] = [],
  at: string = referenceDate(),
): Specificity {
  const tie = Math.max(0, ...relations.map((relation) => relationWeight(relation, at)?.weight ?? 0));
  return {
    id,
    score: tie * hubFactor(entity?.degree),
    sources: Math.max(0, ...relations.map((relation) => relation.source_count ?? 0)),
    name: entity?.name ?? "",
  };
}

export interface PmSceneNode {
  id: string;
  pmId: number | null;
  label: string;
  type: string;
  filter: string | null;
  weight: number;
  seed?: PmSeed;
  expanded: boolean;
  isEvent?: boolean;
  bundle?: PmBundle;
}

export interface PmSceneEdge {
  id: string;
  relationId: number | null;
  /** A relation of the model, the line from "Dit nieuws" to a seed, or the line to a bundle */
  kind: "relation" | "seed" | "bundle";
  source: string;
  target: string;
  type: string;
  /** Filter the edge is drawn in */
  filter: string | null;
  filters: string[];
  historic: boolean;
  /** Has a direction (most relations: "A is eigenaar van B"); drawn with an arrow */
  directed: boolean;
}

/** Relation types that read the same both ways */
const SYMMETRIC_TYPES = new Set(["alliantie", "oppositie"]);

export function isDirected(relation: Pick<PmRelation, "relation_type" | "bidirectional">): boolean {
  return !relation.bidirectional && !SYMMETRIC_TYPES.has(relation.relation_type);
}

export const pmNodeId = (id: number) => `pm:${id}`;
export const PM_EVENT_NODE = "pm-event";

/** A relation that ended before this year (shown dashed as "historisch"). */
export function isHistoric(relation: Pick<PmRelation, "active_until">, now: Date = new Date()): boolean {
  if (!relation.active_until) return false;
  const year = Number(String(relation.active_until).slice(0, 4));
  if (!Number.isFinite(year)) return false;
  const until = new Date(String(relation.active_until));
  return Number.isNaN(until.getTime()) ? year < now.getFullYear() : until.getTime() < now.getTime();
}

/** A leftover smaller than this whose relations are all loaded is simply drawn (a "+1" bundle is silly) */
const MIN_BUNDLE = 2;

export function pmScene(
  merged: PmMerged,
  seeds: PmSeed[],
  expanded: ReadonlySet<number>,
  options: {
    hiddenFilters?: ReadonlySet<string>;
    /** Per expanded node the filters it was expanded along (missing = all) */
    expandedFilters?: ReadonlyMap<number, ReadonlySet<string>>;
    /** Taken out of a bundle by the user: always drawn */
    revealed?: ReadonlySet<number>;
    /** On a route the user asked for (Epic 13): always drawn, their relations always visible */
    routeNodes?: ReadonlySet<number>;
    routeRelations?: ReadonlySet<number>;
    maxNodes?: number;
    eventLabel?: string;
    now?: Date;
    /** The latest expansion: the view glides to it; its neighbours are never dropped by the node cap */
    latest?: PmExpansion | null;
  } = {},
): { nodes: PmSceneNode[]; edges: PmSceneEdge[]; latestIds: string[]; bundles: PmBundle[] } {
  const hidden = options.hiddenFilters ?? new Set<string>();
  const revealed = options.revealed ?? new Set<number>();
  const routeNodes = options.routeNodes ?? new Set<number>();
  const routeRelations = options.routeRelations ?? new Set<number>();
  const maxNodes = options.maxNodes ?? 100;
  const at = referenceDate(null, options.now);
  const seedById = new Map(seeds.map((seed) => [seed.id, seed]));
  const entityOf = (id: number) => merged.entities.get(id);
  const visibleKeys = ALL_FILTER_KEYS.filter((key) => !hidden.has(key));

  const relations = Array.from(merged.relations.values()).filter(
    (relation) => isRelationVisible(relation, hidden) || routeRelations.has(relation.id),
  );
  const latest = options.latest && merged.entities.has(options.latest.id) ? options.latest : null;

  // Anchors: the nodes whose neighbours are drawn (seeds, expanded nodes, the node expanded last)
  const anchors = new Set<number>(
    [...Array.from(seedById.keys()), ...Array.from(expanded), ...(latest ? [latest.id] : [])].filter((id) => merged.entities.has(id)),
  );
  const expandedVia = (id: number, filter: string) => {
    if (latest?.id === id && (!latest.filters || latest.filters.includes(filter))) return true;
    if (!expanded.has(id)) return false;
    const via = options.expandedFilters?.get(id);
    return !via || via.has(filter);
  };

  // Neighbours of anchors: which anchors each one touches, and per (anchor, filter) the relations with it
  const touches = new Map<number, Set<number>>();
  const touching = new Map<number, PmRelation[]>();
  const groups = new Map<string, { anchor: number; filter: string; members: Map<number, PmRelation[]> }>();
  for (const relation of relations) {
    for (const [a, b] of [
      [relation.source_id, relation.target_id],
      [relation.target_id, relation.source_id],
    ]) {
      if (!anchors.has(a)) continue;
      touching.set(a, [...(touching.get(a) ?? []), relation]);
      if (anchors.has(b) || !merged.entities.has(b)) continue;
      touches.set(b, (touches.get(b) ?? new Set<number>()).add(a));
      for (const filter of relationFilterKeys(relation)) {
        if (hidden.has(filter)) continue;
        const key = bundleKey(a, filter);
        const group = groups.get(key) ?? { anchor: a, filter, members: new Map<number, PmRelation[]>() };
        group.members.set(b, [...(group.members.get(b) ?? []), relation]);
        groups.set(key, group);
      }
    }
  }

  // Always drawn: nodes taken out of a bundle, nodes on a route you asked for, and nodes that link two
  // anchors (a shared owner or source)
  const forced = new Set<number>();
  touches.forEach((set, id) => {
    if (set.size >= 2 || revealed.has(id)) forced.add(id);
  });
  routeNodes.forEach((id) => {
    if (merged.entities.has(id) && !anchors.has(id)) forced.add(id);
  });

  // Per anchor and filter only the most specific neighbours: none around a node you only see, a few
  // along a filter you asked about
  const shown = new Set<number>(forced);
  groups.forEach((group) => {
    const limit = expandedVia(group.anchor, group.filter) ? SHOWN_PER_FILTER.expanded : SHOWN_PER_FILTER.collapsed;
    Array.from(group.members.entries())
      .filter(([id]) => !forced.has(id))
      .map(([id, list]) => specificityOf(entityOf(id), id, list, at))
      .sort(bySpecificity)
      .slice(0, limit)
      .forEach(({ id }) => shown.add(id));
  });

  /** What of an anchor's relations via a filter is not drawn: loaded ones (members) plus those not loaded (count) */
  const leftovers = (anchor: number, filter: string) => {
    const loaded = (touching.get(anchor) ?? []).filter((relation) => relationFilterKeys(relation).includes(filter));
    const members = loaded.filter((relation) => {
      const other = otherEnd(relation, anchor);
      return !anchors.has(other) && !shown.has(other) && merged.entities.has(other);
    });
    const drawn = loaded.length - members.length;
    const inModel = merged.filterCounts.get(anchor)?.[filter] ?? loaded.length;
    return { count: Math.max(members.length, inModel - drawn), members };
  };

  // A bundle of one is silly: draw it instead (a question adds at most three parties plus one more node)
  anchors.forEach((anchor) => {
    for (const filter of visibleKeys) {
      if (!expandedVia(anchor, filter)) continue;
      const { count, members } = leftovers(anchor, filter);
      if (count < MIN_BUNDLE && members.length === count) members.forEach((relation) => shown.add(otherEnd(relation, anchor)));
    }
  });

  // Node cap: drop the least specific optional nodes (never forced ones or the latest expansion's neighbours)
  const latestNeighbours = new Set<number>(
    latest ? relations.filter((relation) => (relation.source_id === latest.id || relation.target_id === latest.id) && matchesFilters(relation, latest.filters)).map((relation) => otherEnd(relation, latest.id)) : [],
  );
  const excess = anchors.size + shown.size - maxNodes;
  if (excess > 0) {
    Array.from(shown)
      .filter((id) => !forced.has(id) && !latestNeighbours.has(id))
      .map((id) => specificityOf(entityOf(id), id, relations.filter((relation) => relation.source_id === id || relation.target_id === id), at))
      .sort(bySpecificity)
      .reverse()
      .slice(0, excess)
      .forEach(({ id }) => shown.delete(id));
  }
  const drawn = new Set<number>([...Array.from(anchors), ...Array.from(shown)]);

  // What an expanded node has more via a filter becomes one "+N" bundle
  const bundles: PmBundle[] = [];
  anchors.forEach((anchor) => {
    for (const filter of visibleKeys) {
      if (!expandedVia(anchor, filter)) continue;
      const { count, members } = leftovers(anchor, filter);
      if (count === 0 || (count === 1 && members.length === 0)) continue;
      const ranked = members
        .map((relation) => ({ relation, rank: specificityOf(entityOf(otherEnd(relation, anchor)), otherEnd(relation, anchor), [relation], at) }))
        .sort((x, y) => bySpecificity(x.rank, y.rank))
        .map((item) => item.relation);
      bundles.push({ anchorId: anchor, filter, count, members: ranked });
    }
  });

  const nodes: PmSceneNode[] = Array.from(drawn).map((id) => {
    const entity = merged.entities.get(id) as PmEntity;
    return {
      id: pmNodeId(id),
      pmId: id,
      label: entity.name,
      type: entity.type,
      filter: (entity.primary_filter as string | null) ?? null,
      weight: 1 + Math.min(entity.degree ?? 0, 60) / 4,
      seed: seedById.get(id),
      expanded: expanded.has(id),
    };
  });

  const edges: PmSceneEdge[] = relations
    .filter((relation) => drawn.has(relation.source_id) && drawn.has(relation.target_id))
    .map((relation) => ({
      id: `pmrel:${relation.id}`,
      relationId: relation.id,
      kind: "relation" as const,
      source: pmNodeId(relation.source_id),
      target: pmNodeId(relation.target_id),
      type: relation.relation_type,
      filter: displayFilter(relation, { hidden }),
      filters: relationFilters(relation),
      historic: isHistoric(relation, options.now),
      directed: isDirected(relation),
    }));

  for (const bundle of bundles) {
    const id = bundleNodeId(bundle.anchorId, bundle.filter);
    nodes.push({
      id,
      pmId: null,
      label: `+${bundle.count}`,
      type: "bundle",
      filter: bundle.filter === PM_OTHER ? null : bundle.filter,
      weight: 1,
      expanded: false,
      bundle,
    });
    edges.push({
      id: `bundle-edge:${bundleKey(bundle.anchorId, bundle.filter)}`,
      relationId: null,
      kind: "bundle",
      source: pmNodeId(bundle.anchorId),
      target: id,
      type: "bundle",
      filter: bundle.filter === PM_OTHER ? null : bundle.filter,
      filters: bundle.filter === PM_OTHER ? [] : [bundle.filter],
      historic: false,
      directed: false,
    });
  }

  // "Dit nieuws" in the middle, connected to the seeds that come from this event
  const eventSeeds = seeds.filter((seed) => seed.reason !== "focus" && drawn.has(seed.id));
  if (eventSeeds.length) {
    nodes.push({
      id: PM_EVENT_NODE,
      pmId: null,
      label: options.eventLabel ?? "Dit nieuws",
      type: "event",
      filter: null,
      weight: 6,
      expanded: true,
      isEvent: true,
    });
    for (const seed of eventSeeds) {
      edges.push({
        id: `seed:${seed.id}`,
        relationId: null,
        kind: "seed",
        source: PM_EVENT_NODE,
        target: pmNodeId(seed.id),
        type: seed.reason === "outlet" ? "bericht" : "in het nieuws",
        filter: null,
        filters: [],
        historic: false,
        directed: false,
      });
    }
  }

  const latestIds = latest
    ? [
        pmNodeId(latest.id),
        ...Array.from(latestNeighbours).filter((id) => drawn.has(id)).map(pmNodeId),
        ...bundles
          .filter((bundle) => bundle.anchorId === latest.id && (!latest.filters || latest.filters.includes(bundle.filter)))
          .map((bundle) => bundleNodeId(bundle.anchorId, bundle.filter)),
      ]
    : [];
  return { nodes, edges, latestIds, bundles };
}

/** Relations of the current graph per filter (structural evidence for the five-filter panel). */
export function relationsByFilter(merged: PmMerged): Map<string, PmRelation[]> {
  const map = new Map<string, PmRelation[]>();
  for (const relation of Array.from(merged.relations.values())) {
    for (const key of relationFilterKeys(relation)) {
      const list = map.get(key) ?? [];
      list.push(relation);
      map.set(key, list);
    }
  }
  return map;
}
