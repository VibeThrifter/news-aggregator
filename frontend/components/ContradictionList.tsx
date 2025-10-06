"use client";

import type { Contradiction } from "@/lib/types";

import { ContradictionCard } from "./ContradictionCard";

interface ContradictionListProps {
  items: Contradiction[];
}

export function ContradictionList({ items }: ContradictionListProps) {
  if (!items.length) {
    return (
      <div className="rounded-3xl border border-red-400/30 bg-red-500/10 p-6 text-sm text-red-100">
        Geen tegenstrijdige claims gevonden. Houd bronnen in de gaten en voer anders een nieuwe controle uit.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {items.map((item, index) => (
        <ContradictionCard key={`${item.topic}-${index}`} data={item} index={index} />
      ))}
    </div>
  );
}
