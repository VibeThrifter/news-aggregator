"use client";

import { useMemo } from "react";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});
const numberFormatter = new Intl.NumberFormat("nl-NL");

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface StatusMetricProps {
  label: string;
  value: string;
  isLoading?: boolean;
}

function StatusMetric({ label, value, isLoading }: StatusMetricProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      {isLoading ? (
        <span className="block h-4 w-28 animate-pulse rounded-full bg-slate-200" aria-hidden="true" />
      ) : (
        <p aria-live="polite" className="text-sm font-medium text-slate-700">
          {value}
        </p>
      )}
    </div>
  );
}

export interface StatusBannerProps {
  lastUpdated?: string | null;
  llmProvider?: string | null;
  totalEvents?: number | null;
  isLoading?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  error?: string | null;
}

export default function StatusBanner({
  lastUpdated,
  llmProvider,
  totalEvents,
  isLoading = false,
  isRefreshing = false,
  onRefresh,
  error,
}: StatusBannerProps) {
  const parsedDate = useMemo(() => parseDate(lastUpdated), [lastUpdated]);
  const providerLabel = llmProvider?.trim() || "Onbekend";
  const lastUpdatedLabel = parsedDate ? dateTimeFormatter.format(parsedDate) : "Niet beschikbaar";
  const totalEventsLabel = typeof totalEvents === "number" ? numberFormatter.format(totalEvents) : "—";

  const statusMessage = error
    ? error
    : "Eventfeed wordt automatisch ververst zodra nieuwe data beschikbaar is.";

  return (
    <section className="rounded-xl border border-slate-200 bg-white/80 px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Status</p>
          <p className={`text-sm ${error ? "text-rose-600" : "text-slate-600"}`}>{statusMessage}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatusMetric label="Laatste update" value={lastUpdatedLabel} isLoading={isLoading} />
          <StatusMetric label="Actieve LLM" value={providerLabel} isLoading={isLoading} />
          <StatusMetric label="Events in feed" value={totalEventsLabel} isLoading={isLoading} />
        </div>
      </div>
      {onRefresh ? (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading || isRefreshing}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            {isRefreshing ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
              />
            ) : null}
            Vernieuw feed
          </button>
          {isRefreshing ? (
            <span className="text-xs text-slate-500">Bezig met verversen…</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
