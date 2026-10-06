"use client";

/**
 * Explore state: the outlets chosen per event, what the reader added themselves per event, the
 * saved items ("Bewaard", with the board) and preferences. Persisted in localStorage on this
 * device only.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { legacyFindingId, TAB_OF_TYPE } from "./findings";
import { FALLACY_LABELS, isTabId } from "./labels";
import { OWN_KIND_IDS, OWN_LIMITS } from "./own";
import { backupRawValue, safeStorage } from "./storage";
import type { AnalysisType, OwnEntry, TabId } from "./types";

export const STORE_KEY = "pluriformiteit:onderzoek";
/** v2 (Epic 14): no more revealed clues, quest mode or hints; dossier "clue" items became "finding" */
export const STORE_VERSION = 2;
const MAX_EVENTS = 150;
export const MAX_DOSSIER_ITEMS = 300;

export interface EventProgress {
  lastVisitedAt: string;
  slug: string | null;
  title: string;
  /** Outlets in "Wie zegt wat?": foreign ones the reader added, Dutch ones they removed */
  sources?: { added: string[]; removed: string[] };
}

export type DossierItemKind = "outlet" | "actor" | "entity" | "finding" | "event" | "pm" | "note" | "bias" | "country";

export interface DossierItem {
  id: string;
  kind: DossierItemKind;
  eventId: number | null;
  eventSlug?: string | null;
  /** LLM title of the event this came from */
  eventTitle?: string | null;
  /** Reference inside the event (finding id, outlet key, pm entity id, ...) */
  refId?: string;
  /** Saved finding: its id and tab, to jump back to it */
  findingId?: string;
  tab?: TabId;
  title: string;
  subtitle?: string;
  outletKey?: string;
  iso?: string;
  /** Matching keys for link suggestions (e.g. "entity:mark-rutte", "outlet:nos", "pm:11") */
  keys: string[];
  text?: string;
  url?: string;
  position?: { x: number; y: number };
  addedAt: string;
}

export interface DossierEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  origin: "user" | "suggestion";
}

export interface Preferences {
  /** "Wie zegt wat?" as conversation/perspectives (auto) or on the left-right map */
  mapMode: "auto" | "spectrum";
  /** Last chosen tab under the figure (null: the first tab with findings) */
  findingsTab: TabId | null;
}

interface CompareState {
  eventId: number | null;
  a: string | null;
  b: string | null;
}

export type OwnPatch = Partial<
  Pick<OwnEntry, "text" | "detail" | "quote" | "anchor" | "against" | "about" | "fallacy" | "url" | "title" | "date" | "sharedAt" | "from">
>;

export interface ExploreState {
  events: Record<string, EventProgress>;
  /** What the reader added themselves, per event id (never pruned with the visited events) */
  own: Record<string, OwnEntry[]>;
  dossier: { items: Record<string, DossierItem>; order: string[]; edges: DossierEdge[]; dismissed: string[] };
  prefs: Preferences;
  compare: CompareState;

  touchEvent(eventId: number, meta: { slug: string | null; title: string }): void;
  /** Put an outlet in or out of "Wie zegt wat?" */
  setOutletShown(eventId: number, outlet: { key: string; isInternational: boolean; foundVoice?: boolean; own?: boolean }, shown: boolean): void;

  addOwn(eventId: number, entry: OwnEntry): "added" | "full" | "invalid";
  updateOwn(eventId: number, id: string, patch: OwnPatch): void;
  /** Returns the removed entry and where it was, to undo */
  removeOwn(eventId: number, id: string): { entry: OwnEntry; index: number } | null;
  restoreOwn(eventId: number, entry: OwnEntry, index: number): void;

  addItem(item: Omit<DossierItem, "addedAt"> & { addedAt?: string }): "added" | "exists" | "full";
  removeItem(id: string): void;
  moveItem(id: string, position: { x: number; y: number }): void;
  updateNote(id: string, text: string): void;
  connect(source: string, target: string, label?: string, origin?: DossierEdge["origin"]): string | null;
  updateEdgeLabel(id: string, label: string): void;
  removeEdge(id: string): void;
  dismissSuggestion(key: string): void;
  importDossier(json: string): { ok: true; items: number } | { ok: false; error: string };
  clearDossier(): void;

  setPref<K extends keyof Preferences>(key: K, value: Preferences[K]): void;

