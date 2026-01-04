"use client";

import { useMemo } from "react";
import useSWR from "swr";

import {
  ApiClientError,
  getEventDetail,
  getEventInsights,
} from "@/lib/api";
import type {
  AggregationResponse,
  EventDetail,
  EventDetailMeta,
} from "@/lib/api";
import {
  formatEventTimeframe,
  parseIsoDate,
} from "@/lib/format";
import { eventDetailSwrOptions, insightsSwrOptions } from "@/lib/swr-config";
import { ArticleList } from "@/components/ArticleList";
import { InternationalSources } from "@/components/InternationalSources";
import { SpectrumBar } from "@/components/SpectrumBar";
import { ArticleLookupProvider } from "@/components/ArticleLookupContext";
import { ClusterGrid } from "@/components/ClusterGrid";
import { ContradictionList } from "@/components/ContradictionList";
import { CoverageGapsList } from "@/components/CoverageGapsList";
import {
  UnsubstantiatedClaimsList,
  AuthorityAnalysisList,
  MediaAnalysisList,
  ScientificPluralityCard,
  StatisticalIssuesList,
  TimingAnalysisCard,
} from "@/components/CriticalAnalysis";
import { FallacyList } from "@/components/FallacyList";
import { FrameList } from "@/components/FrameList";
import { InsightsFallback } from "@/components/InsightsFallback";
import { Timeline } from "@/components/Timeline";
import ReactMarkdown from "react-markdown";

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
  const firstSeen = event.first_seen_at ?? (meta?.first_seen_at as string | undefined) ?? null;
  const lastUpdated = event.last_updated_at ?? (meta?.last_updated_at as string | undefined) ?? null;

  return {
    timeframeLabel: formatEventTimeframe(event.first_seen_at, event.last_updated_at),
    articleCount: event.article_count,
    lastUpdatedLabel: formatDate(lastUpdated),
    firstSeenLabel: formatDate(firstSeen),
  };
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
    insights.coverage_gaps?.length ||
    insights.unsubstantiated_claims?.length ||
    insights.authority_analysis?.length ||
    insights.media_analysis?.length ||
    insights.statistical_issues?.length ||
    insights.timing_analysis ||
    insights.scientific_plurality,
  );
}

