/**
 * Which perspective an outlet leans to when the analysis did not put it in one: the words of its
 * headlines against each perspective (label, summary, stances and the headlines of its members).
 * Only a clear winner is returned; it is an estimate and shown as such.
 */

import type { ArticleIndex } from "./input";
import type { Finding, ExploreInput } from "./types";

const STOPWORDS = new Set(
  (
    "aan als bij dan dat de den der des deze die dit door een en er het hij hoe hun ik in is je kan maar met na naar niet nog nu of om ook op over te tegen tot uit van voor waar wat wel wie wij wordt worden zal ze zich zijn zo zij " +
    "the and for with from into over that this are was were has have its his her their they will been not but "
  )
    .trim()
    .split(/\s+/),
);

/** Crude Dutch/English stemming: vissers → visser, protesteren → protest, kansen → kans. */
function stem(word: string): string {
  for (const suffix of ["eren", "ingen", "en", "es", "s", "e"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map(stem);
}

export interface PerspectiveText {
  index: number;
  label: string;
  text: string;
}

export interface PerspectiveEstimate {
  index: number;
  label: string;
  score: number;
}

/**
 * The perspective the headlines lean to, or null without a clear winner. Every headline word votes
 * with its share of use per perspective ("vissers": 5 of 6 times in "Vissers in het nauw"), so words
 * all perspectives use are spread out; the winner needs half a word's vote and 1.5× the runner-up.
 */
export function nearestPerspective(titles: string[], perspectives: PerspectiveText[]): PerspectiveEstimate | null {
  if (perspectives.length === 0) return null;
  const counts = perspectives.map((perspective) => {
    const tf = new Map<string, number>();
    for (const word of words(`${perspective.label} ${perspective.text}`)) tf.set(word, (tf.get(word) ?? 0) + 1);
    return tf;
  });
  const total = new Map<string, number>();
  counts.forEach((tf) => tf.forEach((count, word) => total.set(word, (total.get(word) ?? 0) + count)));

  const own = new Set(words(titles.join(" ")));
  const scores = perspectives
    .map((perspective, i) => {
      let score = 0;
      own.forEach((word) => {
        const all = total.get(word);
        if (all) score += (counts[i].get(word) ?? 0) / all;
      });
      return { index: perspective.index, label: perspective.label, score };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || best.score < 0.5) return null;
  if (second && best.score < second.score * 1.5) return null;
  return best;
}

/** Label, summary, stances and member headlines of each perspective of the event. */
export function perspectiveTexts(findings: Finding[]): PerspectiveText[] {
  return findings.flatMap((finding) =>
    finding.body.type === "perspective"
      ? [
          {
            index: finding.body.index,
            label: finding.body.cluster.label,
            text: [
              finding.body.cluster.summary ?? "",
              ...finding.body.stances.map((stance) => stance.stance ?? ""),
              ...(finding.body.cluster.sources ?? []).map((source) => source.title ?? ""),
            ].join(" "),
          },
        ]
      : [],
  );
}

const cache = new WeakMap<Finding[], Map<string, PerspectiveEstimate>>();

/** For every outlet the analysis did not put in a perspective: the perspective it leans to (if clear). */
export function perspectiveEstimates(input: ExploreInput, findings: Finding[], index: ArticleIndex): Map<string, PerspectiveEstimate> {
  const cached = cache.get(findings);
  if (cached) return cached;
  const perspectives = perspectiveTexts(findings);
  const covered = new Set(findings.flatMap((finding) => (finding.body.type === "perspective" ? finding.body.stances.map((stance) => stance.outletKey) : [])));
  const estimates = new Map<string, PerspectiveEstimate>();
  for (const outlet of input.outlets) {
    if (covered.has(outlet.key)) continue;
    const titles = outlet.articleIds.map((id) => index.article(id)?.title ?? "").filter(Boolean);
    const estimate = nearestPerspective(titles, perspectives);
    if (estimate) estimates.set(outlet.key, estimate);
  }
  cache.set(findings, estimates);
  return estimates;
}
