"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, FolderOpen } from "lucide-react";

import { getCategoryForEventType } from "@/lib/categories";
import { newsStart, storyThread } from "@/lib/explore/chronology";
import { useFocusStore } from "@/lib/explore/focus";
import { useExploreStore } from "@/lib/explore/store";
import { truncate } from "@/lib/explore/summary";
import { formatEventTimeframe, getCountryFlag, getCountryName } from "@/lib/format";

import { useExplore } from "./ExploreContext";
import { EntityText } from "./entity/EntityText";
import { Balloon } from "./ui/Balloon";

function outletsLine(dutch: string[], foreign: number): string {
  const names = dutch.length === 0 ? "" : dutch.length <= 2 ? dutch.join(" en ") : `${dutch.length} Nederlandse bronnen`;
  const abroad = foreign ? `${foreign} buitenlandse` : "";
  if (names && abroad) return `${names} + ${abroad}`;
  return names || (foreign ? `${foreign} buitenlandse bronnen` : "");
}

export function ExploreHeader() {
  const { exploration, panel, dossierCount } = useExplore();
  const { input } = exploration;
  const setPref = useExploreStore((state) => state.setPref);
  const focus = useFocusStore((state) => state.focus);

  const category = getCategoryForEventType(input.event.eventType);
  const dutch = input.outlets.filter((outlet) => !outlet.isInternational).map((outlet) => outlet.name);
  const foreign = input.outlets.filter((outlet) => outlet.isInternational).length;
  const thread = useMemo(() => storyThread(input), [input]);
  const sameStory = thread.earlier.length + thread.alongside.length + thread.later.length;
  const first = exploration.findings.find((finding) => finding.body.type === "first");
  const countries = (input.insight?.involved_countries ?? []).filter((country) => country.iso_code);
  // From the first Dutch article: an old foreign article can make the event's own start far too early
  const startMs = newsStart(input);
  const start = Number.isNaN(startMs) ? input.event.firstSeenAt : new Date(startMs).toISOString();

  return (
    <header className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm text-ink-500 hover:text-ink-900">
          <ArrowLeft size={16} /> Nieuws
        </Link>
        <button
          type="button"
          onClick={() => panel.open("dossier")}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink-700 hover:bg-paper-200"
        >
          <FolderOpen size={16} /> Bewaard
          {dossierCount ? <span className="rounded-full bg-ink-900 px-1.5 text-xs text-white">{dossierCount}</span> : null}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
        {input.event.eventType && input.event.eventType !== "other" ? (
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${category.color} ${category.bgColor} ${category.borderColor}`}>{category.label}</span>
        ) : null}
        <span>{formatEventTimeframe(start, input.event.lastUpdatedAt)}</span>
        {outletsLine(dutch, foreign) ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{outletsLine(dutch, foreign)}</span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span>
          {input.articles.length} {input.articles.length === 1 ? "artikel" : "artikelen"}
        </span>
      </div>

      <h1 className="font-serif text-2xl font-bold leading-tight text-ink-900 sm:text-3xl">{input.event.title}</h1>

      {sameStory ? (
        <button
          type="button"
          onClick={() => {
            setPref("findingsTab", "tijdlijn");
            if (first) focus("finding", first.id);
            else window.setTimeout(() => document.querySelector('[aria-label="Bevindingen"]')?.scrollIntoView({ block: "start" }), 50);
          }}
          className="inline-flex min-h-[36px] items-center rounded-full border border-paper-300 bg-paper-50 px-3 text-xs font-semibold text-ink-700 hover:bg-paper-100"
        >
          Ook in {sameStory} {sameStory === 1 ? "ander nieuwsitem" : "andere nieuwsitems"} over dit verhaal ›
        </button>
      ) : null}

      {input.summary.firstParagraph ? (
        <div>
          <p className="font-serif text-[17px] leading-relaxed text-ink-800">
            <EntityText text={truncate(input.summary.firstParagraph, 320)} />
          </p>
          <button
            type="button"
            onClick={() => panel.open("samenvatting")}
            className="mt-1 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-accent-blue"
          >
            <BookOpen size={15} /> Lees alles
          </button>
        </div>
      ) : null}

      {countries.length ? (
        <div className="-mx-1 flex flex-wrap gap-1.5 px-1" aria-label="Landen in dit verhaal">
          {countries.map((country) => (
            <Balloon
              key={country.iso_code}
              label={getCountryName(country.iso_code)}
              placement="top"
              width={280}
              content={
                <div className="space-y-1">
                  <p className="font-semibold text-ink-900">
                    {getCountryFlag(country.iso_code)} {getCountryName(country.iso_code)}
                  </p>
                  {country.relevance ? (
                    <p className="text-sm text-ink-700">
                      <EntityText text={country.relevance} />
                    </p>
                  ) : null}
                </div>
              }
            >
              {({ ref, props }) => (
                <button
                  ref={ref}
                  {...props}
                  type="button"
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-paper-300 bg-paper-50 px-2.5 text-xs font-medium text-ink-700 hover:bg-paper-100"
                >
                  <span aria-hidden="true">{getCountryFlag(country.iso_code)}</span>
                  {getCountryName(country.iso_code)}
                </button>
              )}
            </Balloon>
          ))}
        </div>
      ) : null}
    </header>
  );
}
