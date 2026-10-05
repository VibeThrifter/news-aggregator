/**
 * Epic 13/14: routes between the outlets and the parties of a news item (pm_paths), read from who
 * has the influence. A route only explains something when its stations belong to one of its ends or
 * carry the party's word to the outlet; "de Volkskrant zet de agenda van RTL, RIVM is bron voor RTL"
 * says nothing about the Volkskrant. Pure.
 */

import type { PmEntity, PmPathRoute, PmPaths, PmRelation } from "@/lib/types";

import { labelSourceId, PM_AFFILIATIONS } from "./labels";
import { influenceOf, relationFilters } from "./pm-graph";

/** Ties that make one party part of another: affiliations, owning, funding, carrying */
const BELONGING_TYPES: ReadonlySet<string> = new Set([...Array.from(PM_AFFILIATIONS), "eigendom", "investering", "financiering", "donor", "mediaplatform"]);

/**
 * Whether a route from an outlet (`nodes[0]`) to a party explains something. Either every station in
 * between belongs to one of the ends (the owner or a programme of the outlet, a researcher of the
 * party), so all steps but one are ties of belonging; or the party's word travels to the outlet along
 * a chain of sourcing (NordVind is bron voor het ANP, het ANP levert aan NU.nl). "De Volkskrant zet de
 * agenda van RTL, RIVM is bron voor RTL" and "de Europese Commissie censureert TikTok, TikTok bepaalt
 * het bereik van de NOS" explain nothing about the news. One step always counts.
 */
export function meaningfulRoute(route: Pick<PmPathRoute, "nodes" | "relations">, relations: ReadonlyMap<number, PmRelation>): boolean {
  const steps = route.relations.map((id, index) => ({ relation: relations.get(id), outletSide: route.nodes[index], partySide: route.nodes[index + 1] }));
  if (steps.some((step) => !step.relation)) return false;
  const rest = (steps as { relation: PmRelation; outletSide: number; partySide: number }[]).filter((step) => !BELONGING_TYPES.has(step.relation.relation_type));
  if (rest.length <= 1) return true;
  return rest.every((step) => {
    const influence = influenceOf(step.relation);
    return relationFilters(step.relation).includes("sourcing") && influence?.from === step.partySide && influence.to === step.outletSide;
  });
}

/** One step read in reading order: "RIVM · is vaste bron voor · DPG Media". */
export interface ReadStep {
  /** Entity read first */
  from: number;
  /** Entity read last */
  to: number;
  relation: PmRelation;
  /** Read with the relation's label (else with its reverse label) */
  forward: boolean;
  /** Which way the influence goes in reading order; "both" when it is mutual or a tie of belonging */
  flow: "down" | "up" | "both";
}

type TypeOf = (id: number) => string | null | undefined;

function readStep(relation: PmRelation, from: number, to: number, typeOf: TypeOf): ReadStep {
  const influence = PM_AFFILIATIONS.has(relation.relation_type) ? null : influenceOf(relation);
  return {
    from,
    to,
    relation,
    forward: labelSourceId(relation, typeOf) === from,
    flow: !influence ? "both" : influence.from === from ? "down" : "up",
  };
}

/** Type of an entity on the paths, for reading affiliations from the person */
export function typeLookup(entities: readonly Pick<PmEntity, "id" | "type">[] | ReadonlyMap<number, Pick<PmEntity, "type">>): TypeOf {
  const byId = entities instanceof Map ? entities : new Map((entities as readonly Pick<PmEntity, "id" | "type">[]).map((entity) => [entity.id, entity]));
  return (id) => byId.get(id)?.type;
}

/**
 * The steps of a route in the order that reads with the influence: from the party when most of it
 * flows towards the outlet ("RIVM ↓ is vaste bron voor ↓ NOS"), else from the outlet. Missing
 * relations make an empty list.
 */