  setCompareSlot(eventId: number, outletKey: string, slot?: "a" | "b"): void;
  swapCompare(): void;
  clearCompare(): void;
}

export const DEFAULT_PREFS: Preferences = {
  mapMode: "auto",
  findingsTab: null,
};

/** Only known preference values survive a reload (renamed or removed values would crash the UI). */
export function sanitizePrefs(raw: unknown): Preferences {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    mapMode: data.mapMode === "spectrum" || data.heroLens === "spectrum" ? "spectrum" : "auto",
    findingsTab: isTabId(data.findingsTab) ? data.findingsTab : null,
  };
}

/** A saved item from before Epic 14: "clue" items become "finding" items (same id, so board threads stay). */
export function migrateDossierItem(item: Omit<DossierItem, "kind"> & { kind: string; spoor?: string }): DossierItem {
  if (item.kind !== "clue") {
    const { spoor: _spoor, ...rest } = item;
    return rest as DossierItem;
  }
  const { spoor: _spoor, ...rest } = item;
  const findingId = legacyFindingId(item.refId ?? "");
  const type = findingId.split(":")[0] as AnalysisType;
  return { ...rest, kind: "finding", findingId, tab: TAB_OF_TYPE[type] ?? undefined } as DossierItem;
}

type PersistedV1 = {
  events?: Record<string, Partial<EventProgress> & { revealed?: unknown; completed?: unknown }>;
  dossier?: { items?: Record<string, DossierItem>; order?: string[]; edges?: DossierEdge[]; dismissed?: string[] };
  prefs?: unknown;
};

const OWN_ID = /^own:[\w-]{1,40}$/;
const OWN_ANCHOR = /^(outlet|speaker):\S{1,200}$/;
const OWN_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A finding of the analysis (`claim:1kl927v`), not an own entry */
const FINDING_ID = /^(?!own:)[a-z]+:[\w-]{1,40}$/;
/** The id of a shared entry it was taken over from (negative in the demo) */
const SHARED_ID = /^-?\d{1,18}$/;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

/** One own entry as typed (or as stored or imported): known kind, trimmed, limited, safe link. */
export function sanitizeOwnEntry(raw: unknown): OwnEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const kind = OWN_KIND_IDS.find((id) => id === data.kind);
  const text = cleanText(data.text, OWN_LIMITS.text);
  if (!kind || !text || typeof data.id !== "string" || !OWN_ID.test(data.id)) return null;
  const anchor = typeof data.anchor === "string" && OWN_ANCHOR.test(data.anchor) ? data.anchor : undefined;
  const against = kind === "contradiction" && typeof data.against === "string" && OWN_ANCHOR.test(data.against) ? data.against : undefined;
  const date = typeof data.date === "string" && OWN_DATE.test(data.date) ? data.date : undefined;
  const url = safeUrl(typeof data.url === "string" ? data.url.trim() : undefined);
  const fallacy = typeof data.fallacy === "string" && Object.prototype.hasOwnProperty.call(FALLACY_LABELS, data.fallacy) ? data.fallacy : undefined;
  // What each kind cannot do without
  if (kind === "moment" && !date) return null;
  if (kind === "source" && !url) return null;
  if (kind === "fallacy" && !fallacy) return null;
  if (kind === "contradiction" && (!anchor || !against || anchor === against)) return null;
  const entry: OwnEntry = {
    id: data.id,
    kind,
    text,
    detail: cleanText(data.detail, OWN_LIMITS.detail),
    quote: cleanText(data.quote, OWN_LIMITS.quote),
    anchor,
    against,
    about: kind === "error" && typeof data.about === "string" && FINDING_ID.test(data.about) ? data.about : undefined,
    fallacy: kind === "fallacy" ? fallacy : undefined,
    url,
    title: kind === "source" ? cleanText(data.title, OWN_LIMITS.title) : undefined,
    date,
    sharedAt: typeof data.sharedAt === "string" && !Number.isNaN(Date.parse(data.sharedAt)) ? data.sharedAt : undefined,
    from: typeof data.from === "string" && SHARED_ID.test(data.from) ? data.from : undefined,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
  };
  // Leave out empty fields (smaller storage, simpler equality)
  for (const key of Object.keys(entry) as (keyof OwnEntry)[]) if (entry[key] === undefined) delete entry[key];
  return entry;
}

