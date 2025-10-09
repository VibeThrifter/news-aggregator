"use client";

import type { Frame } from "@/lib/types";

import { FrameCard } from "./FrameCard";

interface FrameListProps {
  items: Frame[];
}

export function FrameList({ items }: FrameListProps) {
  if (!items.length) {
    return (
      <div className="rounded-3xl border border-indigo-300/40 bg-indigo-500/10 p-6 text-sm text-indigo-100">
        Geen framing geïdentificeerd in deze cyclus. Controleer later opnieuw of herstart de inzichten-run.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item, index) => (
        <FrameCard key={`${item.frame_type}-${index}`} item={item} index={index} />
      ))}
    </div>
  );
}
