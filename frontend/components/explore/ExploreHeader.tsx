"use client";

import Link from "next/link";
import { ArrowLeft, Network, Settings2 } from "lucide-react";

import { getCategoryForEventType } from "@/lib/categories";
import { formatEventTimeframe } from "@/lib/format";
import { useExploreStore } from "@/lib/explore/store";

import { useExplore } from "./ExploreContext";
import { Balloon } from "./ui/Balloon";
import { ProgressRing } from "./ui/primitives";

export function ExploreHeader() {
  const { exploration, revealed, revealAll } = useExplore();
  const { input, clues } = exploration;
  const questMode = useExploreStore((state) => state.prefs.questMode);
  const setPref = useExploreStore((state) => state.setPref);

  const category = getCategoryForEventType(input.event.eventType);
  const dutchOutlets = input.outlets.filter((outlet) => !outlet.isInternational).length;
  const found = revealAll ? clues.length : clues.filter((clue) => revealed.has(clue.id)).length;
  const networkHref = `/event/${encodeURIComponent(input.event.slug ?? String(input.event.id))}/netwerk`;

  return (
    <header className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft size={16} /> Nieuws
        </Link>
        <Balloon
          label="Instellingen onderzoeksmodus"
          placement="bottom-end"
          width={280}
          content={
            <div className="space-y-3">
              <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3">
                <span>
                  <span className="block font-semibold text-ink-900">Speurmodus</span>
                  <span className="text-xs text-ink-500">Aanwijzingen eerst verborgen</span>
                </span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-accent-blue"
                  checked={questMode}
                  onChange={(event) => setPref("questMode", event.target.checked)}
                />
              </label>
              <p className="text-xs text-ink-500">Je voortgang en dossier staan alleen op dit apparaat.</p>
            </div>
          }
        >
          {({ ref, props }) => (
            <button
              ref={ref}
              {...props}
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200 hover:text-ink-900"
              aria-label="Instellingen"
            >
              <Settings2 size={18} />
            </button>
          )}
        </Balloon>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${category.color} ${category.bgColor} ${category.borderColor}`}>
          {category.label}
        </span>
        <span>{formatEventTimeframe(input.event.firstSeenAt, input.event.lastUpdatedAt)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {dutchOutlets} {dutchOutlets === 1 ? "bron" : "bronnen"}
        </span>
        <span aria-hidden="true">·</span>
        <span>{input.articles.length} artikelen</span>
      </div>

      <h1 className="font-serif text-2xl font-bold leading-tight text-ink-900 sm:text-3xl">{input.event.title}</h1>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-3">
        <div className="flex items-center gap-3">
          <ProgressRing value={found} total={clues.length} size={44} />
          <div className="text-sm">
            <p className="font-semibold text-ink-900">
              {revealAll ? "Speurmodus uit" : found === 0 ? "Begin je onderzoek" : `${found} van ${clues.length} aanwijzingen`}
            </p>
            <p className="text-xs text-ink-500">
              {revealAll ? "Alle aanwijzingen zijn zichtbaar" : "Tik op ballonnen en sporen om te ontdekken"}
            </p>
          </div>
        </div>
        <Link
          href={networkHref}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-800"
        >
          <Network size={16} /> Netwerk
        </Link>
      </div>
    </header>
  );
}
