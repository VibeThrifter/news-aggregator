"use client";

/**
 * Exploration state: discovered clues per event, the dossier (research board) and preferences.
 * Persisted in localStorage on this device only.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { HeroLens } from "./layout/bubbles";
import { backupRawValue, safeStorage } from "./storage";
import type { SpoorId } from "./types";

export const STORE_KEY = "pluriformiteit:onderzoek";
export const STORE_VERSION = 1;
const MAX_EVENTS = 150;
export const MAX_DOSSIER_ITEMS = 300;

export type NetworkLens = "propaganda" | "actoren" | "frames" | "tegenspraak" | "gerelateerd";

export interface EventProgress {
  revealed: string[];
  completed: SpoorId[];
  lastVisitedAt: string;
  slug: string | null;
  title: string;
  /** Outlets in "Wie zegt wat?": foreign ones the reader added, Dutch ones they removed */
  sources?: { added: string[]; removed: string[] };
}

export type DossierItemKind = "outlet" | "actor" | "entity" | "clue" | "event" | "pm" | "note" | "bias" | "country";

export interface DossierItem {
  id: string;
  kind: DossierItemKind;
  eventId: number | null;
  eventSlug?: string | null;
  /** LLM title of the event this came from */
  eventTitle?: string | null;
  /** Reference inside the event (clue id, outlet key, pm entity id, ...) */
  refId?: string;
  spoor?: SpoorId;
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
  heroLens: HeroLens;
  networkLens: NetworkLens;
  listMode: boolean;
  /** "Speurmodus": clues start hidden. Off = everything visible. */
  questMode: boolean;
  seenHints: string[];
}

interface CompareState {
  eventId: number | null;
  a: string | null;
  b: string | null;
}

export interface ExploreState {
  events: Record<string, EventProgress>;
  dossier: { items: Record<string, DossierItem>; order: string[]; edges: DossierEdge[]; dismissed: string[] };
  prefs: Preferences;
  compare: CompareState;

  touchEvent(eventId: number, meta: { slug: string | null; title: string }): void;
  reveal(eventId: number, clueIds: string[]): void;
  markSpoorCompleted(eventId: number, spoor: SpoorId): void;
  resetEvent(eventId: number): void;
  /** Put an outlet in or out of "Wie zegt wat?" */
  setOutletShown(eventId: number, outlet: { key: string; isInternational: boolean }, shown: boolean): void;

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
  markHintSeen(hint: string): void;

  setCompareSlot(eventId: number, outletKey: string, slot?: "a" | "b"): void;
  swapCompare(): void;
  clearCompare(): void;
}

