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
  if (spectrum === null || spectrum === undefined) {
    return "inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-700 px-3 py-1 text-xs font-medium text-slate-200";
  }

  // For numeric scores, use gradient based on position
  if (typeof spectrum === "number") {
    if (spectrum <= 3) {
      return "inline-flex items-center gap-1 rounded-full border border-blue-500/60 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-200";
    } else if (spectrum <= 6) {
      return "inline-flex items-center gap-1 rounded-full border border-slate-500/60 bg-slate-500/10 px-3 py-1 text-xs font-medium text-slate-200";
    } else {
      return "inline-flex items-center gap-1 rounded-full border border-red-500/60 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-200";
    }
  }

  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
    SPECTRUM_STYLES[spectrum] ?? "border-slate-600 bg-slate-700 text-slate-200"
  }`;
}

function getSpectrumDisplayLabel(spectrum?: string | number | null): string | null {
  if (spectrum === null || spectrum === undefined) return null;
  if (typeof spectrum === "number") {
    return `${getSpectrumLabel(spectrum)} (${spectrum})`;
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
      <div className="rounded-3xl border border-slate-700 bg-slate-800/70 p-6 text-sm text-slate-300">
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
            className="group flex flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800/80 shadow-sm transition-all hover:border-slate-600 hover:shadow-md"
          >
            {/* Article image */}
            {article.image_url && (
              <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
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
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {article.source}
                </span>
                <span className={buildSpectrumClassName(article.spectrum)}>
                  {spectrumLabel ?? "Onbekend"}
                </span>
              </div>

              {/* Title */}
              <h3 className="flex-1 text-sm font-semibold leading-snug text-slate-100 group-hover:text-brand-300 transition-colors">
                {article.title}
              </h3>

              {/* Footer with date and external link icon */}
              <div className="flex items-center justify-between text-xs text-slate-400">
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
