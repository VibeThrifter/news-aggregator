"use client";

import Link from "next/link";
import Image from "next/image";

import { EventListItem } from "@/lib/types";
import { resolveEventSlug } from "@/lib/format";

import { EventByline, eventCategory } from "./EventMeta";

export interface HeroEventCardProps {
  event: EventListItem;
  imageUrl?: string | null;
}

/** The first news item of the front page, large with its photo. */
export function HeroEventCard({ event, imageUrl }: HeroEventCardProps) {
  const detailHref = resolveEventSlug(event);
  const category = eventCategory(event.event_type);

  return (
    <Link href={detailHref} className="group block rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue">
      <article className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-ink-800">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            sizes="(max-width: 1024px) 100vw, 40vw"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-ink-600 to-ink-900" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 space-y-3 p-5 sm:p-6">
          {category ? (
            <span className="inline-flex rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
              {category.label}
            </span>
          ) : null}
          <h2 className="line-clamp-3 font-serif text-2xl font-bold leading-tight text-white decoration-1 underline-offset-4 group-hover:underline sm:text-[28px]">
            {event.title}
          </h2>
          <EventByline event={event} light />
        </div>
      </article>
    </Link>
  );
}

export default HeroEventCard;
