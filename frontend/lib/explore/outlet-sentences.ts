/**
 * "Wat schreef …?": the sentences of the LLM summary that name an outlet. The summary attributes
 * every fact to a publication ("meldt NOS", "aldus Reuters") and is the only place where the
 * analysis discusses international outlets, so these sentences say what an outlet wrote, in the
 * words of the analysis (never the article text: copyright).
 */

import { buildEntityLinks, segmentText, type LinkerInput, type TextSegment } from "./entity-linker";
import { summarySentences } from "./summary";
import type { ExploreInput } from "./types";

/** A summary sentence in parts; `own` marks the outlet's own name (to highlight it). */
export type OutletSentence = { text: string; own: boolean }[];

/** A sentence that leans on the one before: "Dat meldt RTL Nieuws.", "Daarbij vielen vijf gewonden, meldt NOS." */
const BACK_REFERENCE = /^(Dat|Dit|Die|Daar\p{Ll}*|Hier\p{Ll}+)\s/u;

const cache = new WeakMap<ExploreInput, Map<string, OutletSentence[]>>();

const voiceCache = new WeakMap<ExploreInput, Map<string, OutletSentence[]>>();

/**
 * Per outlet key, the summary sentences that name it: first those in its own voice, then those in
 * which another outlet speaks about it (see outletSentencesIn), each in the order of the summary; a
 * sentence that leans on the one before comes with that sentence. Names are matched like the
 * tappable names in the summary, with all outlets at once, so "Een Blik op de NOS" does not count as NOS.
 */
export function outletSentences(input: ExploreInput): Map<string, OutletSentence[]> {
  const cached = cache.get(input);
  if (cached) return cached;
  const byOutlet = outletSentencesIn(input.summary.body, input.outlets);
  cache.set(input, byOutlet);
  return byOutlet;
}

/** Only the sentences in each outlet's own voice: what its balloon may say it wrote. */
export function outletVoiceSentences(input: ExploreInput): Map<string, OutletSentence[]> {
  const cached = voiceCache.get(input);
  if (cached) return cached;
  const byOutlet = outletSentencesIn(input.summary.body, input.outlets, { ownVoice: true });
  voiceCache.set(input, byOutlet);
  return byOutlet;
}

/**
 * The same for any summary body and outlets (the front page has no exploration). A sentence that
 * names another outlet before this one is that outlet speaking about it ("Volgens GeenStijl laat
 * Trouw de architect aan het woord", "Een Blik op de NOS verwijt de NOS …"): it comes after the
 * outlet's own sentences, and `ownVoice` leaves it out (Trouw's balloon said what GeenStijl thought
 * of Trouw, 2026-11-16).
 */
export function outletSentencesIn(
  body: string,
  outlets: LinkerInput["outlets"],
  options: { ownVoice?: boolean } = {},
): Map<string, OutletSentence[]> {
  const links = buildEntityLinks({ outlets, entities: [] });
  const sentences = summarySentences(body);
  const segmented = sentences.map((sentence) => segmentText(sentence, links));
  const entries = new Map<string, { last: number; parts: OutletSentence; byOther: boolean }[]>();

  segmented.forEach((segments, i) => {
    const named = segments.flatMap((segment) => (segment.type === "link" ? [segment.link.key] : []));
    const keys = new Set(named);
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
        list.push({
          last: i,
          parts: leans ? [...parts(segmented[i - 1]), { text: " ", own: false }, ...parts(segments)] : parts(segments),
          byOther: named[0] !== key,
        });
      }
      entries.set(key, list);
    });
  });

  return new Map(
    Array.from(entries, ([key, list]) => {
      const own = list.filter((entry) => !entry.byOther);
      const ordered = options.ownVoice ? own : [...own, ...list.filter((entry) => entry.byOther)];
      return [key, ordered.map((entry) => entry.parts)] as const;
    }).filter(([, list]) => list.length > 0),
  );
}
