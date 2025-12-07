"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";

import { ApiClientError, EventFeedMeta, EventListFilters, listEvents } from "@/lib/api";
import { DEFAULT_CATEGORY, getCategoryLabel } from "@/lib/categories";

import CategoryNav from "./CategoryNav";
import DaysBackFilter from "./DaysBackFilter";
import EventCard from "./EventCard";
import MinSourcesFilter from "./MinSourcesFilter";
import SearchBar from "./SearchBar";
import StatusBanner from "./StatusBanner";

interface NormalisedMeta {
  lastUpdated?: string | null;
  llmProvider?: string | null;
  totalEvents?: number | null;
}

function pickString(meta: EventFeedMeta, keys: string[]): string | null {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function pickNumber(meta: EventFeedMeta, keys: string[]): number | null {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function normaliseMeta(meta: EventFeedMeta | undefined): NormalisedMeta {
  if (!meta) {
    return {};
  }

  const lastUpdated = pickString(meta, [
    "last_updated_at",
    "last_updated",
    "last_refresh_at",
    "generated_at",
  ]);

  const llmProvider = pickString(meta, ["llm_provider", "active_provider", "provider"]);
  const totalEvents = pickNumber(meta, ["total_events", "event_count", "total"]);

  return {
    lastUpdated,
    llmProvider,
    totalEvents,
  };
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.payload?.message ?? `API-fout (${error.status})`;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Kon de eventfeed niet laden.";
}

function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-6">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-sm"
        >
          <div className="flex flex-col gap-4">
            <div className="space-y-3">
              <span className="block h-4 w-24 rounded-full bg-slate-700" aria-hidden="true" />
              <span className="block h-6 w-3/4 rounded-full bg-slate-700" aria-hidden="true" />
              <span className="block h-4 w-1/2 rounded-full bg-slate-700" aria-hidden="true" />
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block h-6 w-24 rounded-full bg-slate-700" aria-hidden="true" />
              <span className="inline-block h-6 w-20 rounded-full bg-slate-700" aria-hidden="true" />
              <span className="inline-block h-6 w-28 rounded-full bg-slate-700" aria-hidden="true" />
            </div>
            <span className="block h-4 w-32 rounded-full bg-slate-700" aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}

function ErrorState({ message, onRetry, isRetrying }: ErrorStateProps) {
  return (
    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-rose-200">
      <p className="text-sm font-medium">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-rose-400/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition-colors hover:bg-rose-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRetrying ? (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-rose-400 border-t-transparent"
          />
        ) : null}
        Probeer opnieuw
      </button>
    </div>
  );
}

interface EmptyStateProps {
  onRetry: () => void;
  categoryLabel?: string;
  searchQuery?: string;
  onClearSearch?: () => void;
  onSearchAllPeriods?: () => void;
  isSearchingAllPeriods?: boolean;
}

function EmptyState({
  onRetry,
  categoryLabel,
  searchQuery,
  onClearSearch,
  onSearchAllPeriods,
  isSearchingAllPeriods,
}: EmptyStateProps) {
  let message: string;
  let hint: string;

  if (searchQuery) {
    if (isSearchingAllPeriods) {
      message = `Geen events gevonden voor "${searchQuery}" in alle periodes.`;
      hint = "Probeer een andere zoekterm.";
    } else {
      message = `Geen events gevonden voor "${searchQuery}" in deze periode.`;
      hint = "Zoek in alle periodes of probeer een andere zoekterm.";
    }
  } else if (categoryLabel) {
    message = `Geen events in de categorie "${categoryLabel}".`;
    hint = "Probeer een andere categorie of bekijk alle events.";
  } else {
    message = "Er zijn nog geen events beschikbaar.";
    hint = "Controleer later opnieuw of forceer een nieuwe ingest-run.";
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center text-slate-300">
      <p className="text-sm font-medium">{message}</p>
      <p className="mt-1 text-sm">{hint}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        {searchQuery && !isSearchingAllPeriods && onSearchAllPeriods && (
          <button
            type="button"
            onClick={onSearchAllPeriods}
            className="inline-flex items-center justify-center rounded-full border border-brand-500/60 bg-brand-500/10 px-4 py-2 text-sm font-semibold text-brand-300 transition-colors hover:bg-brand-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Zoek in alle periodes
          </button>
        )}
        {searchQuery && onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="inline-flex items-center justify-center rounded-full border border-slate-600 bg-slate-700/50 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Wis zoekopdracht
          </button>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center rounded-full border border-slate-600 bg-slate-700/50 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Ververs feed
        </button>
      </div>
    </div>
  );
}

type EventFeedResponse = Awaited<ReturnType<typeof listEvents>>;

const DEFAULT_DAYS_BACK = 7;

// Build a stable SWR key from filters
function buildSwrKey(filters: EventListFilters): string {
  const params = new URLSearchParams();
  if (filters.daysBack !== undefined) params.set("days", String(filters.daysBack));
  if (filters.category && filters.category !== "all") params.set("category", filters.category);
  if (filters.minSources !== undefined && filters.minSources > 1) params.set("minSources", String(filters.minSources));
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.searchAllPeriods) params.set("allPeriods", "true");
  if (filters.includeWithoutInsights) params.set("admin", "true");
  return `/api/events?${params.toString()}`;
}

