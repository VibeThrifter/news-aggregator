"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { getEntityResearch, pmMatch, pmNeighborhood, pmPaths } from "@/lib/api";
import type { Exploration } from "@/lib/explore/exploration";
import {
  bundleKey,
  expansionFilters,
  filterNeighborhood,
  hoodKey,
  pmScene,
  proposalsOf,
  reasonKey,
  viewGraph,
  type PmDirection,
  type PmSeed,
} from "@/lib/explore/pm-graph";
import { PATH_LIMITS, pickRoutes } from "@/lib/explore/pm-paths";
import { eventActorAliases, eventOutletSeeds, matchActorIds, newsOnlyEntities, researchedIds, researchKeys } from "@/lib/explore/pm-seeds";
import { usePmStore } from "@/lib/explore/pm-store";
import type { PmPaths } from "@/lib/types";

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
export const bundleHoodKey = (id: number, filter: string, direction: PmDirection | null = null) => `${hoodKey(id, [filter], direction)}#bundle`;

/** Routes among all parties of the news: pm_paths takes 12 starting points per call, so ask in batches. */
async function routesAmong(ids: number[], demo: boolean): Promise<PmPaths | null> {
  const targets = ids.slice(0, PATH_LIMITS.to);
  const batches: number[][] = [];
  for (let i = 0; i < targets.length; i += PATH_LIMITS.from) batches.push(targets.slice(i, i + PATH_LIMITS.from));
  const results = (await Promise.all(batches.map((from) => pmPaths(from, targets, { demo, maxHops: 2, limit: 1 }).catch(() => null)))).filter(
    (result): result is PmPaths => Boolean(result?.routes.length),
  );
  if (results.length === 0) return null;
  const byId = <T extends { id: number }>(lists: T[][]) => Array.from(new Map(lists.flat().map((item) => [item.id, item])).values());
  return {
    ...results[0],
    routes: results.flatMap((result) => result.routes),
    entities: byId(results.map((result) => result.entities)),
    relations: byId(results.map((result) => result.relations)),
    truncated: results.some((result) => result.truncated),
  };
}

/** A load that finishes after an undo/redo, or after its step ended, is cached but does not change the graph */
function stale(epoch: number, token?: number): boolean {
  const now = usePmStore.getState();
  return now.epoch !== epoch || (token !== undefined && now.pending?.token !== token);
}

