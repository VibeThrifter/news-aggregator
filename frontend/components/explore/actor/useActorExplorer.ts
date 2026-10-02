"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { pmNeighborhood, pmPaths } from "@/lib/api";
import { hoodKey, mergeNeighborhoods, routeParts } from "@/lib/explore/pm-graph";
import { pickRoutes } from "@/lib/explore/pm-paths";
import type { PmNeighborhood, PmPaths } from "@/lib/types";

/** The actor's own neighbourhood (the RPC caps at 60); the scene draws only the most specific few per filter */
export const ACTOR_CENTER_LIMIT = 60;
/** Neighbours loaded per question about another party ("Wie betaalt?") */
export const ACTOR_ASK_LIMIT = 30;
/** Routes drawn to the people and organisations that are in the news together with the actor */
export const ACTOR_NEWS_ROUTES = 5;
/** Routes drawn for "Zoek verband met …" */
export const ACTOR_PAIR_ROUTES = 3;

interface ExplorerState {
  centerId: number;
  /** Loaded neighbourhoods by hoodKey(id, filters) */
  hoods: Record<string, PmNeighborhood>;
  /** Per party the questions (filters) asked about it */
  asked: Record<number, string[]>;
  /** Route results by key, in the order they were added */
  routes: Record<string, PmPaths>;
  routeKeys: string[];
  loading: string[];
  failed: boolean;
  /** The last step: a party that was asked about, or a route key (the view glides to it) */
  latest: { kind: "ask"; id: number } | { kind: "routes"; key: string } | null;
}

const initial = (centerId: number): ExplorerState => ({
  centerId,
  hoods: {},
  asked: {},
  routes: {},
  routeKeys: [],
  loading: [],
  failed: false,
  latest: null,
});

/**
 * Explorer of one actor's network, scoped to the actor page (local state only; the event network
 * keeps its own session store). Epic 13: instead of unfolding every neighbour you ask a question
 * about a party, or look for routes between the actor and another party.
 */
