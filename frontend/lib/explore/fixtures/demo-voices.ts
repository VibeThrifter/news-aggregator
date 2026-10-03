/**
 * Demo of "Stemmen zoeken" (Story 14.10), behind NEXT_PUBLIC_ENABLE_DEMO: the AI search is
 * simulated client-side, so the whole flow can be seen without a backend.
 *
 * FICTIONAL, like the demo event: the found articles, the people in them and what they say do not
 * exist (Trouw and RTL Nieuws are real media; these articles are not). Searches and approved
 * sources are kept on this device (localStorage) and added to the demo event when it loads
 * (applyDemoVoices), the way an approved source joins a real event.
 */

import type { RawExploration, RawExploreArticle } from "../input";
import type { VoiceCandidate, VoiceRequestResult, VoiceSearch, VoiceSearchRequest, VoiceVerdict } from "@/lib/voice-search";

const STORAGE_KEY = "pluriformiteit:demo-stemmen";
/** A simulated search: queued, then searching, then done */
const QUEUED_MS = 1200;
const SEARCHING_MS = 2600;

type Found = Omit<VoiceCandidate, "id" | "verdict" | "article_id">;

/** What the simulated search finds, per missing voice of the demo (lower case) */
const RESULTS: Record<string, Found[]> = {
  "boeren op de polder": [
    {
      url: "https://example.org/demo/trouw-boeren-dijkerhoven",
      title: "Boeren in de polder van Dijkerhoven: 'Wij verhuren de grond, maar niemand vraagt ons iets'",
      outlet: "Trouw",
      domain: "trouw.nl",
      is_international: false,
      country: "NL",
      published_at: "2026-09-29T05:30:00Z",
      who: "Gerrit Hofstede, boer en verpachter",
      gist: "Hofstede verhuurt grond aan NordVind en zegt dat de boeren de vergoeding nodig hebben, maar willen meepraten over waar de turbines komen.",
      confidence: 0.88,
    },
    {
      url: "https://example.org/demo/rtl-lto-dijkerhoven",
      title: "LTO wil vaste vergoeding voor hele polder bij windpark",
      outlet: "RTL Nieuws",
      domain: "rtl.nl",
      is_international: false,
      country: "NL",
      published_at: "2026-09-30T11:00:00Z",
      who: "LTO-afdeling Dijkerhoven",
      gist: "De afdeling wil een vergoeding per hectare voor alle boeren in de polder, ook voor wie geen turbine krijgt.",
      confidence: 0.74,
    },
  ],
  "energiecoöperatie": [
    {
      url: "https://example.org/demo/trouw-cooperatie-dijkerhoven",
      title: "Inwoners Dijkerhoven willen mede-eigenaar van windpark worden",
      outlet: "Trouw",
      domain: "trouw.nl",
      is_international: false,
      country: "NL",
      published_at: "2026-09-30T06:00:00Z",
      who: "Energiecoöperatie Dijkerhoven Duurzaam",
      gist: "De coöperatie wil een vijfde van het park kopen zodat inwoners meeprofiteren, en zegt dat NordVind daar nog niet op heeft gereageerd.",
      confidence: 0.81,
    },
  ],
};
// The later episode (the court halts the build, 2 October)
RESULTS["boeren met turbines op hun land"] = [
  {
    url: "https://example.org/demo/trouw-boeren-na-uitspraak",
    title: "Boeren na uitspraak over windpark Dijkerhoven: 'Wij blijven met lege handen achter'",
    outlet: "Trouw",
    domain: "trouw.nl",
    is_international: false,
    country: "NL",
    published_at: "2026-10-02T13:40:00Z",
    who: "Gerrit Hofstede, boer en verpachter",
    gist: "Hofstede verhuurt grond aan NordVind en zegt dat de boeren door de bouwstop hun vergoeding mislopen; zij willen meepraten over een nieuw geluidsonderzoek.",
    confidence: 0.88,
  },
  {
    url: "https://example.org/demo/rtl-lto-na-uitspraak",
    title: "LTO wil compensatie voor boeren na bouwstop windpark",
    outlet: "RTL Nieuws",
    domain: "rtl.nl",
    is_international: false,
    country: "NL",
    published_at: "2026-10-02T16:05:00Z",
    who: "LTO-afdeling Dijkerhoven",
    gist: "De afdeling vraagt NordVind de vergoeding door te betalen zolang de bouw stilligt.",
    confidence: 0.76,
  },
];