export function readableRoute(route: Pick<PmPathRoute, "nodes" | "relations">, relations: ReadonlyMap<number, PmRelation>, typeOf: TypeOf): ReadStep[] {
  const found = route.relations.map((id) => relations.get(id));
  if (found.some((relation) => !relation)) return [];
  const forward = found.map((relation, index) => readStep(relation as PmRelation, route.nodes[index], route.nodes[index + 1], typeOf));
  const backward = [...found]
    .reverse()
    .map((relation, index) => readStep(relation as PmRelation, route.nodes[route.nodes.length - 1 - index], route.nodes[route.nodes.length - 2 - index], typeOf));
  const downs = (steps: ReadStep[]) => steps.filter((step) => step.flow === "down").length;
  return downs(backward) > downs(forward) ? backward : forward;
}

/** One way a party of the news reaches outlets that brought it, read from the party. */
export interface BehindLine {
  key: string;
  /** Steps from the party to the station before the outlets (empty for a direct link) */
  lead: ReadStep[];
  /** The last step, once per outlet (the same kind of relation), in the order of the news */
  last: ReadStep[];
  /** Relations in the order their explanation tells most: the influence before ties of belonging */
  explain: number[];
  /** At least one relation had ended */
  historic: boolean;
  /** How well it is supported (GRADE_RANK of lib/explore/evidence.ts, 0 = best); null = not known */
  rank: number | null;
}

export interface BehindParty {
  partyId: number;
  lines: BehindLine[];
  /** Outlets of the news it reaches, in the order of the news */
  outletIds: number[];
}

/** Lines whose evidence is not known yet sit between "met bron" and "zonder bron" */
const UNKNOWN_RANK = 1.5;

/**
 * "Wie zit erachter?": per party of the news, how it reaches the outlets that brought it, directly or
 * over a station that belongs to one of them. Outlets with the same link and the same support share
 * one line ("is vaste bron voor NOS en de Volkskrant"). `rankOf` gives how well a relation is
 * supported (0 = best): a route counts as its weakest step that carries influence. Best supported
 * first, then the parties that reach most outlets, then those with a direct link, then the order of
 * pm_paths (strongest route first).
 */