/** Own entries per event, as stored or imported. */
export function sanitizeOwn(raw: unknown): Record<string, OwnEntry[]> {
  if (!raw || typeof raw !== "object") return {};
  const own: Record<string, OwnEntry[]> = {};
  for (const [eventId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^-?\d+$/.test(eventId) || !Array.isArray(list)) continue;
    const seen = new Set<string>();
    const entries = list
      .map(sanitizeOwnEntry)
      .filter((entry): entry is OwnEntry => entry !== null && !seen.has(entry.id) && Boolean(seen.add(entry.id)))
      .slice(0, OWN_LIMITS.perEvent);
    if (entries.length) own[eventId] = entries;
  }
  return own;
}

/** v0/v1 -> v2: drop the quest state, rename dossier items, sanitise preferences. */
export function migrateState(persisted: unknown): Pick<ExploreState, "events" | "dossier" | "prefs"> {
  const data = (persisted && typeof persisted === "object" ? persisted : {}) as PersistedV1;
  const events: Record<string, EventProgress> = {};
  for (const [key, value] of Object.entries(data.events ?? {})) {
    if (!value || typeof value !== "object") continue;
    events[key] = {
      lastVisitedAt: typeof value.lastVisitedAt === "string" ? value.lastVisitedAt : new Date(0).toISOString(),
      slug: value.slug ?? null,
      title: value.title ?? "",
      ...(value.sources ? { sources: value.sources } : {}),
    };
  }
  const items: Record<string, DossierItem> = {};
  for (const [id, item] of Object.entries(data.dossier?.items ?? {})) {
    if (item && typeof item === "object" && typeof item.title === "string") items[id] = migrateDossierItem({ ...item, id });
  }
  return {
    events,
    dossier: {
      items,
      order: (data.dossier?.order ?? []).filter((id) => items[id]),
      edges: Array.isArray(data.dossier?.edges) ? data.dossier!.edges!.filter((edge) => items[edge.source] && items[edge.target]) : [],
      dismissed: Array.isArray(data.dossier?.dismissed) ? data.dossier!.dismissed! : [],
    },
    prefs: sanitizePrefs(data.prefs),
  };
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

function pruneEvents(events: Record<string, EventProgress>): Record<string, EventProgress> {
  const entries = Object.entries(events);
  if (entries.length <= MAX_EVENTS) return events;
  entries.sort((a, b) => Date.parse(b[1].lastVisitedAt) - Date.parse(a[1].lastVisitedAt));
  return Object.fromEntries(entries.slice(0, MAX_EVENTS));
}

function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export const useExploreStore = create<ExploreState>()(
  persist(
    (set, get) => ({
      events: {},
      own: {},
      dossier: { items: {}, order: [], edges: [], dismissed: [] },
      prefs: DEFAULT_PREFS,
      compare: { eventId: null, a: null, b: null },

      touchEvent(eventId, meta) {
        set((state) => {
          const key = String(eventId);
          const existing = state.events[key];
          return {
            events: pruneEvents({
              ...state.events,
              [key]: {
                lastVisitedAt: new Date().toISOString(),
                slug: meta.slug,
                title: meta.title,
                ...(existing?.sources ? { sources: existing.sources } : {}),
              },
            }),
          };
        });
      },

      setOutletShown(eventId, outlet, shown) {
        set((state) => {
          const key = String(eventId);
          const existing = state.events[key] ?? {
            lastVisitedAt: new Date().toISOString(),
            slug: null,
            title: "",
          };
          const added = new Set(existing.sources?.added ?? []);
          const removed = new Set(existing.sources?.removed ?? []);
          // Foreign outlets are added; Dutch ones, and one added for a missing voice or by the reader, are left out
          if (outlet.isInternational && !outlet.foundVoice && !outlet.own) {
            if (shown) added.add(outlet.key);
            else added.delete(outlet.key);
          } else if (shown) removed.delete(outlet.key);
          else removed.add(outlet.key);
          return {
            events: { ...state.events, [key]: { ...existing, sources: { added: Array.from(added), removed: Array.from(removed) } } },
          };
        });
      },

      addOwn(eventId, entry) {
        const key = String(eventId);
        const clean = sanitizeOwnEntry(entry);
        const list = get().own[key] ?? [];
        if (!clean) return "invalid";
        if (list.length >= OWN_LIMITS.perEvent) return "full";
        set((state) => ({ own: { ...state.own, [key]: [...(state.own[key] ?? []).filter((item) => item.id !== clean.id), clean] } }));
        return "added";
      },

      updateOwn(eventId, id, patch) {
        set((state) => {
          const key = String(eventId);
          const list = state.own[key] ?? [];
          const index = list.findIndex((item) => item.id === id);
          if (index < 0) return state;
          const clean = sanitizeOwnEntry({ ...list[index], ...patch, updatedAt: new Date().toISOString() });
          if (!clean) return state;
          const next = [...list];
          next[index] = clean;
          return { own: { ...state.own, [key]: next } };
        });
      },

      removeOwn(eventId, id) {
        const key = String(eventId);
        const list = get().own[key] ?? [];
        const index = list.findIndex((item) => item.id === id);
        if (index < 0) return null;
        const entry = list[index];
        set((state) => {
          const rest = (state.own[key] ?? []).filter((item) => item.id !== id);
          const own = { ...state.own };
          if (rest.length) own[key] = rest;
          else delete own[key];
          return { own };
        });
        return { entry, index };
      },

      restoreOwn(eventId, entry, index) {
        set((state) => {
          const key = String(eventId);
          const list = (state.own[key] ?? []).filter((item) => item.id !== entry.id);
          const next = [...list.slice(0, index), entry, ...list.slice(index)];
          return { own: { ...state.own, [key]: next } };
        });
      },

      addItem(item) {
        const state = get();
        if (state.dossier.items[item.id]) return "exists";
        if (state.dossier.order.length >= MAX_DOSSIER_ITEMS) return "full";
        const full: DossierItem = {
          ...item,
          text: item.text?.slice(0, 1000),
          url: safeUrl(item.url),
          addedAt: item.addedAt ?? new Date().toISOString(),
        };
        set((current) => ({
          dossier: {
            ...current.dossier,
            items: { ...current.dossier.items, [full.id]: full },
            order: [...current.dossier.order, full.id],
          },
        }));
        return "added";
      },

      removeItem(id) {
        set((state) => {
          if (!state.dossier.items[id]) return state;
          const items = { ...state.dossier.items };
          delete items[id];
          return {
            dossier: {
              ...state.dossier,
              items,
              order: state.dossier.order.filter((itemId) => itemId !== id),
              edges: state.dossier.edges.filter((edge) => edge.source !== id && edge.target !== id),
            },
          };
        });
      },

      moveItem(id, position) {
        set((state) => {
          const item = state.dossier.items[id];
          if (!item) return state;
          return { dossier: { ...state.dossier, items: { ...state.dossier.items, [id]: { ...item, position } } } };
        });
      },

      updateNote(id, text) {
        set((state) => {
          const item = state.dossier.items[id];
          if (!item) return state;
          return {
            dossier: {
              ...state.dossier,
              items: { ...state.dossier.items, [id]: { ...item, text: text.slice(0, 1000), title: text.split("\n")[0].slice(0, 80) || item.title } },
            },
          };
        });
      },

      connect(source, target, label, origin = "user") {
        const state = get();
        if (source === target || !state.dossier.items[source] || !state.dossier.items[target]) return null;
        const exists = state.dossier.edges.find(
          (edge) => (edge.source === source && edge.target === target) || (edge.source === target && edge.target === source),
        );
        if (exists) return exists.id;
        const edge: DossierEdge = { id: newId("edge"), source, target, label: label?.slice(0, 60), origin };
        set((current) => ({ dossier: { ...current.dossier, edges: [...current.dossier.edges, edge] } }));
        return edge.id;
      },

      updateEdgeLabel(id, label) {
        set((state) => ({
          dossier: {
            ...state.dossier,
            edges: state.dossier.edges.map((edge) => (edge.id === id ? { ...edge, label: label.slice(0, 60) } : edge)),
          },
        }));
      },

      removeEdge(id) {
        set((state) => ({ dossier: { ...state.dossier, edges: state.dossier.edges.filter((edge) => edge.id !== id) } }));
      },

      dismissSuggestion(key) {
        set((state) =>
          state.dossier.dismissed.includes(key)
            ? state
            : { dossier: { ...state.dossier, dismissed: [...state.dossier.dismissed, key] } },
        );
      },

      importDossier(json) {
        try {
          const parsed = JSON.parse(json);
          const data = parsed?.dossier ?? parsed;
          // What the reader added per event travels along (entries that exist stay as they are)
          const imported = sanitizeOwn(parsed?.own);
          if (!data || typeof data !== "object" || typeof data.items !== "object" || !Array.isArray(data.order)) {
            return { ok: false, error: "Geen geldig dossierbestand" };
          }
          const items: Record<string, DossierItem> = {};
          for (const id of data.order.slice(0, MAX_DOSSIER_ITEMS)) {
            const item = data.items[id];
            if (item && typeof item.title === "string" && typeof item.kind === "string") {
              items[id] = migrateDossierItem({ ...item, id, url: safeUrl(item.url), text: item.text?.slice?.(0, 1000) });
            }
          }
          const order = Object.keys(items);
          const edges: DossierEdge[] = Array.isArray(data.edges)
            ? data.edges.filter((edge: DossierEdge) => items[edge.source] && items[edge.target])
            : [];
          set((state) => {
            const own = { ...state.own };
            for (const [eventId, entries] of Object.entries(imported)) {
              const existing = own[eventId] ?? [];
              const fresh = entries.filter((entry) => !existing.some((item) => item.id === entry.id));
              if (fresh.length) own[eventId] = [...existing, ...fresh].slice(0, OWN_LIMITS.perEvent);
            }
            return {
              own,
              dossier: {
                items: { ...state.dossier.items, ...items },
                order: Array.from(new Set([...state.dossier.order, ...order])).slice(0, MAX_DOSSIER_ITEMS),
                edges: [...state.dossier.edges, ...edges.filter((edge) => !state.dossier.edges.some((e) => e.id === edge.id))],
                dismissed: state.dossier.dismissed,
              },
            };
          });
          return { ok: true, items: order.length };
        } catch {
          return { ok: false, error: "Bestand kon niet gelezen worden" };
        }
      },

      clearDossier() {
        set({ dossier: { items: {}, order: [], edges: [], dismissed: [] } });
      },

      setPref(key, value) {
        set((state) => ({ prefs: { ...state.prefs, [key]: value } }));
      },

      setCompareSlot(eventId, outletKey, slot) {
        set((state) => {
          const base = state.compare.eventId === eventId ? state.compare : { eventId, a: null, b: null };
          if (base.a === outletKey || base.b === outletKey) return { compare: base };
          const target = slot ?? (base.a === null ? "a" : "b");
          return { compare: { ...base, [target]: outletKey } };
        });
      },

      swapCompare() {
        set((state) => ({ compare: { ...state.compare, a: state.compare.b, b: state.compare.a } }));
      },

      clearCompare() {
        set({ compare: { eventId: null, a: null, b: null } });
      },
    }),
    {
      name: STORE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => safeStorage),
      skipHydration: true,
      partialize: (state) => ({ events: state.events, own: state.own, dossier: state.dossier, prefs: state.prefs }),
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") {
          backupRawValue(STORE_KEY);
          return { events: {}, own: {}, dossier: { items: {}, order: [], edges: [], dismissed: [] }, prefs: DEFAULT_PREFS };
        }
        if (version < STORE_VERSION) {
          // Keep a backup of the old data, then convert (v1 -> v2: see migrateState)
          backupRawValue(STORE_KEY);
          return migrateState(persisted) as Partial<ExploreState>;
        }
        return persisted as Partial<ExploreState>;
      },
      merge: (persisted, current) => {
        const data = (persisted ?? {}) as Partial<ExploreState>;
        return {
          ...current,
          events: data.events && typeof data.events === "object" ? data.events : current.events,
          own: sanitizeOwn(data.own),
          dossier:
            data.dossier && typeof data.dossier === "object" && Array.isArray(data.dossier.order)
              ? {
                  items: data.dossier.items ?? {},
                  order: data.dossier.order,
                  edges: Array.isArray(data.dossier.edges) ? data.dossier.edges : [],
                  dismissed: Array.isArray(data.dossier.dismissed) ? data.dossier.dismissed : [],
                }
              : current.dossier,
          prefs: sanitizePrefs(data.prefs),
        };
      },
    },
  ),
);

/** Export the dossier and what the reader added as a JSON string (backup, or another device). */
export function exportDossier(): string {
  const { dossier, own } = useExploreStore.getState();
  return JSON.stringify({ app: "pluriformiteit", version: STORE_VERSION, exportedAt: new Date().toISOString(), dossier, own }, null, 2);
}