function LoadingHero() {
  return (
    <header className="space-y-6 rounded-sm border border-paper-300 bg-paper-50 p-8 shadow-card-light">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <span className="inline-flex h-4 w-32 animate-pulse rounded-sm bg-paper-200" />
          <span className="block h-8 w-72 animate-pulse rounded-sm bg-paper-200" />
          <span className="block h-16 w-full max-w-3xl animate-pulse rounded-sm bg-paper-100" />
        </div>
        <div className="flex flex-col gap-3">
          <span className="block h-4 w-48 animate-pulse rounded-sm bg-paper-200" />
          <span className="block h-4 w-40 animate-pulse rounded-sm bg-paper-200" />
          <span className="block h-9 w-36 animate-pulse rounded-sm bg-paper-200" />
        </div>
      </div>
    </header>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-sm border border-red-200 bg-red-50 p-8 text-red-700">
      <h2 className="text-lg font-semibold">Kon event niet laden</h2>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}

export default function EventDetailScreen({ eventId }: EventDetailScreenProps) {
  // Story 4 (INFRA): Event detail cached for 1 minute to reduce Supabase egress
  const {
    data: eventResponse,
    error: eventError,
    isLoading: isEventLoading,
  } = useSWR<EventDetailResponse, unknown>(
    ["event-detail", eventId],
    () => getEventDetail(eventId),
    eventDetailSwrOptions,
  );

  const event = eventResponse?.data ?? null;
  const eventMeta = useMemo(
    () => (event ? normaliseMeta(event, eventResponse?.meta as EventDetailMeta | undefined) : null),
    [event, eventResponse?.meta],
  );

  const shouldFetchInsights = Boolean(event);

  // Story 4 (INFRA): Insights cached for 5 minutes (regeneration is manual)
  const {
    data: insightsResponse,
    error: insightsError,
    isLoading: isInsightsLoading,
  } = useSWR<EventInsightsResponse, unknown>(
    shouldFetchInsights ? ["event-insights", eventId] : null,
    () => getEventInsights(eventId),
    insightsSwrOptions,
  );

  const insights = insightsResponse?.data ?? null;
  const showInsights = hasInsightsContent(insights);
  const articles = event?.articles ?? [];

  // Split articles into Dutch (non-international) and international
  const { dutchArticles, internationalArticles } = useMemo(() => {
    const dutch = articles.filter((a) => !a.is_international);
    const international = articles.filter((a) => a.is_international);
    return { dutchArticles: dutch, internationalArticles: international };
  }, [articles]);

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
    <ArticleLookupProvider articles={articles}>
      <div className="space-y-12 pb-16">
        <header className="space-y-6 rounded-sm border border-paper-300 bg-paper-50 p-8 shadow-card-light">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent-blue">Event detail</p>
            <h1 className="font-serif text-3xl font-bold text-ink-900 lg:text-4xl">{event.title}</h1>
            {insights?.summary ? (
              <div className="max-w-3xl rounded-sm border border-paper-200 bg-paper-100 p-4">
                <div className="prose prose-sm prose-neutral max-w-none
                  prose-p:leading-relaxed prose-p:my-2 prose-p:text-ink-700
                  prose-strong:text-ink-900 prose-strong:font-semibold
                  prose-headings:text-ink-900 prose-headings:font-serif prose-headings:mt-4 prose-headings:mb-2
                  prose-li:text-ink-700 prose-ul:my-2 prose-ol:my-2">
                  <ReactMarkdown>{
                    // Strip first line (title) from summary - LLM generates title without punctuation
                    // Match: title\n\n or title.\n\n or title\n or title. (sentence with period)
                    insights.summary
                      .replace(/^[^\n.!?]+\n\n/, '')  // Title without punctuation followed by blank line
                      .replace(/^[^\n]+[.!?]\s*\n\n/, '')  // Title with punctuation followed by blank line
                      .replace(/^[^\n.!?]+\n/, '')  // Fallback: title without punctuation, single newline
                  }</ReactMarkdown>
                </div>
              </div>
            ) : null}
            {eventMeta ? (
              <dl className="grid gap-3 text-xs uppercase tracking-[0.25em] text-ink-500 sm:grid-cols-2">
                <div className="space-y-1">
                  <dt>Tijdframe</dt>
                  <dd className="text-sm normal-case tracking-normal text-ink-900">{eventMeta.timeframeLabel}</dd>
                </div>
                <div className="space-y-1">
                  <dt>Artikelen</dt>
                  <dd className="text-sm normal-case tracking-normal text-ink-900">
                    {numberFormatter.format(eventMeta.articleCount)} artikelen
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt>Eerste artikel</dt>
                  <dd className="text-sm normal-case tracking-normal text-ink-900">{eventMeta.firstSeenLabel}</dd>
                </div>
                <div className="space-y-1">
                  <dt>Laatste update</dt>
                  <dd className="text-sm normal-case tracking-normal text-ink-900">{eventMeta.lastUpdatedLabel}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-500 mb-3">Bronverdeling</p>
          <SpectrumBar sourceBreakdown={event.source_breakdown} />
        </div>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="font-serif text-2xl font-bold text-ink-900">
            Nederlandse bronnen ({dutchArticles.length})
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            Artikelen van Nederlandse media over dit event met spectrumlabels en publicatietijd.
          </p>
        </div>
        <ArticleList articles={dutchArticles} />
      </section>

      {internationalArticles.length > 0 && (
        <InternationalSources articles={articles} />
      )}

      {insightsFallbackReason ? <InsightsFallback eventId={event.id} reason={insightsFallbackReason} /> : null}

      {showInsights && insights ? (
        <section className="space-y-12">
          {/* === SECTIE 1: OVERZICHT === */}
          {insights.timeline.length ? (
            <div>
              <h2 className="font-serif text-2xl font-bold text-ink-900">Chronologie</h2>
              <p className="mt-1 text-sm text-ink-600">
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
                <h2 className="font-serif text-2xl font-bold text-ink-900">Standpunten</h2>
                <p className="mt-1 text-sm text-ink-600">
                  Groepering van artikelen op basis van ingenomen standpunt of perspectief.
                </p>
              </div>
              <ClusterGrid clusters={insights.clusters} />
            </div>
          ) : null}

          {/* === SECTIE 2: KRITISCHE ANALYSE === */}
          {(insights.unsubstantiated_claims?.length ||
            insights.authority_analysis?.length ||
            insights.media_analysis?.length ||
            insights.statistical_issues?.length ||
            insights.timing_analysis ||
            insights.scientific_plurality ||
            insights.fallacies.length ||
            insights.frames?.length) ? (
            <div className="space-y-8">
              <div className="border-t border-paper-300 pt-8">
                <h2 className="font-serif text-2xl font-bold text-accent-blue">Kritische Analyse</h2>
                <p className="mt-1 text-sm text-ink-600">
                  Diepgaande analyse van claims, bronnen, framing en berichtgeving.
                </p>
              </div>

              {insights.unsubstantiated_claims?.length ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Ononderbouwde claims</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Claims die als feit worden gepresenteerd zonder adequate onderbouwing.
                    </p>
                  </div>
                  <UnsubstantiatedClaimsList items={insights.unsubstantiated_claims} />
                </div>
              ) : null}

              {insights.authority_analysis?.length ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Bronkritiek</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Kritische analyse van geciteerde autoriteiten en hun mandaat.
                    </p>
                  </div>
                  <AuthorityAnalysisList items={insights.authority_analysis} />
                </div>
              ) : null}

              {insights.fallacies.length ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Drogredeneringen</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Logische drogredenen in de argumentatie.
                    </p>
                  </div>
                  <FallacyList items={insights.fallacies} />
                </div>
              ) : null}

              {insights.frames?.length ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Framingtechnieken</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Hoe het verhaal wordt gepresenteerd en welke aspecten worden benadrukt of weggelaten.
                    </p>
                  </div>
                  <FrameList items={insights.frames} />
                </div>
              ) : null}

              {insights.statistical_issues?.length ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Misleidende statistieken</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Statistieken die mogelijk misleidend of onvolledig worden gepresenteerd.
                    </p>
                  </div>
                  <StatisticalIssuesList items={insights.statistical_issues} />
                </div>
              ) : null}

              {insights.timing_analysis ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Timing analyse</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Waarom is dit nu nieuws? Wie profiteert van deze timing?
                    </p>
                  </div>
                  <TimingAnalysisCard data={insights.timing_analysis} />
                </div>
              ) : null}

              {insights.scientific_plurality ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Wetenschappelijke pluraliteit</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Wordt dit onderwerp gepresenteerd als consensus terwijl er wetenschappelijk debat is?
                    </p>
                  </div>
                  <ScientificPluralityCard data={insights.scientific_plurality} />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* === SECTIE 3: MEDIA-ANALYSE === */}
          {insights.media_analysis?.length ? (
            <div className="space-y-4">
              <div className="border-t border-paper-300 pt-8">
                <h2 className="font-serif text-2xl font-bold text-accent-red">Media-analyse</h2>
                <p className="mt-1 text-sm text-ink-600">
                  Kritische analyse van de berichtgeving: bronnenpatronen, niet-gestelde vragen, en narratief-uitlijning.
                </p>
              </div>
              <MediaAnalysisList items={insights.media_analysis} />
            </div>
          ) : null}

          {/* === SECTIE 4: VERGELIJKING === */}
          {(insights.contradictions.length || insights.coverage_gaps?.length) ? (
            <div className="space-y-8">
              <div className="border-t border-paper-300 pt-8">
                <h2 className="font-serif text-2xl font-bold text-ink-900">Bronvergelijking</h2>
                <p className="mt-1 text-sm text-ink-600">
                  Vergelijking tussen bronnen: tegenstrijdigheden en onderbelichte perspectieven.
                </p>
              </div>

              {insights.contradictions.length ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Tegenstrijdige claims</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Conflicterende uitspraken tussen verschillende bronnen.
                    </p>
                  </div>
                  <ContradictionList items={insights.contradictions} />
                </div>
              ) : null}

              {insights.coverage_gaps?.length ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-bold text-ink-900">Onderbelichte perspectieven</h3>
                    <p className="mt-1 text-sm text-ink-600">
                      Invalshoeken en contexten die ontbreken in de huidige berichtgeving.
                    </p>
                  </div>
                  <CoverageGapsList items={insights.coverage_gaps} />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      </div>
    </ArticleLookupProvider>
  );
}
