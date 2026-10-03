"use client";

/**
 * Session state of the propaganda-model explorer (not persisted): the graph you built (which loaded
 * neighbourhoods and routes are in it, expanded nodes, seeds, filter toggles, what you took away)
 * with undo/redo, the step in progress whose new nodes are proposals, plus a cache of everything
 * fetched. Shared between the canvas and the sheets.
 */

import { create } from "zustand";

import type { PmNeighborhood, PmPaths } from "@/lib/types";

import {
  DEFAULT_HIDDEN_FILTERS,
  bundleKey,
  hoodKey,
  pmNodeId,
  proposalsOf,
  reasonKey,
  viewScene,
  type PmExpansion,
  type PmGraphView,
  type PmPending,
  type PmSeed,
  type PmDirection,
  type PmSide,
} from "./pm-graph";
import type { NewsEntity } from "./pm-seeds";

/** What undo/redo restores */
export interface PmView extends PmGraphView {
  /** The last expansion, so the view can glide to its new neighbours */
  latest: PmExpansion | null;
  /** The last routes added: the view glides to them (instead of `latest`) */
  latestRoutes: string | null;
  /** The step in progress: what it added is proposed until you keep it or move on */
  pending: PmPending | null;
}

const HISTORY_LIMIT = 30;

interface PmState extends PmView {
  eventId: number | null;
  /** Seeding (matching the event's outlets/actors) has finished */
  seeded: boolean;
  /** People and organisations of this news that are not in the model: always drawn around "Dit nieuws" */
  news: NewsEntity[];
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
  /** Counter for step tokens */
  steps: number;
  reset(eventId: number): void;
  setSeeds(seeds: PmSeed[], news?: NewsEntity[]): void;
  addSeed(seed: PmSeed): void;
  /** Cache only (e.g. counts for a tooltip, the list behind a bundle); `key` defaults to hoodKey(center, filters) */
  cacheNeighborhood(hood: PmNeighborhood, filters?: string[] | null, key?: string): void;
  /** Cache and add to the graph */
  putNeighborhood(hood: PmNeighborhood, expanded: boolean, filters?: string[] | null, direction?: PmDirection | null): void;
  setLoading(key: string, loading: boolean): void;
  /** Remember the current graph before a user action (clears redo); what the last step proposed and you did not keep goes */
  record(): void;
  /** `record()` and start a step whose new nodes are proposals; returns its token */
  begin(kind: PmPending["kind"]): number;
  /** Keep a proposal (a tap on it) */
  keep(nodeId: string): void;
  /** Keep every proposal of the step in progress */
  keepAll(): void;
  /** Drop the proposals you did not keep (or withdraw the question when you kept none) */
  dropRest(): void;
  /** Take a party ("pm:12") or a bundle ("bundle:12:sourcing") out of the graph (undoable): a party stays away until something new points at it, a bundle until you ask its question again */
  remove(nodeId: string): void;
  /** Asking a question again brings back what you took away of its answer (as proposals) */
  recall(id: number, filter: string, side?: PmSide): void;
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

export function graphViewOf(state: PmGraphView): PmGraphView {
  return {
    active: state.active,
    expanded: state.expanded,
    seeds: state.seeds,
    hiddenFilters: state.hiddenFilters,
    latest: state.latest,
    revealed: state.revealed,
    activeRoutes: state.activeRoutes,
    dismissed: state.dismissed,
    dismissedBundles: state.dismissedBundles,
  };
}

export function viewOf(state: PmView): PmView {
  return { ...graphViewOf(state), latestRoutes: state.latestRoutes, pending: state.pending };
}

/** The scene the network draws for this state ("Dit nieuws" and its names do not matter here). */
const sceneOf = (state: PmState) => viewScene(state, state);

/**
 * End the step in progress: proposals you did not keep go (a party remembers why it was there, so the
 * next one does not move up; a bundle stays away until you ask its question again), and a question of
 * which you kept nothing is withdrawn altogether.
 */
function settled(state: PmState): Partial<PmState> {
  const pending = state.pending;
  if (!pending) return {};
  const scene = sceneOf(state);
  const proposals = proposalsOf(scene, pending, state.revealed);
  if (proposals.withdraws) return { ...pending.before, pending: null };
  const dismissed = { ...state.dismissed };
  const bundles = new Set(state.dismissedBundles);
  for (const nodeId of proposals.nodes) {
    if (pending.kept.includes(nodeId)) continue;
    if (nodeId.startsWith("pm:")) dismissed[Number(nodeId.slice(3))] = scene.reasons.get(Number(nodeId.slice(3))) ?? [];
    else if (nodeId.startsWith("bundle:")) bundles.add(nodeId.slice("bundle:".length));
  }
  return { dismissed, dismissedBundles: Array.from(bundles), pending: null };
}

/** One undoable user action: remember the graph as it was (with its proposals), then settle them. */
function step(state: PmState): Partial<PmState> {
  return { past: [...state.past, viewOf(state)].slice(-HISTORY_LIMIT), future: [], ...settled(state) };
}

export const usePmStore = create<PmState>()((set, get) => ({
  eventId: null,
  seeds: [],
  seeded: false,
  news: [],
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
  dismissed: {},
  dismissedBundles: [],
  pending: null,
  past: [],
  future: [],
  epoch: 0,
  steps: 0,
  reset(eventId) {
    // Filter toggles are kept across events within the session
    set((state) => ({
      eventId,
      seeds: [],
      seeded: false,
      news: [],
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
      dismissed: {},
      dismissedBundles: [],
      pending: null,
      past: [],
      future: [],
      epoch: state.epoch + 1,
    }));
  },
  setSeeds(seeds, news = []) {
    set({ seeds, news, seeded: true });
  },
  addSeed(seed) {
    set((state) => (state.seeds.some((existing) => existing.id === seed.id) ? state : { seeds: [...state.seeds, seed] }));
  },
  cacheNeighborhood(hood, filters = null, key = hoodKey(hood.center.id, filters)) {
    set((state) => ({ neighborhoods: { ...state.neighborhoods, [key]: hood } }));
  },
  putNeighborhood(hood, expanded, filters = null, direction = null) {
    const key = hoodKey(hood.center.id, filters, direction);
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
    set((state) => step(state));
  },
  begin(kind) {
    const token = get().steps + 1;
    set((state) => {
      const change = step(state);
      const next = { ...state, ...change };
      const base = sceneOf(next).nodes.map((node) => node.id);
      return { ...change, steps: token, pending: { token, kind, base, kept: [], before: { ...graphViewOf(next), latestRoutes: next.latestRoutes } } };
    });
    return token;
  },
  keep(nodeId) {
    set((state) =>
      state.pending && !state.pending.kept.includes(nodeId) ? { pending: { ...state.pending, kept: [...state.pending.kept, nodeId] } } : state,
    );
  },
  keepAll() {
    set((state) =>
      state.pending ? { past: [...state.past, viewOf(state)].slice(-HISTORY_LIMIT), future: [], pending: null } : state,
    );
  },
  dropRest() {
    set((state) => (state.pending ? step(state) : state));
  },
  remove(nodeId) {
    set((state) => {
      const scene = sceneOf(state);
      let change: Partial<PmState>;
      if (nodeId.startsWith("bundle:")) {
        const key = nodeId.slice("bundle:".length);
        if (!scene.bundles.some((bundle) => bundleKey(bundle.anchorId, bundle.filter, bundle.side) === key)) return state;
        change = { dismissedBundles: [...state.dismissedBundles, key] };
      } else {
        const id = Number(nodeId.slice(3));
        const reasons = scene.reasons.get(id);
        if (!nodeId.startsWith("pm:") || (!reasons && !state.revealed.includes(id))) return state;
        change = { dismissed: { ...state.dismissed, [id]: reasons ?? [] }, revealed: state.revealed.filter((item) => item !== id) };
      }
      return {
        past: [...state.past, viewOf(state)].slice(-HISTORY_LIMIT),
        future: [],
        ...change,
        pending: state.pending ? { ...state.pending, kept: state.pending.kept.filter((item) => item !== nodeId) } : null,
        selected: state.selected === nodeId ? null : state.selected,
      };
    });
  },
  recall(id, filter, side = "any") {
    const key = bundleKey(id, filter, side);
    const reason = reasonKey.group(id, filter, side);
    set((state) => ({
      dismissedBundles: state.dismissedBundles.filter((item) => item !== key),
      dismissed: Object.fromEntries(Object.entries(state.dismissed).filter(([, reasons]) => !reasons.includes(reason))),
    }));
  },
  toggleFilter(filter) {
    set((state) => {
      const change = step(state);
      // Switch it the way the legend showed it (a withdrawn question may have switched it back already)
      const hidden = (change.hiddenFilters ?? state.hiddenFilters).filter((item) => item !== filter);
      return { ...change, hiddenFilters: state.hiddenFilters.includes(filter) ? hidden : [...hidden, filter] };
    });
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
      if (ids.every((id) => state.revealed.includes(id)) && Object.keys(hoods).every((key) => state.active.includes(key))) return state;
      // Picking from a list is a step of its own: what the last step proposed and you did not keep goes first
      const change = step(state);
      const next = { ...state, ...change };
      // Only the relations that link the revealed nodes join the graph, so nothing else moves
      const keys = Object.keys(hoods).filter((key) => !next.active.includes(key));
      return {
        ...change,
        neighborhoods: { ...state.neighborhoods, ...hoods },
        revealed: Array.from(new Set([...next.revealed, ...ids])),
        active: keys.length ? [...next.active, ...keys] : next.active,
        // Chosen again: no longer taken away
        dismissed: Object.fromEntries(Object.entries(next.dismissed).filter(([id]) => !ids.includes(Number(id)))),
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
