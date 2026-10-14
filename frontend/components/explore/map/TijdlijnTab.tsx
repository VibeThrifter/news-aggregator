"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import { chronology, partOf, type ChronologyRow, type Episode, type StoryRow } from "@/lib/explore/chronology";
import { ownEntryOf } from "@/lib/explore/own";
import { formatLag } from "@/lib/explore/timeline";
import type { Finding } from "@/lib/explore/types";

import { useExplore } from "../ExploreContext";
import { EntityText } from "../entity/EntityText";
import { Favicon, SubHeading } from "../ui/primitives";
import { FindingActions, FindingRow } from "./FindingRow";
import { useFocusRing } from "./Markers";

/** A white card, like the cards under "Wie praat?" */
const CARD = "rounded-2xl border border-paper-300 bg-paper-50 px-4";

const clock = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

/** "28 sep", with the year when it is not this year */
function dayLabel(t: number): string {
  const date = new Date(t);
  return (date.getFullYear() === new Date().getFullYear() ? dayMonth : dayMonthYear).format(date);
}

const dayKey = (t: number) => new Date(t).toDateString();
/** A date without a time ("2026-09-29") is parsed as local midnight */
const hasClock = (t: number) => new Date(t).getHours() !== 0 || new Date(t).getMinutes() !== 0;

/** Older moments than this many before this news fold away */
const BEFORE_SHOWN = 3;

type Own = { kind: "own"; t: number; finding: Finding };
type Part = "before" | "news" | "after";
type Dot = "publication" | "moment" | "own" | "story-moment" | "episode" | "news";

const DOT: Record<Exclude<Dot, "own">, string> = {
  publication: "h-2.5 w-2.5 bg-ink-900",
  moment: "h-2.5 w-2.5 border-2 border-ink-900 bg-paper-50",
  "story-moment": "h-2.5 w-2.5 border-2 border-ink-300 bg-paper-50",
  episode: "h-2.5 w-2.5 bg-ink-300",
  news: "h-3 w-3 bg-ink-900 ring-4 ring-paper-50",
};

/** One row of the axis: when on the left, its dot on the line, what happened on the right. */
interface AxisItem {
  key: string;
  part: Part;
  when?: ReactNode;
  dot?: Dot;
  /** Height of the dot's centre: the middle of the first line */
  dotY?: number;
  body?: ReactNode;
}

/**
 * Tijdlijn: one axis in one card. The story before this news (background, earlier news items),
 * this news hour by hour (who published when, what happened, your own moments) on a black line,
 * and the story after it. "Waarom nu?" has a card of its own.
 */
