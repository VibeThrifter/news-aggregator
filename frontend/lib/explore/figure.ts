/**
 * "Wie zegt wat?" as one picture (Epic 14): outlets, the speakers they give the word to and the
 * voices that are missing, with numbered markers for the findings that hang on them.
 *
 * Numbers are fixed per event: Dutch outlets by first publication → their speakers → foreign
 * outlets → contradictions → missing voices → findings without an anchor → what the reader added
 * (own.ts, in the order they added it). They do not change when the reader adds or removes
 * outlets or entries of their own. Pure.
 */

import { newsStart } from "./chronology";
import type { Exploration } from "./exploration";
import { frameLabel, toneLabel } from "./labels";
import { perspectiveEstimates } from "./nearest";
import { outletSentences } from "./outlet-sentences";
import { OWN_KINDS, resolveOwnAnchor } from "./own";
import type { Speaker, SpeakerModel } from "./speakers";
import type { ExploreOutlet, Finding } from "./types";

export type FigureMode = "perBron" | "perInvalshoek";
export type MarkerType = "claim" | "statistic" | "fallacy" | "contradiction" | "gap" | "question" | "note";

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
   * else which missing voice it was added for */
  text: string | null;
  textKind: "stance" | "sentence" | "digest" | "found" | "none";
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
  kind: "outlet" | "perspective" | "unclassified" | "foreign" | "missing";
  label: string;
  color: string;
  /** Outlet groups: time of the first article, tone and own frames */
  meta: { time: string | null; tone: string | null; frames: string[] } | null;
  outlets: OutletBalloonModel[];
  /** Outlet groups: the speakers of that outlet */
  speakers: Speaker[];
  /** Missing voices (`own`: added by the reader; `found`: where an AI search found them speaking) */
  ghosts: { anchor: string; findingId: string; label: string; own?: boolean; found?: FoundSpeakerRef[] }[];
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
  contradictions: { findingId: string; number: number; from: string; to: string }[];
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

export const GROUP_COLORS = ["#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#10b981", "#ec4899", "#64748b"];
const FOREIGN_COLOR = "#64748b";
const MISSING_COLOR = "#0f766e";
/** Foreign coverage this far from the event gets its date in the balloon */
const OFF_DATE_DAYS = 3;

const time = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });

function byFirstPublication(a: ExploreOutlet, b: ExploreOutlet): number {
  const ta = a.firstPublishedAt ? Date.parse(a.firstPublishedAt) : Number.POSITIVE_INFINITY;
  const tb = b.firstPublishedAt ? Date.parse(b.firstPublishedAt) : Number.POSITIVE_INFINITY;
  return ta - tb || a.name.localeCompare(b.name);
}

