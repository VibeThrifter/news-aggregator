"use client";

import { useMemo } from "react";
import useSWR from "swr";

import {
  ApiClientError,
  getEventDetail,
  getEventInsights,
  resolveEventExportUrl,
} from "@/lib/api";
import type {
  AggregationResponse,
  EventDetail,
  EventDetailMeta,
} from "@/lib/api";
import {
  SPECTRUM_STYLES,
  formatEventTimeframe,
  parseIsoDate,
  resolveSpectrumBadges,
} from "@/lib/format";
import { ArticleList } from "@/components/ArticleList";
import { ClusterGrid } from "@/components/ClusterGrid";
import { ContradictionList } from "@/components/ContradictionList";
import { CoverageGapsList } from "@/components/CoverageGapsList";
import { FallacyList } from "@/components/FallacyList";
import { InsightsFallback } from "@/components/InsightsFallback";
import { Timeline } from "@/components/Timeline";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});
const numberFormatter = new Intl.NumberFormat("nl-NL");

interface EventMetaSummary {
  timeframeLabel: string;
  articleCount: number;
  lastUpdatedLabel: string;
  firstSeenLabel: string;
  llmProvider: string | null;
  insightsStatus: string | null;
  insightsGeneratedLabel: string | null;
}

interface EventDetailScreenProps {
  eventId: string;
}

type EventDetailResponse = Awaited<ReturnType<typeof getEventDetail>>;
type EventInsightsResponse = Awaited<ReturnType<typeof getEventInsights>>;

function formatDate(value?: string | null): string {
  const parsed = parseIsoDate(value);
  return parsed ? dateTimeFormatter.format(parsed) : "Onbekend";
}

function normaliseMeta(event: EventDetail, meta?: EventDetailMeta): EventMetaSummary {
  const insightsStatus = (event.insights_status ?? meta?.insights_status ?? null) as string | null;
  const llmProvider = event.llm_provider ?? (meta?.llm_provider as string | undefined) ?? null;
  const generatedAt =
    event.insights_generated_at ?? (meta?.insights_generated_at as string | undefined) ?? (meta?.generated_at as string | undefined) ?? null;
  const firstSeen = event.first_seen_at ?? (meta?.first_seen_at as string | undefined) ?? null;
  const lastUpdated = event.last_updated_at ?? (meta?.last_updated_at as string | undefined) ?? null;

  return {
    timeframeLabel: formatEventTimeframe(event.first_seen_at, event.last_updated_at),
    articleCount: event.article_count,
    lastUpdatedLabel: formatDate(lastUpdated),
    firstSeenLabel: formatDate(firstSeen),
    llmProvider: llmProvider && llmProvider.trim() ? llmProvider : null,
    insightsStatus: insightsStatus?.trim() ?? null,
    insightsGeneratedLabel: generatedAt ? formatDate(generatedAt) : null,
  };
}

