"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { STORE_KEY, useExploreStore } from "./store";

/** Rehydrate the persisted exploration store once on the client; true when done. */
export function useExploreHydration(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const unsubscribe = useExploreStore.persist.onFinishHydration(() => setHydrated(true));
    if (useExploreStore.persist.hasHydrated()) {
      setHydrated(true);
    } else {
      void useExploreStore.persist.rehydrate();
    }
    // Keep tabs in sync
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORE_KEY) {
        void useExploreStore.persist.rehydrate();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return hydrated;
}

/** matchMedia as state (false during SSR). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
export const useFinePointer = () => useMediaQuery("(hover: hover) and (pointer: fine)");
export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

const PANEL_STATE_KEY = "__explorePanel";

/**
 * A panel (sheet) whose state lives in the URL (?p=...), so the browser back button and the
 * Android back gesture close it. Uses history.pushState, which Next 14.1+ keeps in sync with
 * useSearchParams without a server round trip.
 */
export function useUrlPanel() {
  const searchParams = useSearchParams();
  const panel = searchParams?.get("p") ?? null;

  const buildUrl = useCallback((mutate: (params: URLSearchParams) => void) => {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    mutate(params);
    const query = params.toString();
    return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  }, []);

  const open = useCallback(
    (next: string, extra: Record<string, string | null> = {}) => {
      const url = buildUrl((params) => {
        params.set("p", next);
        for (const [key, value] of Object.entries(extra)) {
          if (value === null) params.delete(key);
          else params.set(key, value);
        }
      });
      const alreadyInPanel = Boolean(window.history.state?.[PANEL_STATE_KEY]);
      // Only pass our own key: Next.js adds its internal state itself. Copying window.history.state
      // (which contains Next's __NA marker) would make Next treat this as its own navigation and
      // skip syncing useSearchParams.
      const state = { [PANEL_STATE_KEY]: true };
      if (alreadyInPanel) {
        window.history.replaceState(state, "", url);
      } else {
        window.history.pushState(state, "", url);
      }
    },
    [buildUrl],
  );

  const close = useCallback(() => {
    if (window.history.state?.[PANEL_STATE_KEY]) {
      window.history.back();
      return;
    }
    const url = buildUrl((params) => {
      params.delete("p");
      params.delete("c");
    });
    window.history.replaceState({}, "", url);
  }, [buildUrl]);

  const param = useCallback((key: string) => searchParams?.get(key) ?? null, [searchParams]);

  return { panel, open, close, param };
}
