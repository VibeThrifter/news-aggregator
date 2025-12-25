"use client";

import type {
  UnsubstantiatedClaim,
  AuthorityAnalysis,
  MediaAnalysis,
  ScientificPlurality,
  StatisticalIssue,
  TimingAnalysis,
} from "@/lib/types";
import { SourceIconLink } from "@/components/SourceIconLink";

interface UnsubstantiatedClaimsListProps {
  items: UnsubstantiatedClaim[];
}

export function UnsubstantiatedClaimsList({ items }: UnsubstantiatedClaimsListProps) {
  if (!items.length) return null;

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div
          key={index}
          className="rounded-lg border-l-4 border-l-orange-500 border border-paper-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1 text-xl text-orange-600">⚠</span>
            <div className="flex-1 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-orange-600">Claim</p>
                  <p className="text-base font-medium text-ink-900">{item.claim}</p>
                </div>
                {item.article_url && (
                  <div className="shrink-0">
                    <SourceIconLink url={item.article_url} />
                  </div>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Gepresenteerd als
                  </p>
                  <p className="text-sm text-ink-700">{item.presented_as}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Bron in artikel
                  </p>
                  <p className="text-sm text-ink-700">{item.source_in_article}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Aangedragen bewijs
                </p>
                <p className="text-sm text-ink-700">{item.evidence_provided}</p>
              </div>
              {item.missing_context.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Ontbrekende context
                  </p>
                  <ul className="mt-1 list-inside list-disc text-sm text-ink-600">
                    {item.missing_context.map((ctx, i) => (
                      <li key={i}>{ctx}</li>
                    ))}
                  </ul>
                </div>
              )}
              {item.critical_questions.length > 0 && (
                <div className="rounded-lg bg-orange-50 p-3 border border-orange-100">
                  <p className="text-xs font-semibold uppercase tracking-wider text-orange-700">
                    Kritische vragen
                  </p>
                  <ul className="mt-1 list-inside list-disc text-sm text-orange-800">
                    {item.critical_questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface AuthorityAnalysisListProps {
  items: AuthorityAnalysis[];
}

export function AuthorityAnalysisList({ items }: AuthorityAnalysisListProps) {
  if (!items.length) return null;

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div
          key={index}
          className="rounded-lg border-l-4 border-l-violet-500 border border-paper-200 bg-white p-5 shadow-sm"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl text-violet-600">👥</span>
                <div>
                  <p className="text-base font-semibold text-ink-900">{item.authority}</p>
                  <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 border border-violet-200">
                    {item.authority_type}
                  </span>
                </div>
              </div>
              {item.article_url && (
                <div className="shrink-0">
                  <SourceIconLink url={item.article_url} />
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Geclaimde expertise
              </p>
              <p className="text-sm text-ink-700">{item.claimed_expertise}</p>
            </div>
            {item.actual_role && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Daadwerkelijke rol
                </p>
                <p className="text-sm text-ink-700">{item.actual_role}</p>
              </div>
            )}
            {item.scope_creep && item.scope_creep.toLowerCase() !== "geen" && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
                  Scope creep
                </p>
                <p className="text-sm text-red-800">{item.scope_creep}</p>
              </div>
            )}
            {item.composition_question && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                  Samenstelling
                </p>
                <p className="text-sm text-blue-800">{item.composition_question}</p>
              </div>
            )}
            {item.funding_sources && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-green-700">
                  Financiering
                </p>
                <p className="text-sm text-green-800">{item.funding_sources}</p>
              </div>
            )}
            {item.track_record && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Track record
                </p>
                <p className="text-sm text-ink-700">{item.track_record}</p>
              </div>
            )}
            {item.independence_check && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-orange-700">
                  Onafhankelijkheid
                </p>
                <p className="text-sm text-orange-800">{item.independence_check}</p>
              </div>
            )}
            {item.potential_interests.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Mogelijke belangen
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-ink-600">
                  {item.potential_interests.map((interest, i) => (
                    <li key={i}>{interest}</li>
                  ))}
                </ul>
              </div>
            )}
            {item.critical_questions.length > 0 && (
              <div className="rounded-lg bg-violet-50 p-3 border border-violet-100">
                <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">
                  Kritische vragen
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-violet-800">
                  {item.critical_questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface MediaAnalysisListProps {
  items: MediaAnalysis[];
}

const SOURCE_DOMAINS: Record<string, string> = {
  // NOS
  "NOS": "nos.nl",
  "nos": "nos.nl",
  // NU.nl
  "NU.nl": "nu.nl",
  "nu.nl": "nu.nl",
  "NU": "nu.nl",
  "nu": "nu.nl",
  // AD
  "AD": "ad.nl",
  "ad": "ad.nl",
  "Algemeen Dagblad": "ad.nl",
  // RTL
  "RTL": "rtl.nl",
  "rtl": "rtl.nl",
  "RTL Nieuws": "rtl.nl",
  // Telegraaf
  "Telegraaf": "telegraaf.nl",
  "telegraaf": "telegraaf.nl",
  "De Telegraaf": "telegraaf.nl",
  // Volkskrant
  "Volkskrant": "volkskrant.nl",
  "volkskrant": "volkskrant.nl",
  "de Volkskrant": "volkskrant.nl",
  "De Volkskrant": "volkskrant.nl",
  // Parool
  "Parool": "parool.nl",
  "parool": "parool.nl",
  "Het Parool": "parool.nl",
  // Trouw
  "Trouw": "trouw.nl",
  "trouw": "trouw.nl",
  // GeenStijl
  "GeenStijl": "geenstijl.nl",
  "geenstijl": "geenstijl.nl",
  "Geenstijl": "geenstijl.nl",
  // De Andere Krant
  "De Andere Krant": "deanderekrant.nl",
  "deanderekrant": "deanderekrant.nl",
  // NineForNews
  "NineForNews": "ninefornews.nl",
  "ninefornews": "ninefornews.nl",
  "Nine For News": "ninefornews.nl",
  // NieuwRechts
  "NieuwRechts": "nieuwrechts.nl",
  "nieuwrechts": "nieuwrechts.nl",
  "Nieuw Rechts": "nieuwrechts.nl",
  // @eenblikopdenos
  "@eenblikopdenos": "x.com",
  "eenblikopdenos": "x.com",
  "Een Blik op de NOS": "x.com",
};

function getSourceFavicon(source: string, articleUrl?: string | null): string {
  // First try to extract favicon from article URL if available
  if (articleUrl) {
    try {
      const hostname = new URL(articleUrl).hostname.replace(/^www\./, "");
      return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
    } catch {
      // Invalid URL, fall through to source mapping
    }
  }
  // Fall back to source name mapping
  const domain = SOURCE_DOMAINS[source];
  if (domain) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  }
  return "";
}

export function MediaAnalysisList({ items }: MediaAnalysisListProps) {
  if (!items.length) return null;

  return (
    <div className="space-y-4">
      {items.map((item, index) => {
        const favicon = getSourceFavicon(item.source, item.article_url);
        return (
        <div
          key={index}
          className="rounded-lg border-l-4 border-l-pink-500 border border-paper-200 bg-white p-5 shadow-sm"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {favicon ? (
                  <img
                    src={favicon}
                    alt=""
                    className="h-8 w-8 rounded"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-xl text-pink-600">📰</span>
                )}
                <div>
                  <p className="text-base font-semibold text-ink-900">{item.source}</p>
                  <span className="inline-flex rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700 border border-pink-200">
                    Toon: {item.tone}
                  </span>
                </div>
              </div>
              {item.article_url && (
                <div className="shrink-0">
                  <SourceIconLink url={item.article_url} />
                </div>
              )}
            </div>
            {item.sourcing_pattern && (
              <div className="rounded-lg border border-pink-200 bg-pink-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-pink-700">
                  Bronnenpatroon
                </p>
                <p className="text-sm text-pink-800">{item.sourcing_pattern}</p>
              </div>
            )}
            {item.questions_not_asked && item.questions_not_asked.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Niet-gestelde vragen
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-ink-600">
                  {item.questions_not_asked.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            {item.perspectives_omitted && item.perspectives_omitted.length > 0 && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-purple-700">
                  Weggelaten perspectieven
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-purple-800">
                  {item.perspectives_omitted.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {item.framing_by_omission && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
                  Framing door weglating
                </p>
                <p className="text-sm text-red-800">{item.framing_by_omission}</p>
              </div>
            )}
            {(item.anonymous_source_count !== undefined && item.anonymous_source_count > 0) && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Anonieme bronnen:
                </span>
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 border border-gray-200">
                  {item.anonymous_source_count}
                </span>
              </div>
            )}
            {item.narrative_alignment && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Narratief
                </p>
                <p className="text-sm text-ink-700">{item.narrative_alignment}</p>
              </div>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}

interface ScientificPluralityCardProps {
  data: ScientificPlurality;
}

export function ScientificPluralityCard({ data }: ScientificPluralityCardProps) {
  return (
    <div className="rounded-lg border-l-4 border-l-cyan-500 border border-paper-200 bg-white p-5 shadow-sm">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xl text-cyan-600">🔬</span>
          <div>
            <p className="text-base font-semibold text-ink-900">{data.topic}</p>
            <span className="inline-flex rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700 border border-cyan-200">
              Wetenschappelijk debat
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Gepresenteerde visie
          </p>
          <p className="text-sm text-ink-700">{data.presented_view}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border ${
              data.alternative_views_mentioned
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-red-50 text-red-700 border-red-200"
            }`}
          >
            {data.alternative_views_mentioned
              ? "✓ Alternatieven genoemd"
              : "✗ Alternatieven NIET genoemd"}
          </span>
        </div>
        {data.known_debates.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Bekende debatten
            </p>
            <ul className="mt-1 list-inside list-disc text-sm text-ink-600">
              {data.known_debates.map((debate, i) => (
                <li key={i}>{debate}</li>
              ))}
            </ul>
          </div>
        )}
        {data.notable_dissenters && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Afwijkende stemmen
            </p>
            <p className="text-sm text-ink-700">{data.notable_dissenters}</p>
          </div>
        )}
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700">
            Beoordeling
          </p>
          <p className="text-sm text-cyan-800">{data.assessment}</p>
        </div>
      </div>
    </div>
  );
}

interface StatisticalIssuesListProps {
  items: StatisticalIssue[];
}

export function StatisticalIssuesList({ items }: StatisticalIssuesListProps) {
  if (!items.length) return null;

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div
          key={index}
          className="rounded-lg border-l-4 border-l-rose-500 border border-paper-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1 text-xl text-rose-600">📊</span>
            <div className="flex-1 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-rose-600">Statistische claim</p>
                  <p className="text-base font-medium text-ink-900">{item.claim}</p>
                </div>
                {item.article_url && (
                  <div className="shrink-0">
                    <SourceIconLink url={item.article_url} />
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">
                  Probleem
                </p>
                <p className="text-sm text-rose-800">{item.issue}</p>
              </div>
              {item.better_framing && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-green-700">
                    Betere presentatie
                  </p>
                  <p className="text-sm text-green-800">{item.better_framing}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface TimingAnalysisCardProps {
  data: TimingAnalysis;
}

export function TimingAnalysisCard({ data }: TimingAnalysisCardProps) {
  return (
    <div className="rounded-lg border-l-4 border-l-indigo-500 border border-paper-200 bg-white p-5 shadow-sm">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xl text-indigo-600">⏱</span>
          <div>
            <p className="text-base font-semibold text-ink-900">Timing Analyse</p>
            <span className="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-200">
              Waarom nu?
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Reden voor timing
          </p>
          <p className="text-sm text-ink-700">{data.why_now}</p>
        </div>
        {data.cui_bono && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Cui bono? (Wie profiteert?)
            </p>
            <p className="text-sm text-amber-800">{data.cui_bono}</p>
          </div>
        )}
        {data.upcoming_events && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Aankomende gebeurtenissen
            </p>
            <p className="text-sm text-ink-700">{data.upcoming_events}</p>
          </div>
        )}
      </div>
    </div>
  );
}
