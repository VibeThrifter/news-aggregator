/**
 * What the news leaves out (Epic 14, Story 14.24): whether a gap of the analysis is a voice that
 * does not speak or context that is missing, and what leaving things out does to the story of an
 * outlet. Pure.
 */

import type { CoverageGap, MediaAnalysis } from "@/lib/types";

import { splitSentences } from "./summary";

/**
 * Words of a gap that is context, not a voice: "Oorsprong en onderbouwing van de cijfers", "Wat
 * '40 jaar tot levenslang' concreet betekent", "Historische context van Westpoort". "context", "ethiek"
 * and "cijfers" also inside a word ("Bendecontext", "mediaethiek", "Kijkcijfers").
 */
const CONTEXT_WORDS =
  /context|ethiek|cijfers?\b|^(wat|hoe|waarom|welke)\b|\b(achtergrond\w*|vergelijking\w*|kader|duiding|motivering|omvang|verschil(len)?|relatie tussen|onderbouwing|oorsprong|oorza\w+|betekent|betekenis|stand van zaken|status|details|data|gegevens|voorwaarden|transparantie|besluitvorming|geschiedenis|historische?|wettelijke?|regelgeving|effectiviteit|gevolgen|kosten|feiten|feitelijke?|tijdlijn|tijdelijkheid|privacy)\b/i;

/**
 * A gap that is context rather than a voice. The analysis says which since 2026-10-14 (`kind`);
 * for older analyses the words of the label decide.
 */
export function isContextGap(gap: Pick<CoverageGap, "perspective"> & { kind?: CoverageGap["kind"] }): boolean {
  if (gap.kind === "context") return true;
  if (gap.kind === "stem") return false;
  return CONTEXT_WORDS.test(gap.perspective.trim());
}

/** A sentence about the text the analysis had, not about the news ("Dit is niet te toetsen op basis van de beschikbare tekst") */
const ABOUT_THE_TEXT = /(beschikbare|aangeleverde|volledige) tekst|zonder (de |volledige )?tekst|(tot|alleen|enkel) de kop\b|niet te (toetsen|controleren|beoordelen)/i;

/**
 * What leaving things out does to the story of an outlet, over its articles: their
 * `framing_by_omission` without the sentences about the text the analysis had. Null when nothing
 * is left.
 */
export function omissionText(analyses: Pick<MediaAnalysis, "framing_by_omission">[]): string | null {
  const sentences: string[] = [];
  for (const analysis of analyses) {
    for (const sentence of splitSentences(analysis.framing_by_omission?.trim() ?? "")) {
      if (!ABOUT_THE_TEXT.test(sentence) && !sentences.includes(sentence)) sentences.push(sentence);
    }
  }
  return sentences.length ? sentences.join(" ") : null;
}
