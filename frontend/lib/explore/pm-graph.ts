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

// --- Direction of influence ("Wie heeft invloed op X?" / "Op wie heeft X invloed?") -------------

/** "in": the other party has influence on the entity; "out": the entity has influence on the other */
export type PmDirection = "in" | "out";
/** A question about a node: along a filter either way ("any"), or one way */
export type PmSide = PmDirection | "any";

/** The target has the influence: "A werkt voor B" is B's influence on A (same list as migration 008) */
const REVERSE_INFLUENCE = new Set(["personeel", "dienstverband", "woordvoerder_van", "lidmaatschap", "citeert"]);
/** Both ways (same list as migration 008) */
const MUTUAL_INFLUENCE = new Set(["alliantie", "oppositie", "draaideur"]);

/**
 * Who has influence on whom in a relation, or null when it goes both ways. Mostly the source on the
 * target ("A is eigenaar van B"); for employment, membership, spokespeople and quotes the other way
 * round. The contract of pm_influence_side in migration 008: keep them in sync.
 */
export function influenceOf(
  relation: Pick<PmRelation, "source_id" | "target_id" | "relation_type" | "bidirectional">,
): { from: number; to: number } | null {
  if (relation.bidirectional || MUTUAL_INFLUENCE.has(relation.relation_type)) return null;
  return REVERSE_INFLUENCE.has(relation.relation_type)
    ? { from: relation.target_id, to: relation.source_id }
    : { from: relation.source_id, to: relation.target_id };
}

/** The ways a relation goes seen from one of its ends: "in" (influence on it), "out" (its influence) or both. */
export function directionsFrom(relation: Pick<PmRelation, "source_id" | "target_id" | "relation_type" | "bidirectional">, id: number): PmDirection[] {
  const influence = influenceOf(relation);
  if (!influence) return ["in", "out"];
  return [influence.to === id ? "in" : "out"];
}

/** A relation is part of an answer along a side ("any" = either way). */
export function onSide(relation: Pick<PmRelation, "source_id" | "target_id" | "relation_type" | "bidirectional">, id: number, side: PmSide): boolean {
  return side === "any" || directionsFrom(relation, id).includes(side);
}

/** Per filter how many relations go each way (same contract as `direction_counts` of migration 008). */
export function countDirections(
  relations: Pick<PmRelation, "source_id" | "target_id" | "relation_type" | "bidirectional" | "filter" | "filters">[],
  id: number,
): Record<string, { in: number; out: number }> {
  const counts: Record<string, { in: number; out: number }> = {};
  for (const relation of relations) {
    const ways = directionsFrom(relation, id);
    for (const key of relationFilterKeys(relation)) {
      const count = (counts[key] = counts[key] ?? { in: 0, out: 0 });
      ways.forEach((way) => (count[way] += 1));
    }
  }
  return counts;
}

/** Store key of a neighbourhood request: entity + (sorted) filter set + direction ("12:eigendom@in"). */
export const hoodKey = (id: number, filters?: readonly string[] | null, direction?: PmDirection | null) =>
  (filters?.length ? `${id}:${Array.from(new Set(filters)).sort().join(",")}` : String(id)) + (direction ? `@${direction}` : "");

