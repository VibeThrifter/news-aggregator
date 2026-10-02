"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { pmMatch, pmNeighborhood, pmPaths } from "@/lib/api";
import type { Exploration } from "@/lib/explore/exploration";
import {
  expansionFilters,
  filterNeighborhood,
  hoodKey,
  hoodKeyFilters,
  mergeNeighborhoods,
  routeParts,
  type PmSeed,
} from "@/lib/explore/pm-graph";
import { pickRoutes } from "@/lib/explore/pm-paths";
import { eventActorAliases, eventOutletSeeds, matchActorIds } from "@/lib/explore/pm-seeds";
import { usePmStore } from "@/lib/explore/pm-store";

const SEED_LIMIT = 6;
/** Epic 13: the start shows only what connects the outlets and actors of the news (routes of <= 2 steps) */
export const START_ROUTES = 10;
/** "Verbind met beeld": the best few routes (<= 3 steps) to what is on screen */
export const CONNECT_ROUTES = 5;
/** "Zoek verband met …": routes between two chosen parties */
export const PAIR_ROUTES = 3;

/** Neighbours per filter when expanding (the most informative first): a few are drawn, the rest becomes a bundle */
export const EXPAND_LIMIT = 12;
/** What a bundle lists (the RPC caps at 60) */
export const BUNDLE_LIMIT = 60;

/** Store key of the full list behind a bundle: cache only, never part of the graph as a whole */
export const bundleHoodKey = (id: number, filter: string) => `${hoodKey(id, [filter])}#bundle`;