const DEFAULT_PREFS: Preferences = {
  heroLens: "invalshoek",
  networkLens: "propaganda",
  listMode: false,
  questMode: true,
  seenHints: [],
};

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
                revealed: existing?.revealed ?? [],
                completed: existing?.completed ?? [],
                lastVisitedAt: new Date().toISOString(),
                slug: meta.slug,
                title: meta.title,
                ...(existing?.sources ? { sources: existing.sources } : {}),
              },
            }),
          };
        });
      },

      reveal(eventId, clueIds) {
        if (clueIds.length === 0) return;
        set((state) => {
          const key = String(eventId);
          const existing = state.events[key] ?? {
            revealed: [],
            completed: [],
            lastVisitedAt: new Date().toISOString(),
            slug: null,
            title: "",
          };
          const revealed = new Set(existing.revealed);
          const before = revealed.size;
          clueIds.forEach((id) => revealed.add(id));
          if (revealed.size === before) return state;
          return { events: { ...state.events, [key]: { ...existing, revealed: Array.from(revealed) } } };
        });
      },

      markSpoorCompleted(eventId, spoor) {
        set((state) => {
          const key = String(eventId);
          const existing = state.events[key];
          if (!existing || existing.completed.includes(spoor)) return state;
          return { events: { ...state.events, [key]: { ...existing, completed: [...existing.completed, spoor] } } };
        });
      },

      setOutletShown(eventId, outlet, shown) {
        set((state) => {
          const key = String(eventId);
          const existing = state.events[key] ?? {
            revealed: [],
            completed: [],
            lastVisitedAt: new Date().toISOString(),
            slug: null,
            title: "",
          };
          const added = new Set(existing.sources?.added ?? []);
          const removed = new Set(existing.sources?.removed ?? []);
          if (outlet.isInternational) {
            if (shown) added.add(outlet.key);
            else added.delete(outlet.key);
          } else if (shown) removed.delete(outlet.key);
          else removed.add(outlet.key);
          return {
            events: { ...state.events, [key]: { ...existing, sources: { added: Array.from(added), removed: Array.from(removed) } } },
          };
        });
      },

      resetEvent(eventId) {
        set((state) => {
          const key = String(eventId);
          const existing = state.events[key];
          if (!existing) return state;
          return { events: { ...state.events, [key]: { ...existing, revealed: [], completed: [] } } };
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
          if (!data || typeof data !== "object" || typeof data.items !== "object" || !Array.isArray(data.order)) {
            return { ok: false, error: "Geen geldig dossierbestand" };
          }
          const items: Record<string, DossierItem> = {};
          for (const id of data.order.slice(0, MAX_DOSSIER_ITEMS)) {
            const item = data.items[id];
            if (item && typeof item.title === "string" && typeof item.kind === "string") {
              items[id] = { ...item, id, url: safeUrl(item.url), text: item.text?.slice?.(0, 1000) };
            }
          }
          const order = Object.keys(items);
          const edges: DossierEdge[] = Array.isArray(data.edges)
            ? data.edges.filter((edge: DossierEdge) => items[edge.source] && items[edge.target])
            : [];
          set((state) => ({
            dossier: {
              items: { ...state.dossier.items, ...items },
              order: Array.from(new Set([...state.dossier.order, ...order])).slice(0, MAX_DOSSIER_ITEMS),
              edges: [...state.dossier.edges, ...edges.filter((edge) => !state.dossier.edges.some((e) => e.id === edge.id))],
              dismissed: state.dossier.dismissed,
            },
          }));
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

      markHintSeen(hint) {
        set((state) =>
          state.prefs.seenHints.includes(hint) ? state : { prefs: { ...state.prefs, seenHints: [...state.prefs.seenHints, hint] } },
        );
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
      partialize: (state) => ({ events: state.events, dossier: state.dossier, prefs: state.prefs }),
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") {
          backupRawValue(STORE_KEY);
          return { events: {}, dossier: { items: {}, order: [], edges: [], dismissed: [] }, prefs: DEFAULT_PREFS };
        }
        if (version < STORE_VERSION) {
          // v0 -> v1: nothing to transform yet; keep a backup for safety
          backupRawValue(STORE_KEY);
        }
        return persisted as Partial<ExploreState>;
      },
      merge: (persisted, current) => {
        const data = (persisted ?? {}) as Partial<ExploreState>;
        return {
          ...current,
          events: data.events && typeof data.events === "object" ? data.events : current.events,
          dossier:
            data.dossier && typeof data.dossier === "object" && Array.isArray(data.dossier.order)
              ? {
                  items: data.dossier.items ?? {},
                  order: data.dossier.order,
                  edges: Array.isArray(data.dossier.edges) ? data.dossier.edges : [],
                  dismissed: Array.isArray(data.dossier.dismissed) ? data.dossier.dismissed : [],
                }
              : current.dossier,
          prefs: { ...DEFAULT_PREFS, ...(data.prefs ?? {}) },
        };
      },
    },
  ),
);

/** Export the dossier as a JSON string (for backup or moving to another device). */
export function exportDossier(): string {
  const { dossier } = useExploreStore.getState();
  return JSON.stringify({ app: "pluriformiteit", version: STORE_VERSION, exportedAt: new Date().toISOString(), dossier }, null, 2);
}
