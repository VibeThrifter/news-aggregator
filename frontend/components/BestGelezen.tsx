"use client";

import Link from "next/link";

import { EventListItem } from "@/lib/types";
import { resolveEventSlug } from "@/lib/format";

import { eventCategory, eventOutlets, plural } from "./EventMeta";

export interface BestGelezenProps {
  events: EventListItem[];
  maxItems?: number;
}

/**
 * The news items with the most articles. Reading figures are not known, so the list is called
 * "Meest besproken": what the media wrote most about.
 */
export function BestGelezen({ events, maxItems = 5 }: BestGelezenProps) {
  const sortedEvents = [...events].sort((a, b) => b.article_count - a.article_count).slice(0, maxItems);

  if (sortedEvents.length === 0) {
    return null;
  }

  return (
    <section aria-label="Meest besproken" className="mt-6 overflow-hidden rounded-2xl border border-paper-300 bg-paper-50">
      <h3 className="px-4 pb-1 pt-4 font-serif text-lg font-bold text-ink-900">Meest besproken</h3>
      <ol className="divide-y divide-paper-200">
        {sortedEvents.map((event, index) => {
          const category = eventCategory(event.event_type);
          const outlets = eventOutlets(event).length;
          return (
            <li key={event.id}>
              <Link href={resolveEventSlug(event)} className="group flex items-start gap-4 px-4 py-3 transition-colors hover:bg-paper-100">
                <span className="w-6 shrink-0 font-serif text-2xl font-bold leading-none text-ink-200">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <h4 className="line-clamp-2 text-sm font-semibold leading-snug text-ink-900 decoration-1 underline-offset-2 group-hover:underline">
                    {event.title}
                  </h4>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {category ? <span className={`font-semibold ${category.color}`}>{category.label} · </span> : null}
                    {plural(event.article_count, "artikel", "artikelen")}
                    {outlets > 1 ? ` · ${plural(outlets, "bron", "bronnen")}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default BestGelezen;
