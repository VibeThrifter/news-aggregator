"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { pmMatch, pmNeighborhood } from "@/lib/api";
import type { Exploration } from "@/lib/explore/exploration";
import { actorKeys } from "@/lib/explore/normalize";
import {
  expansionFilters,
  filterNeighborhood,
  hoodKey,
  hoodKeyFilters,
  mergeNeighborhoods,
  visibleFilterKeys,
  type PmSeed,
} from "@/lib/explore/pm-graph";
import { usePmStore } from "@/lib/explore/pm-store";

import { compatibleMatches } from "./PmSection";

const SEED_LIMIT = 6;
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
      const seeds: PmSeed[] = [];
      for (const outlet of input.outlets) {
        if (!outlet.isInternational && outlet.profile?.pmEntityId) {
          seeds.push({ id: outlet.profile.pmEntityId, outletKey: outlet.key, reason: "outlet" });
        }
      }
      // Actors: NER entities (people/organisations) and authorities from the analysis — exact aliases only
      const actorAliases: { aliases: string[]; kind: "person" | "org" | null }[] = [
        ...input.entities
          .filter((entity) => entity.kind === "person" || entity.kind === "org")
          .map((entity) => ({ aliases: entity.aliases, kind: entity.kind as "person" | "org" })),
        ...(input.insight?.authority_analysis ?? []).map((authority) => ({ aliases: actorKeys(authority.authority).aliases, kind: null })),
      ];
      const matches = await pmMatch(actorAliases.flatMap((item) => item.aliases), { demo }).catch(() => []);
      for (const item of actorAliases) {
        const own = compatibleMatches(
          matches.filter((match) => item.aliases.includes(match.alias)),
          item.kind,
        );
        for (const match of own) {
          if (!seeds.some((seed) => seed.id === match.entity_id)) seeds.push({ id: match.entity_id, reason: "actor" });
        }
      }
      if (usePmStore.getState().eventId !== eventId) return;
      const chosen = seeds.slice(0, 12);
      actions.setSeeds(chosen);
      await Promise.all(chosen.map((seed) => load(seed.id, SEED_LIMIT, "seed")));
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
   * Expand a node: its neighbours via the filters switched on in the legend, or via one chosen filter
   * (which is then switched on). One request per filter, so every filter brings its own most important
   * links; the graph draws a few per filter and bundles the rest ("+84").
   */
  const expandNode = useCallback(
    async (id: number, only?: string) => {
      const store = usePmStore.getState();
      if (only) actions.showFilter(only);
      const filters = only ? [only] : expansionFilters(store.hiddenFilters);
      actions.setLatest({ id, filters });
      await Promise.all((filters ?? visibleFilterKeys(store.hiddenFilters)).map((filter) => expandVia(id, filter)));
    },
    [actions, expandVia],
  );

  /** A user action: can be undone */
  const expand = useCallback(
    (id: number, only?: string) => {
      actions.record();
      return expandNode(id, only);
    },
    [actions, expandNode],
  );

  // A focus from the URL (?focus=pm:<id>) becomes a seed and is expanded (part of the starting point)
  useEffect(() => {
    if (!focusPmId) return;
    actions.addSeed({ id: focusPmId, reason: "focus" });
    void expandNode(focusPmId);
  }, [actions, focusPmId, expandNode]);

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

  const merged = useMemo(
    () => mergeNeighborhoods(state.active.map((key) => state.neighborhoods[key]).filter(Boolean)),
    [state.active, state.neighborhoods],
  );

  /** Search result: add it to the graph and expand it (one undo step) */
  const addAndExpand = useCallback(
    (id: number) => {
      actions.record();
      actions.addSeed({ id, reason: "focus" });
      return expandNode(id);
    },
    [actions, expandNode],
  );

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
    expand,
    peek,
    loadBundle,
    reveal: actions.reveal,
    addAndExpand,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undo: actions.undo,
    redo: actions.redo,
    ready: state.eventId === input.event.id && state.seeded,
  };
}
