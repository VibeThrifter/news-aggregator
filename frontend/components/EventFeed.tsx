"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";

import { ApiClientError, EventListFilters, listEvents } from "@/lib/api";
import { DEFAULT_CATEGORY, getCategoryLabel } from "@/lib/categories";

import CategoryNav from "./CategoryNav";
import DateRangeFilter from "./DateRangeFilter";
import EventCard from "./EventCard";
import HeroEventCard from "./HeroEventCard";
import MediumEventCard from "./MediumEventCard";
import NewsSidebar from "./NewsSidebar";
import BestGelezen from "./BestGelezen";
import MinSourcesFilter from "./MinSourcesFilter";
import SearchBar from "./SearchBar";
import { SOCIAL_MEDIA_SOURCES, SourceFilter, SourceInfo } from "./SourceFilter";

// Default to last 7 days
function getDefaultDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
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
          className="animate-pulse rounded-sm border border-paper-300 bg-paper-50 p-6 shadow-card-light"
        >
          <div className="flex flex-col gap-4">
            <div className="space-y-3">
              <span className="block h-4 w-24 rounded-sm bg-paper-200" aria-hidden="true" />
              <span className="block h-6 w-3/4 rounded-sm bg-paper-200" aria-hidden="true" />
              <span className="block h-4 w-1/2 rounded-sm bg-paper-200" aria-hidden="true" />
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block h-6 w-24 rounded-sm bg-paper-200" aria-hidden="true" />
              <span className="inline-block h-6 w-20 rounded-sm bg-paper-200" aria-hidden="true" />
              <span className="inline-block h-6 w-28 rounded-sm bg-paper-200" aria-hidden="true" />
            </div>
            <span className="block h-4 w-32 rounded-sm bg-paper-200" aria-hidden="true" />
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
    <div className="rounded-sm border border-red-200 bg-red-50 p-6 text-red-700">
      <p className="text-sm font-medium">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-4 inline-flex items-center gap-2 rounded-sm border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRetrying ? (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent"
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
    <div className="rounded-sm border border-paper-300 bg-paper-50 p-6 text-center text-ink-600">
      <p className="text-sm font-medium">{message}</p>
      <p className="mt-1 text-sm text-ink-500">{hint}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        {searchQuery && !isSearchingAllPeriods && onSearchAllPeriods && (
          <button
            type="button"
            onClick={onSearchAllPeriods}
            className="inline-flex items-center justify-center rounded-sm border border-accent-blue bg-blue-50 px-4 py-2 text-sm font-medium text-accent-blue transition-colors hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2"
          >
            Zoek in alle periodes
          </button>
        )}
        {searchQuery && onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="inline-flex items-center justify-center rounded-sm border border-paper-300 bg-paper-100 px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2"
          >
            Wis zoekopdracht
          </button>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center rounded-sm border border-paper-300 bg-paper-100 px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2"
        >
          Ververs feed
        </button>
      </div>
    </div>
  );
}

type EventFeedResponse = Awaited<ReturnType<typeof listEvents>>;

