"use client";

import { useCallback } from "react";
import useSWR from "swr";

import { ApiClientError, EventFeedMeta, listEvents } from "@/lib/api";

import EventCard from "./EventCard";
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
          className="animate-pulse rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-col gap-4">
            <div className="space-y-3">
              <span className="block h-4 w-24 rounded-full bg-slate-200" aria-hidden="true" />
              <span className="block h-6 w-3/4 rounded-full bg-slate-200" aria-hidden="true" />
              <span className="block h-4 w-1/2 rounded-full bg-slate-200" aria-hidden="true" />
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block h-6 w-24 rounded-full bg-slate-200" aria-hidden="true" />
              <span className="inline-block h-6 w-20 rounded-full bg-slate-200" aria-hidden="true" />
              <span className="inline-block h-6 w-28 rounded-full bg-slate-200" aria-hidden="true" />
            </div>
            <span className="block h-4 w-32 rounded-full bg-slate-200" aria-hidden="true" />
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
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
      <p className="text-sm font-medium">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:border-rose-400 hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRetrying ? (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-rose-500 border-t-transparent"
          />
        ) : null}
        Probeer opnieuw
      </button>
    </div>
  );
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-600">
      <p className="text-sm font-medium">Er zijn nog geen events beschikbaar.</p>
      <p className="mt-1 text-sm">Controleer later opnieuw of forceer een nieuwe ingest-run.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        Ververs feed
      </button>
    </div>
  );
}

type EventFeedResponse = Awaited<ReturnType<typeof listEvents>>;

const EVENTS_ENDPOINT = "/api/v1/events";

export default function EventFeed() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<EventFeedResponse>(
    EVENTS_ENDPOINT,
    () => listEvents(),
    {
      revalidateOnFocus: false,
    },
  );

  const normalisedMeta = normaliseMeta((data?.meta as EventFeedMeta | undefined) ?? undefined);
  const events = data?.data ?? [];
  const errorMessage = error ? resolveErrorMessage(error) : null;
  const totalEvents = normalisedMeta.totalEvents ?? events.length;

  const handleRefresh = useCallback(() => {
    void mutate(undefined, { revalidate: true });
  }, [mutate]);

  return (
    <div className="space-y-6">
      <StatusBanner
        lastUpdated={normalisedMeta.lastUpdated ?? null}
        llmProvider={normalisedMeta.llmProvider ?? null}
        totalEvents={totalEvents}
        isLoading={isLoading && !data}
        isRefreshing={isValidating && Boolean(data)}
        onRefresh={handleRefresh}
        error={errorMessage}
      />

      {errorMessage ? (
        <ErrorState message={errorMessage} onRetry={handleRefresh} isRetrying={isValidating} />
      ) : isLoading && !data ? (
        <LoadingSkeleton />
      ) : events.length === 0 ? (
        <EmptyState onRetry={handleRefresh} />
      ) : (
        <div className="grid gap-6">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
