"use client";

import Link from "next/link";
import Image from "next/image";

import { EventListItem } from "@/lib/types";
import { getCategoryForEventType } from "@/lib/categories";
import { resolveEventSlug, parseIsoDate } from "@/lib/format";

const timeFormatter = new Intl.DateTimeFormat("nl-NL", {
  hour: "2-digit",
  minute: "2-digit",
});

export interface CompactEventCardProps {
  event: EventListItem;
  imageUrl?: string | null;
  showImage?: boolean;
}

export function CompactEventCard({ event, imageUrl, showImage = true }: CompactEventCardProps) {
  const detailHref = resolveEventSlug(event);
  const category = getCategoryForEventType(event.event_type);
  const lastUpdated = parseIsoDate(event.last_updated_at);
  const timeLabel = lastUpdated ? timeFormatter.format(lastUpdated) : null;

  return (
    <Link href={detailHref} className="group block">
      <article className="flex items-start gap-3 py-3 px-4 hover:bg-paper-100 transition-colors">
        {/* Timestamp */}
        {timeLabel && (
          <time className="text-xs text-ink-400 w-12 flex-shrink-0 pt-0.5">
            {timeLabel}
          </time>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent-red">
            {category.label}
          </span>
          <h4 className="mt-0.5 text-sm font-medium text-ink-900 leading-snug line-clamp-2 group-hover:underline decoration-1 underline-offset-1">
            {event.title}
          </h4>
        </div>

        {/* Small thumbnail */}
        {showImage && (
          <div className="relative w-16 h-12 flex-shrink-0 overflow-hidden rounded-sm bg-paper-200">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt=""
                fill
                className="object-cover"
                sizes="64px"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-paper-200 to-paper-300" />
            )}
          </div>
        )}
      </article>
    </Link>
  );
}

export default CompactEventCard;