export default function EventFeed() {
  const searchParams = useSearchParams();
  const activeCategory = searchParams.get("category") ?? DEFAULT_CATEGORY;
  const [searchQuery, setSearchQuery] = useState("");
  const [minSources, setMinSources] = useState(1);
  const [daysBack, setDaysBack] = useState(DEFAULT_DAYS_BACK);
  const [searchAllPeriods, setSearchAllPeriods] = useState(false);
  const [adminMode, setAdminMode] = useState(false);

  // Build filters object for server-side query
  const filters: EventListFilters = useMemo(() => ({
    daysBack,
    category: activeCategory,
    minSources,
    search: searchQuery,
    searchAllPeriods,
    includeWithoutInsights: adminMode,
  }), [daysBack, activeCategory, minSources, searchQuery, searchAllPeriods, adminMode]);

  // SWR key changes when filters change, triggering a new fetch
  const swrKey = useMemo(() => buildSwrKey(filters), [filters]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<EventFeedResponse>(
    swrKey,
    () => listEvents(filters),
    {
      revalidateOnFocus: false,
    },
  );

  const normalisedMeta = normaliseMeta((data?.meta as EventFeedMeta | undefined) ?? undefined);

  // Events are already filtered server-side, no client-side filtering needed
  const events = useMemo(() => data?.data ?? [], [data?.data]);

  const errorMessage = error ? resolveErrorMessage(error) : null;
  const totalEvents = normalisedMeta.totalEvents ?? events.length;
  const eventCount = events.length;

  // Get label for empty state
  const activeCategoryLabel =
    activeCategory !== DEFAULT_CATEGORY ? getCategoryLabel(activeCategory) : undefined;

  const handleRefresh = useCallback(() => {
    void mutate(undefined, { revalidate: true });
  }, [mutate]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    // Reset searchAllPeriods when search query changes
    if (searchAllPeriods) {
      setSearchAllPeriods(false);
    }
  }, [searchAllPeriods]);

  const handleSearchAllPeriods = useCallback(() => {
    setSearchAllPeriods(true);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchAllPeriods(false);
  }, []);

  const handleMinSourcesChange = useCallback((value: number) => {
    setMinSources(value);
  }, []);

  const handleDaysBackChange = useCallback((value: number) => {
    setDaysBack(value);
  }, []);

  const handleAdminModeToggle = useCallback(() => {
    setAdminMode((prev) => !prev);
  }, []);

  return (
    <div className="space-y-6">
      {/* Category Navigation */}
      <CategoryNav activeCategory={activeCategory} />

      {/* Search Bar and Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <SearchBar
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Zoek in events..."
          className="flex-1"
        />
        <div className="flex items-center gap-4">
          <DaysBackFilter
            value={daysBack}
            onChange={handleDaysBackChange}
          />
          <MinSourcesFilter
            value={minSources}
            onChange={handleMinSourcesChange}
          />
          <button
            type="button"
            onClick={handleAdminModeToggle}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              adminMode
                ? "border-amber-500/60 bg-amber-500/20 text-amber-300"
                : "border-slate-600 bg-slate-700/50 text-slate-400 hover:text-slate-300"
            }`}
            title="Toon ook events zonder LLM analyse"
          >
            Admin
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <StatusBanner
        lastUpdated={normalisedMeta.lastUpdated ?? null}
        llmProvider={normalisedMeta.llmProvider ?? null}
        totalEvents={totalEvents}
        isLoading={isLoading && !data}
        isRefreshing={isValidating && Boolean(data)}
        onRefresh={handleRefresh}
        error={errorMessage}
      />

      {/* Event Feed */}
      <div id="event-feed" role="tabpanel" aria-label="Event feed">
        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={handleRefresh} isRetrying={isValidating} />
        ) : isLoading && !data ? (
          <LoadingSkeleton />
        ) : events.length === 0 ? (
          <EmptyState
            onRetry={handleRefresh}
            categoryLabel={activeCategoryLabel}
            searchQuery={searchQuery.trim() || undefined}
            onClearSearch={handleClearSearch}
            onSearchAllPeriods={handleSearchAllPeriods}
            isSearchingAllPeriods={searchAllPeriods}
          />
        ) : (
          <div className="grid gap-6">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
