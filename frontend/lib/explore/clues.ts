/**
 * Derive investigation clues ("aanwijzingen") from the analysis, grouped per spoor.
 *
 * A clue is face down until the user reveals it. The teaser may say WHERE to look (outlets,
 * actor names, counts) but never gives away WHAT was found.
 */

import { getCountryFlag, getCountryName } from "@/lib/format";

import { biasByOutlet } from "./bias";
import {
  actorNode,
  claimNode,
  contradictionNode,
  countryNode,
  fallacyNode,
  frameNode,
  gapNode,
  outletNode,
  perspectiveNode,
  statisticNode,
} from "./ids";
import { ArticleIndex } from "./input";
import { PRESENTED_AS_LABELS } from "./labels";
import { DUTCH_OUTLETS } from "./media-landscape";
import { actorKeys, fnv1a } from "./normalize";
import { firstReporters, parseTimelineTime } from "./timeline";
import type { Clue, ClueBody, ExploreInput, NodeId, SpoorId, StanceEntry } from "./types";

/** Mainstream outlets used for the "Wie zweeg?" clue. */
const MAINSTREAM_KEYS = ["nos", "nu-nl", "ad", "rtl-nieuws", "telegraaf", "volkskrant", "parool", "trouw"];

const PERSON_TYPES = /(persoon|politicus|minister|expert|wetenschapper|hoogleraar|woordvoerder|journalist|arts|advocaat)/i;

class ClueCollector {
  readonly clues: Clue[] = [];
  private ids = new Set<string>();
  private orders = new Map<SpoorId, number>();

