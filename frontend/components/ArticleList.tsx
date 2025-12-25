"use client";

import { ExternalLink } from "lucide-react";

import type { EventArticle } from "@/lib/types";
import { SPECTRUM_LABELS, SPECTRUM_STYLES, parseIsoDate, getSpectrumScore, getSpectrumLabel } from "@/lib/format";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface ArticleListProps {
  articles: EventArticle[];
}

function buildSpectrumClassName(spectrum?: string | number | null): string {
  const base = "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium";

  if (spectrum === null || spectrum === undefined) {
    return `${base} border-gray-300 bg-gray-100 text-gray-600`;
  }

  // For numeric scores, use gradient based on position (0-10 scale)
  if (typeof spectrum === "number") {
    if (spectrum <= 3) {
      return `${base} border-blue-300 bg-blue-50 text-blue-700`;
    } else if (spectrum <= 6) {
      return `${base} border-gray-300 bg-gray-100 text-gray-700`;
    } else {
      return `${base} border-red-300 bg-red-50 text-red-700`;
    }
  }

  return `${base} ${SPECTRUM_STYLES[spectrum] ?? "border-gray-300 bg-gray-100 text-gray-600"}`;
}

function getSpectrumDisplayLabel(spectrum?: string | number | null): string | null {
  if (spectrum === null || spectrum === undefined) return null;
  if (typeof spectrum === "number") {
    return getSpectrumLabel(spectrum);
  }
  return SPECTRUM_LABELS[spectrum] ?? spectrum;
}

function getSourceFavicon(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return "";
  }
}

export function ArticleList({ articles }: ArticleListProps) {
  if (!articles.length) {
    return (
      <div className="rounded-lg border border-paper-200 bg-paper-50 p-6 text-sm text-ink-500">
        Nog geen artikelen gekoppeld aan dit event.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {articles.map((article) => {
        const published = parseIsoDate(article.published_at);
        const spectrumLabel = getSpectrumDisplayLabel(article.spectrum);
        const favicon = getSourceFavicon(article.url);

        return (
          <a
            key={article.id}
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col overflow-hidden rounded-lg border border-paper-200 bg-white shadow-sm transition-all hover:border-paper-300 hover:shadow-md"
          >
            {/* Article image */}
            {article.image_url && (
              <div className="relative aspect-video w-full overflow-hidden bg-paper-100">
                <img
                  src={article.image_url}
                  alt=""
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              </div>
            )}
            {/* Card content */}
            <div className="flex flex-1 flex-col gap-3 p-4">
              {/* Header with favicon and source */}
              <div className="flex items-center gap-2">
                {favicon && (
                  <img
                    src={favicon}
                    alt=""
                    className="h-4 w-4 rounded"
                    loading="lazy"
                  />
                )}
                <span className="text-xs font-medium uppercase tracking-wider text-ink-500">
                  {article.source}
                </span>
                <span className={buildSpectrumClassName(article.spectrum)}>
                  {spectrumLabel ?? "Onbekend"}
                </span>
              </div>

              {/* Title */}
              <h3 className="flex-1 text-sm font-semibold leading-snug text-ink-900 group-hover:text-accent-red transition-colors">
                {article.title}
              </h3>

              {/* Footer with date and external link icon */}
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>
                  {published ? dateTimeFormatter.format(published) : "Datum onbekend"}
                </span>
                <ExternalLink size={14} className="opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