interface Stored {
  searches: (Omit<VoiceSearch, "status"> & { final: "klaar" | "niets_gevonden" })[];
}

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Stored) : null;
    return data && Array.isArray(data.searches) ? data : { searches: [] };
  } catch {
    return { searches: [] };
  }
}

function write(data: Stored) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // A private window: the demo search just does not survive a reload
  }
}

function withStatus(search: Stored["searches"][number]): VoiceSearch {
  const elapsed = Date.now() - Date.parse(search.created_at);
  const status = elapsed < QUEUED_MS ? "wachtrij" : elapsed < SEARCHING_MS ? "bezig" : search.final;
  const { final: _final, ...rest } = search;
  return { ...rest, status, candidates: status === "klaar" ? rest.candidates : [], finished_at: status === "klaar" || status === "niets_gevonden" ? rest.finished_at : null };
}

export async function demoRequestVoiceSearch(eventId: number, request: VoiceSearchRequest): Promise<VoiceRequestResult> {
  const data = read();
  const perspective = request.perspective.trim();
  const existing = data.searches.find((search) => search.event_id === eventId && search.perspective.toLowerCase() === perspective.toLowerCase());
  if (existing) return { ok: true, search: withStatus(existing) };
  const found = RESULTS[perspective.toLowerCase()] ?? [];
  const id = Math.max(0, ...data.searches.map((search) => search.id)) + 1;
  const created = new Date();
  const search: Stored["searches"][number] = {
    id,
    event_id: eventId,
    perspective,
    origin: request.origin,
    gap_key: request.gapKey ?? null,
    status_reason: null,
    candidates: found.map((candidate, i) => ({ ...candidate, id: `c${i + 1}`, verdict: "open", article_id: null })),
    created_at: created.toISOString(),
    finished_at: new Date(created.getTime() + SEARCHING_MS).toISOString(),
    final: found.length ? "klaar" : "niets_gevonden",
  };
  write({ searches: [...data.searches, search] });
  return { ok: true, search: withStatus(search) };
}

export async function demoVoiceSearches(eventId: number): Promise<VoiceSearch[]> {
  return read()
    .searches.filter((search) => search.event_id === eventId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map(withStatus);
}

export async function demoReviewVoiceCandidate(searchId: number, candidateId: string, verdict: VoiceVerdict): Promise<{ ok: boolean; reason: string | null }> {
  const data = read();
  const search = data.searches.find((item) => item.id === searchId);
  const candidate = search?.candidates.find((item) => item.id === candidateId);
  if (!search || !candidate) return { ok: false, reason: "onbekend" };
  candidate.verdict = verdict;
  // Demo article ids: below the fixtures' (-101 …), one per search and candidate
  candidate.article_id = verdict === "goedgekeurd" ? -9000 - searchId * 10 - Number(candidateId.replace(/\D/g, "") || 0) : null;
  write(data);
  return { ok: true, reason: null };
}

/** The demo event with the sources approved on this device, as a real event would have them. */
export function applyDemoVoices(raw: RawExploration): RawExploration {
  if (typeof window === "undefined") return raw;
  const added: RawExploreArticle[] = [];
  for (const search of read().searches) {
    if (search.event_id !== raw.event.id) continue;
    for (const candidate of search.candidates) {
      if (candidate.verdict !== "goedgekeurd" || candidate.article_id === null) continue;
      added.push({
        id: candidate.article_id,
        title: candidate.title,
        url: candidate.url,
        source_name: candidate.outlet,
        published_at: candidate.published_at,
        is_international: candidate.is_international,
        source_country: candidate.country,
        spectrum: null,
        digest: candidate.gist ? { nl: candidate.gist, basis: "text" } : null,
        found: { perspective: search.perspective, who: candidate.who, gist: candidate.gist, gap_key: search.gap_key },
      });
    }
  }
  return added.length ? { ...raw, articles: [...raw.articles, ...added] } : raw;
}
