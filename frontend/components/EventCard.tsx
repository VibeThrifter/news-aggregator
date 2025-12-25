"use client";

import Link from "next/link";
import Image from "next/image";

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
  imageUrl?: string | null;
}

export function EventCard({ event, imageUrl }: EventCardProps) {
  const timeframeLabel = formatEventTimeframe(event.first_seen_at, event.last_updated_at);
  const lastUpdated = event.last_updated_at ? new Date(event.last_updated_at) : null;
  const detailHref = resolveEventSlug(event);
  const category = getCategoryForEventType(event.event_type);

  return (
    <article className="flex flex-col gap-4 rounded-sm border border-paper-300 bg-paper-50 p-5 shadow-card-light transition-shadow hover:shadow-md">
      {/* Optional image */}
      {imageUrl && (
        <div className="relative aspect-[16/9] -mx-5 -mt-5 mb-1 overflow-hidden rounded-t-sm">
          <Image
            src={imageUrl}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        </div>
      )}

      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${category.color} ${category.bgColor} ${category.borderColor}`}
              data-testid="category-badge"
            >
              {category.label}
            </span>
          </div>
          <p className="text-sm text-ink-500">{timeframeLabel}</p>
        </div>
        <div className="flex items-center gap-2 rounded-sm border border-paper-300 bg-paper-100 px-3 py-1.5 text-sm font-medium text-ink-700">
          <span className="inline-block h-2 w-2 rounded-full bg-accent-blue" aria-hidden="true" />
          {numberFormatter.format(event.article_count)} artikelen
        </div>
      </header>

      <div className="space-y-2">
        {event.has_llm_insights ? (
          <h2 className="font-serif text-headline-md text-ink-900">
            {event.title}
          </h2>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Wacht op analyse
            </span>
            <span className="text-sm text-ink-500">Event #{event.id}</span>
          </div>
        )}
      </div>

      <SpectrumBar sourceBreakdown={event.source_breakdown} compact />

      <footer className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-paper-200">
        <p className="text-xs text-ink-500">
          {lastUpdated ? `Laatst bijgewerkt ${dateTimeFormatter.format(lastUpdated)}` : "Laatste update onbekend"}
        </p>
        <Link
          href={detailHref}
          className="inline-flex items-center justify-center rounded-sm bg-ink-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2"
        >
          Bekijk event
        </Link>
      </footer>
    </article>
  );
}

export default EventCard;
