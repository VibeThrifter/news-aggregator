"use client";

import { getCategoryForEventType, type CategoryConfig } from "@/lib/categories";
import { parseIsoDate } from "@/lib/format";

/** Shared bits of the news cards on the front page: counts, time and category. */

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
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
