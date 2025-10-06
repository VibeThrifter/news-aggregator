"use client";

import type { Fallacy } from "@/lib/types";

import { FallacyCard } from "./FallacyCard";

interface FallacyListProps {
  items: Fallacy[];
}

export function FallacyList({ items }: FallacyListProps) {
  if (!items.length) {
    return (
      <div className="rounded-3xl border border-amber-300/40 bg-amber-500/10 p-6 text-sm text-amber-100">
        Geen drogredeneringen geïdentificeerd in deze cyclus. Controleer later opnieuw of herstart de inzichten-run.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item, index) => (
        <FallacyCard key={`${item.type}-${index}`} item={item} index={index} />
      ))}
    </div>
  );
}
