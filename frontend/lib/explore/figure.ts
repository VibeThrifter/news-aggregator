/**
 * "Wie zegt wat?" as one picture (Epic 14): outlets, the speakers they give the word to and the
 * voices that are missing, with numbered markers for the findings that hang on them.
 *
 * Numbers are fixed per event: Dutch outlets by first publication → their speakers → foreign
 * outlets → contradictions → one text at more outlets → missing voices → findings without an
 * anchor → what the reader added
 * (own.ts, in the order they added it). They do not change when the reader adds or removes
 * outlets or entries of their own. Sources the reader added join the picture after the outlets of
 * the news; they do not change how it is grouped. Pure.
 */

import { newsStart } from "./chronology";
import { GROUP_COLORS } from "./colors";
import { copyShortLabel } from "./copies";
import type { Exploration } from "./exploration";
import { frameLabel, toneLabel } from "./labels";
import { isContextGap } from "./missing";
import { perspectiveEstimates } from "./nearest";
import { outletVoiceSentences } from "./outlet-sentences";
import { OWN_KINDS, ownEntryOf, resolveOwnAgainst, resolveOwnAnchor, sourceOutletKey } from "./own";
import type { Speaker, SpeakerModel } from "./speakers";
import type { ExploreOutlet, Finding } from "./types";

export type FigureMode = "perBron" | "perInvalshoek";
export type MarkerType = "claim" | "statistic" | "fallacy" | "contradiction" | "copy" | "error" | "gap" | "question" | "note";

/** Anchors are what a finding hangs on: `outlet:<key>`, `speaker:<id>` or `gap:<findingId>`. */
export const outletAnchor = (key: string) => `outlet:${key}`;
export const speakerAnchor = (id: string) => `speaker:${id}`;
export const gapAnchor = (findingId: string) => `gap:${findingId}`;

export interface Marker {
  findingId: string;
  number: number;
  type: MarkerType;
  /** Added by the reader */
  own?: boolean;
}

export interface OutletBalloonModel {
  anchor: string;
  outletKey: string;
  /** What the outlet says: its stance, else the summary sentence naming it, else a foreign gist,
   * else which missing voice it was added for, else its own headline; for a source of the reader
   * what they wrote */
  text: string | null;
  textKind: "stance" | "sentence" | "digest" | "found" | "headline" | "own" | "none";
  /** Placed in a perspective by estimate (perspective mode) */
  estimated: boolean;
  /** Media and agencies the outlet leans on */
  via: string[];
  speakers: Speaker[];
  /** Published far from the event (foreign coverage): its date */
  offDate: string | null;
}

export interface FigureGroup {
  key: string;
  /** "own": sources the reader added, when the outlets are grouped per perspective */
  kind: "outlet" | "perspective" | "unclassified" | "foreign" | "own" | "missing";
  label: string;
  color: string;
  /** Outlet groups: time of the first article, tone and own frames */
  meta: { time: string | null; tone: string | null; frames: string[] } | null;
  outlets: OutletBalloonModel[];
  /** Outlet groups: the speakers of that outlet */
  speakers: Speaker[];
  /** Missing voices (`own`: added by the reader; `found`: where an AI search found them speaking) */
  ghosts: { anchor: string; findingId: string; label: string; own?: boolean; found?: FoundSpeakerRef[] }[];
  /** An outlet the reader added (a source of their own) */
  own?: boolean;
}

export interface FigureModel {
  mode: FigureMode;
  groups: FigureGroup[];
  /** Finding id → number (only findings that are drawn as markers) */
  numbers: Map<string, number>;
  /** Anchor → its markers */
  markers: Map<string, Marker[]>;
  /** Finding id → anchor (claims, statistics, fallacies, missing voices) */
  anchorOf: Map<string, string>;
  /** Lines between two sides that contradict each other and stand right next to each other */
  contradictions: ContradictionLine[];
  /** Place (`placeKey`) → the contradictions on that balloon whose other side is not right next to it */
  contradictionNotes: Map<string, ContradictionNote[]>;
  /** Lines between balloons of one text that stand right next to each other */
  copyLines: CopyLine[];
  /** Place (`placeKey`) → the texts of that balloon that no line joins to the others */
  copyNotes: Map<string, CopyNote[]>;
}

/**
 * A contradiction between two balloons of one group that stand side by side or one under the other:
 * a line between them crosses no other balloon, so it never suggests a link with an outlet that has
 * nothing to do with it (`own`: the reader's).
 */