export function TijdlijnTab() {
  const { exploration } = useExplore();
  const { input, findings } = exploration;
  const chrono = useMemo(() => chronology(input), [input]);
  const [allBefore, setAllBefore] = useState(false);

  const parts = useMemo(() => {
    const own: Own[] = findings.flatMap((finding) => {
      const entry = ownEntryOf(finding);
      const t = entry?.kind === "moment" && entry.date ? Date.parse(`${entry.date}T12:00:00`) : NaN;
      return Number.isNaN(t) ? [] : [{ kind: "own" as const, t, finding }];
    });
    const ownIn = (part: Part) => own.filter((row) => partOf(row.t, chrono.span) === part);
    const byTime = (a: { t: number }, b: { t: number }) => a.t - b.t;
    return {
      before: [...chrono.before, ...ownIn("before")].sort(byTime),
      news: [...chrono.rows, ...ownIn("news")].sort(byTime),
      after: [...chrono.after, ...ownIn("after")].sort(byTime),
    };
  }, [chrono, findings]);

  const timing = findings.find((finding) => finding.body.type === "timing");
  // A jump to "Wie was er het eerst?" or to a moment of the analysis lands on the axis
  const targets = findings.filter((finding) => finding.body.type === "first" || finding.body.type === "timeline").map((finding) => finding.id);
  const { ref, ringing } = useFocusRing<HTMLElement>("finding", targets.length ? targets : "-tijdlijn");

  // The oldest moments fold away; what you added yourself stays
  const fold = !allBefore && parts.before.length > BEFORE_SHOWN;
  const shown = fold ? parts.before.filter((row, i) => row.kind === "own" || i >= parts.before.length - (BEFORE_SHOWN - 1)) : parts.before;
  const hidden = parts.before.length - shown.length;
  const items: AxisItem[] = [];
  if (hidden) {
    items.push({
      key: "more",
      part: "before",
      body: (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setAllBefore(true)}
          className="flex min-h-[36px] items-center gap-1 py-2 text-sm font-semibold text-ink-700 hover:text-ink-900"
        >
          Nog {hidden} eerder <ChevronDown size={16} aria-hidden="true" />
        </button>
      ),
    });
  }
  shown.forEach((row, i) => items.push(storyItem(row, "before", i)));

  // This news: the first day next to its name, every next day on a row of its own
  const firstDay = parts.news[0];
  items.push({
    key: "news",
    part: "news",
    when: firstDay ? <span className="font-semibold text-ink-700">{dayLabel(firstDay.t)}</span> : null,
    dot: "news",
    body: <SubHeading className="py-2">Dit nieuws</SubHeading>,
  });
  parts.news.forEach((row, i) => {
    if (i > 0 && dayKey(row.t) !== dayKey(parts.news[i - 1].t)) {
      items.push({ key: `day${i}`, part: "news", when: <span className="font-semibold text-ink-700">{dayLabel(row.t)}</span> });
    }
    items.push(newsItem(row, i));
  });

  parts.after.forEach((row, i) => items.push(storyItem(row, "after", i)));

  return (
    <div className="space-y-3">
      <section
        ref={ref}
        aria-label="Tijdlijn"
        className={`${CARD} scroll-mt-28 py-2 transition-shadow ${ringing ? "ring-4 ring-amber-300 ring-offset-2" : ""}`}
      >
        <ol>
          {items.map((item, i) => (
            <AxisRow
              key={item.key}
              item={item}
              up={i > 0 ? lineTone(items[i - 1], item) : null}
              down={i < items.length - 1 ? lineTone(item, items[i + 1]) : null}
            />
          ))}
        </ol>
      </section>
      {timing ? <TimingCard finding={timing} /> : null}
    </div>
  );
}

/** The line between two rows is black within this news, grey around it */
function lineTone(a: AxisItem, b: AxisItem): string {
  return a.part === "news" && b.part === "news" ? "bg-ink-900" : "bg-ink-200";
}

function AxisRow({ item, up, down }: { item: AxisItem; up: string | null; down: string | null }) {
  const dotY = item.dotY ?? 18;
  return (
    <li className="flex">
      <span
        className="w-[4.5rem] shrink-0 pr-3 text-right text-xs leading-5 tabular-nums text-ink-500"
        style={{ paddingTop: dotY - 10 }}
      >
        {item.when}
      </span>
      <div className="relative min-w-0 flex-1 pl-5">
        {up ? <span aria-hidden="true" className={`absolute left-0 top-0 w-0.5 ${up}`} style={{ height: dotY }} /> : null}
        {down ? <span aria-hidden="true" className={`absolute bottom-0 left-0 w-0.5 ${down}`} style={{ top: dotY }} /> : null}
        {item.dot && item.dot !== "own" ? (
          <span
            aria-hidden="true"
            className={`absolute left-px -translate-x-1/2 -translate-y-1/2 rounded-full ${DOT[item.dot]}`}
            style={{ top: dotY }}
          />
        ) : null}
        {item.body}
      </div>
    </li>
  );
}

function storyItem(row: StoryRow | Own, part: Part, i: number): AxisItem {
  const when = row.kind === "moment" && row.yearOnly ? String(new Date(row.t).getFullYear()) : dayLabel(row.t);
  if (row.kind === "own") return ownItem(row, part, when);
  if (row.kind === "episode") {
    return { key: `${part}e${row.episode.eventId}`, part, when, dot: "episode", body: <EpisodeLink episode={row.episode} /> };
  }
  return {
    key: `${part}m${row.timelineIndex}-${i}`,
    part,
    when,
    dot: "story-moment",
    body: (
      <p className="py-2 text-sm leading-5 text-ink-700">
        <EntityText text={row.headline} />
      </p>
    ),
  };
}