export function behindParties(
  paths: Pick<PmPaths, "routes" | "relations" | "entities"> | null | undefined,
  newsOutletIds: readonly number[],
  rankOf?: (relationId: number) => number | undefined,
): BehindParty[] {
  if (!paths) return [];
  const relations = new Map(paths.relations.map((relation) => [relation.id, relation]));
  const typeOf = typeLookup(paths.entities);
  const newsOrder = (id: number) => newsOutletIds.indexOf(id);
  const lines = new Map<string, BehindLine & { partyId: number; order: number }>();
  paths.routes.forEach((route, order) => {
    if (!newsOutletIds.includes(route.from) || !meaningfulRoute(route, relations)) return;
    const nodes = [...route.nodes].reverse();
    const steps = [...route.relations].reverse().map((id, index) => readStep(relations.get(id) as PmRelation, nodes[index], nodes[index + 1], typeOf));
    const lead = steps.slice(0, -1);
    const last = steps[steps.length - 1];
    const kind = `${last.relation.relation_type}:${last.relation.mechanism ?? ""}:${last.forward ? ">" : "<"}`;
    const telling = steps.filter((step) => !BELONGING_TYPES.has(step.relation.relation_type));
    const ranks = (telling.length ? telling : steps)
      .map((step) => rankOf?.(step.relation.id))
      .filter((rank): rank is number => rank !== undefined);
    const rank = ranks.length ? Math.max(...ranks) : null;
    const key = `${route.to}|${lead.map((step) => step.relation.id).join(".")}|${kind}|${rank ?? ""}`;
    const line = lines.get(key) ?? { key, partyId: route.to, order, lead, last: [], explain: [], historic: false, rank };
    if (!line.last.some((step) => step.to === last.to)) line.last.push(last);
    line.historic = line.historic || route.historic;
    lines.set(key, line);
  });

  const parties = new Map<number, { partyId: number; order: number; lines: (BehindLine & { order: number })[] }>();
  lines.forEach(({ partyId, ...line }) => {
    line.last.sort((a, b) => newsOrder(a.to) - newsOrder(b.to));
    // The step that carries the influence tells more than a tie of belonging ("Hekkert treedt op bij de NOS" over "Hekkert werkt bij het PBL")
    const steps = [...line.lead, ...line.last];
    const telling = [...steps.filter((step) => !BELONGING_TYPES.has(step.relation.relation_type)), ...steps.filter((step) => BELONGING_TYPES.has(step.relation.relation_type))];
    line.explain = Array.from(new Set(telling.map((step) => step.relation.id)));
    const party = parties.get(partyId) ?? { partyId, order: line.order, lines: [] };
    party.order = Math.min(party.order, line.order);
    party.lines.push(line);
    parties.set(partyId, party);
  });

  const rankKey = (line: { rank: number | null }) => line.rank ?? UNKNOWN_RANK;
  return Array.from(parties.values())
    .map((party) => ({
      partyId: party.partyId,
      order: party.order,
      direct: party.lines.some((line) => line.lead.length === 0),
      best: Math.min(...party.lines.map(rankKey)),
      lines: party.lines
        .sort((a, b) => rankKey(a) - rankKey(b) || a.lead.length - b.lead.length || b.last.length - a.last.length || a.order - b.order)
        .map((line) => ({ key: line.key, lead: line.lead, last: line.last, explain: line.explain, historic: line.historic, rank: line.rank })),
      outletIds: Array.from(new Set(party.lines.flatMap((line) => line.last.map((step) => step.to)))).sort((a, b) => newsOrder(a) - newsOrder(b)),
    }))
    .sort((a, b) => a.best - b.best || b.outletIds.length - a.outletIds.length || Number(b.direct) - Number(a.direct) || a.order - b.order)
    .map(({ partyId, lines: partyLines, outletIds }) => ({ partyId, lines: partyLines, outletIds }));
}

/** The relations of all lines, the ones that carry influence first, at most `max` (one evidence lookup). */
export function lineRelationIds(parties: readonly BehindParty[], max = 40): number[] {
  const ids = new Set<number>();
  for (const party of parties) for (const line of party.lines) line.explain.forEach((id) => ids.add(id));
  return Array.from(ids).slice(0, max);
}

/** "NOS", "NOS en de Volkskrant", "NOS, AD en de Volkskrant" */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;
}

/** Name of a model entity, or its id when it is missing */
export function entityName(entities: ReadonlyMap<number, PmEntity>, id: number): string {
  return entities.get(id)?.name ?? String(id);
}

export interface Touchpoint {
  outletId: number;
  /** The outlet brought this news (otherwise: it has a link with the news but did not report it) */
  covered: boolean;
  routes: PmPathRoute[];
}

/**
 * Per followed outlet its routes to the parties of the news that explain something (see
 * meaningfulRoute): the outlets that brought the news first, then those that did not ("zweeg"), each
 * with most routes first.
 */
export function touchpoints(paths: Pick<PmPaths, "routes" | "relations"> | null | undefined, newsOutletIds: readonly number[]): Touchpoint[] {
  if (!paths) return [];
  const relations = new Map(paths.relations.map((relation) => [relation.id, relation]));
  const byOutlet = new Map<number, PmPathRoute[]>();
  for (const route of paths.routes) {
    if (meaningfulRoute(route, relations)) byOutlet.set(route.from, [...(byOutlet.get(route.from) ?? []), route]);
  }
  return Array.from(byOutlet.entries())
    .map(([outletId, routes]) => ({ outletId, covered: newsOutletIds.includes(outletId), routes }))
    .sort((a, b) => Number(b.covered) - Number(a.covered) || b.routes.length - a.routes.length || a.outletId - b.outletId);
}