export interface ContradictionLine {
  findingId: string;
  number: number;
  group: string;
  from: string;
  to: string;
  /** Names of the two ends */
  between: [string, string];
  /** What they contradict each other about */
  topic: string;
  own?: boolean;
  /** The first place of this contradiction: the picture scrolls there when it is shown in it */
  lead: boolean;
}

/** A contradiction on a balloon whose other side stands elsewhere: who it contradicts. */
export interface ContradictionNote {
  findingId: string;
  number: number;
  /** Names of the other side */
  against: string[];
  topic: string;
  own?: boolean;
  lead: boolean;
}

/**
 * Two balloons of one text (Story 14.27) that stand side by side or one under the other; with more
 * outlets of that text, as many lines as join them.
 */
export interface CopyLine {
  findingId: string;
  number: number;
  group: string;
  from: string;
  to: string;
  between: [string, string];
  /** Where the text comes from in a word ("ANP", "persbureau", "DPG Media") */
  label: string;
  /** The first place of this text: the picture scrolls there when it is shown in it */
  lead: boolean;
}

/** A balloon of one text that no line joins to the others: which outlets have the same text. */
export interface CopyNote {
  findingId: string;
  number: number;
  /** Names of the other outlets of the text */
  others: string[];
  label: string;
  lead: boolean;
}

/** A balloon in one group: an outlet can stand in more than one perspective. */
export const placeKey = (group: string, anchor: string) => `${group}|${anchor}`;

interface Place {
  anchor: string;
  group: string;
  index: number;
  /** Columns of the group's grid; 0: not in a grid (speakers, one outlet per group) */
  cols: number;
}

/** Side by side (1) or one under the other (2); null when other balloons stand between them. */
function neighbours(a: Place, b: Place): number | null {
  if (a.group !== b.group || a.cols === 0 || b.cols === 0) return null;
  const apart = Math.abs(a.index - b.index);
  if (a.cols === 1) return apart === 1 ? 2 : null;
  if (apart === 1 && Math.floor(a.index / a.cols) === Math.floor(b.index / b.cols)) return 1;
  return apart === a.cols ? 2 : null;
}

export interface FoundSpeakerRef {
  speakerId: string;
  outletKey: string;
}

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Where a missing voice was found after all (AI search, approved): the speakers that answer it, by
 * the id of the missing voice or, for one another reader added, by the same words.
 */
export function foundVoicesFor(speakers: Pick<SpeakerModel, "speakers">, findingId: string, label: string): FoundSpeakerRef[] {
  return speakers.speakers
    .filter((speaker) => speaker.found && (speaker.found.gapKey === findingId || normalize(speaker.found.perspective) === normalize(label)))
    .map((speaker) => ({ speakerId: speaker.id, outletKey: speaker.outletKey }));
}

export { GROUP_COLORS };
const FOREIGN_COLOR = "#64748b";
const MISSING_COLOR = "#0f766e";
const OWN_COLOR = "#475569";
/** Foreign coverage this far from the event gets its date in the balloon */
const OFF_DATE_DAYS = 3;

const time = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });

function byFirstPublication(a: ExploreOutlet, b: ExploreOutlet): number {
  const ta = a.firstPublishedAt ? Date.parse(a.firstPublishedAt) : Number.POSITIVE_INFINITY;
  const tb = b.firstPublishedAt ? Date.parse(b.firstPublishedAt) : Number.POSITIVE_INFINITY;
  return ta - tb || a.name.localeCompare(b.name);
}

/**
 * Balloons of one text side by side, so the line between them crosses nothing: the outlets of a
 * text that has two or more of them in this group first (the biggest text first), the rest after,
 * each in its order of first publication.
 */
