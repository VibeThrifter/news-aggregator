/**
 * Epic 13/14: routes between the outlets and the parties of a news item (pm_paths), read from who
 * has the influence. A route only explains something when its stations belong to one of its ends or
 * carry the party's word to the outlet; "de Volkskrant zet de agenda van RTL, RIVM is bron voor RTL"
 * says nothing about the Volkskrant. Pure.
 */

import type { PmArgument, PmEntity, PmPathRoute, PmPaths, PmRelation } from "@/lib/types";

import { FILTERS, labelSourceId, PM_AFFILIATIONS } from "./labels";
import { influenceOf, relationFilters } from "./pm-graph";

/** Ties that make one party part of another: affiliations, owning, funding, carrying */
const BELONGING_TYPES: ReadonlySet<string> = new Set([...Array.from(PM_AFFILIATIONS), "eigendom", "investering", "financiering", "donor", "mediaplatform"]);

/** Pressure from outside: an attack, a threat, a ban. It says what someone did to an outlet, not who is behind its news */
const PRESSURE_TYPES: ReadonlySet<string> = new Set(["flak", "censuur", "intimidatie", "etikettering", "oppositie"]);

/**
 * What kind of link a line of "Wie zit erachter?" is, the ones that tell most first (Story 14.23):
 * 0 a person who belongs to both the party and the outlet (Kees Berghuis: VVD-woordvoerder and RTL
 * Nieuws), 1 owning, funding and other ties of belonging, 2 sourcing, 3 other influence, 4 pressure
 * from outside.
 */
export type LineTier = 0 | 1 | 2 | 3 | 4;

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
  /** What kind of link it is (people first) */
  tier: LineTier;
}

/**
 * The kind of a line (see LineTier), from its steps read from the party. A person in the middle who
 * belongs to both ends, or a person of the news who belongs to the outlet, is a people link.
 */
export function lineTier(steps: readonly ReadStep[], typeOf: TypeOf): LineTier {
  const belonging = steps.every((step) => BELONGING_TYPES.has(step.relation.relation_type));
  if (belonging) {
    const person = steps.some((step) => PM_AFFILIATIONS.has(step.relation.relation_type) && (typeOf(step.from) === "persoon" || typeOf(step.to) === "persoon"));
    return person ? 0 : 1;
  }
  const telling = steps.filter((step) => !BELONGING_TYPES.has(step.relation.relation_type));
  if (telling.some((step) => PRESSURE_TYPES.has(step.relation.relation_type))) return 4;
  return telling.every((step) => relationFilters(step.relation).includes("sourcing")) ? 2 : 3;
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
 * one line ("is vaste bron voor NOS en de Volkskrant"). A route with a link that has no source at
 * all is left out (Story 14.23: a claim without a source is no finding). `rankOf` gives how well a
 * relation is supported (0 = best): a route counts as its weakest step that carries influence.
 * People who belong to both ends first (LineTier), then best supported, then the parties that reach
 * most outlets, then those with a direct link, then the order of pm_paths (strongest route first).
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
    if (route.relations.some((id) => relations.get(id)?.source_count === 0)) return;
    const nodes = [...route.nodes].reverse();
    const steps = [...route.relations].reverse().map((id, index) => readStep(relations.get(id) as PmRelation, nodes[index], nodes[index + 1], typeOf));
    // The outlet's own influence on the party (the NOS lobbies the Kamer) is not who is behind its news
    if (steps.some((step) => step.flow === "up" && !BELONGING_TYPES.has(step.relation.relation_type))) return;
    const lead = steps.slice(0, -1);
    const last = steps[steps.length - 1];
    const kind = `${last.relation.relation_type}:${last.relation.mechanism ?? ""}:${last.forward ? ">" : "<"}`;
    const telling = steps.filter((step) => !BELONGING_TYPES.has(step.relation.relation_type));
    const ranks = (telling.length ? telling : steps)
      .map((step) => rankOf?.(step.relation.id))
      .filter((rank): rank is number => rank !== undefined);
    const rank = ranks.length ? Math.max(...ranks) : null;
    const key = `${route.to}|${lead.map((step) => step.relation.id).join(".")}|${kind}|${rank ?? ""}`;
    const line = lines.get(key) ?? { key, partyId: route.to, order, lead, last: [], explain: [], historic: false, rank, tier: lineTier(steps, typeOf) };
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
      tier: Math.min(...party.lines.map((line) => line.tier)),
      best: Math.min(...party.lines.map(rankKey)),
      lines: party.lines
        .sort((a, b) => a.tier - b.tier || rankKey(a) - rankKey(b) || a.lead.length - b.lead.length || b.last.length - a.last.length || a.order - b.order)
        .map((line) => ({ key: line.key, lead: line.lead, last: line.last, explain: line.explain, historic: line.historic, rank: line.rank, tier: line.tier })),
      outletIds: Array.from(new Set(party.lines.flatMap((line) => line.last.map((step) => step.to)))).sort((a, b) => newsOrder(a) - newsOrder(b)),
    }))
    .sort((a, b) => a.tier - b.tier || a.best - b.best || b.outletIds.length - a.outletIds.length || Number(b.direct) - Number(a.direct) || a.order - b.order)
    .map(({ partyId, lines: partyLines, outletIds }) => ({ partyId, lines: partyLines, outletIds }));
}

