"use client";

import { BookOpen } from "lucide-react";

import { truncate } from "@/lib/explore/summary";

import { useExplore } from "./ExploreContext";
import { EntityText } from "./entity/EntityText";
import { Eyebrow } from "./ui/primitives";

export function SummaryTeaser() {
  const { exploration, panel } = useExplore();
  const { summary } = exploration.input;

  if (!summary.firstParagraph) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-paper-300 bg-paper-50 p-5" aria-labelledby="teaser-title">
      <Eyebrow>Het verhaal in het kort</Eyebrow>
      <p id="teaser-title" className="mt-2 font-serif text-[17px] leading-relaxed text-ink-800">
        <EntityText text={truncate(summary.firstParagraph, 360)} />
      </p>
      <button
        type="button"
        onClick={() => panel.open("samenvatting")}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-paper-300 px-4 text-sm font-semibold text-ink-800 hover:bg-paper-100"
      >
        <BookOpen size={16} /> Lees het hele verhaal
      </button>
    </section>
  );
}
