"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { ChevronDown, Check } from "lucide-react";
import { getSourceFaviconUrl } from "@/lib/format";

export interface SourceInfo {
  name: string;
  articleCount: number;
}

interface SourceFilterProps {
  sources: SourceInfo[];
  selectedSources: Set<string>;
  onSelectionChange: (sources: Set<string>) => void;
}

// Social media / commentary accounts (shown in separate section, unchecked by default)
export const SOCIAL_MEDIA_SOURCES = new Set([
  "Een Blik op de NOS",
]);

function SourceCheckbox({
  source,
  isSelected,
  onToggle,
}: {
  source: SourceInfo;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
        isSelected
          ? "bg-paper-100 text-ink-900"
          : "text-ink-600 hover:bg-paper-50 hover:text-ink-900"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
          isSelected
            ? "border-accent-orange bg-accent-orange"
            : "border-ink-300"
        }`}
      >
        {isSelected && <Check size={12} className="text-white" />}
      </span>
      <Image
        src={getSourceFaviconUrl(source.name)}
        alt=""
        width={16}
        height={16}
        className="shrink-0 rounded-sm"
        unoptimized
      />
      <span className="flex-1 truncate">{source.name}</span>
      <span className="shrink-0 text-xs text-ink-400">
        {source.articleCount}
      </span>
    </button>
  );
}

export function SourceFilter({ sources, selectedSources, onSelectionChange }: SourceFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded]);

  // Split sources into news sources and social media accounts
  const { newsSources, socialSources } = useMemo(() => {
    const news: SourceInfo[] = [];
    const social: SourceInfo[] = [];
    for (const source of sources) {
      if (SOCIAL_MEDIA_SOURCES.has(source.name)) {
        social.push(source);
      } else {
        news.push(source);
      }
    }
    // Sort each group by article count (descending)
    news.sort((a, b) => b.articleCount - a.articleCount);
    social.sort((a, b) => b.articleCount - a.articleCount);
    return { newsSources: news, socialSources: social };
  }, [sources]);

  const allSelected = sources.length > 0 && sources.every((s) => selectedSources.has(s.name));
  const noneSelected = sources.length > 0 && sources.every((s) => !selectedSources.has(s.name));

  const handleToggleSource = (sourceName: string) => {
    const newSelection = new Set(selectedSources);
    if (newSelection.has(sourceName)) {
      newSelection.delete(sourceName);
    } else {
      newSelection.add(sourceName);
    }
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    onSelectionChange(new Set(sources.map((s) => s.name)));
  };

  const handleSelectNone = () => {
    onSelectionChange(new Set());
  };

  if (sources.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-2 text-sm text-ink-400 transition-colors hover:text-ink-700"
      >
        <span>bronnen</span>
        <span className="font-medium text-ink-700">
          {selectedSources.size}/{sources.length}
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {isExpanded && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[260px] overflow-hidden rounded-sm border border-paper-200 bg-white shadow-lg">
          {/* Select All / None buttons */}
          <div className="flex items-center gap-3 border-b border-paper-200 px-3 py-2">
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={allSelected}
              className="text-xs text-ink-500 transition-colors hover:text-accent-orange disabled:opacity-40"
            >
              Alles
            </button>
            <span className="text-paper-300">·</span>
            <button
              type="button"
              onClick={handleSelectNone}
              disabled={noneSelected}
              className="text-xs text-ink-500 transition-colors hover:text-accent-orange disabled:opacity-40"
            >
              Geen
            </button>
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {/* News sources section */}
            {newsSources.length > 0 && (
              <div>
                {newsSources.map((source) => (
                  <SourceCheckbox
                    key={source.name}
                    source={source}
                    isSelected={selectedSources.has(source.name)}
                    onToggle={() => handleToggleSource(source.name)}
                  />
                ))}
              </div>
            )}

            {/* Social media / commentary section */}
            {socialSources.length > 0 && (
              <>
                <div className="border-t border-paper-200 px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                    X / Commentaar
                  </span>
                </div>
                <div>
                  {socialSources.map((source) => (
                    <SourceCheckbox
                      key={source.name}
                      source={source}
                      isSelected={selectedSources.has(source.name)}
                      onToggle={() => handleToggleSource(source.name)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
