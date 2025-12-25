"use client";

import Image from "next/image";
import { useMemo } from "react";

import type { EventSourceBreakdownEntry } from "@/lib/types";
import {
  getSpectrumScore,
  getSourceFaviconUrl,
  isAlternativeSource,
} from "@/lib/format";

interface SpectrumBarProps {
  sourceBreakdown?: EventSourceBreakdownEntry[] | null;
  compact?: boolean;
}

interface SourceItem {
  source: string;
  articleCount: number;
  spectrum: string | number | null;
  score: number; // 0-10 scale
  faviconUrl: string;
}

export function SpectrumBar({ sourceBreakdown, compact = false }: SpectrumBarProps) {
  const { mainstream, alternative } = useMemo(() => {
    if (!sourceBreakdown || sourceBreakdown.length === 0) {
      return { mainstream: [], alternative: [] };
    }

    const mainstreamSources: SourceItem[] = [];
    const alternativeSources: SourceItem[] = [];

    for (const entry of sourceBreakdown) {
      const item: SourceItem = {
        source: entry.source,
        articleCount: entry.article_count,
        spectrum: entry.spectrum ?? null,
        score: getSpectrumScore(entry.spectrum),
        faviconUrl: getSourceFaviconUrl(entry.source),
      };

      if (isAlternativeSource(entry.spectrum)) {
        alternativeSources.push(item);
      } else {
        mainstreamSources.push(item);
      }
    }

    // Sort by score for consistent display
    mainstreamSources.sort((a, b) => a.score - b.score);

    return { mainstream: mainstreamSources, alternative: alternativeSources };
  }, [sourceBreakdown]);

  if (mainstream.length === 0 && alternative.length === 0) {
    return null;
  }

  const iconSize = compact ? 20 : 24;

  return (
    <div className={`space-y-2 ${compact ? "text-xs" : "text-sm"}`}>
      {/* Mainstream row - spectrum positioning on 0-10 scale */}
      {mainstream.length > 0 && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-blue-600 font-medium">Links</span>
          <div className="relative w-[280px] h-10">
            {/* Background gradient bar */}
            <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full bg-gradient-to-r from-blue-400/60 via-paper-300 to-red-400/60" />
            {/* Position each source icon based on their 0-10 score */}
            {mainstream.map((item) => (
              <div
                key={item.source}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                style={{ left: `${item.score * 10}%` }}
              >
                <SourceIcon item={item} size={iconSize} />
              </div>
            ))}
          </div>
          <span className="text-red-600 font-medium">Rechts</span>
        </div>
      )}

      {/* Alternative row - compact inline design */}
      {alternative.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-purple-600">
            Alternatief
          </span>
          <div className="flex flex-wrap gap-1">
            {alternative.map((item) => (
              <SourceIcon key={item.source} item={item} size={iconSize} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SourceIconProps {
  item: SourceItem;
  size: number;
}

function SourceIcon({ item, size }: SourceIconProps) {
  return (
    <div
      className="group relative flex items-center justify-center rounded-sm border border-paper-300 bg-paper-50 p-1 transition-colors hover:border-paper-300 hover:bg-paper-100 shadow-sm"
      title={item.source}
    >
      <Image
        src={item.faviconUrl}
        alt={item.source}
        width={size}
        height={size}
        className="rounded-sm"
        unoptimized
      />
      {item.articleCount > 1 && (
        <span className="absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent-blue px-1 text-[10px] font-bold text-white">
          {item.articleCount}
        </span>
      )}
      {/* Tooltip */}
      <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {item.source}
      </div>
    </div>
  );
}

export default SpectrumBar;
