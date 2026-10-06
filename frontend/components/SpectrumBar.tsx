"use client";

import { useMemo } from "react";

import { Favicon } from "@/components/explore/ui/primitives";
import type { EventSourceBreakdownEntry } from "@/lib/types";
import { getSpectrumScore, isAlternativeSource } from "@/lib/format";

interface SpectrumBarProps {
  sourceBreakdown?: EventSourceBreakdownEntry[] | null;
  compact?: boolean;
}

interface SourceItem {
  source: string;
  articleCount: number;
  score: number; // 0-10 scale
}

/** Where the Dutch outlets of an event stand from left to right; alternative outlets on their own row. */
export function SpectrumBar({ sourceBreakdown, compact = false }: SpectrumBarProps) {
  const { mainstream, alternative } = useMemo(() => {
    const mainstreamSources: SourceItem[] = [];
    const alternativeSources: SourceItem[] = [];
    for (const entry of sourceBreakdown ?? []) {
      // Foreign outlets have no place on the Dutch political spectrum
      if (entry.is_international) continue;
      const item = { source: entry.source, articleCount: entry.article_count, score: getSpectrumScore(entry.spectrum) };
      if (isAlternativeSource(entry.spectrum)) alternativeSources.push(item);
      else mainstreamSources.push(item);
    }
    mainstreamSources.sort((a, b) => a.score - b.score);
    return { mainstream: mainstreamSources, alternative: alternativeSources };
  }, [sourceBreakdown]);

  if (mainstream.length === 0 && alternative.length === 0) {
    return null;
  }

  const size = compact ? 16 : 20;

  return (
    <div className="space-y-2">
      {mainstream.length > 0 ? (
        <div className="flex items-center gap-2 text-[11px] font-medium">
          <span className="text-blue-700">Links</span>
          <div className={`relative min-w-0 flex-1 ${compact ? "h-7" : "h-9"}`}>
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-blue-300 via-paper-300 to-red-300" />
            {mainstream.map((item) => (
              <div
                key={item.source}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                // Keep the icons inside the track at the ends
                style={{ left: `clamp(${size / 2 + 2}px, ${item.score * 10}%, calc(100% - ${size / 2 + 2}px))` }}
              >
                <SourceDot item={item} size={size} />
              </div>
            ))}
          </div>
          <span className="text-red-700">Rechts</span>
        </div>
      ) : null}

      {alternative.length > 0 ? (
        <div className="flex items-center gap-2 text-[11px] font-medium">
          <span className="text-purple-700">Alternatief</span>
          <div className="flex flex-wrap gap-1">
            {alternative.map((item) => (
              <SourceDot key={item.source} item={item} size={size} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SourceDot({ item, size }: { item: SourceItem; size: number }) {
  return (
    <span
      className="relative flex items-center justify-center rounded-full border border-paper-300 bg-paper-50 p-0.5 shadow-sm"
      title={item.articleCount > 1 ? `${item.source} · ${item.articleCount} artikelen` : item.source}
    >
      <Favicon name={item.source} size={size} className="rounded-full" />
      {item.articleCount > 1 ? (
        <span className="absolute -bottom-1 -right-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-ink-900 px-1 text-[9px] font-bold text-white">
          {item.articleCount}
        </span>
      ) : null}
    </span>
  );
}

export default SpectrumBar;
