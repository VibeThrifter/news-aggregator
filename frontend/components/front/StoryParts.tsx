"use client";

import Image from "next/image";
import { Globe } from "lucide-react";

import { eventCategory, newsTime, plural } from "@/components/EventMeta";
import { Favicon } from "@/components/explore/ui/primitives";
import { GROUP_COLORS } from "@/lib/explore/colors";
import { outletsLine, parseIsoDate } from "@/lib/format";
import { dutchOutletNames, foreignOutletCount, type FrontClaim, type OutletQuote, type StoryHook } from "@/lib/front-page";
import type { EventListItem } from "@/lib/types";

/** The colours of the markers on the event page: a claim without evidence, a question */
const CLAIM_COLOR = "#E30613";
const QUESTION_COLOR = "#0f766e";

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

/** The sign of a marker of the event page ("!" a claim, "?" a question), without its number. */
function Sign({ sign, color }: { sign: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow ring-2 ring-white"
      style={{ backgroundColor: color }}
    >
      {sign}
    </span>
  );
}

/**
 * "Klopt het?": a claim without evidence, who makes it and the question to ask, as a row of the
 * event page. `compact` (a card): with its heading, without the question.
 */
export function ClaimRow({ claim, compact = false }: { claim: FrontClaim; compact?: boolean }) {
  return (
    <div className={`border border-paper-300 bg-white ${compact ? "rounded-2xl p-3" : "rounded-3xl p-3 sm:p-4"}`}>
      {compact ? <p className="mb-1.5 font-serif text-[15px] font-bold text-ink-900">Klopt het?</p> : null}
      <div className="flex items-start gap-2.5">
        <span className="pt-0.5">
          <Sign sign="!" color={CLAIM_COLOR} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className={`${compact ? "line-clamp-3 text-[13px]" : "line-clamp-4 text-sm"} italic leading-snug text-ink-900`}>{claim.claim}</p>
          <p className="text-xs text-ink-500">
            {claim.speaker ? (
              <>
                <span className="font-semibold text-ink-700">{claim.speaker}</span>
                {claim.role ? ` (${claim.role})` : ""}
                <span aria-hidden="true"> · </span>
              </>
            ) : null}
            <span className="font-semibold" style={{ color: CLAIM_COLOR }}>
              zonder bewijs
            </span>
          </p>
        </div>
      </div>
      {claim.question && !compact ? (
        <p className="mt-3 flex items-start gap-2.5 border-t border-paper-200 pt-3 text-sm leading-snug text-ink-800">
          <span className="pt-px">
            <Sign sign="?" color={QUESTION_COLOR} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="sr-only">Vraag die je kunt stellen: </span>
            {claim.question}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** What makes you read on: a claim someone makes ("Klopt het?"), or the next part of the story under its heading. */
export function HookBox({ hook }: { hook: StoryHook | null }) {
  if (!hook) return null;
  if (hook.kind === "claim") return <ClaimRow claim={hook.claim} compact />;
  return (
    <div className="rounded-2xl bg-paper-100 p-3">
      <p className="font-serif text-[15px] font-bold leading-snug text-ink-900">{hook.section.heading}</p>
      <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-ink-700">{hook.section.text}</p>
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