/** Seeds the propaganda-model graph with this event's outlets and actors, and explores nodes on demand. */
export function usePmExplorer(exploration: Exploration, focusPmId: number | null) {
  const { input } = exploration;
  const demo = input.event.isDemo;
  const state = usePmStore(
    useShallow((store) => ({
      eventId: store.eventId,
      seeds: store.seeds,
      seeded: store.seeded,
      news: store.news,
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
      dismissed: store.dismissed,
      dismissedBundles: store.dismissedBundles,
      pending: store.pending,
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
      begin: store.begin,
      keep: store.keep,
      keepAll: store.keepAll,
      dropRest: store.dropRest,
      remove: store.remove,
      recall: store.recall,
      undo: store.undo,
      redo: store.redo,
    })),
  );

  /**
   * Fetch a neighbourhood. Seeds and expansions go into the graph, peeks only into the cache. A load
   * that finishes after an undo/redo (or another event, or after its step ended) is cached but does
   * not change the graph.
   */
  const load = useCallback(
    async (
      id: number,
      limit: number,
      mode: "seed" | "expand" | "peek",
      filters: string[] | null = null,
      options: { cacheKey?: string; token?: number; direction?: PmDirection | null } = {},
    ) => {
      const { cacheKey, token, direction = null } = options;
      const key = cacheKey ?? hoodKey(id, filters, direction);
      const epoch = usePmStore.getState().epoch;
      actions.setLoading(key, true);
      try {
        const hood = await pmNeighborhood(id, { demo, limit, filters, direction });
        if (!hood) return;
        if (mode === "peek" || cacheKey || stale(epoch, token)) actions.cacheNeighborhood(hood, filters, key);
        else actions.putNeighborhood(hood, mode === "expand", filters, direction);
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
      // Actors: NER entities (people/organisations/groups) and authorities from the analysis — exact
      // aliases only — plus what "Wie is dit?" research found in the model for the news' names
      const actors = eventActorAliases(input);
      const [matches, research] = await Promise.all([
        pmMatch(actors.flatMap((item) => item.aliases), { demo }).catch(() => []),
        getEntityResearch(researchKeys(input), { demo }).catch(() => null),
      ]);
      const taken = new Set(seeds.map((seed) => seed.id));
      for (const id of [...matchActorIds(actors, matches, taken), ...researchedIds(research, taken)]) {
        if (taken.has(id)) continue;
        taken.add(id);
        seeds.push({ id, reason: "actor" });
      }
      if (usePmStore.getState().eventId !== eventId) return;
      // Every party of the news is in the network, and so is every person or organisation that is not
      // in the model (yet)
      actions.setSeeds(seeds, newsOnlyEntities(input, matches, research));
      const ids = seeds.map((seed) => seed.id);
      // The seeds themselves (counts, the node itself) and only what connects them: no fan of
      // neighbours around every outlet (Epic 13: the network between things, not around one)
      const [routes] = await Promise.all([
        ids.length > 1 ? routesAmong(ids, demo) : Promise.resolve(null),
        ...seeds.map((seed) => load(seed.id, SEED_LIMIT, "seed")),
      ]);
      if (routes?.routes.length && usePmStore.getState().eventId === eventId) {
        actions.putRoutes("start", pickRoutes(routes, START_ROUTES), { glide: false });
      }
    })();
  }, [actions, demo, input, load]);

  /** Expand along one filter (one way, or either); anything fetched before (also before an undo, or behind a bundle) is reused. */
  const expandVia = useCallback(
    async (id: number, filter: string, direction: PmDirection | null, token?: number) => {
      const { neighborhoods } = usePmStore.getState();
      const complete = (hood: (typeof neighborhoods)[string] | undefined) => hood && (!hood.truncated || hood.relations.length >= EXPAND_LIMIT);
      const own = neighborhoods[hoodKey(id, [filter], direction)];
      if (complete(own)) return actions.putNeighborhood(own, true, [filter], direction);
      const behindBundle = neighborhoods[bundleHoodKey(id, filter, direction)];
      if (complete(behindBundle)) return actions.putNeighborhood(behindBundle, true, [filter], direction);
      // Everything of this filter (or of the node) loaded before: take this way out of it
      for (const all of [neighborhoods[hoodKey(id, [filter])], neighborhoods[hoodKey(id, null)]]) {
        if (all && !all.truncated) return actions.putNeighborhood(filterNeighborhood(all, [filter], direction), true, [filter], direction);
      }
      await load(id, EXPAND_LIMIT, "expand", [filter], { token, direction });
    },
    [actions, load],
  );

  /**
   * Ask a question about a node (Epic 13): its neighbours via one filter ("Wie betaalt?"), which is
   * switched on in the legend. The graph draws the three most specific and bundles the rest ("+84").
   * They are proposals: see-through until you tap them; the next step takes the rest away (and the
   * question too when you keep none). Asking again brings back what you took away of the answer.
   * One undoable step.
   */
  const ask = useCallback(
    async (id: number, filter: string, direction: PmDirection | null = null) => {
      const token = actions.begin("ask");
      actions.recall(id, filter, direction ?? "any");
      actions.showFilter(filter);
      actions.setLatest({ id, filters: [filter], direction });
      await expandVia(id, filter, direction, token);
    },
    [actions, expandVia],
  );

  /**
   * Routes from one node to others, added to the graph (and glided to). Returns how many were found;
   * nothing changes when there are none (with `begin`, the step is only made when something is
   * added). A load that finishes after an undo/redo, or after its step ended, is dropped.
   */
  const addRoutes = useCallback(
    async (key: string, from: number, to: number[], options: { maxHops: number; limit: number; max: number; begin?: boolean; token?: number }) => {
      const targets = Array.from(new Set(to.filter((id) => id !== from))).slice(0, 40);
      if (targets.length === 0) return 0;
      const epoch = usePmStore.getState().epoch;
      actions.setLoading(key, true);
      try {
        const result = await pmPaths([from], targets, { demo, maxHops: options.maxHops, limit: options.limit });
        if (!result?.routes.length || stale(epoch, options.token)) return 0;
        const picked = pickRoutes(result, options.max);
        if (options.begin) actions.begin("routes");
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
        begin: true,
      }),
    [addRoutes],
  );

  /** "Zoek verband met …": the other party joins the graph with only the routes in between (proposals). One undoable step. */
  const connectTo = useCallback(
    async (id: number, targetId: number) => {
      const token = actions.begin("party");
      actions.addSeed({ id: targetId, reason: "focus" });
      const [found] = await Promise.all([
        addRoutes(`pair:${id}:${targetId}`, id, [targetId], { maxHops: 3, limit: PAIR_ROUTES, max: PAIR_ROUTES, token }),
        load(targetId, SEED_LIMIT, "seed"),
      ]);
      return found;
    },
    [actions, addRoutes, load],
  );

  /** A party from the search bar: it joins the graph with only its routes to what is on screen (proposals). One undoable step. */
  const addAndConnect = useCallback(
    async (id: number, onScreen: number[]) => {
      const token = actions.begin("party");
      actions.addSeed({ id, reason: "focus" });
      const [found] = await Promise.all([
        addRoutes(`connect:${id}:${onScreen.slice().sort((a, b) => a - b).join(",")}`, id, onScreen, { maxHops: 3, limit: 1, max: CONNECT_ROUTES, token }),
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
    async (id: number, filter: string, direction: PmDirection | null = null) => {
      const { neighborhoods } = usePmStore.getState();
      if (neighborhoods[bundleHoodKey(id, filter, direction)]) return;
      const complete = [hoodKey(id, [filter], direction), hoodKey(id, [filter]), hoodKey(id, null)].some(
        (key) => neighborhoods[key] && !neighborhoods[key].truncated,
      );
      if (complete) return;
      await load(id, BUNDLE_LIMIT, "peek", [filter], { cacheKey: bundleHoodKey(id, filter, direction), direction });
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

  const graph = useMemo(
    () =>
      viewGraph(
        {
          active: state.active,
          expanded: state.expanded,
          seeds: state.seeds,
          hiddenFilters: state.hiddenFilters,
          latest: state.latest,
          revealed: state.revealed,
          activeRoutes: state.activeRoutes,
          dismissed: state.dismissed,
          dismissedBundles: state.dismissedBundles,
        },
        { neighborhoods: state.neighborhoods, routeSets: state.routeSets },
      ),
    [
      state.active,
      state.expanded,
      state.seeds,
      state.hiddenFilters,
      state.latest,
      state.revealed,
      state.activeRoutes,
      state.dismissed,
      state.dismissedBundles,
      state.neighborhoods,
      state.routeSets,
    ],
  );
  /** Nodes of the routes added last: the view glides to them */
  const latestRouteNodes = useMemo(() => {
    const result = state.latestRoutes ? state.routeSets[state.latestRoutes] : null;
    return result ? Array.from(new Set(result.routes.flatMap((route) => route.nodes))) : null;
  }, [state.latestRoutes, state.routeSets]);

  const expanded = useMemo(() => new Set(state.expanded), [state.expanded]);
  const revealed = useMemo(() => new Set(state.revealed), [state.revealed]);
  const hiddenFilters = useMemo(() => new Set(state.hiddenFilters), [state.hiddenFilters]);

  /** What the network draws (the store settles proposals on the same scene) */
  const scene = useMemo(
    () =>
      pmScene(graph.merged, state.seeds, expanded, {
        hiddenFilters,
        expandedFilters: graph.expandedFilters,
        revealed,
        routeNodes: graph.routeNodes,
        routeRelations: graph.routeRelations,
        routeKeys: graph.routeKeys,
        dismissed: state.dismissed,
        dismissedBundles: state.dismissedBundles,
        newsNodes: state.news.map((item) => ({ id: item.id, label: item.name })),
        eventLabel: "Dit nieuws",
        latest: state.latest,
      }),
    [graph, state.seeds, expanded, hiddenFilters, revealed, state.dismissed, state.dismissedBundles, state.news, state.latest],
  );
  const proposals = useMemo(() => proposalsOf(scene, state.pending, state.revealed), [scene, state.pending, state.revealed]);

  const loading = useMemo(() => new Set(state.loading), [state.loading]);
  const visibleFilters = useMemo(() => expansionFilters(state.hiddenFilters), [state.hiddenFilters]);

  return {
    seeds: state.seeds,
    /** People and organisations of the news that are not in the model */
    news: state.news,
    merged: graph.merged,
    scene,
    /** The step in progress: its new nodes, which of them are see-through, and whether moving on withdraws a question */
    proposals,
    /** A question whose answer you took (partly) away: asking it again brings that back */
    recallable: (id: number, filter: string, direction: PmDirection | null = null) =>
      state.dismissedBundles.includes(bundleKey(id, filter, direction ?? "any")) ||
      Object.values(state.dismissed).some((reasons) => reasons.includes(reasonKey.group(id, filter, direction ?? "any"))),
    neighborhoods: state.neighborhoods,
    expanded,
    expandedFilters: graph.expandedFilters,
    revealed,
    loading,
    isLoading: (id: number) => state.loading.some((key) => key === String(id) || key.startsWith(`${id}:`)),
    hiddenFilters,
    /** Filters an expansion uses by default (null = all) */
    visibleFilters,
    latest: state.latest,
    /** Epic 13: nodes and relations on the routes in the graph (always drawn) */
    routeNodes: graph.routeNodes,
    routeRelations: graph.routeRelations,
    latestRouteNodes,
    ask,
    connect,
    connectTo,
    addAndConnect,
    peek,
    loadBundle,
    reveal: actions.reveal,
    keep: actions.keep,
    keepAll: actions.keepAll,
    dropRest: actions.dropRest,
    remove: actions.remove,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undo: actions.undo,
    redo: actions.redo,
    ready: state.eventId === input.event.id && state.seeded,
  };
}
