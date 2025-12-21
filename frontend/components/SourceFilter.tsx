"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
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

  // Sort sources by article count (descending)
  const sortedSources = [...sources].sort((a, b) => b.articleCount - a.articleCount);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-700/50 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-200"
      >
        <span>Bronnen</span>
        <span className="rounded-full bg-slate-600 px-1.5 py-0.5 text-[10px] font-semibold">
          {selectedSources.size}/{sources.length}
        </span>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {isExpanded && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[240px] rounded-lg border border-slate-600 bg-slate-800 p-2 shadow-xl">
          {/* Select All / None buttons */}
          <div className="mb-2 flex items-center gap-2 border-b border-slate-700 pb-2">
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={allSelected}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              Alles
            </button>
            <span className="text-slate-600">|</span>
            <button
              type="button"
              onClick={handleSelectNone}
              disabled={noneSelected}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              Geen
            </button>
          </div>

          {/* Source checkboxes */}
          <div className="max-h-[300px] space-y-1 overflow-y-auto">
            {sortedSources.map((source) => {
              const isSelected = selectedSources.has(source.name);
              return (
                <button
                  key={source.name}
                  type="button"
                  onClick={() => handleToggleSource(source.name)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-brand-500/20 text-slate-100"
                      : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? "border-brand-500 bg-brand-500"
                        : "border-slate-500 bg-slate-700"
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
                  <span className="shrink-0 text-xs text-slate-500">
                    {source.articleCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
