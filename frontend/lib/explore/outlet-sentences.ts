/**
 * "Wat schreef …?": the sentences of the LLM summary that name an outlet. The summary attributes
 * every fact to a publication ("meldt NOS", "aldus Reuters") and is the only place where the
 * analysis discusses international outlets, so these sentences say what an outlet wrote, in the
 * words of the analysis (never the article text: copyright).
 */

import { buildEntityLinks, segmentText, type TextSegment } from "./entity-linker";
import { summarySentences } from "./summary";
import type { ExploreInput } from "./types";

/** A summary sentence in parts; `own` marks the outlet's own name (to highlight it). */
export type OutletSentence = { text: string; own: boolean }[];

/** A sentence that leans on the one before: "Dat meldt RTL Nieuws.", "Daarbij vielen vijf gewonden, meldt NOS." */
const BACK_REFERENCE = /^(Dat|Dit|Die|Daar\p{Ll}*|Hier\p{Ll}+)\s/u;

const cache = new WeakMap<ExploreInput, Map<string, OutletSentence[]>>();

/**
 * Per outlet key, the summary sentences that name it, in the order of the summary; a sentence
 * that leans on the one before comes with that sentence. Names are matched like the tappable names
 * in the summary, with all outlets at once, so "Een Blik op de NOS" does not count as NOS.
 */
export function outletSentences(input: ExploreInput): Map<string, OutletSentence[]> {
  const cached = cache.get(input);
  if (cached) return cached;
  const links = buildEntityLinks({ outlets: input.outlets, entities: [] });
  const sentences = summarySentences(input.summary.body);
  const segmented = sentences.map((sentence) => segmentText(sentence, links));
  const entries = new Map<string, { last: number; parts: OutletSentence }[]>();

  segmented.forEach((segments, i) => {
    const keys = new Set(segments.flatMap((segment) => (segment.type === "link" ? [segment.link.key] : [])));
    const leans = i > 0 && BACK_REFERENCE.test(sentences[i]);
    keys.forEach((key) => {
      const parts = (list: TextSegment[]): OutletSentence =>
        list.map((segment) => ({ text: segment.text, own: segment.type === "link" && segment.link.key === key }));
      const list = entries.get(key) ?? [];
      const previous = list[list.length - 1];
      if (leans && previous?.last === i - 1) {
        previous.parts.push({ text: " ", own: false }, ...parts(segments));
        previous.last = i;
      } else {
        list.push({ last: i, parts: leans ? [...parts(segmented[i - 1]), { text: " ", own: false }, ...parts(segments)] : parts(segments) });
      }
      entries.set(key, list);
    });
  });

  const byOutlet = new Map(Array.from(entries, ([key, list]) => [key, list.map((entry) => entry.parts)] as const));
  cache.set(input, byOutlet);
  return byOutlet;
}
