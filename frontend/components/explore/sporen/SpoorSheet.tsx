"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Eye } from "lucide-react";

import { SPOOR_BY_ID } from "@/lib/explore/labels";
import type { SpoorId } from "@/lib/explore/types";

import { SPOOR_COLORS, SPOOR_ICONS, useExplore } from "../ExploreContext";
import { Sheet } from "../ui/Sheet";
import { ClueCard } from "./ClueCard";

const TimelineScrubber = dynamic(() => import("../timeline/TimelineScrubber").then((m) => m.TimelineScrubber), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-2xl bg-paper-200" />,
});

export function SpoorSheet({ spoorId }: { spoorId: SpoorId }) {
  const { exploration, panel, reveal, isRevealed, revealAll } = useExplore();
  const spoor = SPOOR_BY_ID[spoorId];
  const Icon = SPOOR_ICONS[spoorId];
  const clues = exploration.bySpoor.get(spoorId) ?? [];
  const focus = panel.param("c");
  const revealedCount = clues.filter((clue) => isRevealed(clue.id)).length;

  useEffect(() => {
    if (!focus) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`clue-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [focus]);

  const timelineClues = clues.filter((clue) => clue.type === "timeline");
  const otherClues = spoorId === "hoe-liep-het" ? clues.filter((clue) => clue.type !== "timeline") : clues;

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title={spoor.question}
      subtitle={revealAll ? `${clues.length} aanwijzingen` : `${revealedCount} van ${clues.length} ontdekt`}
      icon={<Icon size={22} style={{ color: SPOOR_COLORS[spoorId] }} />}
      footer={
        !revealAll && revealedCount < clues.length ? (
          <button
            type="button"
            onClick={() => reveal(clues.map((clue) => clue.id))}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-paper-300 text-sm font-semibold text-ink-600 hover:bg-paper-100"
          >
            <Eye size={16} /> Toon alles in dit spoor
          </button>
        ) : null
      }
    >
      <p className="mb-4 text-sm text-ink-600">{spoor.intro}</p>
      {spoorId === "hoe-liep-het" ? (
        <div className="mb-5">
          <TimelineScrubber timelineClueIds={timelineClues.map((clue) => clue.id)} />
        </div>
      ) : null}
      <ul className="space-y-3">
        {otherClues.map((clue) => (
          <li key={clue.id}>
            <ClueCard clue={clue} highlighted={focus === clue.id} />
          </li>
        ))}
        {spoorId === "hoe-liep-het"
          ? timelineClues.map((clue) => (
              <li key={clue.id}>
                <ClueCard clue={clue} highlighted={focus === clue.id} />
              </li>
            ))
          : null}
      </ul>
    </Sheet>
  );
}
