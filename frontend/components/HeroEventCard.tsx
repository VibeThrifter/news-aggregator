"use client";

import Link from "next/link";
import Image from "next/image";

import { EventListItem } from "@/lib/types";
import { getCategoryForEventType } from "@/lib/categories";
import { resolveEventSlug } from "@/lib/format";

export interface HeroEventCardProps {
  event: EventListItem;
  imageUrl?: string | null;
}

export function HeroEventCard({ event, imageUrl }: HeroEventCardProps) {
  const detailHref = resolveEventSlug(event);
  const category = getCategoryForEventType(event.event_type);

  return (
    <Link href={detailHref} className="group block">
      <article className="relative aspect-[4/3] overflow-hidden rounded-sm bg-paper-200">
        {/* Background image or gradient placeholder */}
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 40vw"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900" />
        )}

        {/* Dark gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {/* Content overlay */}
        <div className="absolute inset-x-0 bottom-0 p-6">
          <span className="text-category uppercase tracking-wider text-white/80">
            {category.label}
          </span>
          <h2 className="mt-2 font-serif text-headline-xl text-white leading-tight line-clamp-3 group-hover:underline decoration-1 underline-offset-2">
            {event.title}
          </h2>
          <p className="mt-3 text-sm text-white/70">
            {event.article_count} bronnen
          </p>
        </div>
      </article>
    </Link>
  );
}

export default HeroEventCard;
