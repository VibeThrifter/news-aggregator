"use client";

import { useState } from "react";
import useSWR, { mutate as revalidate } from "swr";
import { Check, ChevronRight, ExternalLink, Loader2, Sparkles, Undo2, X } from "lucide-react";

import { useAccess } from "@/lib/explore/access";
import { foundVoicesFor } from "@/lib/explore/figure";
import { truncate } from "@/lib/explore/summary";
import {
  requestVoiceSearch,
  reviewVoiceCandidate,
  voiceSearchesForEvent,
  type VoiceCandidate,
  type VoiceRequestResult,
  type VoiceSearch,
  type VoiceVerdict,
} from "@/lib/voice-search";

import { useExplore } from "../ExploreContext";
import { Eyebrow, Favicon } from "../ui/primitives";
import { Avatar } from "./PeopleCards";

const day = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });
/** A search for the same voice can be repeated after this (the database returns the old one before) */
const RETRY_MS = 10 * 60_000;

const REASONS: Record<Exclude<VoiceRequestResult, { ok: true }>["reason"], string> = {
  geen_toegang: "Deze toegangscode mag niet zoeken.",
  ongeldig: "Deze stem kan niet gezocht worden.",
  onbekend_event: "Dit nieuwsitem staat niet in de database.",
  limiet: "De daglimiet van deze code is bereikt.",
  druk: "Het is te druk, probeer het later nog eens.",
  niet_beschikbaar: "De database kent het zoeken nog niet (migratie 009).",
};

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/** The searches of this news (admin only): refreshed while one is queued or running. */
export function useVoiceSearches() {
  const { exploration, eventId } = useExplore();
  const access = useAccess();
  const demo = exploration.input.event.isDemo;
  const swr = useSWR(
    access.canSearch && access.code ? ["voice-searches", eventId, access.code, demo] : null,
    () => voiceSearchesForEvent(access.code as string, eventId, { demo }),
    {
      refreshInterval: (data) => (data?.some((search) => search.status === "wachtrij" || search.status === "bezig") ? 2500 : 0),
      revalidateOnFocus: false,
    },
  );
  return { access, demo, searches: swr.data ?? [], refresh: () => swr.mutate() };
}

function latestFor(searches: VoiceSearch[], findingId: string, perspective: string): VoiceSearch | null {
  return searches.find((search) => search.gap_key === findingId) ?? searches.find((search) => normalize(search.perspective) === normalize(perspective)) ?? null;
}

/** Reload the news: an approved source is now one of its articles. */
function reloadNews() {
  return revalidate((key) => Array.isArray(key) && key[0] === "explore");
}

export interface VoiceTarget {
  /** The missing voice in the app: gap:<hash> or own:<id> */
  findingId: string;
  perspective: string;
  context?: string | null;
  origin: "analyse" | "eigen";
}

