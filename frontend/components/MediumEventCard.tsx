"use client";

import Link from "next/link";
import Image from "next/image";

import { EventListItem } from "@/lib/types";
import { resolveEventSlug } from "@/lib/format";

import { EventByline, eventCategory } from "./EventMeta";

export interface MediumEventCardProps {
  event: EventListItem;
  imageUrl?: string | null;
}

/** A top story next to the large one: photo, headline and who brought it. */
export function MediumEventCard({ event, imageUrl }: MediumEventCardProps) {
  const detailHref = resolveEventSlug(event);
  const category = eventCategory(event.event_type);

  return (
    <Link
      href={detailHref}
      className="group flex gap-4 border-b border-paper-200 py-4 first:pt-0 last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
    >
      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-2xl bg-paper-200 sm:h-24 sm:w-32">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            sizes="128px"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-paper-200 to-paper-300" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        {category ? <p className={`text-xs font-semibold ${category.color}`}>{category.label}</p> : null}
        <h3 className="line-clamp-3 font-serif text-[17px] font-bold leading-snug text-ink-900 decoration-1 underline-offset-2 group-hover:underline">
          {event.title}
        </h3>
        <EventByline event={event} />
      </div>
    </Link>
  );
}

export default MediumEventCard;
