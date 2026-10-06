/**
 * Stemmen zoeken (Epic 14, Story 14.10): let AI search the news for a voice that is missing, and
 * add what it finds to the event. Admin only for now (an access code, checked by the database);
 * paying users later (role "pro", see migration 009).
 *
 * The app queues a search in Supabase (request_voice_search); the local backend runs it (job
 * "Voice Search") and writes the sources it found; the admin approves or rejects them
 * (review_voice_candidate). An approved source becomes an article of the event, for every reader.
 * Demo events: simulated client-side (fixtures/demo-voices.ts).
 */

import { rpcOrNull as rpc } from './rpc';

export type AccessRole = 'admin' | 'pro';

export interface AccessInfo {
  role: AccessRole | null;
  /** This role may search and approve (now: admin) */
  can_search: boolean;
}

export type VoiceSearchStatus = 'wachtrij' | 'bezig' | 'klaar' | 'niets_gevonden' | 'fout';
export type VoiceVerdict = 'open' | 'goedgekeurd' | 'afgewezen';

export interface VoiceCandidate {
  id: string;
  url: string;
  /** Headline: only as link text */
  title: string;
  outlet: string | null;
  domain: string | null;
  is_international: boolean;
  country: string | null;
  published_at: string | null;
  /** Who speaks for the missing voice in it */
  who: string | null;
  /** What they say, written by the check (never the article text) */
  gist: string | null;
  confidence: number | null;
  verdict: VoiceVerdict;
  /** The article in the event once approved */
  article_id: number | null;
}

export interface VoiceSearch {
  id: number;
  event_id: number;
  perspective: string;
  origin: 'analyse' | 'eigen';
  gap_key: string | null;
  status: VoiceSearchStatus;
  status_reason: string | null;
  candidates: VoiceCandidate[];
  created_at: string;
  finished_at: string | null;
}

export interface VoiceSearchRequest {
  perspective: string;
  context?: string | null;
  origin: 'analyse' | 'eigen';
  /** The missing voice in the app: gap:<hash> or own:<id> */
  gapKey?: string | null;
}

export type VoiceRequestResult =
  | { ok: true; search: VoiceSearch }
  | { ok: false; reason: 'geen_toegang' | 'ongeldig' | 'onbekend_event' | 'limiet' | 'druk' | 'niet_beschikbaar' };

const DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true';

async function demo() {
  return import('./explore/fixtures/demo-voices');
}

/** What a code may do; null when the database does not know codes yet. */
export async function accessCodeRole(code: string): Promise<AccessInfo | null> {
  if (!code.trim()) return { role: null, can_search: false };
  return rpc<AccessInfo>('access_code_role', { p_code: code.trim() });
}

export async function requestVoiceSearch(
  code: string,
  eventId: number,
  request: VoiceSearchRequest,
  options: { demo?: boolean } = {},
): Promise<VoiceRequestResult> {
  if (DEMO_ENABLED && options.demo) return (await demo()).demoRequestVoiceSearch(eventId, request);
  const data = await rpc<{ ok: boolean; reason: string | null; search: VoiceSearch | null }>('request_voice_search', {
    p_code: code,
    p_event_id: eventId,
    p_perspective: request.perspective,
    p_context: request.context ?? null,
    p_origin: request.origin,
    p_gap_key: request.gapKey ?? null,
  });
  if (!data) return { ok: false, reason: 'niet_beschikbaar' };
  return data.ok && data.search
    ? { ok: true, search: data.search }
    : { ok: false, reason: (data.reason as Exclude<VoiceRequestResult, { ok: true }>['reason']) ?? 'ongeldig' };
}

export async function voiceSearchesForEvent(code: string, eventId: number, options: { demo?: boolean } = {}): Promise<VoiceSearch[]> {
  if (DEMO_ENABLED && options.demo) return (await demo()).demoVoiceSearches(eventId);
  return (await rpc<VoiceSearch[]>('voice_searches_for_event', { p_code: code, p_event_id: eventId })) ?? [];
}

export async function reviewVoiceCandidate(
  code: string,
  searchId: number,
  candidateId: string,
  verdict: VoiceVerdict,
  options: { demo?: boolean } = {},
): Promise<{ ok: boolean; reason: string | null }> {
  if (DEMO_ENABLED && options.demo) return (await demo()).demoReviewVoiceCandidate(searchId, candidateId, verdict);
  const data = await rpc<{ ok: boolean; reason: string | null }>('review_voice_candidate', {
    p_code: code,
    p_search_id: searchId,
    p_candidate_id: candidateId,
    p_verdict: verdict,
  });
  return data ?? { ok: false, reason: 'niet_beschikbaar' };
}