function newsItem(row: ChronologyRow | Own, i: number): AxisItem {
  if (row.kind === "own") return ownItem(row, "news", null);
  const when = row.kind === "publication" || hasClock(row.t) ? clock.format(new Date(row.t)) : null;
  if (row.kind === "publication") {
    return { key: `p${row.outletKey}`, part: "news", when, dot: "publication", body: <Publication outletKey={row.outletKey} lagMinutes={row.lagMinutes} /> };
  }
  return {
    key: `m${row.timelineIndex}-${i}`,
    part: "news",
    when,
    dot: "moment",
    body: (
      <p className="py-2 text-sm leading-5 text-ink-900">
        <EntityText text={row.headline} />
      </p>
    ),
  };
}

/** A moment you added: a row of your own (change, remove, share) with a dashed dot */
function ownItem(row: Own, part: Part, when: ReactNode): AxisItem {
  return {
    key: row.finding.id,
    part,
    when,
    dot: "own",
    // FindingRow puts its first line 2px lower than the other rows
    dotY: 20,
    body: (
      <ul>
        <FindingRow
          finding={row.finding}
          leading={
            <span
              aria-hidden="true"
              className="absolute -left-[19px] top-5 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-ink-900 bg-paper-50"
            />
          }
        />
      </ul>
    ),
  };
}

function Publication({ outletKey, lagMinutes }: { outletKey: string; lagMinutes: number }) {
  const { exploration, toAnchor } = useExplore();
  const outlet = exploration.index.outlet(outletKey);
  if (!outlet) return null;
  return (
    <button
      type="button"
      onClick={() => toAnchor(`outlet:${outlet.key}`)}
      className="flex w-full items-start gap-2 py-2 text-left text-sm leading-5"
    >
      <Favicon name={outlet.name} domain={outlet.domain} size={16} className="mt-0.5" />
      <strong className="min-w-0 font-semibold text-ink-900">{outlet.name}</strong>
      <span className="shrink-0 text-ink-500">{formatLag(lagMinutes)}</span>
    </button>
  );
}

function EpisodeLink({ episode }: { episode: Episode }) {
  const href = `/event/${encodeURIComponent(episode.slug ?? String(episode.eventId))}`;
  return (
    <Link href={href} className="group flex items-start gap-2 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-5 text-ink-900 group-hover:underline">{episode.title}</span>
        {episode.articleCount ? (
          <span className="block text-xs text-ink-500">
            {episode.articleCount} {episode.articleCount === 1 ? "artikel" : "artikelen"}
          </span>
        ) : null}
      </span>
      <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden="true" />
    </Link>
  );
}

function Part({ label, children }: { label: string; children: string | null | undefined }) {
  if (!children?.trim()) return null;
  return (
    <div className="space-y-0.5 py-2.5">
      <p className="text-sm font-semibold text-ink-900">{label}</p>
      <p className="text-sm leading-relaxed text-ink-700">
        <EntityText text={children} />
      </p>
    </div>
  );
}

/** "Waarom nu?": why this news comes now and what is coming. */
function TimingCard({ finding }: { finding: Finding }) {
  const id = useId();
  const { ref, ringing } = useFocusRing<HTMLElement>("finding", finding.id);
  if (finding.body.type !== "timing") return null;
  const { why_now, upcoming_events } = finding.body.timing;
  return (
    <section
      ref={ref}
      id={`finding-${finding.id}`}
      aria-labelledby={id}
      className={`${CARD} scroll-mt-28 transition-shadow ${ringing ? "ring-4 ring-amber-300 ring-offset-2" : ""}`}
    >
      <div className="space-y-1 py-3">
        <SubHeading>
          <span id={id}>Waarom nu?</span>
        </SubHeading>
        <p className="text-sm leading-relaxed text-ink-700">
          <EntityText text={why_now} />
        </p>
      </div>
      <div className="divide-y divide-paper-200 border-t border-paper-200">
        <Part label="Wat komt eraan?">{upcoming_events}</Part>
        <div className="py-3">
          <FindingActions finding={finding} />
        </div>
      </div>
    </section>
  );
}
