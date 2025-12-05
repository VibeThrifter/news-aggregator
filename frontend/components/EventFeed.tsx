"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";

import { ApiClientError, EventFeedMeta, listEvents } from "@/lib/api";
import { DEFAULT_CATEGORY, getCategoryLabel } from "@/lib/categories";

import CategoryNav from "./CategoryNav";
import EventCard from "./EventCard";
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
}

function EmptyState({ onRetry, categoryLabel, searchQuery, onClearSearch }: EmptyStateProps) {
  let message: string;
  let hint: string;

  if (searchQuery) {
    message = `Geen events gevonden voor "${searchQuery}".`;
    hint = categoryLabel
      ? "Probeer een andere zoekterm of wis de zoekfilter."
      : "Probeer een andere zoekterm.";
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
      <div className="mt-4 flex items-center justify-center gap-3">
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

const EVENTS_ENDPOINT = "/api/v1/events";

export default function EventFeed() {
  const searchParams = useSearchParams();
  const activeCategory = searchParams.get("category") ?? DEFAULT_CATEGORY;
  const [searchQuery, setSearchQuery] = useState("");

  const { data, error, isLoading, isValidating, mutate } = useSWR<EventFeedResponse>(
    EVENTS_ENDPOINT,
    () => listEvents(),
    {
      revalidateOnFocus: false,
    },
  );

  const normalisedMeta = normaliseMeta((data?.meta as EventFeedMeta | undefined) ?? undefined);

  // Memoize allEvents to avoid changing reference on every render
  const allEvents = useMemo(() => data?.data ?? [], [data?.data]);

  // Filter events by category and search query (client-side filtering)
  const filteredEvents = useMemo(() => {
    let events = allEvents;

    // Filter by category
    if (activeCategory !== DEFAULT_CATEGORY) {
      events = events.filter((event) => event.event_type === activeCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      events = events.filter((event) => {
        const title = event.title?.toLowerCase() ?? "";
        const summary = event.summary?.toLowerCase() ?? "";
        return title.includes(query) || summary.includes(query);
      });
    }

    return events;
  }, [allEvents, activeCategory, searchQuery]);

  const errorMessage = error ? resolveErrorMessage(error) : null;
  const totalEvents = normalisedMeta.totalEvents ?? allEvents.length;
  const filteredCount = filteredEvents.length;

  // Get label for empty state
  const activeCategoryLabel =
    activeCategory !== DEFAULT_CATEGORY ? getCategoryLabel(activeCategory) : undefined;

  const handleRefresh = useCallback(() => {
    void mutate(undefined, { revalidate: true });
  }, [mutate]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  return (
    <div className="space-y-6">
      {/* Category Navigation */}
      <CategoryNav activeCategory={activeCategory} />

      {/* Search Bar */}
      <SearchBar
        value={searchQuery}
        onChange={handleSearchChange}
        placeholder="Zoek in events..."
      />

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
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            onRetry={handleRefresh}
            categoryLabel={activeCategoryLabel}
            searchQuery={searchQuery.trim() || undefined}
            onClearSearch={() => setSearchQuery("")}
          />
        ) : (
          <div className="grid gap-6">
            {filteredEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
