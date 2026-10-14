/**
 * Gekleurde zinnen op verzoek (Story 10.7): a paying user or the admin lets AI read every sentence
 * of the Dutch articles of one news item (Epic 10, one LLM call per article). An access code with
 * role admin or pro, checked by the database (migration 019).
 *
 * The app queues a request in Supabase (request_bias_analysis); the local backend runs it (job
 * "Bias Requests") and notes its progress. The analyses are published like the rest of the news,
 * so every reader sees them; every reader also sees that a request runs (bias_request_for_event).
 */

import { rpcOrNull as rpc } from './rpc';

export type BiasRequestStatus = 'wachtrij' | 'bezig' | 'klaar' | 'fout';

export interface BiasRequest {
  id: number;
  event_id: number;
  status: BiasRequestStatus;
  status_reason: string | null;
  /** Articles to analyse (null until the backend took the request) */
  total: number | null;
  done: number;
  failed: number;
  /** Articles of this news with an analysis that readers can see now */
  analysed: number;
  created_at: string;
  finished_at: string | null;
}

export type BiasRequestResult =
  | { ok: true; request: BiasRequest }
  | { ok: false; reason: 'geen_toegang' | 'onbekend_event' | 'limiet' | 'druk' | 'niet_beschikbaar' };

export async function requestBiasAnalysis(code: string, eventId: number): Promise<BiasRequestResult> {
  const data = await rpc<{ ok: boolean; reason: string | null; request: BiasRequest | null }>('request_bias_analysis', {
    p_code: code,
    p_event_id: eventId,
  });
  if (!data) return { ok: false, reason: 'niet_beschikbaar' };
  return data.ok && data.request
    ? { ok: true, request: data.request }
    : { ok: false, reason: (data.reason as Exclude<BiasRequestResult, { ok: true }>['reason']) ?? 'niet_beschikbaar' };
}

/** The latest request of this news, for every reader; null when there is none (or no migration). */
export async function biasRequestForEvent(eventId: number): Promise<BiasRequest | null> {
  return rpc<BiasRequest>('bias_request_for_event', { p_event_id: eventId });
}
