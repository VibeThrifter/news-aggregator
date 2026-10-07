"use client";

import Image from "next/image";
import { Globe, MicOff } from "lucide-react";

import { eventCategory, newsTime, plural } from "@/components/EventMeta";
import { Favicon } from "@/components/explore/ui/primitives";
import { GROUP_COLORS } from "@/lib/explore/colors";
import { outletsLine, parseIsoDate } from "@/lib/format";
import { dutchOutletNames, foreignOutletCount, type OutletQuote } from "@/lib/front-page";
import type { EventListItem } from "@/lib/types";

/** The colours of "Niet aan het woord" on the event page */
const MISSING_BORDER = "#0f766e88";
const MISSING_BACKGROUND = "#0f766e0d";

const clock = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });

/** The photo of the news, or nothing. */
export function StoryImage({ src, sizes, className = "", priority = false }: { src?: string | null; sizes: string; className?: string; priority?: boolean }) {
  if (!src) return null;
  return (
    <div className={`relative overflow-hidden bg-paper-200 ${className}`}>
      <Image src={src} alt="" fill priority={priority} sizes={sizes} className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
    </div>
  );
}

/**
 * Category and time, like the head of the event page. `full` adds who brought it and the number of
 * articles; `timeOnly` leaves out the day (the news is under its day).
 */
export function StoryMeta({ event, full = false, timeOnly = false }: { event: EventListItem; full?: boolean; timeOnly?: boolean }) {
  const category = eventCategory(event.event_type);
  const moment = parseIsoDate(event.last_updated_at);
  const time = timeOnly ? (moment ? clock.format(moment) : null) : newsTime(event.last_updated_at);
  const outlets = full ? outletsLine(dutchOutletNames(event), foreignOutletCount(event)) : "";
  const parts = [time, outlets, full ? plural(event.article_count, "artikel", "artikelen") : null].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
      {category ? (
        <span
          data-testid="category-badge"
          className={`rounded-full border px-2 py-0.5 font-semibold ${category.color} ${category.bgColor} ${category.borderColor}`}
        >
          {category.label}
        </span>
      ) : null}
      {/* The dot sticks to the part before it, so a wrapped line never starts with one */}
      {parts.map((part, index) => (
        <span key={index} className={index < parts.length - 1 ? "after:ml-2 after:content-['·']" : ""}>
          {part}
        </span>
      ))}
    </div>
  );
}

/** Who brought it: the Dutch outlets as pills, foreign ones counted. */
export function OutletPills({ event, max = 3 }: { event: EventListItem; max?: number }) {
  const dutch = dutchOutletNames(event);
  const foreign = foreignOutletCount(event);
  const more = dutch.length - max;
  const pill = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-2.5 text-xs font-semibold text-ink-700";
  return (
    <>
      {dutch.slice(0, max).map((name) => (
        <span key={name} className={pill}>
          <Favicon name={name} size={14} />
          {name}
        </span>
      ))}
      {more > 0 ? <span className={pill}>+{more}</span> : null}
      {foreign ? (
        <span className={pill}>
          <Globe size={13} aria-hidden="true" className="text-ink-400" />
          {dutch.length ? "+" : ""}
          {foreign} buitenland
        </span>
      ) : null}
    </>
  );
}

/** The first missing voice as a dashed pill, as on the event page. */
export function MissingVoicePill({ voices }: { voices?: string[] | null }) {
  if (!voices?.length) return null;
  return (
    <span
      title={`Niet aan het woord: ${voices.join(", ")}`}
      className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full border-2 border-dashed border-teal-600/50 bg-white/70 px-2.5 text-xs text-ink-700"
    >
      <MicOff size={13} aria-hidden="true" className="shrink-0 text-teal-700" />
      <span className="sr-only">Niet aan het woord:</span>
      <span className="truncate">{voices[0]}</span>
      {voices.length > 1 ? <span className="shrink-0 font-semibold text-teal-800">+{voices.length - 1}</span> : null}
    </span>
  );
}

/** "Niet aan het woord" with every missing voice, as on the event page. */
export function MissingVoices({ voices }: { voices?: string[] | null }) {
  if (!voices?.length) return null;
  return (
    <div className="rounded-3xl border-2 border-dashed p-3" style={{ borderColor: MISSING_BORDER, backgroundColor: MISSING_BACKGROUND }}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-800">
        <MicOff size={14} aria-hidden="true" /> Niet aan het woord
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {voices.map((voice) => (
          <li
            key={voice}
            className="flex min-h-[32px] max-w-full items-center gap-1.5 rounded-2xl border-2 border-dashed border-teal-600/50 bg-white/70 py-1 pl-2 pr-2.5 text-[12px] leading-snug text-ink-800"
          >
            <MicOff size={13} aria-hidden="true" className="shrink-0 text-teal-700" />
            <span className="line-clamp-2">{voice}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What each outlet reported, as balloons that answer each other. */
export function Conversation({ quotes }: { quotes: OutletQuote[] }) {
  if (quotes.length === 0) return null;
  return (
    <ul className="space-y-3.5">
      {quotes.map((quote, index) => {
        const right = index % 2 === 1;
        const color = GROUP_COLORS[index % GROUP_COLORS.length];
        return (
          <li key={quote.outlet} className={`w-[92%] ${right ? "ml-auto" : ""}`}>
            <span className="relative flex items-start gap-2 rounded-[20px] border-2 bg-white px-3 py-2 shadow-bubble" style={{ borderColor: color }}>
              <Favicon name={quote.outlet} size={20} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-ink-900">{quote.outlet}</span>
                <span className="block text-[13px] leading-snug text-ink-800">{quote.text}</span>
              </span>
              <span
                aria-hidden="true"
                className={`absolute -bottom-[7px] h-3 w-3 rotate-45 border-b-2 border-r-2 bg-white ${right ? "right-6" : "left-5"}`}
                style={{ borderColor: color }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
