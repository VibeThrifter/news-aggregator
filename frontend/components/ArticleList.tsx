"use client";

import { ExternalLink } from "lucide-react";

import type { EventArticle } from "@/lib/types";
import { SPECTRUM_LABELS, SPECTRUM_STYLES, parseIsoDate } from "@/lib/format";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface ArticleListProps {
  articles: EventArticle[];
}

function buildSpectrumClassName(spectrum?: string | null): string {
  if (!spectrum) {
    return "inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-700 px-3 py-1 text-xs font-medium text-slate-200";
  }

  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
    SPECTRUM_STYLES[spectrum] ?? "border-slate-600 bg-slate-700 text-slate-200"
  }`;
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
    <div className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-800/80 shadow-sm">
      <ul className="divide-y divide-slate-700">
        {articles.map((article) => {
          const published = parseIsoDate(article.published_at);
          const spectrumLabel = article.spectrum ? SPECTRUM_LABELS[article.spectrum] ?? article.spectrum : null;

          return (
            <li key={article.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-base font-semibold text-brand-400 transition hover:text-brand-300"
                  >
                    <ExternalLink size={16} />
                    <span className="max-w-[28rem] truncate leading-tight">{article.title}</span>
                  </a>
                  <span className={buildSpectrumClassName(article.spectrum)}>
                    {spectrumLabel ?? "Onbekend"}
                  </span>
                </div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{article.source}</p>
                {article.summary ? (
                  <p className="max-w-3xl text-sm text-slate-300">{article.summary}</p>
                ) : null}
              </div>
              <div className="text-xs font-medium text-slate-400">
                {published ? dateTimeFormatter.format(published) : "Publicatiedatum onbekend"}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
