/**
 * What you add yourself (Epic 14): your own answer to the questions under the picture, e.g. a doubt,
 * a speaker, a voice that is missing, a question nobody asked, a remark or a moment.
 *
 * Own entries become findings like the analysis' own: numbered after them (the analysis keeps its
 * numbers), drawn on the picture, listed in their tab, to save and connect on the board. The UI
 * marks them "jij". Stored on this device only (store.ts). Pure.
 */

import type { Exploration } from "./exploration";
import { findingsByTab } from "./findings";
import { actorNode, gapNode, outletNode } from "./ids";
import { actorKeys } from "./normalize";
import { capitalize, entityMatcher, guessSpeakerKind, type Speaker, type SpeakerModel } from "./speakers";
import type { Finding, NodeId, OwnEntry, OwnKind, TabId } from "./types";

export interface OwnKindDefinition {
  tab: TabId;
  /** The marker it gets on the picture; null: no number */
  marker: "claim" | "question" | "note" | "gap" | null;
  /** What it can hang on: a speaker or an outlet, only an outlet, or nothing */
  anchor: "speaker-or-outlet" | "outlet" | null;
}

export const OWN_KINDS: Record<OwnKind, OwnKindDefinition> = {
  claim: { tab: "klopt", marker: "claim", anchor: "speaker-or-outlet" },
  speaker: { tab: "stemmen", marker: null, anchor: "outlet" },
  gap: { tab: "ontbreekt", marker: "gap", anchor: null },
  question: { tab: "ontbreekt", marker: "question", anchor: "speaker-or-outlet" },
  note: { tab: "gebracht", marker: "note", anchor: "speaker-or-outlet" },
  moment: { tab: "tijdlijn", marker: null, anchor: null },
};

export const OWN_KIND_IDS = Object.keys(OWN_KINDS) as OwnKind[];

/** What you can add in each tab, in this order. */
export const OWN_KINDS_BY_TAB: Partial<Record<TabId, OwnKind[]>> = {
  klopt: ["claim"],
  stemmen: ["speaker"],
  ontbreekt: ["gap", "question"],
  gebracht: ["note"],
  tijdlijn: ["moment"],
};

export const OWN_LIMITS = { text: 300, detail: 1000, quote: 500, perEvent: 100 } as const;

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

/** The anchor of an entry if it is still in this news (an outlet or speaker can disappear). */
export function resolveOwnAnchor(entry: OwnEntry, exploration: Pick<Exploration, "index" | "speakers">): string | null {
  const allowed = OWN_KINDS[entry.kind].anchor;
  const anchor = entry.anchor;
  if (!allowed || !anchor) return null;
  if (anchor.startsWith("outlet:")) return exploration.index.outlet(anchor.slice("outlet:".length)) ? anchor : null;
  if (allowed === "speaker-or-outlet" && anchor.startsWith("speaker:")) {
    return exploration.speakers.byId.has(anchor.slice("speaker:".length)) ? anchor : null;
  }
  return null;
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

function ownFinding(entry: OwnEntry, order: number, view: Pick<Exploration, "index" | "speakers">): Finding {
  const anchor = resolveOwnAnchor(entry, view);
  const outletKey = anchorOutletKey(anchor, view.speakers);
  const speaker = anchor?.startsWith("speaker:") ? view.speakers.byId.get(anchor.slice("speaker:".length)) : undefined;
  const links: NodeId[] = [];
  if (outletKey) links.push(outletNode(outletKey));
  if (speaker && speaker.kind !== "anonymous") links.push(actorNode(speaker.slug));
  if (entry.kind === "speaker") {
    const slug = actorKeys(entry.text).slug;
    if (slug) links.push(actorNode(slug));
  }
  if (entry.kind === "gap") links.push(gapNode(entry.text));
  return {
    id: entry.id,
    tab: OWN_KINDS[entry.kind].tab,
    type: "own",
    outletKeys: outletKey ? [outletKey] : [],
    links: Array.from(new Set(links)),
    order: OWN_ORDER + order,
    body: { type: "own", entry },
  };
}

/**
 * The exploration with the reader's entries in it: as findings (after the analysis'), and added
 * speakers in the speaker model. Without entries the exploration itself comes back.
 */
export function withOwn(exploration: Exploration, entries: readonly OwnEntry[] | undefined): Exploration {
  if (!entries || entries.length === 0) return exploration;
  const speakers = withOwnSpeakers(exploration, entries);
  const view = { index: exploration.index, speakers };
  const own = entries.map((entry, i) => ownFinding(entry, i, view));
  const findings = [...exploration.findings, ...own];
  return {
    ...exploration,
    findings,
    findingById: new Map(findings.map((finding) => [finding.id, finding])),
    byTab: findingsByTab(findings),
    speakers,
  };
}

/** What an entry can hang on, in picture order: Dutch outlets with their speakers, then the foreign ones shown. */
export function anchorOptions(
  exploration: Exploration,
  kind: OwnKind,
  shown: (outletKey: string) => boolean = () => true,
): { anchor: string; outletKey: string; speaker: Speaker | null }[] {
  const allowed = OWN_KINDS[kind].anchor;
  if (!allowed) return [];
  const byTime = (a: { firstPublishedAt: string | null; name: string }, b: { firstPublishedAt: string | null; name: string }) =>
    (a.firstPublishedAt ? Date.parse(a.firstPublishedAt) : Infinity) - (b.firstPublishedAt ? Date.parse(b.firstPublishedAt) : Infinity) ||
    a.name.localeCompare(b.name);
  const outlets = exploration.input.outlets.filter((outlet) => !outlet.isInternational || shown(outlet.key));
  const ordered = [...outlets.filter((outlet) => !outlet.isInternational).sort(byTime), ...outlets.filter((outlet) => outlet.isInternational).sort(byTime)];
  return ordered.flatMap((outlet) => [
    { anchor: `outlet:${outlet.key}`, outletKey: outlet.key, speaker: null },
    ...(allowed === "speaker-or-outlet"
      ? (exploration.speakers.byOutlet.get(outlet.key) ?? []).map((speaker) => ({ anchor: `speaker:${speaker.id}`, outletKey: outlet.key, speaker }))
      : []),
  ]);
}