/** Folded text for name matching: lower case, no diacritics, single spaces */
function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface NamePattern {
  pattern: RegExp;
  /** Tested on the folded text (any case, no diacritics); else on the text as written */
  folded: boolean;
}

/**
 * The ways a text can name an entity: "AD (Algemeen Dagblad)" → AD, Algemeen Dagblad; "de Volkskrant"
 * → Volkskrant; "RTL Nederland" → RTL Nederland, RTL. Abbreviations match only as capitals ("AD", not
 * "ad"); other names as whole words in any case.
 */
export function namePatterns(name: string): NamePattern[] {
  const outer = name.replace(/\([^()]*\)\s*$/, "").trim();
  const inner = /\(([^()]+)\)\s*$/.exec(name)?.[1]?.trim() ?? "";
  const bare = (text: string) => text.replace(/^(de|het|een)\s+/i, "").trim();
  const forms = new Set<string>([outer, inner, bare(outer), bare(inner)].filter((form) => form.length >= 2));
  const first = bare(outer).split(/\s+/)[0] ?? "";
  if (/^[A-Z]{2,6}$/.test(first)) forms.add(first);
  return Array.from(forms).map((form) =>
    /^[A-Z0-9]{2,6}$/.test(form)
      ? { pattern: new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(form)}($|[^A-Za-z0-9])`), folded: false }
      : { pattern: new RegExp(`(^|[^a-z0-9])${escapeRegExp(foldText(form))}($|[^a-z0-9])`), folded: true },
  );
}

/** Whether a text names an entity (see namePatterns) */
export function textNames(text: string | null | undefined, name: string): boolean {
  if (!text?.trim()) return false;
  const folded = foldText(text);
  return namePatterns(name).some(({ pattern, folded: onFolded }) => pattern.test(onFolded ? folded : text));
}

/**
 * Whether the evidence for a relation is about this entity: an argument for it names it in its
 * claim, a quote or a source title. "Wilders noemde journalisten tuig van de richel" is evidence that
 * the PVV attacks the press, not that it attacks the AD.
 */
export function evidenceNames(args: readonly PmArgument[], name: string): boolean {
  return args.some(
    (argument) =>
      argument.stance === "supporting" &&
      (textNames(argument.claim, name) || argument.sources.some((source) => textNames(source.quote, name) || textNames(source.title, name))),
  );
}

/**
 * Story 14.23: only links whose evidence is about these two parties. A step that carries influence
 * (not a tie of belonging) must rest on evidence that names its end towards the outlet; outlets of a
 * line whose own link fails drop out, and a line or party without any left goes. Relations without
 * looked-up arguments (`argsOf` undefined) are kept: there is nothing to judge them by.
 */
export function specificParties(
  parties: readonly BehindParty[],
  argsOf: (relationId: number) => readonly PmArgument[] | undefined,
  nameOf: (entityId: number) => string,
): BehindParty[] {
  const specific = (step: ReadStep) => {
    if (BELONGING_TYPES.has(step.relation.relation_type)) return true;
    const args = argsOf(step.relation.id);
    return !args || evidenceNames(args, nameOf(step.to));
  };
  return parties
    .map((party) => {
      const lines = party.lines
        .filter((line) => line.lead.every(specific))
        .map((line) => ({ ...line, last: line.last.filter(specific) }))
        .filter((line) => line.last.length > 0);
      return { ...party, lines, outletIds: party.outletIds.filter((id) => lines.some((line) => line.last.some((step) => step.to === id))) };
    })
    .filter((party) => party.lines.length > 0);
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

/** Decision-making ties (Epic 15): offices, hierarchy, oversight, gifts and lobby access */
const GOVERNANCE_TYPES: ReadonlySet<string> = new Set(["ambt", "zeggenschap", "controle", "geschenk", "lobbyt"]);
const GOVERNANCE_FILTERS: ReadonlySet<string> = new Set(FILTERS.filter((filter) => filter.group === "besluitvorming").map((filter) => filter.id));
/** A station with this many relations connects everyone (the Tweede Kamer, a party, a big ministry) */
export const HUB_DEGREE = 25;

/** Whether a relation belongs to decision-making: its type or one of its categories (Epic 15) */
export function isGovernanceRelation(relation: Pick<PmRelation, "relation_type" | "filter" | "filters">): boolean {
  return GOVERNANCE_TYPES.has(relation.relation_type) || relationFilters(relation).some((filter) => GOVERNANCE_FILTERS.has(filter));
}

/** The decision-making category of a relation (its colour in "Hoe hangen ze samen?"), if it has one */
export function governanceFilter(relation: Pick<PmRelation, "filter" | "filters">): string | null {
  return relationFilters(relation).find((filter) => GOVERNANCE_FILTERS.has(filter)) ?? null;
}

/** One way two parties of the same news hang together through decision-making, in reading order */
export interface GovernanceRoute {
  key: string;
  steps: ReadStep[];
  historic: boolean;
}

/** "Kamerlid, fractievoorzitter" and "Kamerlid" are the same office for the hub rule */
function officeWord(relation: PmRelation): string {
  return (relation.functie ?? "").trim().split(/[\s,(]/)[0].toLowerCase();
}

/** Offices a body has many of: being one of them says nothing about the body */
const COMMON_OFFICE = /^(tweede kamerlid|eerste kamerlid|kamerlid|senator|lid\b|raadslid|gemeenteraadslid|statenlid|europarlementari|fractielid|commissielid|burgerlid|steunfractielid)/i;

/**
 * A tie a party has many of: a member, an employee, a lobbyist, a rank-and-file office. When a
 * station has such a tie on both sides, the two parties just share one of their many members or
 * lobbyists ("Tweede Kamer heeft als lid Marjolein Moorman, Moorman is lid van PRO"; "CIDI lobbyt bij
 * de Tweede Kamer en bij de VVD") and the route says nothing. A board seat, an advisory role or an
 * office of one does tell (a minister of the party, an interlocking director).
 */
export function massTie(relation: Pick<PmRelation, "relation_type" | "functie">): boolean {
  return relation.relation_type === "lobbyt" || whoIsWho(relation);
}

/** A rank-and-file office: Kamerlid, raadslid, lid (an office without a title counts as one) */
function rankAndFile(relation: Pick<PmRelation, "relation_type" | "functie">): boolean {
  return relation.relation_type === "ambt" && (!relation.functie?.trim() || COMMON_OFFICE.test(relation.functie.trim()));
}

/**
 * Who someone is, not how parties hang together: a party membership, a job, a rank-and-file office
 * ("VVD heeft als lid Thom van Campen", "Van Campen is Kamerlid bij Tweede Kamer"). The news itself
 * says it already.
 */
export function whoIsWho(relation: Pick<PmRelation, "relation_type" | "functie">): boolean {
  return ["lidmaatschap", "personeel", "dienstverband"].includes(relation.relation_type) || rankAndFile(relation);
}

/**
 * Epic 15: how two parties of the same news hang together through decision-making — an office, a
 * hierarchy, oversight, a gift or lobby access ("Heinen is minister van Financiën bij Ministerie
 * van Financiën, Ministerie van Financiën heeft zeggenschap over Belastingdienst"). Colleagues
 * through a hub say nothing ("both are Kamerlid", "both are in the VVD") and are left out, and so
 * is a route whose station is one of many on both sides (Story 14.23, massTie: "Tweede Kamer heeft
 * als lid Moorman, Moorman is lid van PRO" holds for every party in the Kamer, with a random
 * member), and a direct tie that only says who someone is (whoIsWho: a membership or a Kamerlid
 * seat the news already names). Routes without a source are left out. Every pair once (its
 * strongest route, as pm_paths orders them); current before historic, then fewest steps first.
 */
export function governanceRoutes(paths: Pick<PmPaths, "routes" | "relations" | "entities"> | null | undefined, max = 6): GovernanceRoute[] {
  if (!paths) return [];
  const relations = new Map(paths.relations.map((relation) => [relation.id, relation]));
  const degree = new Map(paths.entities.map((entity) => [entity.id, entity.degree]));
  const typeOf = typeLookup(paths.entities);
  const pairs = new Set<string>();
  const routes: GovernanceRoute[] = [];
  for (const route of paths.routes) {
    const found = route.relations.map((id) => relations.get(id));
    if (found.some((relation) => !relation) || route.from === route.to) continue;
    const steps = found as PmRelation[];
    if (!steps.some(isGovernanceRelation)) continue;
    if (steps.some((relation) => relation.source_count === 0)) continue;
    if (
      steps.length === 2 &&
      steps[0].relation_type === steps[1].relation_type &&
      officeWord(steps[0]) === officeWord(steps[1]) &&
      (degree.get(route.nodes[1]) ?? 0) >= HUB_DEGREE
    ) {
      continue;
    }
    // One of many on both sides: the station is a random member, employee, lobbyist or Kamerlid
    if (steps.length >= 2 && steps.every(massTie)) continue;
    // Who someone is ("VVD heeft als lid Van Campen"): the news says it already
    if (steps.length === 1 && whoIsWho(steps[0])) continue;
    const pair = [route.from, route.to].sort((a, b) => a - b).join("-");
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    routes.push({ key: `${pair}|${route.relations.join(".")}`, steps: readableRoute(route, relations, typeOf), historic: route.historic });
  }
  return routes
    .filter((route) => route.steps.length > 0)
    .sort((a, b) => Number(a.historic) - Number(b.historic) || a.steps.length - b.steps.length)
    .slice(0, max);
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