function markerType(finding: Finding): MarkerType | null {
  switch (finding.body.type) {
    case "claim":
      return "claim";
    case "statistic":
      return "statistic";
    case "fallacy":
      return "fallacy";
    case "contradiction":
      return "contradiction";
    case "gap":
      return "gap";
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
    const type = markerType(finding);
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
  for (const finding of findings) {
    if (finding.body.type === "gap") add(finding, gapAnchor(finding.id));
  }
  // Findings that hang on nothing visible still get a number for the list
  for (const finding of findings) if (finding.type !== "own") add(finding, null);
  // Then what the reader added: on the outlet or speaker they chose, a missing voice on itself
  for (const finding of findings) {
    if (finding.body.type !== "own") continue;
    add(finding, finding.body.entry.kind === "gap" ? gapAnchor(finding.id) : resolveOwnAnchor(finding.body.entry, exploration));
  }
  return { numbers, markers, anchorOf };
}

/** The balloon text of an outlet and where it comes from. */
function outletText(
  outlet: ExploreOutlet,
  exploration: Exploration,
  sentences: ReturnType<typeof outletSentences>,
): Pick<OutletBalloonModel, "text" | "textKind"> {
  for (const finding of exploration.findings) {
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
  const first = sentences.get(outlet.key)?.[0];
  return first ? { text: first.map((part) => part.text).join(""), textKind: "sentence" } : (foundText ?? { text: null, textKind: "none" });
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

/** The picture for the outlets the reader shows. */
export function buildFigure(exploration: Exploration, shown: (outlet: ExploreOutlet) => boolean): FigureModel {
  const { input, findings, speakers } = exploration;
  const numbered = numberFindings(exploration);
  const sentences = outletSentences(input);
  const dutch = input.outlets.filter((outlet) => !outlet.isInternational && shown(outlet)).sort(byFirstPublication);
  const foreign = input.outlets.filter((outlet) => outlet.isInternational && shown(outlet)).sort(byFirstPublication);
  const perspectives = findings.filter((finding) => finding.body.type === "perspective");
  const mode: FigureMode = dutch.length >= 3 && perspectives.length > 0 ? "perInvalshoek" : "perBron";

  const balloon = (outlet: ExploreOutlet, estimated = false): OutletBalloonModel => ({
    anchor: outletAnchor(outlet.key),
    outletKey: outlet.key,
    ...outletText(outlet, exploration, sentences),
    estimated,
    via: speakers.via.get(outlet.key) ?? [],
    speakers: speakers.byOutlet.get(outlet.key) ?? [],
    offDate: outlet.isInternational ? offDate(outlet, exploration) : null,
  });

  const groups: FigureGroup[] = [];
  if (mode === "perBron") {
    dutch.forEach((outlet, i) => {
      groups.push({
        key: `o:${outlet.key}`,
        kind: "outlet",
        label: outlet.name,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        meta: outletMeta(outlet, exploration),
        outlets: [balloon(outlet)],
        speakers: speakers.byOutlet.get(outlet.key) ?? [],
        ghosts: [],
      });
    });
  } else {
    const estimates = perspectiveEstimates(input, findings, exploration.index);
    const placed = new Set<string>();
    perspectives.forEach((finding, i) => {
      if (finding.body.type !== "perspective") return;
      const members = dutch.filter(
        (outlet) =>
          (finding.body.type === "perspective" && finding.body.stances.some((stance) => stance.outletKey === outlet.key)) ||
          (!placed.has(outlet.key) && estimates.get(outlet.key)?.index === (finding.body.type === "perspective" ? finding.body.index : -1)),
      );
      if (members.length === 0) return;
      members.forEach((outlet) => placed.add(outlet.key));
      groups.push({
        key: `p:${finding.body.index}`,
        kind: "perspective",
        label: finding.body.cluster.label,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        meta: null,
        outlets: members.map((outlet) => {
          const covered = finding.body.type === "perspective" && finding.body.stances.some((stance) => stance.outletKey === outlet.key);
          return balloon(outlet, !covered);
        }),
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
        outlets: rest.map((outlet) => balloon(outlet)),
        speakers: [],
        ghosts: [],
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
    if (finding.body.type === "gap") return ghost(finding.body.gap.perspective, false);
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

  // Contradiction lines between two outlets that are both in the picture
  const visible = new Set([...dutch, ...foreign].map((outlet) => outlet.key));
  const contradictions = findings.flatMap((finding) => {
    if (finding.body.type !== "contradiction") return [];
    const a = finding.body.outletsA.find((key) => visible.has(key));
    const b = finding.body.outletsB.find((key) => visible.has(key) && key !== a);
    const number = numbered.numbers.get(finding.id);
    return a && b && number ? [{ findingId: finding.id, number, from: outletAnchor(a), to: outletAnchor(b) }] : [];
  });

  // With groups per perspective the speakers are avatars in their outlet's balloon: their markers too
  let markers = numbered.markers;
  if (mode === "perInvalshoek") {
    markers = new Map(numbered.markers);
    for (const group of groups) {
      for (const balloon of group.outlets) {
        const own = markers.get(balloon.anchor) ?? [];
        const fromSpeakers = balloon.speakers.flatMap((speaker) => numbered.markers.get(speakerAnchor(speaker.id)) ?? []);
        if (fromSpeakers.length) markers.set(balloon.anchor, [...own, ...fromSpeakers].sort((a, b) => a.number - b.number));
      }
    }
  }

  return { mode, groups, ...numbered, markers, contradictions };
}
