import type { EventListItem } from "@/lib/types";

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

/** Who brought the news, as in the head of the event page: "NOS en RTL Nieuws + 4 buitenlandse", "5 Nederlandse bronnen". */
export function outletsLine(dutch: string[], foreign: number): string {
  const names = dutch.length === 0 ? "" : dutch.length <= 2 ? dutch.join(" en ") : `${dutch.length} Nederlandse bronnen`;
  const abroad = foreign ? `${foreign} buitenlandse` : "";
  if (names && abroad) return `${names} + ${abroad}`;
  return names || (foreign ? `${foreign} buitenlandse bronnen` : "");
}

export function resolveEventSlug(event: Pick<EventListItem, "id" | "slug">): string {
  const slug = event.slug?.trim();
  if (slug) {
    return `/event/${encodeURIComponent(slug)}`;
  }
  return `/event/${encodeURIComponent(String(event.id))}`;
}

// Get label for spectrum score
export function getSpectrumLabel(score: number): string {
  if (score <= 2) return "Links";
  if (score <= 4) return "Centrum-Links";
  if (score <= 6) return "Centrum";
  if (score <= 8) return "Centrum-Rechts";
  return "Rechts";
}

// Alternative sources are shown in a separate row
export function isAlternativeSource(spectrum?: string | number | null): boolean {
  return spectrum === "alternative";
}

// Source name to domain mapping for favicon lookup
const SOURCE_DOMAINS: Record<string, string> = {
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
  "INDEPEN": "indepen.eu",
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
const COUNTRY_NAMES: Record<string, string> = {
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
 * Returns empty string if no valid country code provided.
 */
export function getCountryFlag(isoCode: string | null | undefined): string {
  if (!isoCode || isoCode.length !== 2) return "";
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
let regionNames: Intl.DisplayNames | null | undefined;

export function getCountryName(isoCode: string | null | undefined): string {
  if (!isoCode) return "Onbekend";
  const code = isoCode.toUpperCase();
  if (COUNTRY_NAMES[code]) {
    return COUNTRY_NAMES[code];
  }
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["nl"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
