"use client";

import Link from "next/link";
import Image from "next/image";

import { EventListItem } from "@/lib/api";
import { resolveEventSlug } from "@/lib/format";
import { SpectrumBar } from "@/components/SpectrumBar";

import { EventByline, eventCategory, newsTime } from "./EventMeta";

export interface EventCardProps {
  event: EventListItem;
  imageUrl?: string | null;
}

/** A news item in the grid of the front page; the whole card opens the event. */
export function EventCard({ event, imageUrl }: EventCardProps) {
  const detailHref = resolveEventSlug(event);
  const category = eventCategory(event.event_type);
  const time = newsTime(event.last_updated_at);
  // Where the outlets stand only says something when there are at least two Dutch ones
  const dutch = (event.source_breakdown ?? []).filter((entry) => !entry.is_international).length;

  return (
    <Link
      href={detailHref}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 transition-shadow hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
    >
      {imageUrl ? (
        <div className="relative aspect-[16/9] bg-paper-200">
          <Image src={imageUrl} alt="" fill className="object-cover" sizes="(max-width: 768px) 100vw, 33vw" />
        </div>
      ) : null}

      <article className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          {category ? (
            <span
              className={`rounded-full border px-2 py-0.5 font-semibold ${category.color} ${category.bgColor} ${category.borderColor}`}
              data-testid="category-badge"
            >
              {category.label}
            </span>
          ) : null}
          {time ? <time dateTime={event.last_updated_at ?? undefined}>{time}</time> : null}
        </div>

        {event.has_llm_insights ? (
          <h3 className="line-clamp-3 font-serif text-lg font-bold leading-snug text-ink-900 decoration-1 underline-offset-2 group-hover:underline">
            {event.title}
          </h3>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-500">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Wacht op analyse</span>
            Nieuwsitem {event.id}
          </p>
        )}

        <div className="mt-auto space-y-3 pt-1">
          {dutch >= 2 ? <SpectrumBar sourceBreakdown={event.source_breakdown} compact /> : null}
          <EventByline event={event} />
        </div>
      </article>
    </Link>
  );
}

export default EventCard;
