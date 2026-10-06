"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, Check } from "lucide-react";

import { Favicon } from "@/components/explore/ui/primitives";

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
      role="menuitemcheckbox"
      aria-checked={isSelected}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-ink-800 transition-colors hover:bg-paper-100"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          isSelected ? "border-ink-900 bg-ink-900" : "border-ink-300 bg-paper-50"
        }`}
      >
        {isSelected ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
      </span>
      <Favicon name={source.name} size={16} />
      <span className={`flex-1 truncate ${isSelected ? "text-ink-900" : "text-ink-500"}`}>{source.name}</span>
      <span className="shrink-0 text-xs tabular-nums text-ink-400">{source.articleCount}</span>
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
        aria-haspopup="menu"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3.5 text-sm transition-colors ${
          isExpanded ? "border-ink-400 bg-paper-50" : "border-paper-300 bg-paper-50 hover:border-ink-200"
        }`}
      >
        <span className="text-ink-500">Bronnen</span>
        <span className="font-semibold tabular-nums text-ink-900">
          {selectedSources.size}/{sources.length}
        </span>
        <ChevronDown size={15} className={`text-ink-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {isExpanded ? (
        <div
          role="menu"
          aria-label="Bronnen"
          className="absolute left-0 top-full z-50 mt-2 w-[280px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 p-1.5 shadow-balloon sm:left-auto sm:right-0"
        >
          <div className="flex items-center gap-1 px-1 pb-1.5 pt-0.5">
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={allSelected}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-ink-700 transition-colors hover:bg-paper-200 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Alles
            </button>
            <button
              type="button"
              onClick={handleSelectNone}
              disabled={noneSelected}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-ink-700 transition-colors hover:bg-paper-200 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Geen
            </button>
          </div>

          <div className="max-h-[320px] overflow-y-auto border-t border-paper-200 pt-1">
            {newsSources.map((source) => (
              <SourceCheckbox
                key={source.name}
                source={source}
                isSelected={selectedSources.has(source.name)}
                onToggle={() => handleToggleSource(source.name)}
              />
            ))}

            {/* Social media / commentary accounts */}
            {socialSources.length > 0 ? (
              <>
                <p className="mt-1 border-t border-paper-200 px-2.5 pb-1 pt-2.5 text-xs font-semibold text-ink-500">X en commentaar</p>
                {socialSources.map((source) => (
                  <SourceCheckbox
                    key={source.name}
                    source={source}
                    isSelected={selectedSources.has(source.name)}
                    onToggle={() => handleToggleSource(source.name)}
                  />
                ))}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