// Build a stable SWR key from filters
function buildSwrKey(filters: EventListFilters): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
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
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [searchAllPeriods, setSearchAllPeriods] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());

  // Build filters object for server-side query
  const filters: EventListFilters = useMemo(() => ({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    category: activeCategory,
    minSources,
    search: searchQuery,
    searchAllPeriods,
    includeWithoutInsights: adminMode,
  }), [dateRange, activeCategory, minSources, searchQuery, searchAllPeriods, adminMode]);

  // SWR key changes when filters change, triggering a new fetch
  const swrKey = useMemo(() => buildSwrKey(filters), [filters]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<EventFeedResponse>(
    swrKey,
    () => listEvents(filters),
    {
      revalidateOnFocus: true, // Refresh when returning from admin page
    },
  );

  // Extract all unique sources from all events for the filter
  const availableSources: SourceInfo[] = useMemo(() => {
    const sourceMap = new Map<string, number>();
    for (const event of data?.data ?? []) {
      for (const entry of event.source_breakdown ?? []) {
        const current = sourceMap.get(entry.source) ?? 0;
        sourceMap.set(entry.source, current + entry.article_count);
      }
    }
    return Array.from(sourceMap.entries()).map(([name, articleCount]) => ({
      name,
      articleCount,
    }));
  }, [data?.data]);

  // Initialize selected sources when data loads (exclude commentary sources by default)
  const [hasInitializedSources, setHasInitializedSources] = useState(false);
  if (availableSources.length > 0 && selectedSources.size === 0 && !hasInitializedSources) {
    setSelectedSources(new Set(availableSources.filter((s) => !SOCIAL_MEDIA_SOURCES.has(s.name)).map((s) => s.name)));
    setHasInitializedSources(true);
  }

  // Filter events by selected sources (client-side)
  const events = useMemo(() => {
    const allEvents = data?.data ?? [];
    // If no sources selected or all sources selected, show all events
    if (selectedSources.size === 0 || selectedSources.size === availableSources.length) {
      return allEvents;
    }
    // Filter events that have at least one article from a selected source
    return allEvents.filter((event) =>
      (event.source_breakdown ?? []).some((entry) => selectedSources.has(entry.source))
    );
  }, [data?.data, selectedSources, availableSources.length]);

  const errorMessage = error ? resolveErrorMessage(error) : null;

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

  const handleStartDateChange = useCallback((value: string | null) => {
    setDateRange((prev) => ({
      ...prev,
      startDate: value ?? "",
    }));
  }, []);

  const handleEndDateChange = useCallback((value: string | null) => {
    setDateRange((prev) => ({
      ...prev,
      endDate: value ?? "",
    }));
  }, []);

  const handleAdminModeToggle = useCallback(() => {
    setAdminMode((prev) => !prev);
  }, []);

  const handleSourceSelectionChange = useCallback((sources: Set<string>) => {
    setSelectedSources(sources);
  }, []);

  // Split events for different layout sections
  const heroEvent = events[0];
  const mediumEvents = events.slice(1, 7);  // 6 medium cards
  const sidebarEvents = events.slice(7, 14); // 7 sidebar items
  const remainingEvents = events.slice(14);

  return (
    <div className="space-y-4">
      {/* Category Navigation */}
      <CategoryNav activeCategory={activeCategory} />

      {/* Search Bar and Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-paper-200 pb-4">
        <SearchBar
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Zoek in events..."
          className="sm:max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <DateRangeFilter
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            onStartDateChange={handleStartDateChange}
            onEndDateChange={handleEndDateChange}
          />
          <span className="hidden sm:block text-paper-300">|</span>
          <MinSourcesFilter
            value={minSources}
            onChange={handleMinSourcesChange}
          />
          <span className="hidden sm:block text-paper-300">|</span>
          <SourceFilter
            sources={availableSources}
            selectedSources={selectedSources}
            onSelectionChange={handleSourceSelectionChange}
          />
          <button
            type="button"
            onClick={handleAdminModeToggle}
            className={`text-sm transition-colors ${
              adminMode
                ? "text-accent-orange font-medium"
                : "text-ink-400 hover:text-ink-700"
            }`}
            title="Toon ook events zonder LLM analyse"
          >
            {adminMode ? "● admin" : "admin"}
          </button>
        </div>
      </div>

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
          <div className="space-y-10">
            {/* Topverhalen Section - Volkskrant-style 3-column layout */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-ink-900 border-b-2 border-ink-900 pb-2 mb-6">
                Topverhalen
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Hero Event + Best Gelezen below */}
                <div className="lg:col-span-5">
                  {heroEvent && (
                    <HeroEventCard event={heroEvent} imageUrl={heroEvent.featured_image_url} />
                  )}
                  <BestGelezen events={events} />
                </div>

                {/* Middle: Medium Cards */}
                <div className="lg:col-span-4">
                  {mediumEvents.map((event) => (
                    <MediumEventCard key={event.id} event={event} imageUrl={event.featured_image_url} />
                  ))}
                </div>

                {/* Right: Sidebar */}
                <aside className="lg:col-span-3">
                  <NewsSidebar events={sidebarEvents} />
                </aside>
              </div>
            </section>

            {/* Meer nieuws Section */}
            {remainingEvents.length > 0 && (
              <section>
                <h2 className="font-serif text-2xl font-bold text-ink-900 border-b-2 border-ink-900 pb-2 mb-6">
                  Meer nieuws
                </h2>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {remainingEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