export function useActorExplorer(centerId: number, demo: boolean) {
  const [state, setState] = useState<ExplorerState>(() => initial(centerId));
  const current = useRef(centerId);
  const stateRef = useRef(state);
  stateRef.current = state;

  const setLoading = (key: string, on: boolean) =>
    setState((s) => (s.centerId !== current.current ? s : { ...s, loading: on ? Array.from(new Set([...s.loading, key])) : s.loading.filter((item) => item !== key) }));

  const loadHood = useCallback(
    async (id: number, filters: string[] | null, limit: number) => {
      const scope = current.current;
      const key = hoodKey(id, filters);
      const isCenter = id === scope && !filters;
      setState((s) => (s.centerId !== scope ? s : { ...s, loading: Array.from(new Set([...s.loading, key])), failed: isCenter ? false : s.failed }));
      try {
        const hood = await pmNeighborhood(id, { demo, limit, filters });
        setState((s) => {
          if (s.centerId !== scope) return s;
          const loading = s.loading.filter((item) => item !== key);
          if (!hood) return { ...s, loading, failed: isCenter ? true : s.failed };
          return { ...s, loading, hoods: { ...s.hoods, [key]: hood } };
        });
      } catch {
        setState((s) => (s.centerId !== scope ? s : { ...s, loading: s.loading.filter((item) => item !== key), failed: isCenter ? true : s.failed }));
      }
    },
    [demo],
  );

  // (Re)start when the actor changes
  useEffect(() => {
    current.current = centerId;
    setState(initial(centerId));
    void loadHood(centerId, null, ACTOR_CENTER_LIMIT);
  }, [centerId, loadHood]);

  /** A question about a party: its neighbours via one filter (the scene draws the three most specific). */
  const ask = useCallback(
    (id: number, filter: string) => {
      setState((s) => ({
        ...s,
        asked: { ...s.asked, [id]: Array.from(new Set([...(s.asked[id] ?? []), filter])) },
        latest: { kind: "ask", id },
      }));
      if (!stateRef.current.hoods[hoodKey(id, [filter])]) void loadHood(id, [filter], ACTOR_ASK_LIMIT);
    },
    [loadHood],
  );

  /** Routes from the actor to other parties; returns how many were drawn. */
  const addRoutes = useCallback(
    async (key: string, to: number[], options: { maxHops: number; limit: number; max: number }) => {
      const scope = current.current;
      const targets = Array.from(new Set(to.filter((id) => id !== scope))).slice(0, 40);
      if (targets.length === 0) return 0;
      if (stateRef.current.routes[key]) {
        setState((s) => ({ ...s, latest: { kind: "routes", key } }));
        return stateRef.current.routes[key].routes.length;
      }
      setLoading(key, true);
      try {
        const result = await pmPaths([scope], targets, { demo, maxHops: options.maxHops, limit: options.limit });
        if (!result?.routes.length || current.current !== scope) return 0;
        const picked = pickRoutes(result, options.max);
        setState((s) =>
          s.centerId !== scope
            ? s
            : { ...s, routes: { ...s.routes, [key]: picked }, routeKeys: [...s.routeKeys, key], latest: { kind: "routes", key } },
        );
        return picked.routes.length;
      } finally {
        setLoading(key, false);
      }
    },
    [demo],
  );

  /** "Zoek verband met …" */
  const connectTo = useCallback(
    (targetId: number) => addRoutes(`pair:${targetId}`, [targetId], { maxHops: 3, limit: ACTOR_PAIR_ROUTES, max: ACTOR_PAIR_ROUTES }),
    [addRoutes],
  );

  /** Routes to the people and organisations that are in the news together with the actor */
  const connectNews = useCallback(
    (targetIds: number[]) =>
      addRoutes(`news:${targetIds.slice().sort((a, b) => a - b).join(",")}`, targetIds, { maxHops: 3, limit: 1, max: ACTOR_NEWS_ROUTES }),
    [addRoutes],
  );

  const routeResults = useMemo(() => state.routeKeys.map((key) => state.routes[key]).filter(Boolean), [state.routeKeys, state.routes]);
  const merged = useMemo(() => mergeNeighborhoods(Object.values(state.hoods), routeResults), [state.hoods, routeResults]);
  const routes = useMemo(() => routeParts(routeResults), [routeResults]);
  const asked = useMemo(() => new Map(Object.entries(state.asked).map(([id, filters]) => [Number(id), new Set(filters)])), [state.asked]);
  /** Counts per filter of a party (from any loaded neighbourhood of it) */
  const countsOf = useCallback(
    (id: number) => Object.values(state.hoods).find((hood) => hood.center.id === id && hood.filter_counts)?.filter_counts ?? null,
    [state.hoods],
  );

  return {
    merged,
    asked,
    routeNodes: routes.nodes,
    routeRelations: routes.relations,
    /** Route results in the order they were added (for the list of routes) */
    routeResults,
    latest: state.latest,
    latestRoutes: state.latest?.kind === "routes" ? state.routes[state.latest.key] ?? null : null,
    countsOf,
    /** All relations of a party in the model (from its complete neighbourhood, when loaded) */
    totalOf: (id: number) => state.hoods[hoodKey(id, null)]?.total ?? null,
    /** Counts for a party's questions: one cheap call (cached) */
    peek: (id: number) => {
      if (countsOf(id) || state.loading.includes(hoodKey(id, null))) return;
      void loadHood(id, null, 1);
    },
    isLoading: (id: number) => state.loading.some((key) => key === String(id) || key.startsWith(`${id}:`)),
    loadingAny: state.loading.length > 0,
    failed: state.failed,
    ready: Boolean(state.hoods[hoodKey(centerId, null)]),
    ask,
    connectTo,
    connectNews,
    retry: () => void loadHood(centerId, null, ACTOR_CENTER_LIMIT),
  };
}

export type ActorExplorer = ReturnType<typeof useActorExplorer>;
