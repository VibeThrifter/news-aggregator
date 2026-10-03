/**
 * Findings ("bevindingen"): every analysis field turned into an item that hangs on something you
 * can see — an outlet, a speaker or a missing voice — and belongs to one tab under "Wie zegt wat?".
 *
 * Ids are `<type>:<hash>`: the ids of the old clue model without their spoor prefix, so saved
 * dossier items map one-to-one (see `legacyFindingId`).
 */

import { biasByOutlet } from "./bias";
import {
  actorNode,
  claimNode,
  contradictionNode,
  fallacyNode,
  frameNode,
  gapNode,
  outletNode,
  perspectiveNode,
  statisticNode,
} from "./ids";
import { ArticleIndex } from "./input";
import { OWN_KIND_LABELS } from "./labels";
import { actorKeys, fnv1a } from "./normalize";
import { firstReporters, parseTimelineTime } from "./timeline";
import type { AnalysisBody, AnalysisType, ExploreInput, Finding, NodeId, StanceEntry, TabId } from "./types";

const PERSON_TYPES = /(persoon|politicus|minister|expert|wetenschapper|hoogleraar|woordvoerder|journalist|arts|advocaat)/i;

/** The tab each kind of finding belongs to (a reader's own entries: see own.ts). */
export const TAB_OF_TYPE: Record<AnalysisType, TabId> = {
  perspective: "invalshoeken",
  voices: "stemmen",
  authority: "stemmen",
  contradiction: "klopt",
  claim: "klopt",
  statistic: "klopt",
  fallacy: "klopt",
  frame: "gebracht",
  tone: "gebracht",
  bias: "gebracht",
  gap: "ontbreekt",
  questions: "ontbreekt",
  science: "ontbreekt",
  first: "tijdlijn",
  timeline: "tijdlijn",
  timing: "tijdlijn",
};

class FindingCollector {
  readonly findings: Finding[] = [];
  private ids = new Set<string>();
  private orders = new Map<TabId, number>();

