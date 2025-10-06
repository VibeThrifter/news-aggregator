"use client";

import Link from "next/link";
import { useMemo } from "react";

import { EventListItem, resolveEventExportUrl } from "@/lib/api";
import {
  SPECTRUM_STYLES,
  formatEventTimeframe,
  resolveEventSlug,
  resolveSpectrumBadges,
} from "@/lib/format";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});
const numberFormatter = new Intl.NumberFormat("nl-NL");

function buildSpectrumClassName(spectrumKey: string): string {
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
    SPECTRUM_STYLES[spectrumKey] ?? "border-slate-600 bg-slate-700 text-slate-200"
  }`;
}

export interface EventCardProps {
  event: EventListItem;
}

export function EventCard({ event }: EventCardProps) {
  const spectrumBadges = useMemo(
    () => resolveSpectrumBadges(event.spectrum_distribution),
    [event.spectrum_distribution],
  );

  const timeframeLabel = formatEventTimeframe(event.first_seen_at, event.last_updated_at);
  const lastUpdated = event.last_updated_at ? new Date(event.last_updated_at) : null;
  const csvHref = resolveEventExportUrl(event.id);
  const detailHref = resolveEventSlug(event);

  return (
    <article className="flex flex-col gap-6 rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-sm transition-shadow hover:shadow-md focus-within:shadow-md">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">Event</p>
          <h2 className="text-xl font-semibold text-slate-100 sm:text-2xl">{event.title}</h2>
          <p className="text-sm text-slate-300">{timeframeLabel}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-200">
          <span className="inline-block h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />
          {numberFormatter.format(event.article_count)} artikelen
        </div>
      </header>

      {event.description ? (
        <p className="text-sm leading-6 text-slate-300">{event.description}</p>
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
        <p className="text-sm text-slate-400">Bronverdeling wordt berekend zodra er meer gegevens beschikbaar zijn.</p>
      )}

      <footer className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400">
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
            className="inline-flex items-center justify-center rounded-full border border-slate-600 bg-slate-700/50 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Download CSV
          </a>
        </div>
      </footer>
    </article>
  );
}

export default EventCard;
