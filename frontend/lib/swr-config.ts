/**
 * SWR Configuration for caching.
 *
 * Story 4 (INFRA): Frontend Caching Layer
 *
 * Cache TTLs:
 * - Event list: 5 minutes (news doesn't change that fast)
 * - Event detail: 1 minute (may get new articles)
 * - Insights: 5 minutes (regeneration is manual)
 */

import type { SWRConfiguration } from "swr";

/** Cache duration in milliseconds */
export const CACHE_TTL = {
  /** Event list: 5 minutes */
  EVENT_LIST: 5 * 60 * 1000,
  /** Event detail: 1 minute */
  EVENT_DETAIL: 1 * 60 * 1000,
  /** Insights: 5 minutes (regeneration is manual) */
  INSIGHTS: 5 * 60 * 1000,
  /** Admin data: 30 seconds */
  ADMIN: 30 * 1000,
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
 * SWR options for event detail queries.
 *
 * - dedupingInterval: Prevents duplicate requests within 1 minute
 * - revalidateOnFocus: false - Don't refresh on tab focus (detail is stable)
 */
export const eventDetailSwrOptions: SWRConfiguration = {
  dedupingInterval: CACHE_TTL.EVENT_DETAIL,
  revalidateOnFocus: false,
  revalidateIfStale: true,
  refreshInterval: 0,
};

/**
 * SWR options for insights queries.
 *
 * - dedupingInterval: 5 minutes (insights are manually regenerated)
 * - revalidateOnFocus: false - Don't refresh on tab focus
 */
export const insightsSwrOptions: SWRConfiguration = {
  dedupingInterval: CACHE_TTL.INSIGHTS,
  revalidateOnFocus: false,
  revalidateIfStale: true,
  refreshInterval: 0,
};

/**
 * SWR options for admin pages.
 *
 * - Shorter cache for admin responsiveness
 * - revalidateOnFocus: true - Always show fresh data
 */
export const adminSwrOptions: SWRConfiguration = {
  dedupingInterval: CACHE_TTL.ADMIN,
  revalidateOnFocus: true,
  revalidateIfStale: true,
  refreshInterval: 0,
};
