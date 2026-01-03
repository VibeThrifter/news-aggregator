"use client";

import { ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";

import type { EventArticle, ArticleBiasAnalysis } from "@/lib/types";
import { getArticleBias } from "@/lib/api";
import { SPECTRUM_LABELS, SPECTRUM_STYLES, parseIsoDate, getSpectrumLabel } from "@/lib/format";
import { BiasScoreBadge, BiasScorePlaceholder } from "./BiasScoreBadge";
import { BiasAnalysisModal } from "./BiasAnalysisModal";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});

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

interface ArticleCardProps {
  article: EventArticle;
  /** Whether to show bias analysis badge */
  showBias?: boolean;
}

export function ArticleCard({ article, showBias = true }: ArticleCardProps) {
  const [biasAnalysis, setBiasAnalysis] = useState<ArticleBiasAnalysis | null>(null);
  const [biasLoading, setBiasLoading] = useState(false);
  const [biasLoaded, setBiasLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const published = parseIsoDate(article.published_at);
  const spectrumLabel = getSpectrumDisplayLabel(article.spectrum);
  const favicon = getSourceFavicon(article.url);

  // Fetch bias analysis when component mounts
  useEffect(() => {
    if (!showBias || biasLoaded) return;

    setBiasLoading(true);
    getArticleBias(article.id)
      .then((analysis) => {
        setBiasAnalysis(analysis);
        setBiasLoaded(true);
      })
      .catch((error) => {
        console.warn(`Failed to fetch bias for article ${article.id}:`, error);
        setBiasLoaded(true);
      })
      .finally(() => {
        setBiasLoading(false);
      });
  }, [article.id, showBias, biasLoaded]);

  const handleBiasClick = () => {
    if (biasAnalysis) {
      setShowModal(true);
    }
  };

  return (
    <>
      <a
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
          {/* Header with favicon, source, and badges */}
          <div className="flex items-center gap-2 flex-wrap">
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

            {/* Bias badge */}
            {showBias && (
              <div className="ml-auto">
                {biasLoading ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-400 animate-pulse">
                    ...
                  </span>
                ) : biasAnalysis ? (
                  <BiasScoreBadge
                    rating={biasAnalysis.summary.overall_journalist_rating}
                    biasCount={biasAnalysis.summary.journalist_bias_count}
                    onClick={handleBiasClick}
                  />
                ) : biasLoaded ? (
                  <BiasScorePlaceholder />
                ) : null}
              </div>
            )}
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

      {/* Bias analysis modal */}
      {showModal && biasAnalysis && (
        <BiasAnalysisModal
          analysis={biasAnalysis}
          articleTitle={article.title}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
