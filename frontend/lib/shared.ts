/**
 * Van anderen (Epic 14, Story 14.15): readers share what they added to a news item; others search
 * it and take over what they find good. Nothing of others enters your picture unless you take it
 * over. No AI and no accounts: a random token of this device makes what it shared its own (only
 * this device can change or withdraw it). The database decides the rest (migration 012): limits,
 * reports (3 hide an entry until the admin looks) and the admin's moderation.
 * Demo events: simulated on this device (fixtures/demo-shared.ts).
 */

import type { OwnEntry, OwnKind } from './explore/types';
import { rpcOrNull as rpc } from './rpc';

export interface SharedEntry {
  id: number;
  event_id: number;
  kind: OwnKind;
  text: string;
  detail: string | null;
  quote: string | null;
  anchor: string | null;
  against: string | null;
  about: string | null;
  fallacy: string | null;
  url: string | null;
  title: string | null;
  date: string | null;
  /** How many readers took it over */
  adopted: number;
  created_at: string;
  /** Shared from this device */
  mine: boolean;
  /** Mine: the id of the entry on this device */
  own_id: string | null;
  /** Taken over on this device */
  adopted_by_me: boolean;
  /** Mine: hidden after reports or by the admin */
  hidden: boolean;
}

/** What is shared of an own entry (never when, or whether it was shared or taken over). */
export type ShareFields = Pick<OwnEntry, 'id' | 'kind' | 'text' | 'detail' | 'quote' | 'anchor' | 'against' | 'about' | 'fallacy' | 'url' | 'title' | 'date'>;

export type ShareFailure = 'geen_apparaat' | 'ongeldig' | 'onbekend_event' | 'limiet' | 'druk' | 'niet_beschikbaar';
export type ShareResult = { ok: true; entry: SharedEntry } | { ok: false; reason: ShareFailure };
export type ReportReason = 'spam' | 'beledigend' | 'prive' | 'anders';
export type ModerateAction = 'verberg' | 'toon' | 'verwijder';

export interface ReportedEntry {
  entry: SharedEntry;
  event_slug: string | null;
  event_title: string | null;
  reports: number;
  reasons: Partial<Record<ReportReason, number>> | null;
  hidden_at: string | null;
  hidden_reason: 'meldingen' | 'admin' | null;
}

export interface Options {
  demo?: boolean;
}

const DEVICE_KEY = 'pluriformiteit:apparaat';
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true';

/**
 * The random token of this device; null when storage is blocked. Made only when the reader shares,
 * takes over or reports something (`create`): reading what others shared does not need one.
 */
export function deviceToken(create = true): string | null {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing && DEVICE_TOKEN.test(existing)) return existing;
    if (!create) return null;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    window.localStorage.setItem(DEVICE_KEY, token);
    return token;
  } catch {
    return null;
  }
}

async function demo() {
  return import('./explore/fixtures/demo-shared');
}

const isDemo = (options: Options) => DEMO_ENABLED && Boolean(options.demo);

export async function shareEntry(eventId: number, fields: ShareFields, options: Options = {}): Promise<ShareResult> {
  if (isDemo(options)) return (await demo()).demoShare(eventId, fields);
  const device = deviceToken();
  if (!device) return { ok: false, reason: 'geen_apparaat' };
  const data = await rpc<{ ok: boolean; reason: string | null; entry: SharedEntry | null }>('share_entry', {
    p_device: device,
    p_event_id: eventId,
    p_entry: fields,
  });
  if (!data) return { ok: false, reason: 'niet_beschikbaar' };
  return data.ok && data.entry ? { ok: true, entry: data.entry } : { ok: false, reason: (data.reason as ShareFailure) ?? 'ongeldig' };
}

export async function unshareEntry(eventId: number, ownId: string, options: Options = {}): Promise<boolean> {
  if (isDemo(options)) return (await demo()).demoUnshare(eventId, ownId);
  const device = deviceToken();
  if (!device) return false;
  const data = await rpc<{ ok: boolean }>('unshare_entry', { p_device: device, p_own_id: ownId });
  return Boolean(data?.ok);
}

/** What readers shared about a news item, newest first; null when the database cannot share yet. */
export async function sharedEntriesForEvent(eventId: number, options: Options = {}): Promise<SharedEntry[] | null> {
  if (isDemo(options)) return (await demo()).demoSharedEntries(eventId);
  return rpc<SharedEntry[]>('shared_entries_for_event', { p_event_id: eventId, p_device: deviceToken(false) });
}

export async function adoptSharedEntry(id: number, adopt: boolean, options: Options = {}): Promise<{ ok: boolean; reason: string | null }> {
  if (isDemo(options)) return (await demo()).demoAdopt(id, adopt);
  const device = deviceToken();
  if (!device) return { ok: false, reason: 'geen_apparaat' };
  const data = await rpc<{ ok: boolean; reason: string | null }>('adopt_shared_entry', { p_device: device, p_id: id, p_adopt: adopt });
  return data ?? { ok: false, reason: 'niet_beschikbaar' };
}

export async function reportSharedEntry(id: number, reason: ReportReason, options: Options = {}): Promise<{ ok: boolean; reason: string | null }> {
  if (isDemo(options)) return (await demo()).demoReport(id);
  const device = deviceToken();
  if (!device) return { ok: false, reason: 'geen_apparaat' };
  const data = await rpc<{ ok: boolean; reason: string | null }>('report_shared_entry', { p_device: device, p_id: id, p_reason: reason });
  return data ?? { ok: false, reason: 'niet_beschikbaar' };
}

/** Admin: what readers reported or what is hidden. */
export async function reportedSharedEntries(code: string): Promise<ReportedEntry[]> {
  return (await rpc<ReportedEntry[]>('shared_entries_reported', { p_code: code })) ?? [];
}

/** Admin: hide an entry, show it again (clears its reports) or delete it. */
export async function moderateSharedEntry(code: string, id: number, action: ModerateAction, options: Options = {}): Promise<{ ok: boolean; reason: string | null }> {
  if (isDemo(options)) return (await demo()).demoModerate(id, action);
  const data = await rpc<{ ok: boolean; reason: string | null }>('moderate_shared_entry', { p_code: code, p_id: id, p_action: action });
  return data ?? { ok: false, reason: 'niet_beschikbaar' };
}
