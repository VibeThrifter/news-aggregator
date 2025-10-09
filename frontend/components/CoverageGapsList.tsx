"use client";

import type { CoverageGap } from "@/lib/types";

import { CoverageGapCard } from "./CoverageGapCard";

interface CoverageGapsListProps {
  items: CoverageGap[];
}

export function CoverageGapsList({ items }: CoverageGapsListProps) {
  if (!items.length) {
    return (
      <div className="rounded-3xl border border-indigo-300/40 bg-indigo-500/10 p-6 text-sm text-indigo-100">
        Geen onderbelichte perspectieven geïdentificeerd in deze cyclus. Controleer later opnieuw of herstart de inzichten-run.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item, index) => (
        <CoverageGapCard key={`${item.perspective}-${index}`} item={item} index={index} />
      ))}
    </div>
  );
}
