"use client";

import { ChevronRight, Newspaper } from "lucide-react";

import { useExplore } from "../ExploreContext";
import { Favicon } from "../ui/primitives";

export function SourcesRow() {
  const { exploration, panel } = useExplore();
  const { outlets, articles } = exploration.input;

  return (
    <button
      type="button"
      onClick={() => panel.open("bronnen")}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-paper-300 bg-paper-50 px-4 py-3 text-left hover:bg-paper-100"
    >
      <Newspaper size={18} className="shrink-0 text-ink-500" aria-hidden="true" />
      <span className="flex-1">
        <span className="block text-sm font-semibold text-ink-900">Alle bronnen en artikelen</span>
        <span className="text-xs text-ink-500">
          {outlets.length} bronnen · {articles.length} artikelen
        </span>
      </span>
      <span className="flex -space-x-1.5" aria-hidden="true">
        {outlets.slice(0, 5).map((outlet) => (
          <span key={outlet.key} className="rounded-full border-2 border-paper-50 bg-paper-50">
            <Favicon name={outlet.name} domain={outlet.domain} size={18} className="rounded-full" />
          </span>
        ))}
      </span>
      <ChevronRight size={18} className="text-ink-400" aria-hidden="true" />
    </button>
  );
}