function useStartSearch(target: VoiceTarget) {
  const { eventId } = useExplore();
  const { access, demo, refresh } = useVoiceSearches();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    if (!access.code) return false;
    setBusy(true);
    setError(null);
    try {
      const result = await requestVoiceSearch(
        access.code,
        eventId,
        { perspective: target.perspective, context: target.context ?? null, origin: target.origin, gapKey: target.findingId },
        { demo },
      );
      if (!result.ok) setError(REASONS[result.reason]);
      await refresh();
      return result.ok;
    } catch {
      setError("Zoeken kon niet starten.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { start, busy, error };
}

function SearchButton({ onClick, busy, again = false }: { onClick: () => void; busy: boolean; again?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
    >
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
      {again ? "Opnieuw zoeken met AI" : "Zoek met AI wie dit wél zegt"}
    </button>
  );
}

function StatusLine({ search }: { search: VoiceSearch }) {
  const since = clock.format(new Date(search.created_at));
  const waiting = Date.now() - Date.parse(search.created_at) > 3 * 60_000;
  switch (search.status) {
    case "wachtrij":
      return (
        <p role="status" className="flex items-center gap-1.5 text-sm text-ink-700">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> In de wachtrij sinds {since}
          {waiting ? <span className="text-ink-500">· draait de backend?</span> : null}
        </p>
      );
    case "bezig":
      return (
        <p role="status" className="flex items-center gap-1.5 text-sm text-ink-700">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Zoekt in het nieuws…
        </p>
      );
    case "niets_gevonden":
      return <p className="text-sm text-ink-700">Niemand gevonden die dit wél zegt.</p>;
    case "fout":
      return <p className="text-sm text-red-800">Zoeken lukte niet{search.status_reason ? `: ${search.status_reason}` : "."}</p>;
    default: {
      const count = search.candidates.length;
      return (
        <p className="text-sm text-ink-700">
          {count === 1 ? "1 bron gevonden" : `${count} bronnen gevonden`} · {day.format(new Date(search.finished_at ?? search.created_at))}
        </p>
      );
    }
  }
}

function CandidateRow({ search, candidate, demo }: { search: VoiceSearch; candidate: VoiceCandidate; demo: boolean }) {
  const { access, refresh } = useVoiceSearches();
  const [busy, setBusy] = useState<VoiceVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const review = async (verdict: VoiceVerdict) => {
    if (!access.code) return;
    setBusy(verdict);
    setError(null);
    try {
      const result = await reviewVoiceCandidate(access.code, search.id, candidate.id, verdict, { demo });
      if (!result.ok) setError(result.reason === "geen_toegang" ? "Deze code mag niet goedkeuren." : "Dat lukte niet.");
      await refresh();
      await reloadNews();
    } catch {
      setError("Dat lukte niet.");
    } finally {
      setBusy(null);
    }
  };
  const approved = candidate.verdict === "goedgekeurd";
  const rejected = candidate.verdict === "afgewezen";
  const published = candidate.published_at ? day.format(new Date(candidate.published_at)) : null;
  return (
    <li className={`space-y-1.5 rounded-xl border p-3 ${approved ? "border-teal-300 bg-teal-50/60" : "border-paper-300 bg-white"} ${rejected ? "opacity-60" : ""}`}>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
        <Favicon name={candidate.outlet ?? "?"} domain={candidate.domain} size={16} />
        <strong className="text-sm font-semibold text-ink-900">{candidate.outlet ?? candidate.domain}</strong>
        {published ? <span>{published}</span> : null}
        {approved ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-700 px-1.5 text-[10px] font-semibold text-white">
            <Check size={10} aria-hidden="true" /> toegevoegd
          </span>
        ) : null}
      </p>
      {candidate.who ? <p className="text-sm font-semibold text-ink-900">{candidate.who}</p> : null}
      {candidate.gist ? <p className="text-sm leading-relaxed text-ink-800">{candidate.gist}</p> : null}
      {/* The headline only as link text; demo articles do not exist */}
      {demo ? (
        <p className="text-xs text-ink-500">{truncate(candidate.title, 140)}</p>
      ) : (
        <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-xs font-semibold text-accent-blue">
          {truncate(candidate.title, 140)} <ExternalLink size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        </a>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {approved ? (
          <button
            type="button"
            onClick={() => review("open")}
            disabled={busy !== null}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 px-3 text-xs font-semibold text-ink-700 hover:bg-paper-100"
          >
            <Undo2 size={14} aria-hidden="true" /> Haal weg uit dit nieuws
          </button>
        ) : rejected ? (
          <button
            type="button"
            onClick={() => review("open")}
            disabled={busy !== null}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 px-3 text-xs font-semibold text-ink-700 hover:bg-paper-100"
          >
            <Undo2 size={14} aria-hidden="true" /> Herstel
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => review("goedgekeurd")}
              disabled={busy !== null}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-ink-900 px-3 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy === "goedgekeurd" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />} Voeg toe aan dit nieuws
            </button>
            <button
              type="button"
              onClick={() => review("afgewezen")}
              disabled={busy !== null}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 px-3 text-xs font-semibold text-ink-700 hover:bg-paper-100"
            >
              <X size={14} aria-hidden="true" /> Klopt niet
            </button>
          </>
        )}
      </div>
      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
    </li>
  );
}

/**
 * The search for one missing voice, in its row: start it, follow it, and approve or reject what it
 * found. Only with an access code that may search.
 */
export function VoiceSearchPanel(target: VoiceTarget) {
  const { access, demo, searches } = useVoiceSearches();
  const { start, busy, error } = useStartSearch(target);
  if (!access.canSearch) return null;
  const search = latestFor(searches, target.findingId, target.perspective);
  const done = search && (search.status === "klaar" || search.status === "niets_gevonden" || search.status === "fout");
  const canRetry = done && Date.now() - Date.parse(search.created_at) > RETRY_MS;
  return (
    <section aria-label="Zoeken met AI" className="space-y-2 rounded-2xl border border-teal-200 bg-teal-50/40 p-3">
      <Eyebrow className="flex items-center gap-1.5 text-teal-800">
        <Sparkles size={12} aria-hidden="true" /> Zoeken met AI · admin
      </Eyebrow>
      {search ? <StatusLine search={search} /> : null}
      {search?.status === "klaar" && search.candidates.length ? (
        <ul className="space-y-2">
          {search.candidates.map((candidate) => (
            <CandidateRow key={candidate.id} search={search} candidate={candidate} demo={demo} />
          ))}
        </ul>
      ) : null}
      {!search || canRetry ? <SearchButton onClick={() => void start()} busy={busy} again={Boolean(search)} /> : null}
      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}

/** In the popover: start the search (it continues in the row), or where it stands. */
export function VoiceSearchCompact({ target, onNavigate }: { target: VoiceTarget; onNavigate?: () => void }) {
  const { toFinding } = useExplore();
  const { access, searches } = useVoiceSearches();
  const { start, busy, error } = useStartSearch(target);
  if (!access.canSearch) return null;
  const search = latestFor(searches, target.findingId, target.perspective);
  const open = () => {
    onNavigate?.();
    toFinding(target.findingId);
  };
  if (!search) {
    return (
      <div className="space-y-1">
        <SearchButton
          busy={busy}
          onClick={async () => {
            if (await start()) open();
          }}
        />
        {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
      </div>
    );
  }
  return (
    <button type="button" onClick={open} className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/60 px-3 text-left">
      <Sparkles size={14} className="shrink-0 text-teal-700" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <StatusLine search={search} />
      </span>
      <ChevronRight size={14} className="shrink-0 text-ink-400" aria-hidden="true" />
    </button>
  );
}

/** Where a missing voice speaks after all (approved AI search): for every reader. */
export function FoundVoices({ findingId, label, onNavigate }: { findingId: string; label: string; onNavigate?: () => void }) {
  const { exploration, toAnchor } = useExplore();
  const found = foundVoicesFor(exploration.speakers, findingId, label);
  if (found.length === 0) return null;
  return (
    <div className="space-y-1">
      <Eyebrow className="text-teal-800">Wél aan het woord</Eyebrow>
      <ul className="space-y-1">
        {found.map((ref) => {
          const speaker = exploration.speakers.byId.get(ref.speakerId);
          const outlet = exploration.index.outlet(ref.outletKey);
          if (!speaker) return null;
          return (
            <li key={ref.speakerId}>
              <button
                type="button"
                onClick={() => {
                  onNavigate?.();
                  toAnchor(`speaker:${ref.speakerId}`);
                }}
                className="flex min-h-[44px] w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-paper-100"
              >
                <Avatar speaker={speaker} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-1.5 text-ink-900">
                    <strong className="font-semibold">{speaker.name}</strong>
                    {outlet ? (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-500">
                        bij <Favicon name={outlet.name} domain={outlet.domain} size={12} /> {outlet.name}
                      </span>
                    ) : null}
                  </span>
                  {speaker.quote ? <span className="mt-0.5 block italic text-ink-800">{truncate(speaker.quote, 200)}</span> : null}
                </span>
                <ChevronRight size={14} className="mt-1 shrink-0 text-ink-400" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
