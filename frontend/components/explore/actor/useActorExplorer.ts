"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { pmNeighborhood } from "@/lib/api";
import { mergeNeighborhoods } from "@/lib/explore/pm-graph";
import type { PmNeighborhood } from "@/lib/types";

/** Neighbours per expansion (the most informative first); the RPC caps at 60 */
export const ACTOR_EXPAND_LIMIT = 30;

interface ExplorerState {
  centerId: number;
  /** Full (unfiltered) neighbourhoods by entity id */
  hoods: Record<number, PmNeighborhood>;
  expanded: number[];
  loading: number[];
  failed: boolean;
  /** Last expansion (the view glides to it) */
  latest: number | null;
}

const initial = (centerId: number): ExplorerState => ({ centerId, hoods: {}, expanded: [], loading: [], failed: false, latest: null });

/**
 * Explorer of one actor's ego-network, scoped to the actor page: local state only (the event
 * network keeps its own session store). Loads the actor's neighbourhood and grows on "Breid uit".
 */
export function useActorExplorer(centerId: number, demo: boolean) {
  const [state, setState] = useState<ExplorerState>(() => initial(centerId));
  const current = useRef(centerId);
  const hoodsRef = useRef(state.hoods);
  hoodsRef.current = state.hoods;

  const load = useCallback(
    async (id: number, isCenter: boolean) => {
      const scope = current.current;
      setState((s) => (s.centerId !== scope ? s : { ...s, loading: Array.from(new Set([...s.loading, id])), failed: isCenter ? false : s.failed }));
      try {
        const hood = await pmNeighborhood(id, { demo, limit: ACTOR_EXPAND_LIMIT });
        setState((s) => {
          if (s.centerId !== scope) return s;
          const loading = s.loading.filter((item) => item !== id);
          if (!hood) return { ...s, loading, failed: isCenter ? true : s.failed };
          return {
            ...s,
            loading,
            hoods: { ...s.hoods, [id]: hood },
            expanded: s.expanded.includes(id) ? s.expanded : [...s.expanded, id],
            latest: isCenter ? s.latest : id,
          };
        });
      } catch {
        setState((s) => (s.centerId !== scope ? s : { ...s, loading: s.loading.filter((item) => item !== id), failed: isCenter ? true : s.failed }));
      }
    },
    [demo],
  );

  // (Re)start when the actor changes
  useEffect(() => {
    current.current = centerId;
    setState(initial(centerId));
    void load(centerId, true);
  }, [centerId, load]);

  const expand = useCallback(
    (id: number) => {
      if (hoodsRef.current[id]) {
        setState((s) => (s.expanded.includes(id) ? s : { ...s, expanded: [...s.expanded, id], latest: id }));
        return;
      }
      void load(id, id === current.current);
    },
    [load],
  );

  const merged = useMemo(() => mergeNeighborhoods(Object.values(state.hoods)), [state.hoods]);
  const expanded = useMemo(() => new Set(state.expanded), [state.expanded]);

  return {
    merged,
    hoods: state.hoods,
    expanded,
    latest: state.latest,
    isLoading: (id: number) => state.loading.includes(id),
    loadingAny: state.loading.length > 0,
    failed: state.failed,
    ready: Boolean(state.hoods[centerId]),
    expand,
    retry: () => void load(centerId, true),
  };
}

export type ActorExplorer = ReturnType<typeof useActorExplorer>;