/** The filters of a store key ("12:eigendom,sourcing" → both; "12" → null = all). */
export function hoodKeyFilters(key: string): string[] | null {
  const colon = key.indexOf(":");
  return colon === -1 ? null : key.slice(colon + 1).split(/[@#]/)[0].split(",").filter(Boolean);
}

/** The direction of a store key ("12:eigendom@in" → "in"; null = both). */
export function hoodKeyDirection(key: string): PmDirection | null {
  const match = /@(in|out)(?:#|$)/.exec(key);
  return match ? (match[1] as PmDirection) : null;
}

/** A complete neighbourhood restricted to some filters and a direction (so a full download is reused instead of fetched again). */
export function filterNeighborhood(hood: PmNeighborhood, filters: readonly string[], direction: PmDirection | null = null): PmNeighborhood {
  const id = hood.center.id;
  const relations = hood.relations.filter((relation) => matchesFilters(relation, filters) && onSide(relation, id, direction ?? "any"));
  const ids = new Set(relations.map((relation) => otherEnd(relation, id)));
  return {
    ...hood,
    entities: hood.entities.filter((entity) => ids.has(entity.id)),
    relations,
    total: relations.length,
    truncated: false,
    filters: [...filters],
    direction,
  };
}

/**
 * A small neighbourhood with only these relations of `center`: how nodes taken out of a bundle join
 * the graph without pulling in the rest of the list behind it. No counts, so it never overrides them.
 */
export function pickHood(
  center: PmEntity,
  relations: PmRelation[],
  entities: PmEntity[],
  filter: string,
  direction: PmDirection | null = null,
): [string, PmNeighborhood] {
  const ids = Array.from(new Set(relations.map((relation) => otherEnd(relation, center.id)))).sort((a, b) => a - b);
  return [
    `${hoodKey(center.id, [filter], direction)}#${ids.join(",")}`,
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
  /** Asked one way ("Wie heeft invloed op X?"); missing = either way */
  direction?: PmDirection | null;
}

export interface PmMerged {
  entities: Map<number, PmEntity>;
  relations: Map<number, PmRelation>;
  /** Total number of relations per expanded entity (may exceed what is loaded) */
  totals: Map<number, number>;
  /** Relations per filter for every entity whose neighbourhood was requested */
  filterCounts: Map<number, Record<string, number>>;
  /** Relations per filter and direction (migration 008) for every entity whose neighbourhood was requested */
  directionCounts: Map<number, Record<string, { in: number; out: number }>>;
}

/** One graph from loaded neighbourhoods plus routes (Epic 13); routes add no counts. */
export function mergeNeighborhoods(neighborhoods: PmNeighborhood[], paths: PmPaths[] = []): PmMerged {
  const entities = new Map<number, PmEntity>();
  const relations = new Map<number, PmRelation>();
  const totals = new Map<number, number>();
  const filterCounts = new Map<number, Record<string, number>>();
  const directionCounts = new Map<number, Record<string, { in: number; out: number }>>();
  for (const hood of neighborhoods) {
    entities.set(hood.center.id, hood.center);
    if (!hood.filters?.length && !hood.direction) totals.set(hood.center.id, hood.total);
    if (hood.filter_counts) filterCounts.set(hood.center.id, hood.filter_counts);
    if (hood.direction_counts) directionCounts.set(hood.center.id, hood.direction_counts);
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
  return { entities, relations, totals, filterCounts, directionCounts };
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

export const bundleKey = (anchorId: number, filter: string, side: PmSide = "any") =>
  `${anchorId}:${filter}${side === "any" ? "" : `@${side}`}`;
export const bundleNodeId = (anchorId: number, filter: string, side: PmSide = "any") => `bundle:${bundleKey(anchorId, filter, side)}`;
export const bundleEdgeId = (anchorId: number, filter: string, side: PmSide = "any") => `bundle-edge:${bundleKey(anchorId, filter, side)}`;

/** The relations of an expanded node via one filter (one way, or either) that are not drawn, summarised as one "+N" node. */
export interface PmBundle {
  anchorId: number;
  filter: string;
  /** The way of the question it answers ("any" = either way) */
  side: PmSide;
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
  /** A person or organisation of the news that is not in the model (yet) */
  news?: boolean;
}

export interface PmSceneEdge {
  id: string;
  relationId: number | null;
  /** A relation of the model, the line from "Dit nieuws" to a seed or to a name that is not in the model, or the line to a bundle */
  kind: "relation" | "seed" | "news" | "bundle";
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
export const newsNodeId = (entityKey: string) => `news:${entityKey}`;
export const newsEdgeId = (nodeId: string) => `news-edge:${nodeId}`;

/**
 * Why a node is drawn. A node you take away remembers its reasons and stays away until something new
 * points at it (another question, a new route), so dropping a proposal never brings in the next one.
 */
export const reasonKey = {
  /** It links these anchors (a shared owner or source) */
  link: (anchors: Iterable<number>) => `link:${Array.from(anchors).sort((a, b) => a - b).join(",")}`,
  /** It is on routes of this request */
  route: (key: string) => `route:${key}`,
  /** One of the most specific answers to a question (anchor, filter, either way or one way) */
  group: (anchor: number, filter: string, side: PmSide = "any") => `group:${bundleKey(anchor, filter, side)}`,
};

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
    /** Per route node the requests (route keys) it came with */
    routeKeys?: ReadonlyMap<number, readonly string[]>;
    /** Taken away by the user, with the reasons it had then: not drawn while it has no new reason */
    dismissed?: Readonly<Record<number, readonly string[]>>;
    /** Bundles the user took away (bundleKey): gone until the question is asked again */
    dismissedBundles?: readonly string[];
    /** People and organisations of the news that are not in the model: drawn around "Dit nieuws" */
    newsNodes?: readonly { id: string; label: string }[];
    maxNodes?: number;
    eventLabel?: string;
    now?: Date;
    /** The latest expansion: the view glides to it; its neighbours are never dropped by the node cap */
    latest?: PmExpansion | null;
  } = {},
): PmScene {
  const hidden = options.hiddenFilters ?? new Set<string>();
  const revealed = options.revealed ?? new Set<number>();
  const routeNodes = options.routeNodes ?? new Set<number>();
  const routeRelations = options.routeRelations ?? new Set<number>();
  const dismissed = options.dismissed ?? {};
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
  /** Asked about along a filter, either way ("any") or one way */
  const expandedVia = (id: number, filter: string, side: PmSide) => {
    if (latest?.id === id && (!latest.filters || latest.filters.includes(filter)) && (latest.direction ?? "any") === side) return true;
    if (!expanded.has(id)) return false;
    const via = options.expandedFilters?.get(id);
    if (!via) return side === "any";
    return via.has(side === "any" ? filter : `${filter}@${side}`);
  };
  const SIDES: PmSide[] = ["any", "in", "out"];

  // Neighbours of anchors: which anchors each one touches, and per (anchor, filter, way) the relations with it
  const touches = new Map<number, Set<number>>();
  const touching = new Map<number, PmRelation[]>();
  const groups = new Map<string, { anchor: number; filter: string; side: PmSide; members: Map<number, PmRelation[]> }>();
  for (const relation of relations) {
    for (const [a, b] of [
      [relation.source_id, relation.target_id],
      [relation.target_id, relation.source_id],
    ]) {
      if (!anchors.has(a)) continue;
      touching.set(a, [...(touching.get(a) ?? []), relation]);
      if (anchors.has(b) || !merged.entities.has(b)) continue;
      touches.set(b, (touches.get(b) ?? new Set<number>()).add(a));
      const sides: PmSide[] = ["any", ...directionsFrom(relation, a)];
      for (const filter of relationFilterKeys(relation)) {
        if (hidden.has(filter)) continue;
        for (const side of sides) {
          const key = bundleKey(a, filter, side);
          const group = groups.get(key) ?? { anchor: a, filter, side, members: new Map<number, PmRelation[]>() };
          group.members.set(b, [...(group.members.get(b) ?? []), relation]);
          groups.set(key, group);
        }
      }
    }
  }

  // Why each node is drawn (see reasonKey)
  const reasons = new Map<number, Set<string>>();
  const because = (id: number, reason: string) => reasons.set(id, (reasons.get(id) ?? new Set<string>()).add(reason));

  // Always drawn: nodes taken out of a bundle, nodes on a route you asked for, and nodes that link two
  // anchors (a shared owner or source)
  const forced = new Set<number>();
  touches.forEach((set, id) => {
    if (set.size >= 2) because(id, reasonKey.link(set));
    if (set.size >= 2 || revealed.has(id)) forced.add(id);
  });
  routeNodes.forEach((id) => {
    if (!merged.entities.has(id) || anchors.has(id)) return;
    forced.add(id);
    for (const key of options.routeKeys?.get(id) ?? ["*"]) because(id, reasonKey.route(key));
  });

  // Per anchor and filter only the most specific neighbours: none around a node you only see, a few
  // along a filter you asked about
  const shown = new Set<number>(forced);
  groups.forEach((group) => {
    const limit = expandedVia(group.anchor, group.filter, group.side) ? SHOWN_PER_FILTER.expanded : SHOWN_PER_FILTER.collapsed;
    Array.from(group.members.entries())
      .filter(([id]) => !forced.has(id))
      .map(([id, list]) => specificityOf(entityOf(id), id, list, at))
      .sort(bySpecificity)
      .slice(0, limit)
      .forEach(({ id }) => {
        shown.add(id);
        because(id, reasonKey.group(group.anchor, group.filter, group.side));
      });
  });

  /** What of an anchor's relations via a filter (one way, or either) is not drawn: loaded ones (members) plus those not loaded (count) */
  const leftovers = (anchor: number, filter: string, side: PmSide) => {
    const loaded = (touching.get(anchor) ?? []).filter((relation) => relationFilterKeys(relation).includes(filter) && onSide(relation, anchor, side));
    const members = loaded.filter((relation) => {
      const other = otherEnd(relation, anchor);
      return !anchors.has(other) && !shown.has(other) && merged.entities.has(other);
    });
    const drawn = loaded.length - members.length;
    const inModel =
      (side === "any" ? merged.filterCounts.get(anchor)?.[filter] : merged.directionCounts.get(anchor)?.[filter]?.[side]) ?? loaded.length;
    return { count: Math.max(members.length, inModel - drawn), members };
  };

  // A bundle of one is silly: draw it instead (a question adds at most three parties plus one more node)
  anchors.forEach((anchor) => {
    for (const filter of visibleKeys) {
      for (const side of SIDES) {
        if (!expandedVia(anchor, filter, side)) continue;
        const { count, members } = leftovers(anchor, filter, side);
        if (count < MIN_BUNDLE && members.length === count) {
          members.forEach((relation) => {
            const id = otherEnd(relation, anchor);
            shown.add(id);
            because(id, reasonKey.group(anchor, filter, side));
          });
        }
      }
    }
  });

  // Taken away by the user: gone while nothing new points at it (it then counts in its bundle). The
  // reasons are worked out before this, so taking a node away never moves the next one up.
  shown.forEach((id) => {
    const gone = dismissed[id];
    if (!gone || revealed.has(id)) return;
    if (Array.from(reasons.get(id) ?? []).every((reason) => gone.includes(reason))) shown.delete(id);
  });

  // Node cap: drop the least specific optional nodes (never forced ones or the latest expansion's neighbours)
  const latestNeighbours = new Set<number>(
    latest
      ? relations
          .filter(
            (relation) =>
              (relation.source_id === latest.id || relation.target_id === latest.id) &&
              matchesFilters(relation, latest.filters) &&
              onSide(relation, latest.id, latest.direction ?? "any"),
          )
          .map((relation) => otherEnd(relation, latest.id))
      : [],
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

  // What an expanded node has more via a filter becomes one "+N" bundle (unless you took it away)
  const bundles: PmBundle[] = [];
  const goneBundles = new Set(options.dismissedBundles ?? []);
  anchors.forEach((anchor) => {
    for (const filter of visibleKeys) {
      for (const side of SIDES) {
        if (!expandedVia(anchor, filter, side) || goneBundles.has(bundleKey(anchor, filter, side))) continue;
        const { count, members } = leftovers(anchor, filter, side);
        if (count === 0 || (count === 1 && members.length === 0)) continue;
        const ranked = members
          .map((relation) => ({ relation, rank: specificityOf(entityOf(otherEnd(relation, anchor)), otherEnd(relation, anchor), [relation], at) }))
          .sort((x, y) => bySpecificity(x.rank, y.rank))
          .map((item) => item.relation);
        bundles.push({ anchorId: anchor, filter, side, count, members: ranked });
      }
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
    const id = bundleNodeId(bundle.anchorId, bundle.filter, bundle.side);
    // One way: the line points from who has the influence to who undergoes it
    const towardsAnchor = bundle.side === "in";
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
      id: bundleEdgeId(bundle.anchorId, bundle.filter, bundle.side),
      relationId: null,
      kind: "bundle",
      source: towardsAnchor ? id : pmNodeId(bundle.anchorId),
      target: towardsAnchor ? pmNodeId(bundle.anchorId) : id,
      type: "bundle",
      filter: bundle.filter === PM_OTHER ? null : bundle.filter,
      filters: bundle.filter === PM_OTHER ? [] : [bundle.filter],
      historic: false,
      directed: bundle.side !== "any",
    });
  }

  // "Dit nieuws" in the middle, connected to the seeds that come from this event and to its people and
  // organisations that are not in the model
  const eventSeeds = seeds.filter((seed) => seed.reason !== "focus" && drawn.has(seed.id));
  const newsNodes = options.newsNodes ?? [];
  if (eventSeeds.length || newsNodes.length) {
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
    for (const news of newsNodes) {
      nodes.push({ id: news.id, pmId: null, label: news.label, type: "news", filter: null, weight: 1, expanded: false, news: true });
      edges.push({
        id: newsEdgeId(news.id),
        relationId: null,
        kind: "news",
        source: PM_EVENT_NODE,
        target: news.id,
        type: "in het nieuws",
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
          .filter(
            (bundle) =>
              bundle.anchorId === latest.id &&
              (!latest.filters || latest.filters.includes(bundle.filter)) &&
              bundle.side === (latest.direction ?? "any"),
          )
          .map((bundle) => bundleNodeId(bundle.anchorId, bundle.filter, bundle.side)),
      ]
    : [];
  return {
    nodes,
    edges,
    latestIds,
    bundles,
    anchors,
    reasons: new Map(Array.from(shown).map((id) => [id, Array.from(reasons.get(id) ?? [])])),
  };
}

export interface PmScene {
  nodes: PmSceneNode[];
  edges: PmSceneEdge[];
  /** The last expansion: its node, new neighbours and bundles (the view glides to them) */
  latestIds: string[];
  bundles: PmBundle[];
  /** Seeds, expanded nodes and the node asked about last: their neighbours are drawn */
  anchors: ReadonlySet<number>;
  /** Why every other drawn node is there (see reasonKey) */
  reasons: ReadonlyMap<number, string[]>;
}

// --- From the explorer's state to a scene --------------------------------------------------------

/** The part of the explorer's state that decides what is drawn (undo/redo restores it). */
export interface PmGraphView {
  /** Neighbourhoods that are part of the graph (keys into the cache) */
  active: string[];
  expanded: number[];
  seeds: PmSeed[];
  hiddenFilters: string[];
  latest: PmExpansion | null;
  /** Nodes taken out of a bundle ("+84"): always drawn */
  revealed: number[];
  /** Route results that are part of the graph (keys into the cache) */
  activeRoutes: string[];
  /** Nodes the user took away, with the reasons they had then */
  dismissed: Record<number, string[]>;
  /** Bundles the user took away (bundleKey) */
  dismissedBundles: string[];
}

/** Everything fetched: neighbourhoods by hoodKey, route results by request key. */
export interface PmCache {
  neighborhoods: Record<string, PmNeighborhood>;
  routeSets: Record<string, PmPaths>;
}

/**
 * Per expanded node the questions it was asked (from the keys of the neighbourhoods in the graph): a
 * filter ("eigendom", either way) or a filter one way ("eigendom@in").
 */
export function expandedFiltersOf(active: readonly string[], expanded: readonly number[]): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  for (const key of active) {
    const filters = key.includes("#") ? null : hoodKeyFilters(key);
    const id = Number(key.split(/[:@]/)[0]);
    if (!filters || !expanded.includes(id)) continue;
    const direction = hoodKeyDirection(key);
    const set = map.get(id) ?? new Set<string>();
    filters.forEach((filter) => set.add(direction ? `${filter}@${direction}` : filter));
    map.set(id, set);
  }
  return map;
}

/** Per node the route requests it is on. */
export function routeKeysOf(activeRoutes: readonly string[], routeSets: Record<string, PmPaths>): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const key of activeRoutes) {
    for (const route of routeSets[key]?.routes ?? []) {
      for (const id of route.nodes) {
        const keys = map.get(id) ?? [];
        if (!keys.includes(key)) map.set(id, [...keys, key]);
      }
    }
  }
  return map;
}

/** The graph a view describes: merged neighbourhoods and routes, plus what the scene needs to know about them. */
export function viewGraph(view: PmGraphView, cache: PmCache) {
  const results = view.activeRoutes.map((key) => cache.routeSets[key]).filter(Boolean);
  const routes = routeParts(results);
  return {
    merged: mergeNeighborhoods(view.active.map((key) => cache.neighborhoods[key]).filter(Boolean), results),
    routeNodes: routes.nodes,
    routeRelations: routes.relations,
    routeKeys: routeKeysOf(view.activeRoutes, cache.routeSets),
    expandedFilters: expandedFiltersOf(view.active, view.expanded),
  };
}

/** The scene of a view, exactly as the network draws it (the store uses it to settle proposals). */
export function viewScene(
  view: PmGraphView,
  cache: PmCache,
  options: { newsNodes?: readonly { id: string; label: string }[]; eventLabel?: string; now?: Date } = {},
): PmScene {
  const graph = viewGraph(view, cache);
  return pmScene(graph.merged, view.seeds, new Set(view.expanded), {
    hiddenFilters: new Set(view.hiddenFilters),
    expandedFilters: graph.expandedFilters,
    revealed: new Set(view.revealed),
    routeNodes: graph.routeNodes,
    routeRelations: graph.routeRelations,
    routeKeys: graph.routeKeys,
    dismissed: view.dismissed,
    dismissedBundles: view.dismissedBundles,
    latest: view.latest,
    ...options,
  });
}

// --- Proposals: what a step adds is see-through until you tap it ---------------------------------

/** A graph step in progress: what it adds is proposed (drawn see-through) until you keep it or move on. */
export interface PmPending {
  /** Unique per step: loads of a step that is no longer in progress stay out of the graph */
  token: number;
  /** A question (withdrawn when you keep none of its answers), routes, or a party you added yourself */
  kind: "ask" | "routes" | "party";
  /** Scene node ids drawn before the step: the rest is new */
  base: string[];
  /** Proposals you tapped: they stay */
  kept: string[];
  /** The graph before the step: where a question of which you keep nothing goes back to */
  before: PmGraphView & { latestRoutes: string | null };
}

export interface PmProposals {
  /** New nodes of the step in progress: parties and bundles (what you can keep) */
  nodes: string[];
  /** The new parties */
  parties: number[];
  /** Drawn see-through: not kept (yet) */
  ghosts: ReadonlySet<string>;
  kept: number;
  /** Moving on now withdraws the question: none of its answers kept */
  withdraws: boolean;
}

const NO_PROPOSALS: PmProposals = { nodes: [], parties: [], ghosts: new Set(), kept: 0, withdraws: false };

/**
 * What the step in progress proposes: every node it added (parties and a question's "+N" bundle)
 * except anchors (a party you added yourself, the node you asked about) and nodes you took out of a
 * bundle. All see-through until you tap them.
 */
export function proposalsOf(scene: Pick<PmScene, "nodes" | "anchors">, pending: PmPending | null, revealed: readonly number[]): PmProposals {
  if (!pending) return NO_PROPOSALS;
  const base = new Set(pending.base);
  const chosen = new Set(revealed);
  const nodes = scene.nodes
    .filter((node) => !node.isEvent && !node.news && !base.has(node.id))
    .filter((node) => node.pmId === null || (!scene.anchors.has(node.pmId) && !chosen.has(node.pmId)))
    .map((node) => node.id);
  if (nodes.length === 0) return NO_PROPOSALS;
  const parties = nodes.filter((id) => id.startsWith("pm:")).map((id) => Number(id.slice(3)));
  const kept = nodes.filter((id) => pending.kept.includes(id)).length;
  const withdraws = pending.kind === "ask" && parties.length > 0 && kept === 0;
  const ghosts = new Set(nodes.filter((id) => !pending.kept.includes(id)));
  return { nodes, parties, ghosts, kept, withdraws };
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