function buildSpectrumClassName(spectrumKey: string): string {
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
    SPECTRUM_STYLES[spectrumKey] ?? "border-slate-600 bg-slate-700 text-slate-200"
  }`;
}

function buildErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return fallback;
    }
    return error.payload?.message ?? error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function hasInsightsContent(insights: AggregationResponse | null): boolean {
  if (!insights) {
    return false;
  }
  return Boolean(
    insights.timeline.length ||
    insights.clusters.length ||
    insights.fallacies.length ||
    insights.contradictions.length ||
    insights.coverage_gaps?.length,
  );
}

function LoadingHero() {
  return (
    <header className="space-y-6 rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-glow backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <span className="inline-flex h-4 w-32 animate-pulse rounded-full bg-white/20" />
          <span className="block h-8 w-72 animate-pulse rounded-full bg-white/30" />
          <span className="block h-16 w-full max-w-3xl animate-pulse rounded-2xl bg-white/10" />
        </div>
        <div className="flex flex-col gap-3">
          <span className="block h-4 w-48 animate-pulse rounded-full bg-white/20" />
          <span className="block h-4 w-40 animate-pulse rounded-full bg-white/20" />
          <span className="block h-9 w-36 animate-pulse rounded-full bg-white/20" />
        </div>
      </div>
    </header>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-3xl border border-rose-300/60 bg-rose-500/15 p-8 text-rose-100">
      <h2 className="text-lg font-semibold">Kon event niet laden</h2>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}

export default function EventDetailScreen({ eventId }: EventDetailScreenProps) {
  const {
    data: eventResponse,
    error: eventError,
    isLoading: isEventLoading,
  } = useSWR<EventDetailResponse, unknown>(
    ["event-detail", eventId],
    () => getEventDetail(eventId, { cache: "no-store" }),
    { revalidateOnFocus: false },
  );

  const event = eventResponse?.data ?? null;
  const eventMeta = useMemo(
    () => (event ? normaliseMeta(event, eventResponse?.meta as EventDetailMeta | undefined) : null),
    [event, eventResponse?.meta],
  );

  const shouldFetchInsights = Boolean(event);

  const {
    data: insightsResponse,
    error: insightsError,
    isLoading: isInsightsLoading,
  } = useSWR<EventInsightsResponse, unknown>(
    shouldFetchInsights ? ["event-insights", eventId] : null,
    () => getEventInsights(eventId, { cache: "no-store" }),
    { revalidateOnFocus: false },
  );

  const insights = insightsResponse?.data ?? null;
  const showInsights = hasInsightsContent(insights);
  const articles = event?.articles ?? [];
  const spectrumBadges = event ? resolveSpectrumBadges(event.spectrum_distribution) : [];
  const exportUrl = event ? resolveEventExportUrl(event.id) : null;

  const insightsFallbackReason = useMemo(() => {
    if (insightsError) {
      return buildErrorMessage(insightsError, "Kon insights niet laden.");
    }
    if (!showInsights && !isInsightsLoading && shouldFetchInsights) {
      return "Er zijn nog geen LLM-insights beschikbaar voor dit event.";
    }
    return null;
  }, [insightsError, isInsightsLoading, shouldFetchInsights, showInsights]);

  if (eventError) {
    const message = buildErrorMessage(eventError, "Dit event kon niet worden gevonden.");
    return <ErrorState message={message} />;
  }

  if (!event && isEventLoading) {
    return <LoadingHero />;
  }

  if (!event) {
    return <ErrorState message="Dit event is niet gevonden. Ververs de eventfeed of controleer de backend." />;
  }

  return (
    <div className="space-y-12 pb-16">
      <header className="space-y-6 rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-glow backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-aurora-400">Event detail</p>
            <h1 className="text-3xl font-semibold text-white lg:text-4xl">{event.title}</h1>
            {insights?.summary ? (
              <div className="max-w-3xl rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">{insights.summary}</p>
              </div>
            ) : null}
            {eventMeta ? (
              <dl className="grid gap-3 text-xs uppercase tracking-[0.25em] text-slate-300 sm:grid-cols-2">
                <div className="space-y-1">
                  <dt>Tijdframe</dt>
                  <dd className="text-sm normal-case tracking-normal text-slate-100">{eventMeta.timeframeLabel}</dd>
                </div>
                <div className="space-y-1">
                  <dt>Artikelen</dt>
                  <dd className="text-sm normal-case tracking-normal text-slate-100">
                    {numberFormatter.format(eventMeta.articleCount)} artikelen
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt>Eerste artikel</dt>
                  <dd className="text-sm normal-case tracking-normal text-slate-100">{eventMeta.firstSeenLabel}</dd>
                </div>
                <div className="space-y-1">
                  <dt>Laatste update</dt>
                  <dd className="text-sm normal-case tracking-normal text-slate-100">{eventMeta.lastUpdatedLabel}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-3 rounded-3xl border border-white/10 bg-black/20 p-6">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">LLM-provider</p>
              <p className="text-sm font-medium text-slate-100">{eventMeta?.llmProvider ?? "Onbekend"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Insights status</p>
              <p className="text-sm font-medium text-slate-100">{eventMeta?.insightsStatus ?? "Niet beschikbaar"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Laatste insights-run</p>
              <p className="text-sm font-medium text-slate-100">{eventMeta?.insightsGeneratedLabel ?? "Onbekend"}</p>
            </div>
            {exportUrl ? (
              <a
                href={exportUrl}
                download
                className="inline-flex items-center gap-2 rounded-full border border-aurora-400/60 bg-aurora-500/10 px-4 py-2 text-sm font-semibold text-aurora-100 transition hover:bg-aurora-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-aurora-500 focus-visible:ring-offset-2"
              >
                Download CSV
              </a>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm text-slate-400">
                Laden…
              </span>
            )}
          </div>
        </div>
        {spectrumBadges.length ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Bronverdeling</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {spectrumBadges.map((badge) => (
                <li key={badge.key}>
                  <span className={buildSpectrumClassName(badge.key)}>
                    {badge.label}
                    <span className="ml-2 text-sm font-bold normal-case tracking-normal">
                      {numberFormatter.format(badge.count)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      {insightsFallbackReason ? <InsightsFallback eventId={event.id} reason={insightsFallbackReason} /> : null}

      {showInsights && insights ? (
        <section className="space-y-8">
          {insights.timeline.length ? (
            <div>
              <h2 className="text-2xl font-semibold text-white">Chronologie</h2>
              <p className="mt-1 text-sm text-slate-300">
                Neutrale tijdlijn samengesteld uit gekoppelde artikelen en ingest-buckets.
              </p>
              <div className="mt-4">
                <Timeline data={insights.timeline} />
              </div>
            </div>
          ) : null}

          {insights.clusters.length ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">Invalshoeken</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Groepering van verschillende perspectieven met spectrumlabels en bronlinks.
                </p>
              </div>
              <ClusterGrid clusters={insights.clusters} />
            </div>
          ) : null}

          {insights.fallacies.length ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">Drogredeneringen</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Signalen waar argumentatie afwijkt van journalistieke standaarden.
                </p>
              </div>
              <FallacyList items={insights.fallacies} />
            </div>
          ) : null}

          {insights.contradictions.length ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">Tegenstrijdige claims</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Bronvergelijking met detectie van conflicterende uitspraken.
                </p>
              </div>
              <ContradictionList items={insights.contradictions} />
            </div>
          ) : null}

          {insights.coverage_gaps?.length ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">Onderbelichte perspectieven</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Invalshoeken en contexten die ontbreken in de huidige berichtgeving.
                </p>
              </div>
              <CoverageGapsList items={insights.coverage_gaps} />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">Artikelen</h2>
          <p className="mt-1 text-sm text-slate-300">
            Lijst van artikelen die aan dit event gekoppeld zijn met spectrumlabels en publicatietijd.
          </p>
        </div>
        <ArticleList articles={articles} />
      </section>
    </div>
  );
}
