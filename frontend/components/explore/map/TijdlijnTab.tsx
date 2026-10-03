"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import { chronology, storyThread, type ChronologyRow, type Episode } from "@/lib/explore/chronology";
import { ownEntryOf } from "@/lib/explore/own";
import { formatLag } from "@/lib/explore/timeline";
import type { Finding } from "@/lib/explore/types";
import { formatEventTimeframe } from "@/lib/format";

import { useExplore } from "../ExploreContext";
import { EntityText } from "../entity/EntityText";
import { Favicon } from "../ui/primitives";
import { FindingRow } from "./FindingRow";
import { useFocusRing } from "./Markers";

const time = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

type AxisRow = ChronologyRow | { kind: "own"; t: number; finding: Finding };

/** One axis: background → earlier episodes → this news (with your own moments) → alongside/later → why now. */
export function TijdlijnTab() {
  const { exploration } = useExplore();
  const { input, findings } = exploration;
  const chrono = useMemo(() => chronology(input), [input]);
  const axis = useMemo<AxisRow[]>(() => {
    const own = findings.flatMap((finding) => {
      const entry = ownEntryOf(finding);
      const t = entry?.kind === "moment" && entry.date ? Date.parse(`${entry.date}T12:00:00`) : NaN;
      return Number.isNaN(t) ? [] : [{ kind: "own" as const, t, finding }];
    });
    return [...chrono.rows, ...own].sort((a, b) => a.t - b.t);
  }, [chrono.rows, findings]);
  const thread = useMemo(() => storyThread(input), [input]);
  const timing = findings.find((finding) => finding.body.type === "timing");
  const [history, setHistory] = useState(false);
  // "Wie was er het eerst?" and moments from the analysis are shown on the axis itself
  const first = findings.find((finding) => finding.body.type === "first");
  const { ref, ringing } = useFocusRing<HTMLDivElement>("finding", first?.id ?? "-tijdlijn");

  return (
    <div className="space-y-5">
      {chrono.history.length ? (
        <div>
          <button
            type="button"
            aria-expanded={history}
            onClick={() => setHistory((value) => !value)}
            className="flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-ink-700"
          >
            <ChevronDown size={16} className={`transition-transform ${history ? "rotate-180" : ""}`} /> Voorgeschiedenis ({chrono.history.length})
          </button>
          {history ? (
            <ol className="ml-2 space-y-2 border-l-2 border-paper-300 pl-4">
              {chrono.history.map((item) => (
                <li key={item.timelineIndex} className="text-sm">
                  <span className="mr-2 font-semibold text-ink-500">{item.label}</span>
                  <EntityText text={item.headline} />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      <div ref={ref} className={`scroll-mt-28 space-y-4 rounded-xl ${ringing ? "ring-4 ring-amber-300 ring-offset-2" : ""}`}>
        {thread.earlier.length ? <EpisodeList title="Eerder in dit verhaal" episodes={thread.earlier} /> : null}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Dit nieuws</p>
          <ol className="ml-2 space-y-2.5 border-l-2 border-ink-900 pl-4">
            {axis.map((row, i) =>
              row.kind === "own" ? (
                <FindingRow
                  key={row.finding.id}
                  finding={row.finding}
                  leading={
                    <span aria-hidden="true" className="absolute -left-[23px] top-[15px] h-2.5 w-2.5 rounded-full border-2 border-dashed border-ink-900 bg-white" />
                  }
                />
              ) : row.kind === "publication" ? (
                <PublicationRow key={`p${i}`} outletKey={row.outletKey} t={row.t} lagMinutes={row.lagMinutes} />
              ) : (
                <li key={`m${i}`} className="relative text-sm">
                  <span aria-hidden="true" className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900 bg-white" />
                  <span className="mr-2 text-xs font-semibold text-ink-500">{row.label}</span>
                  <EntityText text={row.headline} />
                </li>
              ),
            )}
          </ol>
        </div>

        {thread.alongside.length ? <EpisodeList title="Tegelijk verschenen over hetzelfde" episodes={thread.alongside} /> : null}
        {thread.later.length ? <EpisodeList title="Later in dit verhaal" episodes={thread.later} /> : null}
      </div>

      {timing ? (
        <ul className="divide-y divide-paper-200 border-t border-paper-200">
          <FindingRow finding={timing} />
        </ul>
      ) : null}

      {thread.people.length ? <PeopleElsewhere people={thread.people} /> : null}
    </div>
  );
}

function PublicationRow({ outletKey, t, lagMinutes }: { outletKey: string; t: number; lagMinutes: number }) {
  const { exploration, toAnchor } = useExplore();
  const outlet = exploration.index.outlet(outletKey);
  if (!outlet) return null;
  return (
    <li className="relative">
      <span aria-hidden="true" className="absolute -left-[23px] top-2 h-2.5 w-2.5 rounded-full bg-ink-900" />
      <button
        type="button"
        onClick={() => toAnchor(`outlet:${outlet.key}`)}
        className="flex min-h-[36px] w-full items-center gap-2 text-left text-sm"
      >
        <Favicon name={outlet.name} domain={outlet.domain} size={16} />
        <strong className="font-semibold text-ink-900">{outlet.name}</strong>
        <span className="text-ink-500">{time.format(new Date(t))}</span>
        <span className="text-xs text-ink-500">{formatLag(lagMinutes)}</span>
      </button>
    </li>
  );
}

function EpisodeList({ title, episodes }: { title: string; episodes: Episode[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-500">{title}</p>
      <ul className="divide-y divide-paper-200">
        {episodes.map((episode) => (
          <li key={episode.eventId}>
            <EpisodeLink episode={episode} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EpisodeLink({ episode, showShared = true }: { episode: Episode; showShared?: boolean }) {
  const href = `/event/${encodeURIComponent(episode.slug ?? String(episode.eventId))}`;
  return (
    <Link href={href} className="flex min-h-[44px] items-start gap-2 py-2 hover:bg-paper-100">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-ink-900">{episode.title}</span>
        <span className="mt-0.5 block text-xs text-ink-500">
          {episode.firstSeenAt ? day.format(new Date(episode.firstSeenAt)) : formatEventTimeframe(null, null)}
          {episode.articleCount ? ` · ${episode.articleCount} ${episode.articleCount === 1 ? "artikel" : "artikelen"}` : ""}
          {showShared && episode.shared.length ? ` · ${episode.shared.slice(0, 3).join(", ")}` : ""}
        </span>
      </span>
      <ChevronRight size={16} className="mt-1 shrink-0 text-ink-400" aria-hidden="true" />
    </Link>
  );
}

function PeopleElsewhere({ people }: { people: ReturnType<typeof storyThread>["people"] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-500">Dezelfde mensen in ander nieuws</p>
      <ul className="divide-y divide-paper-200">
        {people.slice(0, 8).map((person) => (
          <li key={person.key}>
            <button
              type="button"
              aria-expanded={openKey === person.key}
              onClick={() => setOpenKey((current) => (current === person.key ? null : person.key))}
              className="flex min-h-[44px] w-full items-center gap-2 text-left text-sm"
            >
              <strong className="flex-1 font-semibold text-ink-900">{person.name}</strong>
              <span className="text-xs text-ink-500">
                {person.episodes.length} {person.episodes.length === 1 ? "nieuwsitem" : "nieuwsitems"}
              </span>
              <ChevronDown size={16} className={`text-ink-400 transition-transform ${openKey === person.key ? "rotate-180" : ""}`} />
            </button>
            {openKey === person.key ? (
              <ul className="mb-2 ml-3 divide-y divide-paper-200 border-l-2 border-paper-300 pl-3">
                {person.episodes.map((episode) => (
                  <li key={episode.eventId}>
                    <EpisodeLink episode={episode} showShared={false} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
