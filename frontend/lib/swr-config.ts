/**
 * SWR Configuration for caching.
 *
 * Story 4 (INFRA): Frontend Caching Layer
 *
 * Cache TTLs:
 * - Event list: 5 minutes (news doesn't change that fast)
 */

import type { SWRConfiguration } from "swr";

/** Cache duration in milliseconds */
const CACHE_TTL = {
  /** Event list: 5 minutes */
  EVENT_LIST: 5 * 60 * 1000,
} as const;

/**
 * SWR options for event list queries.
 *
 * - dedupingInterval: Prevents duplicate requests within 5 minutes
 * - revalidateOnFocus: true - Refresh when user returns to tab
 * - revalidateIfStale: true - Background revalidation for stale data
 */
export const eventListSwrOptions: SWRConfiguration = {
  dedupingInterval: CACHE_TTL.EVENT_LIST,
  revalidateOnFocus: true,
  revalidateIfStale: true,
  // Don't automatically refresh - user can pull-to-refresh
  refreshInterval: 0,
};

/**
 * Epic 11 (Onderzoeksmodus): one fetch per event page (core query + entities/relations/bias).
 * 2 minutes: articles can be added while an event is running.
 */
export const exploreSwrOptions: SWRConfiguration = {
  dedupingInterval: 2 * 60 * 1000,
  revalidateOnFocus: false,
  revalidateIfStale: true,
  refreshInterval: 0,
  errorRetryCount: 2,
};

/** Entity appearances and other auxiliary lookups: 10 minutes. */
export const exploreAuxSwrOptions: SWRConfiguration = {
  dedupingInterval: 10 * 60 * 1000,
  revalidateOnFocus: false,
  revalidateIfStale: false,
  refreshInterval: 0,
  errorRetryCount: 1,
};

/** Wikipedia summaries hardly change: 24 hours, no retries. */
export const wikipediaSwrOptions: SWRConfiguration = {
  dedupingInterval: 24 * 60 * 60 * 1000,
  revalidateOnFocus: false,
  revalidateIfStale: false,
  refreshInterval: 0,
  shouldRetryOnError: false,
};
