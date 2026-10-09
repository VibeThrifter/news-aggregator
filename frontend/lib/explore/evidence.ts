/**
 * Story 14.12: what a link of the propaganda model rests on, read from the arguments behind it
 * (claim, review status, cited sources; migration 010). Thin evidence shows as thin: one press
 * release, nothing reviewed, disputed or outdated arguments. Story 14.13 adds the verdict a reader
 * sees first ("dun bewijs"), names a source of the party itself ("persbericht van PBL zelf"),
 * says what is missing and how far the research of the link is (migration 011). Pure.
 */

import type { PmArgument, PmArgumentSource, PmSourceCheck, RelationResearch } from "@/lib/types";

/** How well a link is supported, best first */
export type EvidenceGrade = "gecontroleerd" | "met_bron" | "zonder_bron" | "betwist" | "verouderd" | "geen";

export const GRADE_RANK: Readonly<Record<EvidenceGrade, number>> = {
  gecontroleerd: 0,
  met_bron: 1,
  zonder_bron: 2,
  betwist: 3,
  verouderd: 4,
  geen: 5,
};

/** Review status of an argument in the words of a reader */
export const ARGUMENT_STATUS_LABELS: Readonly<Record<string, { label: string; tone: "green" | "neutral" | "orange" }>> = {
  geverifieerd: { label: "gecontroleerd", tone: "green" },
  ongecontroleerd: { label: "niet gecontroleerd", tone: "neutral" },
  bronvermelding_nodig: { label: "bron nodig", tone: "orange" },
  voorgesteld: { label: "nog niet gecontroleerd", tone: "orange" },
  betwist: { label: "betwist", tone: "orange" },
  verouderd: { label: "verouderd", tone: "neutral" },
};

const SOURCE_KINDS: Readonly<Record<string, string>> = {
  nieuwsartikel: "nieuwsartikel",
  persbericht: "persbericht",
  rapport: "rapport",
  academisch_artikel: "wetenschappelijk artikel",
  boek: "boek",
  transcript: "transcript",
  interview: "interview",
  dataset: "dataset",
  wetgeving: "wettekst",
  website: "website",
};

export interface Evidence {
  grade: EvidenceGrade;
  /** The argument the link rests on most: its claim says what the link is */
  lead: PmArgument | null;
  /** Distinct sources of the arguments behind the grade (the current ones, else the disputed or outdated ones) */
  sources: PmArgumentSource[];
  /** Arguments for it that still count */
  supporting: number;
  /** Nuance (contextual arguments that still count) */
  nuance: number;
  /** Arguments against it, replies included */
  against: number;
  /** Arguments for it that are outdated */
  outdated: number;
}

/** About whether the link exists, not about its strength or dates */
const aboutExistence = (argument: PmArgument) => !argument.aspect || argument.aspect === "existence";

/**
 * Checked: reviewed by a person (geverifieerd), or an independent re-read of the propaganda model's
 * automatic review found the quote in the source and that it carries the claim.
 */
export function isChecked(argument: PmArgument): boolean {
  return argument.status === "geverifieerd" || autoChecked(argument);
}

/** Checked by the automatic review (which since 2026-10-06 also sets "geverifieerd" itself) */
export function autoChecked(argument: PmArgument): boolean {
  return argument.sources.some((source) => source.checked);
}

/** What the automatic source check found when it did not hold, in a reader's words */
export const CHECK_LABELS: Readonly<Record<PmSourceCheck, string>> = {
  draagt_niet: "bron draagt het niet",
  deels: "bron draagt het deels",
  citaat_weg: "citaat niet teruggevonden",
};

const CHECK_ORDER: readonly PmSourceCheck[] = ["draagt_niet", "deels", "citaat_weg"];

/** The automatic check of an argument that did not hold (the worst of its sources), else null */
export function checkOf(argument: PmArgument): PmSourceCheck | null {
  if (autoChecked(argument)) return null;
  const found = new Set(argument.sources.map((source) => source.check).filter(Boolean));
  return CHECK_ORDER.find((check) => found.has(check)) ?? null;
}

