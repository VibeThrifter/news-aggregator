/**
 * What you add yourself (Epic 14): your own answer to the questions under the picture, e.g. a doubt,
 * a fallacy, a contradiction, an error, a speaker, a source, a voice that is missing, a question
 * nobody asked, a remark or a moment.
 *
 * Own entries become findings like the analysis' own: numbered after them (the analysis keeps its
 * numbers), drawn on the picture, listed in their tab, to save and connect on the board. The UI
 * marks them "jij". A source of your own hangs on its outlet; an outlet that is not in the news yet
 * joins the picture (`Exploration.ownOutlets`) without changing what the analysis found. Stored on
 * this device only (store.ts). Pure.
 */

import type { Exploration } from "./exploration";
import { findingsByTab } from "./findings";
import { actorNode, gapNode, outletNode } from "./ids";
import { ArticleIndex } from "./input";
import { findOutletByUrl } from "./media-landscape";
import { actorKeys, fnv1a, normalizeUrl, slugify, urlFingerprint, urlHost } from "./normalize";
import { capitalize, entityMatcher, guessSpeakerKind, type Speaker, type SpeakerModel } from "./speakers";
import type { ExploreArticle, ExploreInput, ExploreOutlet, Finding, NodeId, OwnEntry, OwnKind, TabId } from "./types";

export interface OwnKindDefinition {
  tab: TabId;
  /** The marker it gets on the picture; null: no number */
  marker: "claim" | "fallacy" | "contradiction" | "error" | "question" | "note" | "gap" | null;
  /** What it can hang on: a speaker or an outlet, only an outlet, or nothing */
  anchor: "speaker-or-outlet" | "outlet" | null;
}

export const OWN_KINDS: Record<OwnKind, OwnKindDefinition> = {
  claim: { tab: "klopt", marker: "claim", anchor: "speaker-or-outlet" },
  fallacy: { tab: "klopt", marker: "fallacy", anchor: "speaker-or-outlet" },
  // Between two sides: `anchor` and `against`
  contradiction: { tab: "klopt", marker: "contradiction", anchor: "speaker-or-outlet" },
  error: { tab: "klopt", marker: "error", anchor: "speaker-or-outlet" },
  speaker: { tab: "stemmen", marker: null, anchor: "outlet" },
  // Hangs on the outlet of its link (ownSources)
  source: { tab: "stemmen", marker: null, anchor: null },
  gap: { tab: "ontbreekt", marker: "gap", anchor: null },
  question: { tab: "ontbreekt", marker: "question", anchor: "speaker-or-outlet" },
  note: { tab: "gebracht", marker: "note", anchor: "speaker-or-outlet" },
  moment: { tab: "tijdlijn", marker: null, anchor: null },
};

export const OWN_KIND_IDS = Object.keys(OWN_KINDS) as OwnKind[];

/** What you can add in each tab, in this order. */
export const OWN_KINDS_BY_TAB: Partial<Record<TabId, OwnKind[]>> = {
  klopt: ["claim", "fallacy", "contradiction", "error"],
  stemmen: ["speaker", "source"],
  ontbreekt: ["gap", "question"],
  gebracht: ["note"],
  tijdlijn: ["moment"],
};

export const OWN_LIMITS = { text: 300, detail: 1000, quote: 500, title: 200, perEvent: 100 } as const;

/** Own findings come after the analysis' in every tab */
const OWN_ORDER = 100_000;

export function isOwnId(id: string): boolean {
  return id.startsWith("own:");
}

export function newOwnId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `own:${random}`;
}

/** The entry behind a finding, if the reader added it. */
export function ownEntryOf(finding: Finding | undefined | null): OwnEntry | null {
  return finding?.body.type === "own" ? finding.body.entry : null;
}

/** The outlet an anchor belongs to: `outlet:<key>`, or the outlet of `speaker:<id>`. */
export function anchorOutletKey(anchor: string | null | undefined, speakers: Pick<SpeakerModel, "byId">): string | null {
  if (!anchor) return null;
  if (anchor.startsWith("outlet:")) return anchor.slice("outlet:".length);
  if (anchor.startsWith("speaker:")) return speakers.byId.get(anchor.slice("speaker:".length))?.outletKey ?? null;
  return null;
}

/** The outlet a link belongs to: a known outlet, else one by its host (`bron-<host>`). */
export function sourceOutletKey(url: string | null | undefined): string | null {
  const host = urlHost(url);
  if (!url || !host) return null;
  return findOutletByUrl(url)?.key ?? `bron-${slugify(host)}`;
}

type AnchorView = Pick<Exploration, "index" | "speakers">;

/** An anchor (`outlet:<key>` or `speaker:<id>`) if it is still in this news (it can disappear). */
function resolveAnchorValue(anchor: string | null | undefined, allowed: OwnKindDefinition["anchor"], view: AnchorView): string | null {
  if (!allowed || !anchor) return null;
  if (anchor.startsWith("outlet:")) return view.index.outlet(anchor.slice("outlet:".length)) ? anchor : null;
  if (allowed === "speaker-or-outlet" && anchor.startsWith("speaker:")) {
    return view.speakers.byId.has(anchor.slice("speaker:".length)) ? anchor : null;
  }
  return null;
}

