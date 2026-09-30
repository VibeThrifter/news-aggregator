"use client";

import { useEffect, useState } from "react";
import useSWR, { type SWRConfiguration } from "swr";

import { getEntityResearch, requestEntityResearch } from "@/lib/api";
import { markRequested, POLLING_STATUSES, RESEARCH_POLL_MS, wasRequested } from "@/lib/explore/research";
import type { EntityResearch, EntityResearchKind } from "@/lib/types";

export interface ResearchLookup {
  /** false when the research functions do not exist yet (migration 006 not run) */
  available: boolean;
  row: EntityResearch | null;
}

const researchSwrOptions: SWRConfiguration<ResearchLookup> = {
  // Short dedupe: polling must be able to fetch again after a minute
  dedupingInterval: 20_000,
  revalidateOnFocus: false,
  revalidateIfStale: true,
  errorRetryCount: 1,
  refreshInterval: (latest) => (latest?.row && POLLING_STATUSES.has(latest.row.status) ? RESEARCH_POLL_MS : 0),
};

/**
 * Research status of a name (entity_research_status), polled every minute while it is queued or
 * running. With `request`, the name is requested automatically — once per browser session per key
 * and only when the research functions exist. Everything fails silently.
 */
export function useEntityResearch(options: {
  /** Keys to look up; the first one is requested */
  keys: string[];
  name: string;
  demo: boolean;
  request?: { kind: EntityResearchKind; eventSlug: string | null } | null;
}) {
  const { keys, name, demo, request } = options;
  const primary = keys[0] ?? null;
  const swrKey = primary ? ["entity-research", keys.join("|"), demo] : null;
  const { data, error, isLoading, mutate } = useSWR<ResearchLookup>(
    swrKey,
    async () => {
      const rows = await getEntityResearch(keys, { demo });
      if (rows === null) return { available: false, row: null };
      // Keys in order of preference
      const row = keys.map((key) => rows.find((candidate) => candidate.entity_key === key)).find(Boolean) ?? null;
      return { available: true, row };
    },
    researchSwrOptions,
  );
  const [requesting, setRequesting] = useState(false);

  const requestKind = request?.kind ?? null;
  const eventSlug = request?.eventSlug ?? null;
  useEffect(() => {
    if (!primary || !requestKind || !name.trim()) return;
    // Wait for the status: nothing is requested when the functions are missing
    if (!data || !data.available) return;
    if (wasRequested(primary)) return;
    markRequested(primary);
    setRequesting(true);
    requestEntityResearch(primary, name, requestKind, eventSlug, { demo })
      .then((result) => {
        if (result) void mutate();
      })
      .catch(() => {
        // Rate limit, cool-down or a network hiccup: the status block just shows what is known
      })
      .finally(() => setRequesting(false));
  }, [data, demo, eventSlug, mutate, name, primary, requestKind]);

  return {
    available: data ? data.available : !error,
    row: data?.row ?? null,
    loading: isLoading && !data,
    error: Boolean(error),
    requesting,
  };
}
