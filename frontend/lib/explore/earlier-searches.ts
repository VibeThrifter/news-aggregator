/**
 * "Al gezocht met AI" (Epic 14, Story 14.22): when you add a missing voice, the voices of this news
 * that were already searched with "Zoek met AI" come first, with what was found. Readers see only
 * what the admin approved (voice_searches_public, migration 015); the admin sees everything,
 * including the finds still to review. Only for missing voices (owner's choice 2026-10-07).
 */

import type { PublicVoiceSearch, VoiceCandidate, VoiceSearch } from "@/lib/voice-search";

import { normalizeWords } from "./others";
import type { Finding } from "./types";

export type EarlierFind = PublicVoiceSearch["found"][number];

export interface EarlierSearch {
  /** The latest search of this voice */
  id: number;
  /** The voice as compared: case and spacing do not count */
  key: string;
  perspective: string;
  /** The missing voice in the app it was searched for: `gap:<hash>` or `own:<id>` */
  gapKey: string | null;
  state: "bezig" | "gezocht";
  /** Approved: sources of the news now */
  found: EarlierFind[];
  /** Admin only: finds still to approve or reject */
  open: number;
  createdAt: string;
}

/** Voices compare as in the database (migration 015): case and spacing do not count. */
export function voiceKey(perspective: string): string {
  return perspective.trim().toLowerCase().replace(/\s+/g, " ");
}

const time = (value: string) => Date.parse(value) || 0;

function asFind({ url, title, outlet, domain, who, gist, article_id }: VoiceCandidate): EarlierFind {
  return { url, title, outlet, domain, who, gist, article_id };
}

/** The admin's searches as one row per voice, the latest first (failed searches do not count). */
export function earlierFromAdmin(searches: readonly VoiceSearch[]): EarlierSearch[] {
  const byVoice = new Map<string, VoiceSearch[]>();
  for (const search of searches) {
    if (search.status === "fout") continue;
    const key = voiceKey(search.perspective);
    byVoice.set(key, [...(byVoice.get(key) ?? []), search]);
  }
  const rows: EarlierSearch[] = [];
  for (const [key, group] of byVoice) {
    const sorted = [...group].sort((a, b) => time(b.created_at) - time(a.created_at));
    const approved = new Map<string, EarlierFind>();
    const open = new Set<string>();
    for (const search of sorted) {
      for (const candidate of search.candidates) {
        if (candidate.verdict === "goedgekeurd" && !approved.has(candidate.url)) approved.set(candidate.url, asFind(candidate));
        if (candidate.verdict === "open") open.add(candidate.url);
      }
    }
    for (const url of approved.keys()) open.delete(url);
    rows.push({
      id: sorted[0].id,
      key,
      perspective: sorted[0].perspective.trim(),
      gapKey: sorted.find((search) => search.gap_key)?.gap_key ?? null,
      state: sorted.some((search) => search.status === "wachtrij" || search.status === "bezig") ? "bezig" : "gezocht",
      found: [...approved.values()],
      open: open.size,
      createdAt: sorted[0].created_at,
    });
  }
  return rows.sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

/** What every reader gets from the database (already one row per voice). */
export function earlierFromPublic(rows: readonly PublicVoiceSearch[]): EarlierSearch[] {
  return rows.map((row) => ({
    id: row.id,
    key: voiceKey(row.perspective),
    perspective: row.perspective.trim(),
    gapKey: row.gap_key,
    state: row.state,
    found: row.found,
    open: 0,
    createdAt: row.created_at,
  }));
}

/** The readers' view of searches, as voice_searches_public gives it (for the demo). */
export function publicSearches(searches: readonly VoiceSearch[]): PublicVoiceSearch[] {
  return earlierFromAdmin(searches).map((row) => ({
    id: row.id,
    perspective: row.perspective,
    gap_key: row.gapKey,
    state: row.state,
    found: row.found,
    created_at: row.createdAt,
    finished_at: null,
  }));
}

/** The voices that share words with what you type first, then the newest. */
export function rankEarlier(searches: readonly EarlierSearch[], typed: string): EarlierSearch[] {
  const words = normalizeWords(typed)
    .split(" ")
    .filter((word) => word.length >= 3);
  return searches
    .map((search, index) => {
      const text = normalizeWords(search.perspective);
      return { search, index, score: words.filter((word) => text.includes(word)).length };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ search }) => search);
}

/** The missing voices in the picture (the analysis' and your own), by their words. */
export function missingVoicesInPicture(findings: readonly Finding[]): Map<string, string> {
  const voices = new Map<string, string>();
  for (const finding of findings) {
    const label =
      finding.body.type === "gap" ? finding.body.gap.perspective : finding.body.type === "own" && finding.body.entry.kind === "gap" ? finding.body.entry.text : null;
    if (label && !voices.has(voiceKey(label))) voices.set(voiceKey(label), finding.id);
  }
  return voices;
}

/** Where a searched voice is in the picture already (its finding id), or null. */
export function inPicture(search: EarlierSearch, findingIds: ReadonlySet<string> | Map<string, unknown>, voices: Map<string, string>): string | null {
  if (search.gapKey && findingIds.has(search.gapKey)) return search.gapKey;
  return voices.get(search.key) ?? null;
}
