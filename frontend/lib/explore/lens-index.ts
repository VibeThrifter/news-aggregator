/**
 * "In dit nieuws" (Epic 14): per outlet and per speaker one line per tab, with what the analysis
 * found there, what the reader added ("1 van jou") and the numbers to jump to. Lines without
 * content are left out. Pure.
 */

import type { Exploration } from "./exploration";
import { frameLabel, TABS, toneLabel } from "./labels";
import type { Speaker } from "./speakers";
import { formatLag } from "./timeline";
import type { Finding, TabId } from "./types";

export interface IndexLine {
  tab: TabId;
  text: string;
  /** Findings this line is about (the first one is the jump target) */
  findingIds: string[];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function kloptLine(findings: Finding[]): IndexLine | null {
  if (findings.length === 0) return null;
  const count = (type: Finding["type"]) => findings.filter((finding) => finding.type === type).length;
  const parts = [
    count("contradiction") ? plural(count("contradiction"), "botsing", "botsingen") : null,
    count("claim") ? plural(count("claim"), "claim zonder bewijs", "claims zonder bewijs") : null,
    count("statistic") ? plural(count("statistic"), "cijfer", "cijfers") : null,
    count("fallacy") ? plural(count("fallacy"), "redeneerfout", "redeneerfouten") : null,
  ].filter(Boolean);
  return { tab: "klopt", text: parts.join(" · "), findingIds: findings.map((finding) => finding.id) };
}

/** "2 van jou" per tab: merged into the analysis line of that tab, or a line of its own. */
function withOwnLines(lines: IndexLine[], own: Finding[]): IndexLine[] {
  const byTab = new Map<TabId, string[]>();
  for (const finding of own) byTab.set(finding.tab, [...(byTab.get(finding.tab) ?? []), finding.id]);
  for (const [tab, ids] of Array.from(byTab.entries())) {
    const text = `${ids.length} van jou`;
    const line = lines.find((item) => item.tab === tab);
    if (line) {
      line.text = line.text ? `${line.text} · ${text}` : text;
      line.findingIds.push(...ids);
    } else {
      lines.push({ tab, text, findingIds: ids });
    }
  }
  const order = TABS.map((tab) => tab.id);
  return lines.sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab));
}

/** Everything about one outlet in this news, per tab. */
export function outletIndex(exploration: Exploration, outletKey: string): IndexLine[] {
  const findings = exploration.findings.filter((finding) => finding.type !== "own");
  const { speakers } = exploration;
  const about = findings.filter((finding) => finding.outletKeys.includes(outletKey));
  const lines: IndexLine[] = [];

  const ownSpeakers = speakers.byOutlet.get(outletKey) ?? [];
  const speakerClaims = new Set(ownSpeakers.flatMap((speaker) => speaker.claimIds));
  const klopt = kloptLine(
    findings.filter(
      (finding) =>
        finding.tab === "klopt" && (finding.outletKeys.includes(outletKey) || speakerClaims.has(finding.id)),
    ),
  );
  if (klopt) lines.push(klopt);

  if (ownSpeakers.length) {
    const names = ownSpeakers.slice(0, 3).map((speaker) => (speaker.org ? `${speaker.name} (${speaker.org})` : speaker.name));
    const rest = ownSpeakers.length - names.length;
    const voices = about.filter((finding) => finding.type === "voices" || finding.type === "authority");
    lines.push({ tab: "stemmen", text: `${names.join(", ")}${rest > 0 ? ` +${rest}` : ""}`, findingIds: voices.map((finding) => finding.id) });
  }

  const questions = about.find((finding) => finding.body.type === "questions");
  if (questions && questions.body.type === "questions") {
    const asked = questions.body.analysis.questions_not_asked?.length ?? 0;
    const omitted = questions.body.analysis.perspectives_omitted?.length ?? 0;
    const text = [asked ? plural(asked, "vraag niet gesteld", "vragen niet gesteld") : null, omitted ? plural(omitted, "perspectief weggelaten", "perspectieven weggelaten") : null]
      .filter(Boolean)
      .join(" · ");
    if (text) lines.push({ tab: "ontbreekt", text, findingIds: [questions.id] });
  }

  const tone = about.find((finding) => finding.body.type === "tone");
  const frames = about.filter((finding) => finding.body.type === "frame" && finding.body.frame.attribution !== "geciteerd");
  const gebracht = [
    tone && tone.body.type === "tone" ? toneLabel(tone.body.analysis.tone).toLowerCase() : null,
    ...Array.from(new Set(frames.map((finding) => (finding.body.type === "frame" ? frameLabel(finding.body.frame.frame_type).toLowerCase() : "")))),
  ].filter(Boolean);
  if (gebracht.length) {
    lines.push({ tab: "gebracht", text: gebracht.join(" · "), findingIds: [...(tone ? [tone.id] : []), ...frames.map((finding) => finding.id)] });
  }

  const first = findings.find((finding) => finding.body.type === "first");
  if (first && first.body.type === "first") {
    const entry = first.body.order.find((item) => item.outletKey === outletKey);
    if (entry) lines.push({ tab: "tijdlijn", text: formatLag(entry.lagMinutes), findingIds: [first.id] });
  }
  // What the reader added on this outlet or its speakers (speakers they added are in the names already)
  const own = exploration.findings.filter(
    (finding) => finding.body.type === "own" && finding.body.entry.kind !== "speaker" && finding.outletKeys.includes(outletKey),
  );
  return withOwnLines(lines, own);
}

/** Everything about one speaker in this news. */
export function speakerIndex(exploration: Exploration, speaker: Speaker): IndexLine[] {
  const lines: IndexLine[] = [];
  const claims = speaker.claimIds.map((id) => exploration.findingById.get(id)).filter((finding): finding is Finding => Boolean(finding));
  const klopt = kloptLine(claims);
  if (klopt) lines.push(klopt);
  if (speaker.authorityId) {
    const authority = exploration.findingById.get(speaker.authorityId);
    if (authority && authority.body.type === "authority") {
      const text = authority.body.authority.actual_role?.trim() || authority.body.authority.authority_type?.trim() || "Autoriteit";
      lines.push({ tab: "stemmen", text, findingIds: [authority.id] });
    }
  }
  return lines;
}