function copiesFirst(outlets: ExploreOutlet[], copyRank: Map<string, number>): ExploreOutlet[] {
  const count = new Map<number, number>();
  for (const outlet of outlets) {
    const rank = copyRank.get(outlet.key);
    if (rank !== undefined) count.set(rank, (count.get(rank) ?? 0) + 1);
  }
  const rankOf = (key: string) => {
    const rank = copyRank.get(key);
    return rank !== undefined && (count.get(rank) ?? 0) >= 2 ? rank : Number.MAX_SAFE_INTEGER;
  };
  return outlets
    .map((outlet, index) => ({ outlet, index, rank: rankOf(outlet.key) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.outlet);
}

/** The marker a finding has on the picture (own entries by their kind), or null. */
export function markerTypeOf(finding: Finding): MarkerType | null {
  switch (finding.body.type) {
    case "claim":
      return "claim";
    case "statistic":
      return "statistic";
    case "fallacy":
      return "fallacy";
    case "contradiction":
      return "contradiction";
    case "copy":
      return "copy";
    case "gap":
      // Missing context is not a voice: no empty balloon, no number
      return isContextGap(finding.body.gap) ? null : "gap";
    case "own":
      return OWN_KINDS[finding.body.entry.kind].marker;
    default:
      return null;
  }
}

/** Numbers and anchors of all markable findings (independent of the outlets shown). */
export function numberFindings(exploration: Exploration): Pick<FigureModel, "numbers" | "markers" | "anchorOf"> {
  const { input, findings, speakers } = exploration;
  const numbers = new Map<string, number>();
  const markers = new Map<string, Marker[]>();
  const anchorOf = new Map<string, string>();
  let next = 1;
  const add = (finding: Finding | undefined, anchor: string | null) => {
    if (!finding || numbers.has(finding.id)) return;
    const type = markerTypeOf(finding);
    if (!type) return;
    numbers.set(finding.id, next);
    if (anchor) {
      anchorOf.set(finding.id, anchor);
      const list = markers.get(anchor) ?? [];
      list.push({ findingId: finding.id, number: next, type, ...(finding.type === "own" ? { own: true } : {}) });
      markers.set(anchor, list);
    }
    next += 1;
  };
  const byId = exploration.findingById;
  const outletFindings = (outletKey: string) =>
    findings.filter(
      (finding) =>
        (finding.body.type === "statistic" && finding.body.outletKey === outletKey) ||
        (finding.body.type === "fallacy" && finding.outletKeys[0] === outletKey),
    );

  const ordered = [
    ...input.outlets.filter((outlet) => !outlet.isInternational).sort(byFirstPublication),
    ...input.outlets.filter((outlet) => outlet.isInternational).sort(byFirstPublication),
  ];
  for (const outlet of ordered) {
    const anchor = outletAnchor(outlet.key);
    for (const id of speakers.ownClaims.get(outlet.key) ?? []) add(byId.get(id), anchor);
    for (const finding of outletFindings(outlet.key)) add(finding, anchor);
    for (const speaker of speakers.byOutlet.get(outlet.key) ?? []) {
      for (const id of speaker.claimIds) add(byId.get(id), speakerAnchor(speaker.id));
    }
  }
  for (const finding of findings) {
    if (finding.body.type === "contradiction") add(finding, null);
  }
  // One text at more outlets: on the line between its balloons (buildFigure)
  for (const finding of findings) {
    if (finding.body.type === "copy") add(finding, null);
  }
  for (const finding of findings) {
    if (finding.body.type === "gap") add(finding, gapAnchor(finding.id));
  }
  // Findings that hang on nothing visible still get a number for the list
  for (const finding of findings) if (finding.type !== "own") add(finding, null);
  // Then what the reader added: on the outlet or speaker they chose, a missing voice on itself, an
  // error next to what it corrects, a contradiction on its line (buildFigure)
  for (const finding of findings) {
    const entry = ownEntryOf(finding);
    if (!entry) continue;
    if (entry.kind === "gap") add(finding, gapAnchor(finding.id));
    else if (entry.kind === "contradiction") add(finding, null);
    else add(finding, (entry.kind === "error" && entry.about ? anchorOf.get(entry.about) : null) ?? resolveOwnAnchor(entry, exploration));
  }
  return { numbers, markers, anchorOf };
}

/** The balloon text of an outlet and where it comes from. */
function outletText(
  outlet: ExploreOutlet,
  exploration: Exploration,
  sentences: ReturnType<typeof outletVoiceSentences>,
  group?: Finding,
): Pick<OutletBalloonModel, "text" | "textKind"> {
  if (outlet.own) {
    // A source the reader added: what they wrote it brings
    const entry = exploration.findings.map(ownEntryOf).find((item) => item?.kind === "source" && sourceOutletKey(item.url) === outlet.key);
    return entry ? { text: entry.text, textKind: "own" } : { text: null, textKind: "none" };
  }
  // First what the outlet says in the perspective it stands in, not its stance in an earlier one
  for (const finding of group ? [group, ...exploration.findings] : exploration.findings) {
    if (finding.body.type !== "perspective") continue;
    const stance = finding.body.stances.find((entry) => entry.outletKey === outlet.key)?.stance?.trim();
    if (stance) return { text: stance, textKind: "stance" };
  }
  // Only added for a missing voice (AI search, approved): what it brings, not "1 artikel" (the
  // voice itself speaks in its own balloon)
  const articles = outlet.articleIds.map((id) => exploration.index.article(id));
  const found = articles.find((article) => article?.foundVoice)?.foundVoice;
  const foundText = found ? { text: `Laat ${found.perspective[0].toLowerCase()}${found.perspective.slice(1)} aan het woord`, textKind: "found" as const } : null;
  if (foundText && articles.every((article) => article?.foundVoice)) return foundText;
  if (outlet.isInternational) {
    const digest = outlet.articleIds.map((id) => exploration.index.article(id)?.digest).find(Boolean);
    return digest ? { text: digest.text, textKind: "digest" } : (foundText ?? { text: null, textKind: "none" });
  }
  // Only a sentence in its own voice: "Volgens GeenStijl laat Trouw …" is GeenStijl speaking
  const first = sentences.get(outlet.key)?.[0];
  if (first) return { text: first.map((part) => part.text).join(""), textKind: "sentence" };
  if (foundText) return foundText;
  // No sentence of its own (it joined after the analysis read the news): its own headline, not "1 artikel"
  const headline = articles.find((article) => article && !article.foundVoice)?.title.trim();
  return headline ? { text: headline, textKind: "headline" } : { text: null, textKind: "none" };
}

function outletMeta(outlet: ExploreOutlet, exploration: Exploration): FigureGroup["meta"] {
  let tone: string | null = null;
  const frames: string[] = [];
  for (const finding of exploration.findings) {
    const body = finding.body;
    if (body.type === "tone" && body.outletKey === outlet.key && !tone) tone = toneLabel(body.analysis.tone).toLowerCase();
    if (body.type === "frame" && body.frame.attribution !== "geciteerd" && finding.outletKeys.includes(outlet.key)) {
      const label = frameLabel(body.frame.frame_type).toLowerCase();
      if (!frames.includes(label)) frames.push(label);
    }
  }
  const published = outlet.firstPublishedAt ? new Date(outlet.firstPublishedAt) : null;
  return { time: published && !Number.isNaN(published.getTime()) ? time.format(published) : null, tone, frames };
}

function offDate(outlet: ExploreOutlet, exploration: Exploration): string | null {
  const start = newsStart(exploration.input);
  const published = outlet.firstPublishedAt ? Date.parse(outlet.firstPublishedAt) : NaN;
  if (Number.isNaN(start) || Number.isNaN(published)) return null;
  return Math.abs(published - start) > OFF_DATE_DAYS * 86_400_000 ? day.format(new Date(published)) : null;
}

/**
 * The perspective an outlet stands in: the one with most of its articles, the first of equals
 * (the analysis puts the main angle first). Outlet key → index of the perspective.
 */
export function outletHomes(perspectives: Finding[], index: Exploration["index"]): Map<string, number> {
  const best = new Map<string, { index: number; count: number }>();
  for (const finding of perspectives) {
    if (finding.body.type !== "perspective") continue;
    const articles = new Map<string, Set<string>>();
    for (const source of finding.body.cluster.sources ?? []) {
      const { outletKey } = index.resolveUrl(source.url);
      if (outletKey) articles.set(outletKey, (articles.get(outletKey) ?? new Set<string>()).add(source.url));
    }
    // An outlet with a stance here always counts, also when its link did not resolve to an article
    for (const stance of finding.body.stances) if (!articles.has(stance.outletKey)) articles.set(stance.outletKey, new Set([stance.outletKey]));
    for (const [key, urls] of articles) {
      const current = best.get(key);
      if (!current || urls.size > current.count) best.set(key, { index: finding.body.index, count: urls.size });
    }
  }
  return new Map(Array.from(best, ([key, value]) => [key, value.index] as const));
}

/** The picture for the outlets the reader shows. */
export function buildFigure(exploration: Exploration, shown: (outlet: ExploreOutlet) => boolean): FigureModel {
  const { input, findings, speakers } = exploration;
  const numbered = numberFindings(exploration);
  const sentences = outletVoiceSentences(input);
  const dutch = input.outlets.filter((outlet) => !outlet.isInternational && shown(outlet)).sort(byFirstPublication);
  // Sources the reader added: after the outlets of the news, never a reason to group differently
  const ownOutlets = (exploration.ownOutlets ?? []).filter(shown);
  const ownDutch = ownOutlets.filter((outlet) => !outlet.isInternational);
  const foreign = [
    ...input.outlets.filter((outlet) => outlet.isInternational && shown(outlet)).sort(byFirstPublication),
    ...ownOutlets.filter((outlet) => outlet.isInternational),
  ];
  const perspectives = findings.filter((finding) => finding.body.type === "perspective");
  // Two or more Dutch outlets: grouped by how they bring the news, never one group per outlet
  const mode: FigureMode = dutch.length >= 2 && perspectives.length > 0 ? "perInvalshoek" : "perBron";
  // Outlet → its text that more outlets have (the first, biggest, one)
  const copies = findings.filter((finding) => finding.body.type === "copy");
  const copyRank = new Map<string, number>();
  copies.forEach((finding, rank) => {
    for (const key of finding.outletKeys) if (!copyRank.has(key)) copyRank.set(key, rank);
  });

  const balloon = (outlet: ExploreOutlet, estimated = false, group?: Finding): OutletBalloonModel => ({
    anchor: outletAnchor(outlet.key),
    outletKey: outlet.key,
    ...outletText(outlet, exploration, sentences, group),
    estimated,
    via: speakers.via.get(outlet.key) ?? [],
    speakers: speakers.byOutlet.get(outlet.key) ?? [],
    offDate: outlet.isInternational ? offDate(outlet, exploration) : null,
  });

  const groups: FigureGroup[] = [];
  if (mode === "perBron") {
    [...dutch, ...ownDutch].forEach((outlet, i) => {
      groups.push({
        key: `o:${outlet.key}`,
        kind: "outlet",
        label: outlet.name,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        meta: outlet.own ? null : outletMeta(outlet, exploration),
        outlets: [balloon(outlet)],
        speakers: speakers.byOutlet.get(outlet.key) ?? [],
        ghosts: [],
        ...(outlet.own ? { own: true } : {}),
      });
    });
  } else {
    const estimates = perspectiveEstimates(input, findings, exploration.index);
    // A simple division: every outlet stands once, in the perspective most of its articles are in
    // (De Dagelijkse Standaard stood in three of six groups, event 12055). A perspective whose
    // outlets all stand elsewhere is not drawn; the tab "Invalshoeken" has them all.
    const homes = outletHomes(perspectives, exploration.index);
    const placed = new Set<string>();
    perspectives.forEach((finding, i) => {
      if (finding.body.type !== "perspective") return;
      const index = finding.body.index;
      const members = dutch.filter((outlet) => (homes.has(outlet.key) ? homes.get(outlet.key) === index : !placed.has(outlet.key) && estimates.get(outlet.key)?.index === index));
      if (members.length === 0) return;
      members.forEach((outlet) => placed.add(outlet.key));
      groups.push({
        key: `p:${finding.body.index}`,
        kind: "perspective",
        label: finding.body.cluster.label,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        meta: null,
        outlets: copiesFirst(members, copyRank).map((outlet) => balloon(outlet, !homes.has(outlet.key), finding)),
        speakers: [],
        ghosts: [],
      });
    });
    const rest = dutch.filter((outlet) => !placed.has(outlet.key));
    if (rest.length) {
      groups.push({
        key: "p:-1",
        kind: "unclassified",
        label: "Nog niet ingedeeld",
        color: "#94a3b8",
        meta: null,
        outlets: copiesFirst(rest, copyRank).map((outlet) => balloon(outlet)),
        speakers: [],
        ghosts: [],
      });
    }
    if (ownDutch.length) {
      groups.push({
        key: "own",
        kind: "own",
        label: "Bronnen van jou",
        color: OWN_COLOR,
        meta: null,
        outlets: ownDutch.map((outlet) => balloon(outlet)),
        speakers: [],
        ghosts: [],
        own: true,
      });
    }
  }

  if (foreign.length) {
    groups.push({
      key: "foreign",
      kind: "foreign",
      label: "Buitenland",
      color: FOREIGN_COLOR,
      meta: null,
      outlets: foreign.map((outlet) => balloon(outlet)),
      speakers: [],
      ghosts: [],
    });
  }

  const ghosts = findings.flatMap((finding) => {
    const ghost = (label: string, own: boolean) => {
      const found = foundVoicesFor(speakers, finding.id, label);
      return [{ anchor: gapAnchor(finding.id), findingId: finding.id, label, ...(own ? { own } : {}), ...(found.length ? { found } : {}) }];
    };
    if (finding.body.type === "gap") return isContextGap(finding.body.gap) ? [] : ghost(finding.body.gap.perspective, false);
    if (finding.body.type === "own" && finding.body.entry.kind === "gap") return ghost(finding.body.entry.text, true);
    return [];
  });
  // Always there: the reader can add who is missing
  groups.push({
    key: "missing",
    kind: "missing",
    label: "Niet aan het woord",
    color: MISSING_COLOR,
    meta: null,
    outlets: [],
    speakers: [],
    ghosts,
  });

  // Where each balloon stands
  const places = new Map<string, Place[]>();
  const place = (anchor: string, group: string, index: number, cols: number) =>
    places.set(anchor, [...(places.get(anchor) ?? []), { anchor, group, index, cols }]);
  for (const group of groups) {
    const cols = group.kind === "perspective" || group.kind === "unclassified" || group.kind === "own" ? 2 : group.kind === "foreign" ? 1 : 0;
    group.outlets.forEach((item, index) => place(item.anchor, group.key, index, cols));
    // Speakers with a balloon or pill of their own
    if (group.kind === "outlet") for (const speaker of group.speakers) place(speakerAnchor(speaker.id), group.key, -1, 0);
    if (group.kind === "foreign") {
      for (const speaker of group.outlets.flatMap((item) => item.speakers.filter((one) => one.found))) place(speakerAnchor(speaker.id), group.key, -1, 0);
    }
  }
  const nameOf = (anchor: string) =>
    anchor.startsWith("outlet:")
      ? (exploration.index.outlet(anchor.slice("outlet:".length))?.name ?? anchor.slice("outlet:".length))
      : (speakers.byId.get(anchor.slice("speaker:".length))?.name ?? anchor.slice("speaker:".length));

  // A contradiction: a line between two sides that stand right next to each other; every other
  // balloon of it says who it contradicts. Never a line across balloons that have nothing to do with it.
  const contradictions: ContradictionLine[] = [];
  const contradictionNotes = new Map<string, ContradictionNote[]>();
  const placeContradiction = (findingId: string, number: number, topic: string, sideA: string[], sideB: string[], own: boolean) => {
    const at = (anchors: string[]) => anchors.flatMap((anchor) => places.get(anchor) ?? []);
    const a = at(sideA);
    const b = at(sideB);
    const pairs = a
      .flatMap((x) => b.map((y) => ({ x, y, distance: neighbours(x, y) })))
      .filter((pair): pair is { x: Place; y: Place; distance: number } => pair.distance !== null)
      .sort((p, q) => p.distance - q.distance);
    const joined = new Set<string>();
    let lead = true;
    for (const { x, y } of pairs) {
      const kx = placeKey(x.group, x.anchor);
      const ky = placeKey(y.group, y.anchor);
      if (joined.has(kx) || joined.has(ky)) continue;
      joined.add(kx);
      joined.add(ky);
      contradictions.push({
        findingId,
        number,
        group: x.group,
        from: x.anchor,
        to: y.anchor,
        between: [nameOf(x.anchor), nameOf(y.anchor)],
        topic,
        ...(own ? { own } : {}),
        lead,
      });
      lead = false;
    }
    const note = (item: Place, other: string[]) => {
      const key = placeKey(item.group, item.anchor);
      if (joined.has(key)) return;
      const against = Array.from(new Set(other.map(nameOf)));
      contradictionNotes.set(key, [...(contradictionNotes.get(key) ?? []), { findingId, number, against, topic, ...(own ? { own } : {}), lead }]);
      lead = false;
    };
    for (const item of a) note(item, sideB);
    for (const item of b) note(item, sideA);
  };

  // The analysis: between outlets that are both in the picture
  const visible = new Set([...dutch, ...ownDutch, ...foreign].map((outlet) => outlet.key));
  for (const finding of findings) {
    if (finding.body.type !== "contradiction") continue;
    const sideA = finding.body.outletsA.filter((key) => visible.has(key));
    const sideB = finding.body.outletsB.filter((key) => visible.has(key) && !sideA.includes(key));
    const number = numbered.numbers.get(finding.id);
    if (sideA.length && sideB.length && number) {
      placeContradiction(finding.id, number, finding.body.contradiction.topic, sideA.map(outletAnchor), sideB.map(outletAnchor), false);
    }
  }

  // One text at more outlets: lines between its balloons that stand right next to each other, as
  // many as join them; a balloon that no line joins says which outlets have the same text
  const copyLines: CopyLine[] = [];
  const copyNotes = new Map<string, CopyNote[]>();
  for (const finding of copies) {
    const number = numbered.numbers.get(finding.id);
    if (finding.body.type !== "copy" || !number) continue;
    const label = copyShortLabel(finding.body.group);
    const at = finding.outletKeys.filter((key) => visible.has(key)).flatMap((key) => places.get(outletAnchor(key)) ?? []);
    const pairs = at
      .flatMap((x, i) => at.slice(i + 1).map((y) => ({ x, y, distance: neighbours(x, y) })))
      .filter((pair): pair is { x: Place; y: Place; distance: number } => pair.distance !== null)
      .sort((p, q) => p.distance - q.distance);
    const parent = new Map<string, string>();
    const root = (key: string): string => {
      const up = parent.get(key);
      return up ? root(up) : key;
    };
    const joined = new Set<string>();
    let lead = true;
    for (const { x, y } of pairs) {
      const kx = placeKey(x.group, x.anchor);
      const ky = placeKey(y.group, y.anchor);
      if (root(kx) === root(ky)) continue;
      parent.set(root(kx), root(ky));
      joined.add(kx);
      joined.add(ky);
      copyLines.push({ findingId: finding.id, number, group: x.group, from: x.anchor, to: y.anchor, between: [nameOf(x.anchor), nameOf(y.anchor)], label, lead });
      lead = false;
    }
    const names = finding.outletKeys.map((key) => nameOf(outletAnchor(key)));
    for (const item of at) {
      const key = placeKey(item.group, item.anchor);
      if (joined.has(key)) continue;
      const own = nameOf(item.anchor);
      copyNotes.set(key, [...(copyNotes.get(key) ?? []), { findingId: finding.id, number, others: names.filter((name) => name !== own), label, lead }]);
      lead = false;
    }
  }

  // With groups per perspective the speakers are avatars in their outlet's balloon: their markers too
  let markers = numbered.markers;
  if (mode === "perInvalshoek") {
    markers = new Map(numbered.markers);
    for (const group of groups) {
      for (const balloon of group.outlets) {
        const own = numbered.markers.get(balloon.anchor) ?? [];
        const fromSpeakers = balloon.speakers.flatMap((speaker) => numbered.markers.get(speakerAnchor(speaker.id)) ?? []);
        if (fromSpeakers.length) markers.set(balloon.anchor, [...own, ...fromSpeakers].sort((a, b) => a.number - b.number));
      }
    }
  }

  // The reader's contradictions: between the two balloons as drawn (a speaker without a balloon of
  // their own is in their outlet's), else the number on the one side that is there
  const drawn = (anchor: string | null): string | null => {
    if (!anchor) return null;
    if (anchor.startsWith("outlet:")) return visible.has(anchor.slice("outlet:".length)) ? anchor : null;
    const speaker = speakers.byId.get(anchor.slice("speaker:".length));
    if (!speaker || !visible.has(speaker.outletKey)) return null;
    const outlet = exploration.index.outlet(speaker.outletKey);
    return speaker.found || (mode === "perBron" && outlet && !outlet.isInternational) ? anchor : outletAnchor(speaker.outletKey);
  };
  for (const finding of findings) {
    const entry = ownEntryOf(finding);
    const number = numbered.numbers.get(finding.id);
    if (entry?.kind !== "contradiction" || !number) continue;
    const from = drawn(resolveOwnAnchor(entry, exploration));
    const to = drawn(resolveOwnAgainst(entry, exploration));
    if (from && to && from !== to) {
      placeContradiction(finding.id, number, entry.text, [from], [to], true);
    } else if (from ?? to) {
      if (markers === numbered.markers) markers = new Map(numbered.markers);
      const anchor = (from ?? to) as string;
      markers.set(anchor, [...(markers.get(anchor) ?? []), { findingId: finding.id, number, type: "contradiction" as const, own: true }]);
    }
  }

  return { mode, groups, ...numbered, markers, contradictions, contradictionNotes, copyLines, copyNotes };
}
