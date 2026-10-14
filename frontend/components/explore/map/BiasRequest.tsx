"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as revalidate } from "swr";
import { Loader2, Sparkles } from "lucide-react";

import { biasRequestForEvent, requestBiasAnalysis, type BiasRequest, type BiasRequestResult } from "@/lib/bias-request";
import { useAccess, type Access } from "@/lib/explore/access";

import { useExplore } from "../ExploreContext";
import { SubHeading } from "../ui/primitives";

const REASONS: Record<Exclude<BiasRequestResult, { ok: true }>["reason"], string> = {
  geen_toegang: "Deze toegangscode mag dit niet.",
  onbekend_event: "Dit nieuwsitem staat niet in de database.",
  limiet: "De daglimiet van deze code is bereikt.",
  druk: "Het is te druk, probeer het later nog eens.",
  niet_beschikbaar: "De database kent dit nog niet (migratie 019).",
};

/** After the backend is done its analyses reach the website through the publisher (every 10 s) */
const PUBLISH_WAIT_MS = 60_000;
/** A request this long in the queue: the backend may not run */
const WAITING_MS = 60_000;

const running = (request: BiasRequest | null | undefined) => request?.status === "wachtrij" || request?.status === "bezig";

function justFinished(request: BiasRequest | null | undefined) {
  return request?.status === "klaar" && request.finished_at !== null && Date.now() - Date.parse(request.finished_at) < PUBLISH_WAIT_MS;
}

export interface BiasRequestState {
  access: Access;
  request: BiasRequest | null;
  /** Dutch articles of the news without an analysis */
  open: number;
  /** Articles with an analysis, and with at least one coloured sentence of the journalist */
  analysed: number;
  coloured: number;
  /** Something to show in "Hoe gebracht?" */
  show: boolean;
}

/** The latest bias request of this news, for every reader: looked at often while one runs. */
export function useBiasRequest(): BiasRequestState {
  const { exploration, eventId } = useExplore();
  const { input } = exploration;
  const access = useAccess();
  const demo = input.event.isDemo;

  const { unread, analysed, coloured } = useMemo(() => {
    const analyses = Object.values(input.bias);
    return {
      // Not: sources found for a missing voice or added by the reader (no text to read)
      unread: input.articles.filter((article) => !article.isInternational && !article.foundVoice && !article.ownId && !input.bias[article.id]),
      analysed: analyses.length,
      coloured: analyses.filter((analysis) => analysis.journalist_biases.length > 0).length,
    };
  }, [input]);

  const { data } = useSWR(demo ? null : ["bias-request", eventId], () => biasRequestForEvent(eventId), {
    refreshInterval: (latest) => (running(latest) || justFinished(latest) ? 2000 : 0),
    revalidateOnFocus: false,
  });
  const request = data ?? null;
  // After a request that read everything, what is left has no text (the backend skips it): only
  // articles published after it count
  const since = request?.status === "klaar" && request.failed === 0 ? Date.parse(request.created_at) : null;
  const open = since === null ? unread.length : unread.filter((article) => article.publishedAt && Date.parse(article.publishedAt) > since).length;

  // What the backend analysed and Supabase has now joins the page
  const published = request?.analysed ?? 0;
  useEffect(() => {
    if (published > analysed) void revalidate((key) => Array.isArray(key) && key[0] === "explore");
  }, [published, analysed]);

  const show = running(request) || (access.canAnalyzeBias && open > 0) || (analysed > 0 && coloured === 0);
  return { access, request, open, analysed, coloured, show };
}

function StatusLine({ request, holder }: { request: BiasRequest; holder: boolean }) {
  if (request.status === "wachtrij" || request.total === null) {
    const waiting = holder && Date.now() - Date.parse(request.created_at) > WAITING_MS;
    return (
      <p role="status" className="flex items-center gap-1.5 text-sm text-ink-700">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Gekleurde zinnen zoeken: in de wachtrij
        {waiting ? <span className="text-ink-500">· draait de backend?</span> : null}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-ink-700">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Gekleurde zinnen zoeken: {request.done + request.failed} van {request.total}{" "}
      {request.total === 1 ? "artikel" : "artikelen"}
    </p>
  );
}

/**
 * Under "Hoe gebracht?": a paying user or the admin lets AI look for coloured sentences in the
 * Dutch articles of this news (Story 10.7); every reader sees that it runs and what it found.
 */
export function BiasRequestPanel({ state }: { state: BiasRequestState }) {
  const { eventId } = useExplore();
  const { access, request, open, analysed, coloured } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!access.code) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestBiasAnalysis(access.code, eventId);
      if (!result.ok) setError(REASONS[result.reason]);
      await revalidate(["bias-request", eventId]);
    } catch {
      setError("Dat kon niet starten.");
    } finally {
      setBusy(false);
    }
  };

  const active = running(request);
  const canStart = access.canAnalyzeBias && open > 0 && !active;
  return (
    <div className="space-y-2 py-3">
      {active && request ? <StatusLine request={request} holder={access.canAnalyzeBias} /> : null}
      {!active && analysed > 0 && coloured === 0 ? (
        <p className="text-sm text-ink-700">
          Geen gekleurde zinnen in {analysed} {analysed === 1 ? "artikel" : "artikelen"}.
        </p>
      ) : null}
      {canStart ? (
        <section aria-label="Gekleurde zinnen zoeken met AI" className="space-y-2 rounded-2xl border border-teal-200 bg-teal-50/40 p-3">
          <SubHeading className="flex items-center gap-1.5" tone="text-teal-800">
            <Sparkles size={14} aria-hidden="true" /> Gekleurde zinnen · {access.role === "pro" ? "pro" : "admin"}
          </SubHeading>
          {access.canAnalyzeBias && request?.status === "fout" ? (
            <p className="text-sm text-red-800">Dat lukte niet{request.status_reason ? `: ${request.status_reason}` : "."}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
            {analysed > 0 ? "Zoek gekleurde zinnen in de andere artikelen" : "Zoek gekleurde zinnen met AI"}
          </button>
          {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