/** Seeds the propaganda-model graph with this event's outlets and actors, and explores nodes on demand. */
export function usePmExplorer(exploration: Exploration, focusPmId: number | null) {
  const { input } = exploration;
  const demo = input.event.isDemo;
  const state = usePmStore(
    useShallow((store) => ({
      eventId: store.eventId,
      seeds: store.seeds,
      seeded: store.seeded,
      neighborhoods: store.neighborhoods,
      active: store.active,
      expanded: store.expanded,
      loading: store.loading,
      hiddenFilters: store.hiddenFilters,
      latest: store.latest,
      revealed: store.revealed,
      routeSets: store.routeSets,
      activeRoutes: store.activeRoutes,
      latestRoutes: store.latestRoutes,
      canUndo: store.past.length > 0,
      canRedo: store.future.length > 0,
    })),
  );
  const actions = usePmStore(
    useShallow((store) => ({
      reset: store.reset,
      setSeeds: store.setSeeds,
      addSeed: store.addSeed,
      putNeighborhood: store.putNeighborhood,
      cacheNeighborhood: store.cacheNeighborhood,
      reveal: store.reveal,
      setLoading: store.setLoading,
      showFilter: store.showFilter,
      setLatest: store.setLatest,
      putRoutes: store.putRoutes,
      record: store.record,
      undo: store.undo,
      redo: store.redo,
    })),
  );

  /**
   * Fetch a neighbourhood. Seeds and expansions go into the graph, peeks only into the cache. A load
   * that finishes after an undo/redo (or another event) is cached but does not change the graph.
   */
  const load = useCallback(
    async (id: number, limit: number, mode: "seed" | "expand" | "peek", filters: string[] | null = null, cacheKey?: string) => {
      const key = cacheKey ?? hoodKey(id, filters);
      const epoch = usePmStore.getState().epoch;
      actions.setLoading(key, true);
      try {
        const hood = await pmNeighborhood(id, { demo, limit, filters });
        if (!hood) return;
        if (mode === "peek" || cacheKey || usePmStore.getState().epoch !== epoch) actions.cacheNeighborhood(hood, filters, key);
        else actions.putNeighborhood(hood, mode === "expand", filters);
      } finally {
        actions.setLoading(key, false);
      }
    },
    [actions, demo],
  );

  // (Re)seed when the event changes. No cancellation: StrictMode runs effects twice, and the second
  // run must not abort the first; stale results are dropped by checking the event id instead.
  useEffect(() => {
    const eventId = input.event.id;
    if (usePmStore.getState().eventId === eventId) return;
    actions.reset(eventId);
    (async () => {
      const seeds: PmSeed[] = eventOutletSeeds(input).map((seed) => ({ ...seed, reason: "outlet" as const }));
      // Actors: NER entities (people/organisations) and authorities from the analysis — exact aliases only
      const actors = eventActorAliases(input);
      const matches = await pmMatch(actors.flatMap((item) => item.aliases), { demo }).catch(() => []);
      for (const id of matchActorIds(actors, matches, new Set(seeds.map((seed) => seed.id)))) {
        seeds.push({ id, reason: "actor" });
      }
      if (usePmStore.getState().eventId !== eventId) return;
      const chosen = seeds.slice(0, 12);
      actions.setSeeds(chosen);
      const ids = chosen.map((seed) => seed.id);
      // The seeds themselves (counts, the node itself) and only what connects them: no fan of
      // neighbours around every outlet (Epic 13: the network between things, not around one)
      const [routes] = await Promise.all([
        ids.length > 1 ? pmPaths(ids, ids, { demo, maxHops: 2, limit: 1 }).catch(() => null) : Promise.resolve(null),
        ...chosen.map((seed) => load(seed.id, SEED_LIMIT, "seed")),
      ]);
      if (routes?.routes.length && usePmStore.getState().eventId === eventId) {
        actions.putRoutes("start", pickRoutes(routes, START_ROUTES), { glide: false });
      }
    })();
  }, [actions, demo, input, load]);

  /** Expand along one filter; anything fetched before (also before an undo, or behind a bundle) is reused. */
  const expandVia = useCallback(
    async (id: number, filter: string) => {
      const { neighborhoods } = usePmStore.getState();
      const complete = (hood: (typeof neighborhoods)[string] | undefined) => hood && (!hood.truncated || hood.relations.length >= EXPAND_LIMIT);
      const own = neighborhoods[hoodKey(id, [filter])];
      if (complete(own)) return actions.putNeighborhood(own, true, [filter]);
      const behindBundle = neighborhoods[bundleHoodKey(id, filter)];
      if (complete(behindBundle)) return actions.putNeighborhood(behindBundle, true, [filter]);
      const all = neighborhoods[hoodKey(id, null)];
      if (all && !all.truncated) return actions.putNeighborhood(filterNeighborhood(all, [filter]), true, [filter]);
      await load(id, EXPAND_LIMIT, "expand", [filter]);
    },
    [actions, load],
  );

  /**
   * Ask a question about a node (Epic 13): its neighbours via one filter ("Wie betaalt?"), which is
   * switched on in the legend. The graph draws the three most specific and bundles the rest ("+84").
   * One undoable step.
   */
  const ask = useCallback(
    async (id: number, filter: string) => {
      actions.record();
      actions.showFilter(filter);
      actions.setLatest({ id, filters: [filter] });
      await expandVia(id, filter);
    },
    [actions, expandVia],
  );

  /**
   * Routes from one node to others, added to the graph (and glided to). Returns how many were found;
   * nothing changes when there are none (with `record`, the undo step is only made when something is
   * added). A load that finishes after an undo/redo is dropped.
   */
  const addRoutes = useCallback(
    async (key: string, from: number, to: number[], options: { maxHops: number; limit: number; max: number; record?: boolean }) => {
      const targets = Array.from(new Set(to.filter((id) => id !== from))).slice(0, 40);
      if (targets.length === 0) return 0;
      const epoch = usePmStore.getState().epoch;
      actions.setLoading(key, true);
      try {
        const result = await pmPaths([from], targets, { demo, maxHops: options.maxHops, limit: options.limit });
        if (!result?.routes.length || usePmStore.getState().epoch !== epoch) return 0;
        const picked = pickRoutes(result, options.max);
        if (options.record) actions.record();
        actions.putRoutes(key, picked);
        return picked.routes.length;
      } finally {
        actions.setLoading(key, false);
      }
    },
    [actions, demo],
  );

  /** "Verbind met beeld": only the best routes (<= 3 steps) from a node to what is already on screen. One undoable step. */
  const connect = useCallback(
    (id: number, onScreen: number[]) =>
      addRoutes(`connect:${id}:${onScreen.slice().sort((a, b) => a - b).join(",")}`, id, onScreen, {
        maxHops: 3,
        limit: 1,
        max: CONNECT_ROUTES,
        record: true,
      }),
    [addRoutes],
  );

  /** "Zoek verband met …": the other party joins the graph with only the routes in between. One undoable step. */
  const connectTo = useCallback(
    async (id: number, targetId: number) => {
      actions.record();
      actions.addSeed({ id: targetId, reason: "focus" });
      const [found] = await Promise.all([
        addRoutes(`pair:${id}:${targetId}`, id, [targetId], { maxHops: 3, limit: PAIR_ROUTES, max: PAIR_ROUTES }),
        load(targetId, SEED_LIMIT, "seed"),
      ]);
      return found;
    },
    [actions, addRoutes, load],
  );

  /** A party from the search bar: it joins the graph with only its routes to what is on screen. One undoable step. */
  const addAndConnect = useCallback(
    async (id: number, onScreen: number[]) => {
      actions.record();
      actions.addSeed({ id, reason: "focus" });
      const [found] = await Promise.all([
        addRoutes(`connect:${id}:${onScreen.slice().sort((a, b) => a - b).join(",")}`, id, onScreen, { maxHops: 3, limit: 1, max: CONNECT_ROUTES }),
        load(id, SEED_LIMIT, "seed"),
      ]);
      return found;
    },
    [actions, addRoutes, load],
  );

  // A focus from the URL (?focus=pm:<id>) becomes a seed with its routes to this news (part of the
  // starting point, added once the event's own seeds are known)
  useEffect(() => {
    if (!focusPmId || !state.seeded) return;
    actions.addSeed({ id: focusPmId, reason: "focus" });
    void load(focusPmId, SEED_LIMIT, "seed");
    const others = usePmStore.getState().seeds.filter((seed) => seed.id !== focusPmId && seed.reason !== "focus").map((seed) => seed.id);
    void addRoutes(`focus:${focusPmId}`, focusPmId, others, { maxHops: 3, limit: 1, max: CONNECT_ROUTES });
  }, [actions, addRoutes, focusPmId, load, state.seeded]);

  /** The full list behind a bundle (cache only: opening a bundle does not change the graph). */
  const loadBundle = useCallback(
    async (id: number, filter: string) => {
      const { neighborhoods } = usePmStore.getState();
      if (neighborhoods[bundleHoodKey(id, filter)]) return;
      const own = neighborhoods[hoodKey(id, [filter])];
      const all = neighborhoods[hoodKey(id, null)];
      if ((own && !own.truncated) || (all && !all.truncated)) return;
      await load(id, BUNDLE_LIMIT, "peek", [filter], bundleHoodKey(id, filter));
    },
    [load],
  );

  /** How many neighbours an expansion via these filters would show (one cheap call, cached). */
  const peek = useCallback(
    async (id: number, filters: string[] | null) => {
      const { neighborhoods } = usePmStore.getState();
      if (neighborhoods[hoodKey(id, filters)]) return;
      const all = neighborhoods[hoodKey(id, null)];
      if (all && !all.truncated) return;
      await load(id, 1, "peek", filters);
    },
    [load],
  );

  const routeResults = useMemo(
    () => state.activeRoutes.map((key) => state.routeSets[key]).filter(Boolean),
    [state.activeRoutes, state.routeSets],
  );
  const merged = useMemo(
    () => mergeNeighborhoods(state.active.map((key) => state.neighborhoods[key]).filter(Boolean), routeResults),
    [state.active, state.neighborhoods, routeResults],
  );
  const routes = useMemo(() => routeParts(routeResults), [routeResults]);
  /** Nodes of the routes added last: the view glides to them */
  const latestRouteNodes = useMemo(() => {
    const result = state.latestRoutes ? state.routeSets[state.latestRoutes] : null;
    return result ? Array.from(new Set(result.routes.flatMap((route) => route.nodes))) : null;
  }, [state.latestRoutes, state.routeSets]);

  /** Per expanded node the filters it was expanded along (from the neighbourhoods in the graph) */
  const expandedFilters = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const key of state.active) {
      const filters = key.includes("#") ? null : hoodKeyFilters(key);
      const id = Number(key.split(":")[0]);
      if (!filters || !state.expanded.includes(id)) continue;
      const set = map.get(id) ?? new Set<string>();
      filters.forEach((filter) => set.add(filter));
      map.set(id, set);
    }
    return map;
  }, [state.active, state.expanded]);

  const loading = useMemo(() => new Set(state.loading), [state.loading]);
  const hiddenFilters = useMemo(() => new Set(state.hiddenFilters), [state.hiddenFilters]);
  const visibleFilters = useMemo(() => expansionFilters(state.hiddenFilters), [state.hiddenFilters]);

  return {
    seeds: state.seeds,
    merged,
    neighborhoods: state.neighborhoods,
    expanded: useMemo(() => new Set(state.expanded), [state.expanded]),
    expandedFilters,
    revealed: useMemo(() => new Set(state.revealed), [state.revealed]),
    loading,
    isLoading: (id: number) => state.loading.some((key) => key === String(id) || key.startsWith(`${id}:`)),
    hiddenFilters,
    /** Filters an expansion uses by default (null = all) */
    visibleFilters,
    latest: state.latest,
    /** Epic 13: nodes and relations on the routes in the graph (always drawn) */
    routeNodes: routes.nodes,
    routeRelations: routes.relations,
    latestRouteNodes,
    ask,
    connect,
    connectTo,
    addAndConnect,
    peek,
    loadBundle,
    reveal: actions.reveal,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undo: actions.undo,
    redo: actions.redo,
    ready: state.eventId === input.event.id && state.seeded,
  };
}