function uniqueSources(sources: readonly PmArgumentSource[]): PmArgumentSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.url ?? ""}|${source.title ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The evidence of one link. Arguments for it count when they are not disputed (status betwist, or a
 * reply against them) or outdated; a source counts unless the argument itself says one is needed.
 */
export function evidenceOf(args: readonly PmArgument[] | null | undefined): Evidence {
  const list = args ?? [];
  const countered = (argument: PmArgument) => list.some((reply) => reply.parent_id === argument.id && reply.stance === "contradicting");
  const roots = list.filter((argument) => !argument.parent_id);
  const forIt = roots.filter((argument) => argument.stance === "supporting" && aboutExistence(argument));
  const outdated = forIt.filter((argument) => argument.status === "verouderd");
  const disputed = forIt.filter((argument) => argument.status !== "verouderd" && (argument.status === "betwist" || countered(argument)));
  const current = forIt.filter((argument) => !outdated.includes(argument) && !disputed.includes(argument));
  const sourced = current.filter((argument) => argument.sources.length > 0 && argument.status !== "bronvermelding_nodig");
  const verified = sourced.filter(isChecked);
  const grade: EvidenceGrade = verified.length
    ? "gecontroleerd"
    : sourced.length
      ? "met_bron"
      : current.length
        ? "zonder_bron"
        : disputed.length
          ? "betwist"
          : outdated.length
            ? "verouderd"
            : "geen";
  const basis = current.length ? current : disputed.length ? disputed : outdated;
  return {
    grade,
    lead: verified[0] ?? sourced[0] ?? current[0] ?? disputed[0] ?? outdated[0] ?? null,
    sources: uniqueSources(basis.flatMap((argument) => argument.sources)),
    supporting: current.length,
    nuance: roots.filter((argument) => argument.stance === "contextual" && argument.status !== "verouderd").length,
    against: list.filter((argument) => argument.stance === "contradicting").length,
    outdated: outdated.length,
  };
}

/** Lowercase letters and digits only, without diacritics: "Leefomgeving (PBL)" -> "leefomgevingpbl" */
export function fold(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The name part of a web address: "pbl" for https://www.pbl.nl/actueel, "nos" for nos.nl */
export function hostLabel(url: string | null | undefined): string | null {
  let host = "";
  try {
    host = new URL(url ?? "").hostname.toLowerCase();
  } catch {
    return null;
  }
  const parts = host.split(".").filter(Boolean);
  if (parts[0] === "www") parts.shift();
  if (parts.length === 0) return null;
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

/** "PBL" for "Planbureau voor de Leefomgeving (PBL)", else the name itself */
export function shortName(name: string): string {
  const match = /\(([^()]{2,12})\)\s*$/.exec(name);
  return match ? match[1].trim() : name;
}

function nameTokens(name: string): Set<string> {
  const [outer, inner] = name.split("(");
  const tokens = [fold(outer), inner && inner.replace(/\)\s*$/, "").trim().length <= 12 ? fold(inner) : ""];
  return new Set(tokens.filter((token) => token.length >= 2));
}

/** Does a source come from the party itself: its own site, or published by it? */
export function fromParty(source: PmArgumentSource, party: string | null | undefined): boolean {
  if (!party) return false;
  const tokens = nameTokens(party);
  const label = hostLabel(source.url);
  if (label && tokens.has(fold(label))) return true;
  const publisher = fold(source.publisher);
  return publisher.length > 0 && tokens.has(publisher);
}

/** Sources that come from different places: publisher, else web address, else title */
export function independentOrigins(sources: readonly PmArgumentSource[]): number {
  return new Set(sources.map((source) => fold(source.publisher) || hostLabel(source.url) || source.title || "")).size;
}

/** All sources of the link come from the party itself */
export function ownSourcesOnly(evidence: Evidence, party: string | null | undefined): boolean {
  return evidence.sources.length > 0 && evidence.sources.every((source) => fromParty(source, party));
}

/** What a reader should take from a link at a glance */
export type EvidenceVerdict = "stevig" | "dun" | "onbewezen" | "betwist" | "verouderd";

export const VERDICT_LABELS: Readonly<Record<EvidenceVerdict, { label: string; tone: "green" | "neutral" | "orange" }>> = {
  stevig: { label: "stevig onderbouwd", tone: "green" },
  dun: { label: "dun bewijs", tone: "orange" },
  onbewezen: { label: "onbewezen", tone: "orange" },
  betwist: { label: "betwist", tone: "orange" },
  verouderd: { label: "verouderd", tone: "neutral" },
};

/** Verdicts best first: the order of the lines under "Wie zit erachter?" */
export const VERDICT_RANK: Readonly<Record<EvidenceVerdict, number>> = { stevig: 0, dun: 1, onbewezen: 2, betwist: 3, verouderd: 4 };

/**
 * The verdict on a link. Strong only when the model itself calls it "onderbouwd" (its score needs
 * at least two independent sources), or, without that label, when a checked argument rests on two
 * independent sources. Everything else that has a source is thin.
 */
export function verdictOf(evidence: Evidence, certaintyLabel?: string | null): EvidenceVerdict {
  if (unsourcedOnly(evidence)) return "onbewezen";
  if (evidence.grade === "betwist" || evidence.grade === "verouderd") return evidence.grade;
  if (evidence.grade === "geen" || evidence.grade === "zonder_bron") return "onbewezen";
  if (certaintyLabel) return certaintyLabel === "onderbouwd" ? "stevig" : "dun";
  return evidence.grade === "gecontroleerd" && independentOrigins(evidence.sources) >= 2 ? "stevig" : "dun";
}

/**
 * Set aside only for want of a source: the arguments for the link are "betwist" but have no source
 * and nothing was brought in against them. The propaganda model marks claims nobody could source
 * that way; to a reader that is unproven, not contested.
 */
export function unsourcedOnly(evidence: Evidence): boolean {
  return evidence.grade === "betwist" && evidence.against === 0 && evidence.sources.length === 0;
}

/** What a thin link lacks, in a reader's words: "een bron die niet van PBL zelf komt", … */
export function evidenceGaps(evidence: Evidence, party?: string | null): string[] {
  if (unsourcedOnly(evidence)) return ["een bron die het verband draagt"];
  if (evidence.grade === "betwist") return ["een argument dat de tegenspraak doorstaat"];
  if (evidence.grade === "verouderd") return ["actueel bewijs"];
  if (evidence.grade === "geen" || evidence.grade === "zonder_bron") return ["een bron die het verband draagt"];
  const gaps: string[] = [];
  if (party && ownSourcesOnly(evidence, party)) gaps.push(`een bron die niet van ${shortName(party)} zelf komt`);
  if (independentOrigins(evidence.sources) < 2) gaps.push("een tweede, onafhankelijke bron");
  if (evidence.grade !== "gecontroleerd") gaps.push("controle of de bron het verband draagt");
  return gaps;
}

/** "6 okt" (with the year when it is not this year) */
function shortDate(value: string | null | undefined, now = new Date()): string | null {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const label = `${date.getDate()} ${date.toLocaleDateString("nl-NL", { month: "short" }).replace(/\.$/, "")}`;
  return date.getFullYear() === now.getFullYear() ? label : `${label} ${date.getFullYear()}`;
}

/** How far the research of a thin link is (Story 14.13); null when there is nothing to say */
export function researchNote(research: RelationResearch | null | undefined, now = new Date()): string | null {
  if (!research) return null;
  const pending = research.found?.pending ?? 0;
  const date = shortDate(research.researched_at, now);
  switch (research.status) {
    case "wachtrij":
      return "staat op de lijst om uit te zoeken";
    case "bezig":
      return "wordt nu uitgezocht";
    case "fout":
      return "uitzoeken mislukte, volgt opnieuw";
    case "klaar":
      // The propaganda model checks them automatically (bronchecker, prosecutor, immune gate)
      if (pending) return `uitgezocht: ${pending === 1 ? "1 nieuw argument wordt" : `${pending} nieuwe argumenten worden`} gecontroleerd`;
      return date ? `uitgezocht op ${date}` : "uitgezocht";
    case "twijfel":
      return "uitgezocht: het bewijs spreekt elkaar tegen";
    case "niets_gevonden":
      return `uitgezocht${date ? ` op ${date}` : ""}: geen nieuwe bron gevonden`;
    default:
      return null;
  }
}

/**
 * Story 14.23: where a link of the model comes from, in a reader's words ("Uit de eerste opzet van
 * het model, met AI gemaakt (1 jun)"); null when the sync does not know it (before migration 017).
 */
export function originNote(origin: string | null | undefined, addedAt: string | null | undefined, now = new Date()): string | null {
  const date = shortDate(addedAt, now);
  const on = date ? ` op ${date}` : "";
  switch (origin) {
    case "opzet":
      return `Uit de eerste opzet van het model, met AI gemaakt${date ? ` (${date})` : ""}`;
    case "register":
      return `Uit een openbaar register, toegevoegd${on}`;
    case "eigenaar":
      return `Toegevoegd door de maker van het model${on}`;
    case "assistent":
      return `Toegevoegd door de AI-assistent van de maker${on}`;
    case "agent":
      return `Toegevoegd door een onderzoeksagent${on}`;
    default:
      return null;
  }
}

/** "2021" from "2021-11-22" or "2021"; null when there is no year */
export function yearOf(value: string | null | undefined): string | null {
  const match = /\b(1[89]\d{2}|20\d{2})\b/.exec(value ?? "");
  return match ? match[1] : null;
}

/** "persbericht", "nieuwsartikel · HUMAN / VPRO, 2021" */
export function sourceLabel(source: PmArgumentSource): string {
  const kind = SOURCE_KINDS[source.kind ?? ""] ?? null;
  const who = [source.publisher, yearOf(source.published_at)].filter(Boolean).join(", ");
  return [kind, who].filter(Boolean).join(" · ") || source.title || "bron";
}

function years(sources: readonly PmArgumentSource[]): string | null {
  const list = sources.map((source) => yearOf(source.published_at)).filter((year): year is string => Boolean(year)).sort();
  if (list.length === 0) return null;
  return list[0] === list[list.length - 1] ? list[0] : `${list[0]}–${list[list.length - 1]}`;
}

/**
 * What the link rests on, in one line: "1 bron: persbericht · niet gecontroleerd",
 * "6 bronnen, 2020–2023 · gecontroleerd", "betwist · zonder bron". With the party that has the
 * influence, a source of its own says so: "1 bron: persbericht van PBL zelf". Next to a verdict
 * label (`verdictShown`) "betwist"/"verouderd" are not repeated.
 */
export function evidenceSummary(evidence: Evidence, party?: string | null, verdictShown = false): string {
  if (evidence.grade === "geen") return "geen onderbouwing in het model";
  const count = evidence.sources.length;
  const own = party && ownSourcesOnly(evidence, party) ? ` van ${shortName(party)} zelf` : "";
  const first = evidence.sources[0];
  const span = years(evidence.sources) ? `, ${years(evidence.sources)}` : "";
  const sources =
    count === 0
      ? "zonder bron"
      : count === 1
        ? `1 bron: ${own ? `${SOURCE_KINDS[first.kind ?? ""] ?? "bron"}${own}` : sourceLabel(first)}`
        : `${count} bronnen${own}${span}`;
  if (unsourcedOnly(evidence)) return verdictShown ? sources : `onbewezen · ${sources}`;
  if (evidence.grade === "betwist" || evidence.grade === "verouderd") return verdictShown ? sources : `${evidence.grade} · ${sources}`;
  // The automatic review sets "geverifieerd" itself once its source check holds: the checked
  // source says it was a machine, a verified argument without one was checked by a person
  const check = evidence.lead ? checkOf(evidence.lead) : null;
  const status =
    evidence.grade === "gecontroleerd"
      ? evidence.lead && autoChecked(evidence.lead)
        ? "automatisch gecontroleerd"
        : "gecontroleerd"
      : check
        ? CHECK_LABELS[check]
        : (ARGUMENT_STATUS_LABELS[evidence.lead?.status ?? ""]?.label ?? null);
  return [sources, status].filter(Boolean).join(" · ");
}

/** What else the model says about it: "1 nuancering", "2 tegenargumenten", "1 verouderd argument" */
export function evidenceExtras(evidence: Evidence): string[] {
  const extras: string[] = [];
  if (evidence.nuance) extras.push(evidence.nuance === 1 ? "1 nuancering" : `${evidence.nuance} nuanceringen`);
  if (evidence.against) extras.push(evidence.against === 1 ? "1 tegenargument" : `${evidence.against} tegenargumenten`);
  if (evidence.outdated && evidence.grade !== "verouderd") extras.push(evidence.outdated === 1 ? "1 verouderd argument" : `${evidence.outdated} verouderde argumenten`);
  return extras;
}
