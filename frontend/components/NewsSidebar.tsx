"use client";

import { EventListItem } from "@/lib/types";
import { CompactEventCard } from "@/components/CompactEventCard";

export interface NewsSidebarProps {
  events: EventListItem[];
  title?: string;
}

/** The column with more headlines next to the top stories. */
export function NewsSidebar({ events, title = "Nieuws" }: NewsSidebarProps) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section aria-label={title} className="overflow-hidden rounded-2xl border border-paper-300 bg-paper-50">
      <h3 className="px-4 pb-1 pt-4 font-serif text-lg font-bold text-ink-900">{title}</h3>
      <div className="divide-y divide-paper-200">
        {events.map((event) => (
          <CompactEventCard key={event.id} event={event} imageUrl={event.featured_image_url} showImage />
        ))}
      </div>
    </section>
  );
}

export default NewsSidebar;
