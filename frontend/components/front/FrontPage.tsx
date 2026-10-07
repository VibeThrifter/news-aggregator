"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { PILL } from "@/components/explore/ui/primitives";
import { groupByDay, pickTopStories, type NewsDay } from "@/lib/front-page";
import type { EventListItem } from "@/lib/types";

import { LeadStory, StoryCard, TopStory } from "./StoryCards";

/** News items per day before "Nog n nieuwsitems" */
const PER_DAY = 6;

/**
 * The front page: the lead with "Wie zegt wat?", two more top stories, then the news per day.
 * `leadPool`: where the top stories come from (the first page, so loading more keeps the lead).
 */
export function FrontPage({ events, leadPool = events }: { events: EventListItem[]; leadPool?: EventListItem[] }) {
  const { top, days } = useMemo(() => {
    const top = pickTopStories(leadPool, leadPool.length >= 6 ? 3 : 1);
    const topIds = new Set(top.map((event) => event.id));
    return { top, days: groupByDay(events.filter((event) => !topIds.has(event.id))) };
  }, [events, leadPool]);
  const [lead, ...next] = top;

  return (
    <div className="space-y-12">
      <section aria-label="Topverhalen" className="space-y-5">
        {lead ? <LeadStory event={lead} /> : null}
        {next.length ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {next.map((event) => (
              <TopStory key={event.id} event={event} />
            ))}
          </div>
        ) : null}
      </section>
      {days.map((day) => (
        <DaySection key={day.key} day={day} />
      ))}
    </div>
  );
}

function DaySection({ day }: { day: NewsDay<EventListItem> }) {
  const [all, setAll] = useState(false);
  const shown = all ? day.events : day.events.slice(0, PER_DAY);
  const rest = day.events.length - shown.length;
  return (
    <section aria-labelledby={`dag-${day.key}`}>
      <h2 id={`dag-${day.key}`} className="mb-4 font-serif text-2xl font-bold text-ink-900">
        {day.label}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((event) => (
          <StoryCard key={event.id} event={event} />
        ))}
      </div>
      {rest > 0 ? (
        <button type="button" onClick={() => setAll(true)} className={`${PILL} mt-4`}>
          Nog {rest} {rest === 1 ? "nieuwsitem" : "nieuwsitems"} <ChevronDown size={16} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
