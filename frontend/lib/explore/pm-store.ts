"use client";

/**
 * Session state of the propaganda-model explorer (not persisted): the graph you built (which loaded
 * neighbourhoods and routes are in it, expanded nodes, seeds, filter toggles) with undo/redo, plus a
 * cache of everything fetched. Shared between the canvas and the sheets.
 */

import { create } from "zustand";

import type { PmNeighborhood, PmPaths } from "@/lib/types";

import { DEFAULT_HIDDEN_FILTERS, hoodKey, type PmExpansion, type PmSeed } from "./pm-graph";

/** What undo/redo restores */
export interface PmView {
  /** Neighbourhoods that are part of the graph (keys into the cache) */
  active: string[];
  expanded: number[];
  seeds: PmSeed[];
  hiddenFilters: string[];
  /** The last expansion, so the view can glide to its new neighbours */
  latest: PmExpansion | null;
  /** Nodes taken out of a bundle ("+84"): always drawn */
  revealed: number[];
  /** Epic 13: route results that are part of the graph (keys into `routeSets`) */
  activeRoutes: string[];
  /** The last routes added: the view glides to them (instead of `latest`) */
  latestRoutes: string | null;
}

const HISTORY_LIMIT = 30;

interface PmState extends PmView {
  eventId: number | null;
  /** Seeding (matching the event's outlets/actors) has finished */
  seeded: boolean;
  /** Everything fetched, by hoodKey(id, filters) — also neighbourhoods not (or no longer) in the graph */
  neighborhoods: Record<string, PmNeighborhood>;
  /** Epic 13: every route result fetched, by request key */
  routeSets: Record<string, PmPaths>;
  /** hoodKeys being loaded */
  loading: string[];
  selected: string | null;
  past: PmView[];
  future: PmView[];
  /** Bumped on undo/redo/reset: loads that started earlier are cached but not added to the graph */
  epoch: number;
  reset(eventId: number): void;
  setSeeds(seeds: PmSeed[]): void;
  addSeed(seed: PmSeed): void;
  /** Cache only (e.g. counts for a tooltip, the list behind a bundle); `key` defaults to hoodKey(center, filters) */
  cacheNeighborhood(hood: PmNeighborhood, filters?: string[] | null, key?: string): void;
  /** Cache and add to the graph */
  putNeighborhood(hood: PmNeighborhood, expanded: boolean, filters?: string[] | null): void;
  setLoading(key: string, loading: boolean): void;
  /** Remember the current graph before a user action (clears redo) */
  record(): void;
  toggleFilter(filter: string): void;
  showFilter(filter: string): void;
  setLatest(latest: PmExpansion | null): void;
  /** Add routes to the graph (cache them too) and glide to them; `record()` first for an undoable step */
  putRoutes(key: string, paths: PmPaths, options?: { glide?: boolean }): void;
  /** Take nodes out of their bundle (undoable), with the relations that link them (as small neighbourhoods) */
  reveal(ids: number[], hoods?: Record<string, PmNeighborhood>): void;
  undo(): void;
  redo(): void;
  select(nodeId: string | null): void;
}

export function viewOf(state: PmView): PmView {
  return {
    active: state.active,
    expanded: state.expanded,
    seeds: state.seeds,
    hiddenFilters: state.hiddenFilters,
    latest: state.latest,
    revealed: state.revealed,
    activeRoutes: state.activeRoutes,
    latestRoutes: state.latestRoutes,
  };
}

export const usePmStore = create<PmState>()((set) => ({
  eventId: null,
  seeds: [],
  seeded: false,
  neighborhoods: {},
  routeSets: {},
  active: [],
  expanded: [],
  loading: [],
  hiddenFilters: DEFAULT_HIDDEN_FILTERS,
  selected: null,
  latest: null,
  revealed: [],
  activeRoutes: [],
  latestRoutes: null,
  past: [],
  future: [],
  epoch: 0,
  reset(eventId) {
    // Filter toggles are kept across events within the session
    set((state) => ({
      eventId,
      seeds: [],
      seeded: false,
      neighborhoods: {},
      routeSets: {},
      active: [],
      expanded: [],
      loading: [],
      selected: null,
      latest: null,
      revealed: [],
      activeRoutes: [],
      latestRoutes: null,
      past: [],
      future: [],
      epoch: state.epoch + 1,
    }));
  },
  setSeeds(seeds) {
    set({ seeds, seeded: true });
  },
  addSeed(seed) {
    set((state) => (state.seeds.some((existing) => existing.id === seed.id) ? state : { seeds: [...state.seeds, seed] }));
  },
  cacheNeighborhood(hood, filters = null, key = hoodKey(hood.center.id, filters)) {
    set((state) => ({ neighborhoods: { ...state.neighborhoods, [key]: hood } }));
  },
  putNeighborhood(hood, expanded, filters = null) {
    const key = hoodKey(hood.center.id, filters);
    set((state) => ({
      neighborhoods: { ...state.neighborhoods, [key]: hood },
      active: state.active.includes(key) ? state.active : [...state.active, key],
      expanded: expanded && !state.expanded.includes(hood.center.id) ? [...state.expanded, hood.center.id] : state.expanded,
    }));
  },
  setLoading(key, loading) {
    set((state) => ({
      loading: loading ? Array.from(new Set([...state.loading, key])) : state.loading.filter((item) => item !== key),
    }));
  },
  record() {
    set((state) => ({ past: [...state.past, viewOf(state)].slice(-HISTORY_LIMIT), future: [] }));
  },
  toggleFilter(filter) {
    set((state) => ({
      past: [...state.past, viewOf(state)].slice(-HISTORY_LIMIT),
      future: [],
      hiddenFilters: state.hiddenFilters.includes(filter)
        ? state.hiddenFilters.filter((item) => item !== filter)
        : [...state.hiddenFilters, filter],
    }));
  },
  showFilter(filter) {
    set((state) => ({ hiddenFilters: state.hiddenFilters.filter((item) => item !== filter) }));
  },
  setLatest(latest) {
    set({ latest, latestRoutes: null });
  },
  putRoutes(key, paths, options = {}) {
    set((state) => ({
      routeSets: { ...state.routeSets, [key]: paths },
      activeRoutes: state.activeRoutes.includes(key) ? state.activeRoutes : [...state.activeRoutes, key],
      ...(options.glide === false ? {} : { latestRoutes: key, latest: null }),
    }));
  },
  reveal(ids, hoods = {}) {
    set((state) => {
      const revealed = Array.from(new Set([...state.revealed, ...ids]));
      // Only the relations that link the revealed nodes join the graph, so nothing else moves
      const keys = Object.keys(hoods).filter((key) => !state.active.includes(key));
      if (revealed.length === state.revealed.length && keys.length === 0) return state;
      return {
        past: [...state.past, viewOf(state)].slice(-HISTORY_LIMIT),
        future: [],
        neighborhoods: { ...state.neighborhoods, ...hoods },
        revealed,
        active: keys.length ? [...state.active, ...keys] : state.active,
      };
    });
  },
  undo() {
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [viewOf(state), ...state.future].slice(0, HISTORY_LIMIT),
        epoch: state.epoch + 1,
        selected: null,
      };
    });
  },
  redo() {
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...next,
        past: [...state.past, viewOf(state)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        epoch: state.epoch + 1,
        selected: null,
      };
    });
  },
  select(nodeId) {
    set({ selected: nodeId });
  },
}));