  add(
    spoor: SpoorId,
    key: string,
    body: ClueBody,
    teaser: Clue["teaser"],
    outletKeys: string[],
    links: NodeId[],
  ): Clue {
    let id = `${spoor}:${body.type}:${fnv1a(key)}`;
    let suffix = 2;
    while (this.ids.has(id)) {
      id = `${spoor}:${body.type}:${fnv1a(key)}-${suffix}`;
      suffix += 1;
    }
    this.ids.add(id);
    const order = this.orders.get(spoor) ?? 0;
    this.orders.set(spoor, order + 1);
    const clue: Clue = {
      id,
      spoor,
      type: body.type,
      teaser,
      outletKeys: unique(outletKeys),
      links: unique(links),
      order,
      body,
    };
    this.clues.push(clue);
    return clue;
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function outletNames(index: ArticleIndex, keys: string[], max = 3): string {
  const names = keys.map((key) => index.outlet(key)?.name ?? key);
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}

export function isPersonAuthority(authorityType: string | null | undefined): boolean {
  return Boolean(authorityType && PERSON_TYPES.test(authorityType));
}

export function deriveClues(input: ExploreInput, index: ArticleIndex = new ArticleIndex(input)): Clue[] {
  const collector = new ClueCollector();
  const insight = input.insight;
  const dutchOutlets = input.outlets.filter((outlet) => !outlet.isInternational);

  // --- Wie zegt wat? ---------------------------------------------------------------------------
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
      "wie-zegt-wat",
      `cluster:${cluster.label}`,
      { type: "perspective", cluster, index: i, stances },
      {
        title: `Invalshoek ${i + 1}`,
        hint: outletKeys.length === 1 ? "1 bron" : `${outletKeys.length} bronnen`,
      },
      outletKeys,
      [perspectiveNode(i), ...outletKeys.map(outletNode)],
    );
  });

  // Voices: who gets quoted per Dutch outlet
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
      "wie-zegt-wat",
      `voices:${outlet.key}`,
      { type: "voices", outletKey: outlet.key, actors, sourcingPattern },
      {
        title: `Wie krijgt het woord bij ${outlet.name}?`,
        hint: actors.length ? `${actors.length} ${actors.length === 1 ? "stem" : "stemmen"}` : "Bronpatroon",
      },
      [outlet.key],
      [outletNode(outlet.key), ...actors.map((actor) => actorNode(actor.key))],
    );
  }

  // --- Wat klopt er niet? ------------------------------------------------------------------------
  for (const contradiction of insight?.contradictions ?? []) {
    const outletsA = index.outletsForUrls(contradiction.claim_a?.sources);
    const outletsB = index.outletsForUrls(contradiction.claim_b?.sources);
    const sides = [outletNames(index, outletsA, 2), outletNames(index, outletsB, 2)].filter(Boolean);
    collector.add(
      "wat-klopt-niet",
      `contradiction:${contradiction.topic}`,
      { type: "contradiction", contradiction, outletsA, outletsB },
      { title: "Tegenspraak", hint: sides.length === 2 ? `${sides[0]} vs ${sides[1]}` : "Twee claims botsen" },
      [...outletsA, ...outletsB],
      [contradictionNode(contradiction.topic), ...[...outletsA, ...outletsB].map(outletNode)],
    );
  }

  for (const claim of insight?.unsubstantiated_claims ?? []) {
    const { outletKey } = index.resolveUrl(claim.article_url);
    const actor = actorKeys(claim.source_in_article || "onbekend");
    const presented = PRESENTED_AS_LABELS[claim.presented_as?.toLowerCase?.() ?? ""] ?? "zonder bewijs";
    collector.add(
      "wat-klopt-niet",
      `claim:${claim.claim}`,
      { type: "claim", claim, outletKey, actorKey: actor.slug },
      {
        title: "Claim zonder bewijs",
        hint: [presented, outletKey ? index.outlet(outletKey)?.name : null].filter(Boolean).join(" · "),
      },
      outletKey ? [outletKey] : [],
      [claimNode(claim.claim), actorNode(actor.slug), ...(outletKey ? [outletNode(outletKey)] : [])],
    );
  }

  for (const issue of insight?.statistical_issues ?? []) {
    const { outletKey } = index.resolveUrl(issue.article_url);
    collector.add(
      "wat-klopt-niet",
      `statistic:${issue.claim}`,
      { type: "statistic", issue, outletKey },
      { title: "Cijfer onder de loep", hint: outletKey ? index.outlet(outletKey)?.name : undefined },
      outletKey ? [outletKey] : [],
      [statisticNode(issue.claim), ...(outletKey ? [outletNode(outletKey)] : [])],
    );
  }

  for (const fallacy of insight?.fallacies ?? []) {
    const outletKeys = index.outletsForUrls(fallacy.sources);
    collector.add(
      "wat-klopt-niet",
      `fallacy:${fallacy.type}:${fallacy.description}`,
      { type: "fallacy", fallacy },
      { title: "Redeneerfout gespot", hint: outletKeys.length ? outletNames(index, outletKeys) : undefined },
      outletKeys,
      [fallacyNode(`${fallacy.type}:${fallacy.description}`), ...outletKeys.map(outletNode)],
    );
  }

  // --- Wie heeft er belang bij? --------------------------------------------------------------------
  for (const authority of insight?.authority_analysis ?? []) {
    const { outletKey } = index.resolveUrl(authority.article_url);
    const actor = actorKeys(authority.authority, { person: isPersonAuthority(authority.authority_type) });
    collector.add(
      "wie-heeft-belang",
      `authority:${actor.slug}:${outletKey ?? ""}`,
      { type: "authority", authority, outletKey, actorKey: actor.slug },
      { title: `Wie is ${actor.display}?`, hint: authority.authority_type || undefined },
      outletKey ? [outletKey] : [],
      [actorNode(actor.slug), ...(outletKey ? [outletNode(outletKey)] : [])],
    );
  }

  if (insight?.timing_analysis?.why_now) {
    collector.add(
      "wie-heeft-belang",
      "timing",
      { type: "timing", timing: insight.timing_analysis },
      { title: "Waarom juist nu?", hint: "Timing en cui bono" },
      [],
      [],
    );
  }

  const ownedOutlets = dutchOutlets.filter((outlet) => outlet.profile?.pmEntityId || outlet.profile?.ownershipType);
  if (ownedOutlets.length > 0) {
    collector.add(
      "wie-heeft-belang",
      "ownership",
      { type: "ownership", outletKeys: ownedOutlets.map((outlet) => outlet.key) },
      {
        title: ownedOutlets.length > 1 ? `Van wie zijn deze ${ownedOutlets.length} bronnen?` : `Van wie is ${ownedOutlets[0].name}?`,
        hint: "Eigendom en geldstromen",
      },
      ownedOutlets.map((outlet) => outlet.key),
      ownedOutlets.map((outlet) => outletNode(outlet.key)),
    );
  }

  // --- Hoe wordt het gebracht? ---------------------------------------------------------------------
  for (const frame of insight?.frames ?? []) {
    const outletKeys = frame.attribution === "geciteerd" ? [] : index.outletsForUrls(frame.sources);
    const quotedOutlets = frame.attribution === "geciteerd" ? index.outletsForUrls(frame.sources) : [];
    collector.add(
      "hoe-gebracht",
      `frame:${frame.frame_type}:${frame.description}`,
      { type: "frame", frame },
      {
        title: "Welk frame?",
        hint:
          frame.attribution === "geciteerd"
            ? `Geciteerd door ${outletNames(index, quotedOutlets)}`
            : outletKeys.length
              ? `Bij ${outletNames(index, outletKeys)}`
              : undefined,
      },
      [...outletKeys, ...quotedOutlets],
      [frameNode(frame.frame_type), ...outletKeys.map(outletNode)],
    );
  }

  for (const analysis of insight?.media_analysis ?? []) {
    if (!analysis.tone) continue;
    const outletKey = index.outletForName(analysis.source, analysis.article_url);
    const name = outletKey ? (index.outlet(outletKey)?.name ?? analysis.source) : analysis.source;
    collector.add(
      "hoe-gebracht",
      `tone:${outletKey ?? analysis.source}`,
      { type: "tone", analysis, outletKey },
      { title: `Toon van ${name}`, hint: "Toon, kopieergedrag, anonieme bronnen" },
      outletKey ? [outletKey] : [],
      outletKey ? [outletNode(outletKey)] : [],
    );
  }

  for (const entry of Array.from(biasByOutlet(input).values())) {
    const outlet = index.outlet(entry.outletKey);
    if (!outlet || entry.sentenceCount === 0) continue;
    collector.add(
      "hoe-gebracht",
      `bias:${entry.outletKey}`,
      {
        type: "bias",
        outletKey: entry.outletKey,
        articleIds: entry.articleIds,
        averageRating: entry.averageRating,
        sentenceCount: entry.sentenceCount,
        topTypes: entry.topTypes,
      },
      {
        title: `${entry.sentenceCount} gekleurde ${entry.sentenceCount === 1 ? "zin" : "zinnen"} bij ${outlet.name}`,
        hint: "Bias per zin",
      },
      [entry.outletKey],
      [outletNode(entry.outletKey)],
    );
  }

  // --- Wat zie je niet? ----------------------------------------------------------------------------
  for (const gap of insight?.coverage_gaps ?? []) {
    collector.add(
      "wat-zie-je-niet",
      `gap:${gap.perspective}`,
      { type: "gap", gap },
      { title: "Ontbrekend perspectief", hint: "Een stem die niet klinkt" },
      [],
      [gapNode(gap.perspective)],
    );
  }

  for (const analysis of insight?.media_analysis ?? []) {
    const questions = analysis.questions_not_asked?.length ?? 0;
    const omitted = analysis.perspectives_omitted?.length ?? 0;
    if (questions === 0 && omitted === 0 && !analysis.framing_by_omission) continue;
    const outletKey = index.outletForName(analysis.source, analysis.article_url);
    const name = outletKey ? (index.outlet(outletKey)?.name ?? analysis.source) : analysis.source;
    collector.add(
      "wat-zie-je-niet",
      `questions:${outletKey ?? analysis.source}`,
      { type: "questions", analysis, outletKey },
      {
        title: questions
          ? `${questions} ${questions === 1 ? "vraag" : "vragen"} die ${name} niet stelde`
          : `Wat liet ${name} weg?`,
      },
      outletKey ? [outletKey] : [],
      outletKey ? [outletNode(outletKey)] : [],
    );
  }

  if (insight?.scientific_plurality?.topic) {
    collector.add(
      "wat-zie-je-niet",
      "science",
      { type: "science", plurality: insight.scientific_plurality },
      { title: "Is er echt consensus?", hint: "Wetenschappelijk debat" },
      [],
      [],
    );
  }

  if ((insight?.clusters?.length ?? 0) === 1 && dutchOutlets.length >= 3) {
    collector.add(
      "wat-zie-je-niet",
      "consensus",
      { type: "consensus", clusterLabel: insight?.clusters?.[0]?.label ?? "" },
      { title: "Iedereen hetzelfde verhaal?", hint: `${dutchOutlets.length} bronnen, één invalshoek` },
      dutchOutlets.map((outlet) => outlet.key),
      [perspectiveNode(0)],
    );
  }

  if (dutchOutlets.length >= 2) {
    const present = new Set(dutchOutlets.map((outlet) => outlet.key));
    const silent = DUTCH_OUTLETS.filter((profile) => MAINSTREAM_KEYS.includes(profile.key) && !present.has(profile.key));
    if (silent.length > 0 && silent.length < MAINSTREAM_KEYS.length) {
      collector.add(
        "wat-zie-je-niet",
        "silent",
        { type: "silent", outletNames: silent.map((profile) => profile.name) },
        { title: "Wie zweeg?", hint: "Voor zover in onze bronnen" },
        [],
        [],
      );
    }
  }

  // --- Hoe liep het? -------------------------------------------------------------------------------
  const order = firstReporters(input);
  if (order.length >= 2) {
    collector.add(
      "hoe-liep-het",
      "first",
      { type: "first", order },
      { title: "Wie was er het eerst?", hint: `${order.length} bronnen in de race` },
      order.map((entry) => entry.outletKey),
      order.map((entry) => outletNode(entry.outletKey)),
    );
  }

  (insight?.timeline ?? []).forEach((item, i) => {
    if (!item.headline?.trim()) return;
    const parsed = parseTimelineTime(item.time, item.headline);
    const outletKeys = index.outletsForUrls(item.sources);
    collector.add(
      "hoe-liep-het",
      `timeline:${i}:${item.time}:${item.headline}`,
      { type: "timeline", item, timeLabel: parsed.label, historic: parsed.yearOnly },
      { title: parsed.label === "–" ? "Een moment" : parsed.label, hint: "Wat gebeurde er?" },
      outletKeys,
      outletKeys.map(outletNode),
    );
  });

  // --- En het buitenland? --------------------------------------------------------------------------
  const byCountry = new Map<string, number[]>();
  for (const article of input.articles) {
    if (!article.isInternational) continue;
    const country = article.sourceCountry ?? index.outlet(article.outletKey)?.country ?? "";
    const list = byCountry.get(country) ?? [];
    list.push(article.id);
    byCountry.set(country, list);
  }
  for (const [country, articleIds] of Array.from(byCountry.entries())) {
    const outletKeys = unique(articleIds.map((id) => index.article(id)?.outletKey).filter((key): key is string => Boolean(key)));
    const label = country ? `${getCountryFlag(country)} ${getCountryName(country)}` : "Buitenland";
    collector.add(
      "buitenland",
      `international:${country}`,
      { type: "international", country: country || null, articleIds },
      { title: label.trim(), hint: `${articleIds.length} ${articleIds.length === 1 ? "artikel" : "artikelen"}` },
      outletKeys,
      [...(country ? [countryNode(country)] : []), ...outletKeys.map(outletNode)],
    );
  }

  for (const country of insight?.involved_countries ?? []) {
    if (!country.iso_code) continue;
    collector.add(
      "buitenland",
      `country:${country.iso_code}`,
      { type: "country", country },
      { title: `Waarom ${getCountryName(country.iso_code)}?`, hint: getCountryFlag(country.iso_code) || undefined },
      [],
      [countryNode(country.iso_code)],
    );
  }

  return collector.clues;
}

