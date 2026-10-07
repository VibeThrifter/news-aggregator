"use client";

import { useMemo } from "react";
import Link from "next/link";

import { resolveEventSlug } from "@/lib/format";
import { fullTitle, LEAD_QUOTES, LEAD_TEASER, outletQuotes, teaserOf } from "@/lib/front-page";
import type { EventListItem } from "@/lib/types";

import { Conversation, MissingVoicePill, MissingVoices, OutletPills, StoryImage, StoryMeta } from "./StoryParts";

const CARD =
  "group border border-paper-300 bg-paper-50 transition-shadow hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue";
const TITLE = "font-serif font-bold text-ink-900 decoration-1 underline-offset-4 group-hover:underline";

/**
 * The lead (see `pickTopStories`), and next to it a small "Wie zegt wat?": what each outlet
 * reported and who is not given the word.
 */
export function LeadStory({ event }: { event: EventListItem }) {
  const teaser = useMemo(() => teaserOf(event.summary, LEAD_TEASER), [event.summary]);
  const quotes = useMemo(() => outletQuotes(event, { max: LEAD_QUOTES, teaser }), [event, teaser]);
  const voices = event.missing_voices ?? [];
  const figure = quotes.length > 0 || voices.length > 0;

  return (
    <Link href={resolveEventSlug(event)} className={`${CARD} block rounded-3xl p-3 sm:p-4 lg:p-5`}>
      <article className={figure ? "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-8" : ""}>
        <div>
          <StoryImage src={event.featured_image_url} priority sizes="(max-width: 1024px) 100vw, 640px" className="aspect-[16/9] rounded-2xl" />
          <div className="space-y-3 px-1 pt-4 sm:px-2">
            <StoryMeta event={event} full />
            <h2 className={`${TITLE} text-[26px] leading-tight sm:text-3xl`}>{fullTitle(event)}</h2>
            {teaser ? <p className="font-serif text-[17px] leading-relaxed text-ink-800">{teaser}</p> : null}
          </div>
        </div>
        {figure ? (
          <div className="space-y-4 px-1 sm:px-2 lg:px-0 lg:pt-1">
            {quotes.length ? (
              <>
                <h3 className="font-serif text-xl font-bold text-ink-900">Wie zegt wat?</h3>
                <div className="rounded-3xl bg-paper-100 p-3 pb-4 sm:p-4 sm:pb-5">
                  <Conversation quotes={quotes} />
                </div>
              </>
            ) : null}
            <MissingVoices voices={voices} />
          </div>
        ) : null}
      </article>
    </Link>
  );
}

/** A top story next to the lead: photo and headline, then what two outlets reported. */
export function TopStory({ event }: { event: EventListItem }) {
  const teaser = useMemo(() => teaserOf(event.summary, 200), [event.summary]);
  const quotes = useMemo(() => outletQuotes(event, { max: 2, length: 150, teaser }), [event, teaser]);

  return (
    <Link href={resolveEventSlug(event)} className={`${CARD} flex h-full flex-col gap-4 rounded-3xl p-4 sm:p-5`}>
      <div className="flex gap-4">
        <StoryImage src={event.featured_image_url} sizes="128px" className="h-[84px] w-28 shrink-0 rounded-2xl sm:h-24 sm:w-32" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <StoryMeta event={event} />
          <h2 className={`${TITLE} line-clamp-3 text-lg leading-snug sm:text-xl`}>{fullTitle(event)}</h2>
        </div>
      </div>
      {/* Two outlets say enough; with one, the start of the story comes first */}
      {quotes.length < 2 && teaser ? <p className="line-clamp-3 font-serif text-[15px] leading-relaxed text-ink-700">{teaser}</p> : null}
      {quotes.length ? (
        <div className="rounded-3xl bg-paper-100 p-3 pb-4">
          <Conversation quotes={quotes} />
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <OutletPills event={event} />
        <MissingVoicePill voices={event.missing_voices} />
      </div>
    </Link>
  );
}

/** A news item under its day: photo, headline, the start of the story, who brought it, who is missing. */
export function StoryCard({ event }: { event: EventListItem }) {
  const teaser = useMemo(() => teaserOf(event.summary, 220), [event.summary]);
  const analysed = event.has_llm_insights !== false;

  return (
    <Link href={resolveEventSlug(event)} className={`${CARD} flex h-full flex-col overflow-hidden rounded-2xl`}>
      <StoryImage src={event.featured_image_url} sizes="(max-width: 1024px) 50vw, 400px" className="hidden aspect-[16/9] sm:block" />
      <article className="flex flex-1 flex-col gap-2.5 p-4 sm:p-5">
        <div className="flex gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <StoryMeta event={event} timeOnly />
            {analysed ? (
              <h3 className={`${TITLE} line-clamp-3 text-[17px] leading-snug sm:text-lg`}>{fullTitle(event)}</h3>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Wacht op analyse</span>
                Nieuwsitem {event.id}
              </p>
            )}
          </div>
          <StoryImage src={event.featured_image_url} sizes="96px" className="h-[72px] w-24 shrink-0 rounded-xl sm:hidden" />
        </div>
        {teaser ? <p className="line-clamp-3 font-serif text-[15px] leading-relaxed text-ink-700">{teaser}</p> : null}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <OutletPills event={event} />
          <MissingVoicePill voices={event.missing_voices} />
        </div>
      </article>
    </Link>
  );
}
