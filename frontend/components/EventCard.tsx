"use client";

import Link from "next/link";

import { EventListItem } from "@/lib/api";
import { getCategoryForEventType } from "@/lib/categories";
import {
  formatEventTimeframe,
  resolveEventSlug,
} from "@/lib/format";
import { SpectrumBar } from "@/components/SpectrumBar";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});
const numberFormatter = new Intl.NumberFormat("nl-NL");

export interface EventCardProps {
  event: EventListItem;
}

export function EventCard({ event }: EventCardProps) {
  const timeframeLabel = formatEventTimeframe(event.first_seen_at, event.last_updated_at);
  const lastUpdated = event.last_updated_at ? new Date(event.last_updated_at) : null;
  const detailHref = resolveEventSlug(event);
  const category = getCategoryForEventType(event.event_type);

  return (
    <article className="flex flex-col gap-6 rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-sm transition-shadow hover:shadow-md focus-within:shadow-md">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${category.color} ${category.bgColor} ${category.borderColor}`}
              data-testid="category-badge"
            >
              {category.label}
            </span>
          </div>
          <p className="text-sm text-slate-300">{timeframeLabel}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-200">
          <span className="inline-block h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />
          {numberFormatter.format(event.article_count)} artikelen
        </div>
      </header>

      <div className="space-y-2">
        {event.has_llm_insights ? (
          <>
            <h2 className="text-lg font-semibold text-slate-100">
              {event.title}
            </h2>
            {event.description ? (
              <p className="text-sm leading-relaxed text-slate-300">{event.description}</p>
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
              Wacht op analyse
            </span>
            <span className="text-sm text-slate-400">Event #{event.id}</span>
          </div>
        )}
      </div>

      <SpectrumBar sourceBreakdown={event.source_breakdown} compact />

      <footer className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400">
          {lastUpdated ? `Laatst bijgewerkt ${dateTimeFormatter.format(lastUpdated)}` : "Laatste update onbekend"}
        </p>
        <Link
          href={detailHref}
          className="inline-flex items-center justify-center rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Bekijk event
        </Link>
      </footer>
    </article>
  );
}

export default EventCard;
