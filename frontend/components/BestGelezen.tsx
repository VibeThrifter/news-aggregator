"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { EventListItem } from "@/lib/types";
import { getCategoryForEventType } from "@/lib/categories";
import { resolveEventSlug } from "@/lib/format";

export interface BestGelezenProps {
  events: EventListItem[];
  maxItems?: number;
}

export function BestGelezen({ events, maxItems = 5 }: BestGelezenProps) {
  // Sort by article count (proxy for popularity)
  const sortedEvents = [...events]
    .sort((a, b) => b.article_count - a.article_count)
    .slice(0, maxItems);

  if (sortedEvents.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 bg-paper-100 border border-paper-300 rounded-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-paper-300">
        <h3 className="text-sm font-bold uppercase tracking-wider text-ink-900">
          BEST GELEZEN
        </h3>
        <Link
          href="/"
          className="flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900 transition-colors"
        >
          MEER
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Numbered list */}
      <ol className="divide-y divide-paper-200">
        {sortedEvents.map((event, index) => {
          const category = getCategoryForEventType(event.event_type);
          const detailHref = resolveEventSlug(event);

          return (
            <li key={event.id}>
              <Link
                href={detailHref}
                className="flex items-start gap-4 p-4 hover:bg-paper-50 transition-colors group"
              >
                {/* Large number */}
                <span className="font-serif text-3xl font-bold text-ink-200 leading-none w-8 flex-shrink-0">
                  {index + 1}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent-red">
                    {category.label}
                  </span>
                  <h4 className="mt-1 text-sm font-medium text-ink-900 leading-snug line-clamp-2 group-hover:underline decoration-1 underline-offset-1">
                    {event.title}
                  </h4>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default BestGelezen;