  add(key: string, body: AnalysisBody, outletKeys: string[], links: NodeId[]): Finding {
    const tab = TAB_OF_TYPE[body.type];
    let id = `${body.type}:${fnv1a(key)}`;
    let suffix = 2;
    while (this.ids.has(id)) {
      id = `${body.type}:${fnv1a(key)}-${suffix}`;
      suffix += 1;
    }
    this.ids.add(id);
    const order = this.orders.get(tab) ?? 0;
    this.orders.set(tab, order + 1);
    const finding: Finding = {
      id,
      tab,
      type: body.type,
      outletKeys: unique(outletKeys),
      links: unique(links),
      order,
      body,
    };
    this.findings.push(finding);
    return finding;
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function isPersonAuthority(authorityType: string | null | undefined): boolean {
  return Boolean(authorityType && PERSON_TYPES.test(authorityType));
}

export function deriveFindings(input: ExploreInput, index: ArticleIndex = new ArticleIndex(input)): Finding[] {
  const collector = new FindingCollector();
  const insight = input.insight;
  const dutchOutlets = input.outlets.filter((outlet) => !outlet.isInternational);

  // --- Invalshoeken ----------------------------------------------------------------------------
  (insight?.clusters ?? []).forEach((cluster, i) => {
    const stances: StanceEntry[] = [];
    for (const source of cluster.sources ?? []) {
      const { article, outletKey } = index.resolveUrl(source.url);
      if (!outletKey) continue;
      const existing = stances.find((entry) => entry.outletKey === outletKey);
      if (existing) {
        if (!existing.stance && source.stance) existing.stance = source.stance;
        continue;
      }
      stances.push({ outletKey, stance: source.stance ?? null, articleId: article?.id ?? null });
    }
    const outletKeys = stances.map((entry) => entry.outletKey);
    collector.add(
      `cluster:${cluster.label}`,
      { type: "perspective", cluster, index: i, stances },
      outletKeys,
      [perspectiveNode(i), ...outletKeys.map(outletNode)],
    );
  });

  // --- Wie praat? ------------------------------------------------------------------------------
  // Voices: who gets quoted per Dutch outlet, and its sourcing pattern
  for (const outlet of dutchOutlets) {
    const actors: { name: string; key: string; role: string | null }[] = [];
    const addActor = (name: string | null | undefined, role: string | null, person = false) => {
      if (!name || !name.trim()) return;
      const keys = actorKeys(name, { person });
      if (!keys.slug || actors.some((actor) => actor.key === keys.slug)) return;
      actors.push({ name: keys.display, key: keys.slug, role });
    };
    for (const authority of insight?.authority_analysis ?? []) {
      if (index.resolveUrl(authority.article_url).outletKey === outlet.key) {
        addActor(authority.authority, authority.authority_type || null, isPersonAuthority(authority.authority_type));
      }
    }
    for (const claim of insight?.unsubstantiated_claims ?? []) {
      if (index.resolveUrl(claim.article_url).outletKey === outlet.key) {
        addActor(claim.source_in_article, "doet een claim");
      }
    }
    for (const articleId of outlet.articleIds) {
      for (const quote of input.bias[articleId]?.quote_biases ?? []) {
        addActor(quote.speaker, "wordt geciteerd", true);
      }
    }
    const analysis = (insight?.media_analysis ?? []).find(
      (item) => index.outletForName(item.source, item.article_url) === outlet.key,
    );
    const sourcingPattern = analysis?.sourcing_pattern?.trim() || null;
    if (actors.length === 0 && !sourcingPattern) continue;
    collector.add(
      `voices:${outlet.key}`,
      { type: "voices", outletKey: outlet.key, actors, sourcingPattern },
      [outlet.key],
      [outletNode(outlet.key), ...actors.map((actor) => actorNode(actor.key))],
    );
  }

  for (const authority of insight?.authority_analysis ?? []) {
    const { outletKey } = index.resolveUrl(authority.article_url);
    const actor = actorKeys(authority.authority, { person: isPersonAuthority(authority.authority_type) });
    collector.add(
      `authority:${actor.slug}:${outletKey ?? ""}`,
      { type: "authority", authority, outletKey, actorKey: actor.slug },
      outletKey ? [outletKey] : [],
      [actorNode(actor.slug), ...(outletKey ? [outletNode(outletKey)] : [])],
    );
  }

  // --- Klopt het? ------------------------------------------------------------------------------
  for (const contradiction of insight?.contradictions ?? []) {
    const outletsA = index.outletsForUrls(contradiction.claim_a?.sources);
    const outletsB = index.outletsForUrls(contradiction.claim_b?.sources);
    collector.add(
      `contradiction:${contradiction.topic}`,
      { type: "contradiction", contradiction, outletsA, outletsB },
      [...outletsA, ...outletsB],
      [contradictionNode(contradiction.topic), ...[...outletsA, ...outletsB].map(outletNode)],
    );
  }

  for (const claim of insight?.unsubstantiated_claims ?? []) {
    const { outletKey } = index.resolveUrl(claim.article_url);
    const actor = actorKeys(claim.source_in_article || "onbekend");
    collector.add(
      `claim:${claim.claim}`,
      { type: "claim", claim, outletKey, actorKey: actor.slug },
      outletKey ? [outletKey] : [],
      [claimNode(claim.claim), actorNode(actor.slug), ...(outletKey ? [outletNode(outletKey)] : [])],
    );
  }

  for (const issue of insight?.statistical_issues ?? []) {
    const { outletKey } = index.resolveUrl(issue.article_url);
    collector.add(
      `statistic:${issue.claim}`,
      { type: "statistic", issue, outletKey },
      outletKey ? [outletKey] : [],
      [statisticNode(issue.claim), ...(outletKey ? [outletNode(outletKey)] : [])],
    );
  }

  for (const fallacy of insight?.fallacies ?? []) {
    const outletKeys = index.outletsForUrls(fallacy.sources);
    collector.add(
      `fallacy:${fallacy.type}:${fallacy.description}`,
      { type: "fallacy", fallacy },
      outletKeys,
      [fallacyNode(`${fallacy.type}:${fallacy.description}`), ...outletKeys.map(outletNode)],
    );
  }

  // --- Hoe gebracht? ---------------------------------------------------------------------------
  for (const frame of insight?.frames ?? []) {
    const outletKeys = index.outletsForUrls(frame.sources);
    collector.add(
      `frame:${frame.frame_type}:${frame.description}`,
      { type: "frame", frame },
      outletKeys,
      [frameNode(frame.frame_type), ...(frame.attribution === "geciteerd" ? [] : outletKeys.map(outletNode))],
    );
  }

  for (const analysis of insight?.media_analysis ?? []) {
    if (!analysis.tone) continue;
    const outletKey = index.outletForName(analysis.source, analysis.article_url);
    collector.add(
      `tone:${outletKey ?? analysis.source}`,
      { type: "tone", analysis, outletKey },
      outletKey ? [outletKey] : [],
      outletKey ? [outletNode(outletKey)] : [],
    );
  }

  for (const entry of Array.from(biasByOutlet(input).values())) {
    const outlet = index.outlet(entry.outletKey);
    if (!outlet || entry.sentenceCount === 0) continue;
    collector.add(
      `bias:${entry.outletKey}`,
      {
        type: "bias",
        outletKey: entry.outletKey,
        articleIds: entry.articleIds,
        averageRating: entry.averageRating,
        sentenceCount: entry.sentenceCount,
        topTypes: entry.topTypes,
      },
      [entry.outletKey],
      [outletNode(entry.outletKey)],
    );
  }

  // --- Wat ontbreekt? --------------------------------------------------------------------------
  for (const gap of insight?.coverage_gaps ?? []) {
    collector.add(`gap:${gap.perspective}`, { type: "gap", gap }, [], [gapNode(gap.perspective)]);
  }

  for (const analysis of insight?.media_analysis ?? []) {
    const questions = analysis.questions_not_asked?.length ?? 0;
    const omitted = analysis.perspectives_omitted?.length ?? 0;
    if (questions === 0 && omitted === 0 && !analysis.framing_by_omission) continue;
    const outletKey = index.outletForName(analysis.source, analysis.article_url);
    collector.add(
      `questions:${outletKey ?? analysis.source}`,
      { type: "questions", analysis, outletKey },
      outletKey ? [outletKey] : [],
      outletKey ? [outletNode(outletKey)] : [],
    );
  }

  if (insight?.scientific_plurality?.topic) {
    collector.add("science", { type: "science", plurality: insight.scientific_plurality }, [], []);
  }

  // --- Tijdlijn --------------------------------------------------------------------------------
  const order = firstReporters(input);
  if (order.length >= 2) {
    collector.add(
      "first",
      { type: "first", order },
      order.map((entry) => entry.outletKey),
      order.map((entry) => outletNode(entry.outletKey)),
    );
  }

  (insight?.timeline ?? []).forEach((item, i) => {
    if (!item.headline?.trim()) return;
    const parsed = parseTimelineTime(item.time, item.headline);
    const outletKeys = index.outletsForUrls(item.sources);
    collector.add(
      `timeline:${i}:${item.time}:${item.headline}`,
      { type: "timeline", item, timeLabel: parsed.label, historic: parsed.yearOnly },
      outletKeys,
      outletKeys.map(outletNode),
    );
  });

  if (insight?.timing_analysis?.why_now) {
    collector.add("timing", { type: "timing", timing: insight.timing_analysis }, [], []);
  }

  return collector.findings;
}

/** Findings grouped per tab, in display order. */
export function findingsByTab(findings: Finding[]): Map<TabId, Finding[]> {
  const map = new Map<TabId, Finding[]>();
  for (const finding of findings) {
    const list = map.get(finding.tab) ?? [];
    list.push(finding);
    map.set(finding.tab, list);
  }
  for (const list of Array.from(map.values())) {
    list.sort((a, b) => a.order - b.order);
  }
  return map;
}

/** The spoor prefixes of the old clue model (Epic 11): `wat-klopt-niet:claim:abc` -> `claim:abc`. */
const LEGACY_SPOREN = ["wie-zegt-wat", "wat-klopt-niet", "wie-heeft-belang", "hoe-gebracht", "wat-zie-je-niet", "hoe-liep-het", "buitenland"];

export function legacyFindingId(id: string): string {
  const prefix = LEGACY_SPOREN.find((spoor) => id.startsWith(`${spoor}:`));
  return prefix ? id.slice(prefix.length + 1) : id;
}

export const FINDING_TYPE_LABELS: Record<Finding["type"], string> = {
  perspective: "Invalshoek",
  voices: "Stemmen",
  contradiction: "Tegenspraak",
  claim: "Claim zonder bewijs",
  statistic: "Cijfer",
  fallacy: "Redeneerfout",
  authority: "Autoriteit",
  timing: "Waarom nu?",
  frame: "Frame",
  tone: "Toon",
  bias: "Gekleurde zinnen",
  gap: "Ontbrekende stem",
  questions: "Niet gesteld",
  science: "Wetenschap",
  first: "Wie eerst",
  timeline: "Moment",
  own: "Van jou",
};

/** Type label of a finding; a reader's own entry by its kind ("Twijfel", "Ontbrekende stem"). */
export function findingLabel(finding: Finding): string {
  return finding.body.type === "own" ? OWN_KIND_LABELS[finding.body.entry.kind] : FINDING_TYPE_LABELS[finding.type];
}

/** Short title of a finding (rows, dossier, popovers). */
export function findingTitle(finding: Finding, index: ArticleIndex): string {
  const body = finding.body;
  const outletName = (key: string | null | undefined) => (key ? (index.outlet(key)?.name ?? key) : "");
  switch (body.type) {
    case "perspective":
      return body.cluster.label;
    case "voices":
      return `Wie praat bij ${outletName(body.outletKey)}`;
    case "contradiction":
      return body.contradiction.topic;
    case "claim":
      return body.claim.claim;
    case "statistic":
      return body.issue.claim;
    case "fallacy":
      return body.fallacy.type.replace(/_/g, " ");
    case "authority":
      return body.authority.authority;
    case "timing":
      return "Waarom nu?";
    case "frame":
      return body.frame.technique || body.frame.frame_type;
    case "tone":
      return `Toon van ${outletName(body.outletKey) || body.analysis.source}`;
    case "bias":
      return `Gekleurde zinnen bij ${outletName(body.outletKey)}`;
    case "gap":
      return body.gap.perspective;
    case "questions":
      return `Niet gesteld door ${outletName(body.outletKey) || body.analysis.source}`;
    case "science":
      return body.plurality.topic;
    case "first":
      return `Eerst: ${outletName(body.order[0]?.outletKey)}`;
    case "timeline":
      return body.item.headline;
    case "own":
      return body.entry.text;
    default:
      return FINDING_TYPE_LABELS[finding.type];
  }
}
