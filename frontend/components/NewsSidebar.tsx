"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { EventListItem } from "@/lib/types";
import { CompactEventCard } from "@/components/CompactEventCard";

export interface NewsSidebarProps {
  events: EventListItem[];
  title?: string;
  moreHref?: string;
}

export function NewsSidebar({ events, title = "NIEUWS", moreHref }: NewsSidebarProps) {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="bg-paper-50 border border-paper-300 rounded-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-paper-300">
        <h3 className="text-sm font-bold uppercase tracking-wider text-ink-900">
          {title}
        </h3>
        {moreHref && (
          <Link
            href={moreHref}
            className="flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900 transition-colors"
          >
            MEER
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {/* Event list */}
      <div className="divide-y divide-paper-200">
        {events.map((event) => (
          <CompactEventCard
            key={event.id}
            event={event}
            imageUrl={event.featured_image_url}
            showImage={true}
          />
        ))}
      </div>
    </div>
  );
}

export default NewsSidebar;
