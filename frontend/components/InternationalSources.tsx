"use client";

import { ExternalLink, Globe } from "lucide-react";
import { useMemo } from "react";

import type { EventArticle } from "@/lib/types";
import { getCountryFlag, getCountryName, parseIsoDate } from "@/lib/format";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface InternationalSourcesProps {
  articles: EventArticle[];
}

function getSourceFavicon(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return "";
  }
}

export function InternationalSources({ articles }: InternationalSourcesProps) {
  // Filter to only international articles (don't require source_country)
  const internationalArticles = useMemo(
    () => articles.filter((a) => a.is_international),
    [articles]
  );

  if (internationalArticles.length === 0) {
    return null; // Don't show section if no international articles
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-serif text-2xl font-bold text-ink-900">
          <Globe className="h-6 w-6 text-accent-blue" />
          Internationale perspectieven ({internationalArticles.length})
        </h2>
        <p className="mt-1 text-sm text-ink-600">
          Artikelen van internationale bronnen over hetzelfde nieuwsverhaal.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {internationalArticles.map((article) => {
          const published = parseIsoDate(article.published_at);
          const favicon = getSourceFavicon(article.url);
          const flag = getCountryFlag(article.source_country);

          return (
            <a
              key={article.id}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col overflow-hidden rounded-lg border border-paper-200 bg-white shadow-sm transition-all hover:border-accent-blue/50 hover:shadow-md"
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
                {/* Header with favicon, source and flag */}
                <div className="flex items-center gap-1.5">
                  {favicon && (
                    <img
                      src={favicon}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded"
                      loading="lazy"
                    />
                  )}
                  <span className="text-xs font-medium uppercase tracking-wider text-ink-500 leading-tight">
                    {article.source}
                    {flag && <span className="ml-1 text-sm align-middle" title={getCountryName(article.source_country)}>{flag}</span>}
                  </span>
                </div>

                {/* Title */}
                <h3 className="flex-1 text-sm font-semibold leading-snug text-ink-900 group-hover:text-accent-blue transition-colors">
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

    </section>
  );
}