/** The anchor of an entry if it is still in this news; a source hangs on the outlet of its link. */
export function resolveOwnAnchor(entry: OwnEntry, exploration: AnchorView): string | null {
  if (entry.kind === "source") {
    const key = sourceOutletKey(entry.url);
    return key && exploration.index.outlet(key) ? `outlet:${key}` : null;
  }
  return resolveAnchorValue(entry.anchor, OWN_KINDS[entry.kind].anchor, exploration);
}

/** The other side of a contradiction, if it is still in this news. */
export function resolveOwnAgainst(entry: OwnEntry, exploration: AnchorView): string | null {
  return entry.kind === "contradiction" ? resolveAnchorValue(entry.against, "speaker-or-outlet", exploration) : null;
}

/** Article ids of own sources: negative, far below the demo fixtures' */
function ownArticleId(entryId: string): number {
  return -(1_000_000_000 + (parseInt(fnv1a(entryId), 36) % 1_000_000_000));
}

export interface OwnSources {
  /** Outlets the news does not have yet */
  outlets: ExploreOutlet[];
  articles: ExploreArticle[];
}

/** The sources the reader added that bring an outlet the news does not have (one per outlet). */
export function ownSources(input: Pick<ExploreInput, "outlets">, entries: readonly OwnEntry[]): OwnSources {
  const known = new Set(input.outlets.map((outlet) => outlet.key));
  const outlets = new Map<string, ExploreOutlet>();
  const articles: ExploreArticle[] = [];
  for (const entry of entries) {
    const key = entry.kind === "source" ? sourceOutletKey(entry.url) : null;
    // A source of an outlet in the news hangs on that outlet: nothing new to draw
    if (!key || !entry.url || known.has(key)) continue;
    const profile = findOutletByUrl(entry.url);
    const host = urlHost(entry.url);
    const country = profile?.country ?? (host.endsWith(".nl") ? "NL" : host.endsWith(".be") ? "BE" : null);
    const isInternational = Boolean(country && country !== "NL");
    let outlet = outlets.get(key);
    if (!outlet) {
      const spectrum = profile?.spectrum ?? null;
      outlet = {
        key,
        name: profile?.name ?? host,
        domain: profile?.domains[0] ?? host,
        isInternational,
        country,
        spectrum: typeof spectrum === "number" ? spectrum : null,
        isAlternative: spectrum === "alternative",
        x: typeof spectrum === "number" ? spectrum : (profile?.politicalX ?? null),
        establishment: isInternational ? null : (profile?.establishment ?? null),
        articleIds: [],
        firstPublishedAt: null,
        profile,
        own: true,
      };
      outlets.set(key, outlet);
    }
    const id = ownArticleId(entry.id);
    outlet.articleIds.push(id);
    articles.push({
      id,
      title: entry.title || host,
      url: entry.url,
      urlKey: normalizeUrl(entry.url),
      fingerprint: urlFingerprint(entry.url),
      outletKey: key,
      outletName: outlet.name,
      publishedAt: null,
      isInternational,
      sourceCountry: country,
      digest: null,
      foundVoice: null,
      ownId: entry.id,
    });
  }
  return { outlets: Array.from(outlets.values()), articles };
}

/**
 * The article index that also finds the reader's own sources. Only for lookups: the analysis' URLs
 * and names still resolve to the outlets of the news, so what it found stays the same.
 */
class OwnIndex extends ArticleIndex {
  private readonly ownOutlets: Map<string, ExploreOutlet>;
  private readonly ownArticles: Map<number, ExploreArticle>;

  constructor(input: ExploreInput, sources: OwnSources) {
    super(input);
    this.ownOutlets = new Map(sources.outlets.map((outlet) => [outlet.key, outlet]));
    this.ownArticles = new Map(sources.articles.map((article) => [article.id, article]));
  }

  override article(id: number): ExploreArticle | null {
    return this.ownArticles.get(id) ?? super.article(id);
  }

  override outlet(key: string | null | undefined): ExploreOutlet | null {
    return (key ? this.ownOutlets.get(key) : undefined) ?? super.outlet(key);
  }
}

