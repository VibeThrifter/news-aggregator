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
  mainstream: "border-sky-300 bg-sky-50 text-sky-700",
  links: "border-blue-300 bg-blue-50 text-blue-700",
  rechts: "border-red-300 bg-red-50 text-red-700",
  alternatief: "border-purple-300 bg-purple-50 text-purple-700",
  overheid: "border-emerald-300 bg-emerald-50 text-emerald-700",
  sociale_media: "border-gray-300 bg-gray-50 text-gray-600",
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

export function getDomainFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return "bron";
  }
}

export function getFaviconUrl(url: string): string {
  const domain = getDomainFromUrl(url);
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

// Spectrum score mapping: 0 = far-left, 5 = center, 10 = far-right
// Numeric scores are used directly, string values are converted
export const SPECTRUM_SCORE: Record<string, number> = {
  // Legacy string mappings for backwards compatibility
  "center-left": 2,
  "center": 5,
  "center-right": 6,
  "right-leaning": 7,
  "right-wing": 9,
};

// Get spectrum score from value (handles both numeric and string)
export function getSpectrumScore(spectrum: string | number | null | undefined): number {
  if (spectrum === null || spectrum === undefined) return 5; // default center
  if (typeof spectrum === "number") return spectrum;
  return SPECTRUM_SCORE[spectrum] ?? 5;
}

// Get label for spectrum score
export function getSpectrumLabel(score: number): string {
  if (score <= 2) return "Links";
  if (score <= 4) return "Centrum-Links";
  if (score <= 6) return "Centrum";
  if (score <= 8) return "Centrum-Rechts";
  return "Rechts";
}

// For backwards compatibility - maps old string values to 0-10 positions
export const SPECTRUM_POSITION: Record<string, number> = SPECTRUM_SCORE;

// Alternative sources are shown in a separate row
export function isAlternativeSource(spectrum?: string | number | null): boolean {
  return spectrum === "alternative";
}

// Source name to domain mapping for favicon lookup
export const SOURCE_DOMAINS: Record<string, string> = {
  "NOS": "nos.nl",
  "NU.nl": "nu.nl",
  "AD": "ad.nl",
  "RTL Nieuws": "rtlnieuws.nl",
  "De Telegraaf": "telegraaf.nl",
  "de Volkskrant": "volkskrant.nl",
  "Trouw": "trouw.nl",
  "Het Parool": "parool.nl",
  "De Andere Krant": "deanderekrant.nl",
  "GeenStijl": "geenstijl.nl",
  "NineForNews": "ninefornews.nl",
  "NieuwRechts": "nieuwrechts.nl",
};

export function getSourceFaviconUrl(sourceName: string): string {
  const domain = SOURCE_DOMAINS[sourceName];
  if (domain) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  }
  // Fallback: try to construct domain from source name
  const normalizedName = sourceName.toLowerCase().replace(/\s+/g, "");
  return `https://www.google.com/s2/favicons?domain=${normalizedName}.nl&sz=32`;
}

// Country name mapping: ISO 3166-1 alpha-2 to Dutch name
export const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australië",
  BE: "België",
  BR: "Brazilië",
  CN: "China",
  DE: "Duitsland",
  EG: "Egypte",
  FR: "Frankrijk",
  GB: "Verenigd Koninkrijk",
  IL: "Israël",
  IN: "India",
  IR: "Iran",
  JP: "Japan",
  KR: "Zuid-Korea",
  MX: "Mexico",
  NL: "Nederland",
  PS: "Palestina",
  RU: "Rusland",
  SA: "Saoedi-Arabië",
  TR: "Turkije",
  UA: "Oekraïne",
  US: "Verenigde Staten",
  ZA: "Zuid-Afrika",
};

/**
 * Convert ISO 3166-1 alpha-2 country code to flag emoji.
 * Works by converting each letter to its regional indicator symbol.
 * Example: "US" -> "🇺🇸", "NL" -> "🇳🇱"
 */
export function getCountryFlag(isoCode: string | null | undefined): string {
  if (!isoCode || isoCode.length !== 2) return "🌍";
  const code = isoCode.toUpperCase();
  const OFFSET = 0x1F1E6 - 0x41; // Regional indicator starts at U+1F1E6, 'A' is U+0041
  return String.fromCodePoint(
    code.charCodeAt(0) + OFFSET,
    code.charCodeAt(1) + OFFSET
  );
}

/**
 * Get Dutch country name from ISO code.
 * Falls back to the ISO code itself if not found.
 */
export function getCountryName(isoCode: string | null | undefined): string {
  if (!isoCode) return "Onbekend";
  return COUNTRY_NAMES[isoCode.toUpperCase()] || isoCode.toUpperCase();
}
