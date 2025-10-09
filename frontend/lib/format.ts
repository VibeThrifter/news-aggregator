import type { EventListItem, SpectrumDistribution } from "@/lib/types";

export type SpectrumBadge = {
  key: string;
  label: string;
  count: number;
};

export const SPECTRUM_LABELS: Record<string, string> = {
  mainstream: "Mainstream",
  links: "Links",
  rechts: "Rechts",
  alternatief: "Alternatief",
  overheid: "Overheid",
  sociale_media: "Sociale media",
};

export const SPECTRUM_STYLES: Record<string, string> = {
  mainstream: "border-sky-500/60 bg-sky-500/10 text-sky-200",
  links: "border-rose-500/60 bg-rose-500/10 text-rose-200",
  rechts: "border-amber-500/60 bg-amber-500/10 text-amber-200",
  alternatief: "border-purple-500/60 bg-purple-500/10 text-purple-200",
  overheid: "border-emerald-500/60 bg-emerald-500/10 text-emerald-200",
  sociale_media: "border-slate-600 bg-slate-700 text-slate-200",
};

const dateRangeFormatter = new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});
const timeFormatter = new Intl.DateTimeFormat("nl-NL", { timeStyle: "short" });

export function parseIsoDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEventTimeframe(firstSeen?: string | null, lastUpdated?: string | null): string {
  const start = parseIsoDate(firstSeen);
  const end = parseIsoDate(lastUpdated);

  if (!start && !end) {
    return "Tijdframe onbekend";
  }

  if (start && !end) {
    return `Vanaf ${dateRangeFormatter.format(start)}`;
  }

  if (!start && end) {
    return `Laatste update ${dateTimeFormatter.format(end)}`;
  }

  if (!start || !end) {
    return "Tijdframe onbekend";
  }

  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${dateRangeFormatter.format(start)} · ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
  }

  return `${dateRangeFormatter.format(start)} – ${dateRangeFormatter.format(end)} · ${timeFormatter.format(end)}`;
}

export function resolveSpectrumBadges(distribution?: SpectrumDistribution | null): SpectrumBadge[] {
  if (!distribution) {
    return [];
  }

  if (Array.isArray(distribution)) {
    return distribution
      .filter((entry) => entry && typeof entry.count === "number" && entry.count > 0)
      .map((entry) => ({
        key: entry.spectrum,
        label: SPECTRUM_LABELS[entry.spectrum] ?? entry.spectrum,
        count: entry.count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  return Object.entries(distribution)
    .map(([key, value]) => {
      if (typeof value === "number") {
        return { key, label: SPECTRUM_LABELS[key] ?? key, count: value };
      }

      if (value && typeof value === "object" && "count" in value && typeof value.count === "number") {
        return { key, label: SPECTRUM_LABELS[key] ?? key, count: value.count };
      }

      return null;
    })
    .filter((entry): entry is SpectrumBadge => entry !== null && entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function resolveEventSlug(event: Pick<EventListItem, "id" | "slug">): string {
  const slug = event.slug?.trim();
  if (slug) {
    return `/event/${encodeURIComponent(slug)}`;
  }
  return `/event/${encodeURIComponent(String(event.id))}`;
}
