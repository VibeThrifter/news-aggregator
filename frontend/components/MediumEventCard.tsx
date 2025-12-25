"use client";

import Link from "next/link";
import Image from "next/image";

import { EventListItem } from "@/lib/types";
import { getCategoryForEventType } from "@/lib/categories";
import { resolveEventSlug } from "@/lib/format";

export interface MediumEventCardProps {
  event: EventListItem;
  imageUrl?: string | null;
}

export function MediumEventCard({ event, imageUrl }: MediumEventCardProps) {
  const detailHref = resolveEventSlug(event);
  const category = getCategoryForEventType(event.event_type);

  return (
    <Link href={detailHref} className="group block">
      <article className="flex gap-4 py-4 border-b border-paper-300">
        {/* Thumbnail */}
        <div className="relative w-32 h-24 flex-shrink-0 overflow-hidden rounded-sm bg-paper-200">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="128px"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-paper-200 to-paper-300" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <span className="text-category uppercase tracking-wider text-accent-red">
            {category.label}
          </span>
          <h3 className="mt-1 font-serif text-headline-md text-ink-900 leading-snug line-clamp-2 group-hover:underline decoration-1 underline-offset-2">
            {event.title}
          </h3>
          <p className="mt-1 text-xs text-ink-400">
            {event.article_count} bronnen
          </p>
        </div>
      </article>
    </Link>
  );
}

export default MediumEventCard;