/** The speakers of this news plus the ones the reader added (at the end of their outlet). */
function withOwnSpeakers(exploration: Exploration, entries: readonly OwnEntry[]): SpeakerModel {
  const base = exploration.speakers;
  const matchEntity = entityMatcher(exploration.input.entities);
  const added: Speaker[] = [];
  for (const entry of entries) {
    if (entry.kind !== "speaker" || !entry.anchor?.startsWith("outlet:")) continue;
    const outletKey = entry.anchor.slice("outlet:".length);
    if (!exploration.index.outlet(outletKey)) continue;
    const entity = matchEntity(entry.text);
    const kind = guessSpeakerKind(entry.text, entity?.kind);
    const keys = actorKeys(entity?.name ?? entry.text, { person: kind === "person" });
    added.push({
      id: `${outletKey}:${entry.id}`,
      slug: keys.slug || entry.id,
      name: capitalize(entry.text.trim()),
      role: entry.detail?.trim() || null,
      org: null,
      kind,
      outletKey,
      via: null,
      claimIds: [],
      authorityId: null,
      interest: false,
      entityKey: entity?.entity_key ?? null,
      ownId: entry.id,
      quote: entry.quote?.trim() || null,
    });
  }
  if (added.length === 0) return base;
  const byOutlet = new Map(base.byOutlet);
  for (const speaker of added) byOutlet.set(speaker.outletKey, [...(byOutlet.get(speaker.outletKey) ?? []), speaker]);
  return {
    ...base,
    speakers: [...base.speakers, ...added],
    byId: new Map([...Array.from(base.byId.entries()), ...added.map((speaker) => [speaker.id, speaker] as const)]),
    byOutlet,
  };
}

function ownFinding(entry: OwnEntry, order: number, view: AnchorView): Finding {
  const anchors = [resolveOwnAnchor(entry, view), resolveOwnAgainst(entry, view)].filter((anchor): anchor is string => Boolean(anchor));
  const outletKeys = Array.from(new Set(anchors.map((anchor) => anchorOutletKey(anchor, view.speakers)).filter((key): key is string => Boolean(key))));
  const links: NodeId[] = outletKeys.map((key) => outletNode(key));
  for (const anchor of anchors) {
    const speaker = anchor.startsWith("speaker:") ? view.speakers.byId.get(anchor.slice("speaker:".length)) : undefined;
    if (speaker && speaker.kind !== "anonymous") links.push(actorNode(speaker.slug));
  }
  if (entry.kind === "speaker") {
    const slug = actorKeys(entry.text).slug;
    if (slug) links.push(actorNode(slug));
  }
  if (entry.kind === "gap") links.push(gapNode(entry.text));
  return {
    id: entry.id,
    tab: OWN_KINDS[entry.kind].tab,
    type: "own",
    outletKeys,
    links: Array.from(new Set(links)),
    order: OWN_ORDER + order,
    body: { type: "own", entry },
  };
}

/**
 * The exploration with the reader's entries in it: as findings (after the analysis'), added speakers
 * in the speaker model and sources of outlets the news does not have as `ownOutlets` (also found by
 * `index.outlet`). Without entries the exploration itself comes back.
 */
export function withOwn(exploration: Exploration, entries: readonly OwnEntry[] | undefined): Exploration {
  if (!entries || entries.length === 0) return exploration;
  const sources = ownSources(exploration.input, entries);
  const index = sources.outlets.length ? new OwnIndex(exploration.input, sources) : exploration.index;
  const base: Exploration = { ...exploration, index, ownOutlets: sources.outlets };
  const speakers = withOwnSpeakers(base, entries);
  const view = { index, speakers };
  const own = entries.map((entry, i) => ownFinding(entry, i, view));
  const findings = [...exploration.findings, ...own];
  return {
    ...base,
    findings,
    findingById: new Map(findings.map((finding) => [finding.id, finding])),
    byTab: findingsByTab(findings),
    speakers,
  };
}

/** Outlets in picture order: Dutch ones by first publication, then foreign ones; sources of your own last in each. */
function inPictureOrder(outlets: ExploreOutlet[]): ExploreOutlet[] {
  const byTime = (a: ExploreOutlet, b: ExploreOutlet) =>
    Number(Boolean(a.own)) - Number(Boolean(b.own)) ||
    (a.firstPublishedAt ? Date.parse(a.firstPublishedAt) : Infinity) - (b.firstPublishedAt ? Date.parse(b.firstPublishedAt) : Infinity) ||
    a.name.localeCompare(b.name);
  return [...outlets.filter((outlet) => !outlet.isInternational).sort(byTime), ...outlets.filter((outlet) => outlet.isInternational).sort(byTime)];
}

/** What an entry can hang on, in picture order: Dutch outlets with their speakers, then the foreign ones shown. */
export function anchorOptions(
  exploration: Exploration,
  kind: OwnKind,
  shown: (outletKey: string) => boolean = () => true,
): { anchor: string; outletKey: string; speaker: Speaker | null }[] {
  const allowed = OWN_KINDS[kind].anchor;
  if (!allowed) return [];
  const all = [...exploration.input.outlets, ...(exploration.ownOutlets ?? [])];
  const outlets = inPictureOrder(all.filter((outlet) => !outlet.isInternational || shown(outlet.key)));
  return outlets.flatMap((outlet) => [
    { anchor: `outlet:${outlet.key}`, outletKey: outlet.key, speaker: null },
    ...(allowed === "speaker-or-outlet"
      ? (exploration.speakers.byOutlet.get(outlet.key) ?? []).map((speaker) => ({ anchor: `speaker:${speaker.id}`, outletKey: outlet.key, speaker }))
      : []),
  ]);
}
