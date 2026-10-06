"use client";

import { Favicon } from "@/components/explore/ui/primitives";
import { getCategoryForEventType, type CategoryConfig } from "@/lib/categories";
import { parseIsoDate } from "@/lib/format";
import type { EventListItem, EventSourceBreakdownEntry } from "@/lib/types";

/** Shared bits of the news cards on the front page: outlets, counts, time and category. */

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Dutch outlets first (most articles first), then foreign ones. */
export function eventOutlets(event: Pick<EventListItem, "source_breakdown">): EventSourceBreakdownEntry[] {
  return [...(event.source_breakdown ?? [])].sort(
    (a, b) => Number(Boolean(a.is_international)) - Number(Boolean(b.is_international)) || b.article_count - a.article_count,
  );
}

/** "NOS", "NOS en NU.nl", "NOS, NU.nl en 3 andere", plus "+ 2 buitenlandse" (like the event page). */
export function outletNames(outlets: EventSourceBreakdownEntry[]): string {
  const dutch = outlets.filter((outlet) => !outlet.is_international).map((outlet) => outlet.source);
  const foreign = outlets.length - dutch.length;
  const names =
    dutch.length <= 1
      ? (dutch[0] ?? "")
      : dutch.length === 2
        ? `${dutch[0]} en ${dutch[1]}`
        : dutch.length === 3
          ? `${dutch[0]}, ${dutch[1]} en ${dutch[2]}`
          : `${dutch[0]}, ${dutch[1]} en ${dutch.length - 2} andere`;
  if (!foreign) return names;
  return names ? `${names} + ${foreign} buitenlandse` : plural(foreign, "buitenlandse bron", "buitenlandse bronnen");
}

/** The category of an event; null for "Overig", a label that says nothing (like on the event page). */
export function eventCategory(eventType: string | null | undefined): CategoryConfig | null {
  const category = getCategoryForEventType(eventType);
  return category.slug === "other" ? null : category;
}

const clock = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });

/** "vandaag 21:10", "gisteren 18:33", "2 okt. 21:10" */
export function newsTime(iso?: string | null): string | null {
  const moment = parseIsoDate(iso);
  if (!moment) return null;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = clock.format(moment);
  if (moment.toDateString() === today.toDateString()) return `vandaag ${time}`;
  if (moment.toDateString() === yesterday.toDateString()) return `gisteren ${time}`;
  return `${date.format(moment)} ${time}`;
}

/** Overlapping favicons of the outlets that brought the news. */
export function OutletStack({
  outlets,
  max = 4,
  size = 18,
  ring = "border-paper-50",
}: {
  outlets: EventSourceBreakdownEntry[];
  max?: number;
  size?: number;
  /** Border colour that separates the icons: the background they sit on */
  ring?: string;
}) {
  if (outlets.length === 0) return null;
  return (
    <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
      {outlets.slice(0, max).map((outlet) => (
        <span key={outlet.source} title={outlet.source} className={`rounded-full border-2 bg-paper-50 ${ring}`}>
          <Favicon name={outlet.source} size={size} className="rounded-full" />
        </span>
      ))}
    </span>
  );
}

/** Under a headline: who brought it and how many articles there are. */
export function EventByline({ event, light = false }: { event: Pick<EventListItem, "source_breakdown" | "article_count">; light?: boolean }) {
  const outlets = eventOutlets(event);
  const text = [outletNames(outlets), plural(event.article_count, "artikel", "artikelen")].filter(Boolean).join(" · ");
  return (
    <div className={`flex min-w-0 items-center gap-2 text-xs ${light ? "text-white/85" : "text-ink-500"}`}>
      {/* Only Dutch outlets have known icons; foreign ones are counted in the text */}
      <OutletStack outlets={outlets.filter((outlet) => !outlet.is_international)} ring={light ? "border-white/0" : "border-paper-50"} />
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}
