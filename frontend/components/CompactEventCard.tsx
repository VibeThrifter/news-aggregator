"use client";

import Link from "next/link";
import Image from "next/image";

import { EventListItem } from "@/lib/types";
import { parseIsoDate, resolveEventSlug } from "@/lib/format";

import { eventCategory } from "./EventMeta";

const timeFormatter = new Intl.DateTimeFormat("nl-NL", {
  hour: "2-digit",
  minute: "2-digit",
});

export interface CompactEventCardProps {
  event: EventListItem;
  imageUrl?: string | null;
  showImage?: boolean;
}

/** One line in the news column: time, headline and a small photo. */
export function CompactEventCard({ event, imageUrl, showImage = true }: CompactEventCardProps) {
  const detailHref = resolveEventSlug(event);
  const category = eventCategory(event.event_type);
  const lastUpdated = parseIsoDate(event.last_updated_at);
  const timeLabel = lastUpdated ? timeFormatter.format(lastUpdated) : null;

  return (
    <Link href={detailHref} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-paper-100">
      {timeLabel ? <time className="w-10 shrink-0 pt-0.5 text-xs tabular-nums text-ink-400">{timeLabel}</time> : null}

      <div className="min-w-0 flex-1">
        {category ? <p className={`text-xs font-semibold ${category.color}`}>{category.label}</p> : null}
        <h4 className="line-clamp-3 text-sm font-semibold leading-snug text-ink-900 decoration-1 underline-offset-2 group-hover:underline">
          {event.title}
        </h4>
      </div>

      {showImage ? (
        <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-xl bg-paper-200">
          {imageUrl ? (
            <Image src={imageUrl} alt="" fill className="object-cover" sizes="64px" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-paper-200 to-paper-300" />
          )}
        </div>
      ) : null}
    </Link>
  );
}

export default CompactEventCard;
