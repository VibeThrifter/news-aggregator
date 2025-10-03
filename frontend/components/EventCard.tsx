"use client";

import Link from "next/link";
import { useMemo } from "react";

import { EventListItem, SpectrumDistribution, resolveApiUrl } from "@/lib/api";

type SpectrumBadge = {
  key: string;
  label: string;
  count: number;
};

const dateRangeFormatter = new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});
const timeFormatter = new Intl.DateTimeFormat("nl-NL", { timeStyle: "short" });
const numberFormatter = new Intl.NumberFormat("nl-NL");

const SPECTRUM_LABELS: Record<string, string> = {
  mainstream: "Mainstream",
  links: "Links",
  rechts: "Rechts",
  alternatief: "Alternatief",
  overheid: "Overheid",
  sociale_media: "Sociale media",
};

const SPECTRUM_STYLES: Record<string, string> = {
  mainstream: "border-sky-200 bg-sky-50 text-sky-700",
  links: "border-rose-200 bg-rose-50 text-rose-700",
  rechts: "border-amber-200 bg-amber-50 text-amber-700",
  alternatief: "border-purple-200 bg-purple-50 text-purple-700",
  overheid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  sociale_media: "border-slate-300 bg-slate-100 text-slate-700",
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimeframe(firstSeen?: string | null, lastUpdated?: string | null): string {
  const start = parseDate(firstSeen);
  const end = parseDate(lastUpdated);

  if (!start && !end) {
    return "Tijdframe onbekend";
  }

  if (start && !end) {
    return `Vanaf ${dateRangeFormatter.format(start)}`;
  }

  if (!start && end) {
    return `Laatste update ${dateTimeFormatter.format(end)}`;
  }

  if (!start || !end) {
    return "Tijdframe onbekend";
  }

  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${dateRangeFormatter.format(start)} · ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
  }

  return `${dateRangeFormatter.format(start)} – ${dateRangeFormatter.format(end)} · ${timeFormatter.format(end)}`;
}

function normaliseSpectrumDistribution(distribution?: SpectrumDistribution | null): SpectrumBadge[] {
  if (!distribution) {
    return [];
  }

  if (Array.isArray(distribution)) {
    return distribution
      .filter((entry) => entry && typeof entry.count === "number" && entry.count > 0)
      .map((entry) => ({
        key: entry.spectrum,
        label: SPECTRUM_LABELS[entry.spectrum] ?? entry.spectrum,
        count: entry.count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  return Object.entries(distribution)
    .map(([key, value]) => {
      if (typeof value === "number") {
        return { key, label: SPECTRUM_LABELS[key] ?? key, count: value };
      }

      if (value && typeof value === "object" && "count" in value && typeof value.count === "number") {
        return { key, label: SPECTRUM_LABELS[key] ?? key, count: value.count };
      }

      return null;
    })
    .filter((entry): entry is SpectrumBadge => Boolean(entry) && entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

function resolveDetailHref(event: EventListItem): string {
  const slug = event.slug?.trim();
  if (slug) {
    return `/events/${encodeURIComponent(slug)}`;
  }
  return `/events/${encodeURIComponent(String(event.id))}`;
}

function resolveCsvHref(eventId: number): string {
  return resolveApiUrl(`/api/v1/exports/events/${encodeURIComponent(String(eventId))}`);
}

function buildSpectrumClassName(spectrumKey: string): string {
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
    SPECTRUM_STYLES[spectrumKey] ?? "border-slate-300 bg-slate-100 text-slate-700"
  }`;
}

export interface EventCardProps {
  event: EventListItem;
}

export function EventCard({ event }: EventCardProps) {
  const spectrumBadges = useMemo(
    () => normaliseSpectrumDistribution(event.spectrum_distribution),
    [event.spectrum_distribution],
  );

  const timeframeLabel = formatTimeframe(event.first_seen_at, event.last_updated_at);
  const lastUpdated = parseDate(event.last_updated_at ?? undefined);
  const csvHref = resolveCsvHref(event.id);
  const detailHref = resolveDetailHref(event);

  return (
    <article className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md focus-within:shadow-md">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Event</p>
          <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">{event.title}</h2>
          <p className="text-sm text-slate-600">{timeframeLabel}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
          <span className="inline-block h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />
          {numberFormatter.format(event.article_count)} artikelen
        </div>
      </header>

      {event.description ? (
        <p className="text-sm leading-6 text-slate-600">{event.description}</p>
      ) : null}

      {spectrumBadges.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Bronverdeling">
          {spectrumBadges.map((badge) => (
            <li key={badge.key}>
              <span className={buildSpectrumClassName(badge.key)}>
                <span>{badge.label}</span>
                <span className="font-semibold">{numberFormatter.format(badge.count)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Bronverdeling wordt berekend zodra er meer gegevens beschikbaar zijn.</p>
      )}

      <footer className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          {lastUpdated ? `Laatst bijgewerkt ${dateTimeFormatter.format(lastUpdated)}` : "Laatste update onbekend"}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={detailHref}
            className="inline-flex items-center justify-center rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Bekijk event
          </Link>
          <a
            href={csvHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Download CSV
          </a>
        </div>
      </footer>
    </article>
  );
}

export default EventCard;