/** Clues grouped per spoor, in display order. */
export function cluesBySpoor(clues: Clue[]): Map<SpoorId, Clue[]> {
  const map = new Map<SpoorId, Clue[]>();
  for (const clue of clues) {
    const list = map.get(clue.spoor) ?? [];
    list.push(clue);
    map.set(clue.spoor, list);
  }
  for (const list of Array.from(map.values())) {
    list.sort((a, b) => a.order - b.order);
  }
  return map;
}

export const CLUE_TYPE_LABELS: Record<Clue["type"], string> = {
  perspective: "Invalshoek",
  voices: "Stemmen",
  contradiction: "Tegenspraak",
  claim: "Claim zonder bewijs",
  statistic: "Cijfer",
  fallacy: "Redeneerfout",
  authority: "Bronkritiek",
  timing: "Timing",
  ownership: "Eigendom",
  frame: "Frame",
  tone: "Toon",
  bias: "Bias per zin",
  gap: "Ontbrekend perspectief",
  questions: "Niet gesteld",
  science: "Wetenschap",
  consensus: "Eenstemmigheid",
  silent: "Stilte",
  first: "Wie eerst",
  timeline: "Moment",
  international: "Buitenland",
  country: "Land",
};

/** Title of a revealed clue (used on the card front and in the dossier). */
export function revealedTitle(clue: Clue, index: ArticleIndex): string {
  const body = clue.body;
  const outletName = (key: string | null | undefined) => (key ? (index.outlet(key)?.name ?? key) : "");
  switch (body.type) {
    case "perspective":
      return body.cluster.label;
    case "voices":
      return `Stemmen bij ${outletName(body.outletKey)}`;
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
      return "Waarom juist nu?";
    case "ownership":
      return "Eigendom van de bronnen";
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
    case "consensus":
      return "Iedereen hetzelfde verhaal";
    case "silent":
      return "Wie zweeg";
    case "first":
      return `Eerst: ${outletName(body.order[0]?.outletKey)}`;
    case "timeline":
      return body.item.headline;
    case "international":
      return clue.teaser.title;
    case "country":
      return body.country.name;
    default:
      return clue.teaser.title;
  }
}
