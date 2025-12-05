"use client";

import type {
  UnsubstantiatedClaim,
  AuthorityAnalysis,
  MediaAnalysis,
  ScientificPlurality,
  StatisticalIssue,
  TimingAnalysis,
} from "@/lib/types";

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
          className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1 text-2xl">&#x26A0;</span>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-semibold text-amber-200">Claim</p>
                <p className="text-base text-white">{item.claim}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Gepresenteerd als
                  </p>
                  <p className="text-sm text-slate-200">{item.presented_as}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Bron in artikel
                  </p>
                  <p className="text-sm text-slate-200">{item.source_in_article}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Aangedragen bewijs
                </p>
                <p className="text-sm text-slate-200">{item.evidence_provided}</p>
              </div>
              {item.missing_context.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Ontbrekende context
                  </p>
                  <ul className="mt-1 list-inside list-disc text-sm text-slate-300">
                    {item.missing_context.map((ctx, i) => (
                      <li key={i}>{ctx}</li>
                    ))}
                  </ul>
                </div>
              )}
              {item.critical_questions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                    Kritische vragen
                  </p>
                  <ul className="mt-1 list-inside list-disc text-sm text-amber-100">
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
          className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-5"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">&#128101;</span>
              <div>
                <p className="text-lg font-semibold text-white">{item.authority}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-300">
                  {item.authority_type}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Geclaimde expertise
              </p>
              <p className="text-sm text-slate-200">{item.claimed_expertise}</p>
            </div>
            {item.actual_role && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Daadwerkelijke rol
                </p>
                <p className="text-sm text-slate-200">{item.actual_role}</p>
              </div>
            )}
            {item.scope_creep && item.scope_creep.toLowerCase() !== "geen" && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-300">
                  Scope creep
                </p>
                <p className="text-sm text-red-100">{item.scope_creep}</p>
              </div>
            )}
            {item.composition_question && (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">
                  Samenstelling
                </p>
                <p className="text-sm text-blue-100">{item.composition_question}</p>
              </div>
            )}
            {item.funding_sources && (
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-green-300">
                  Financiering
                </p>
                <p className="text-sm text-green-100">{item.funding_sources}</p>
              </div>
            )}
            {item.track_record && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Track record
                </p>
                <p className="text-sm text-slate-200">{item.track_record}</p>
              </div>
            )}
            {item.independence_check && (
              <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">
                  Onafhankelijkheid
                </p>
                <p className="text-sm text-orange-100">{item.independence_check}</p>
              </div>
            )}
            {item.potential_interests.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Mogelijke belangen
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-slate-300">
                  {item.potential_interests.map((interest, i) => (
                    <li key={i}>{interest}</li>
                  ))}
                </ul>
              </div>
            )}
            {item.critical_questions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-300">
                  Kritische vragen
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-purple-100">
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
  "NOS": "nos.nl",
  "nos": "nos.nl",
  "NU.nl": "nu.nl",
  "nu.nl": "nu.nl",
  "NU": "nu.nl",
  "nu": "nu.nl",
};

function getSourceFavicon(source: string): string {
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
        const favicon = getSourceFavicon(item.source);
        return (
        <div
          key={index}
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {favicon ? (
                <img
                  src={favicon}
                  alt=""
                  className="h-8 w-8 rounded"
                  loading="lazy"
                />
              ) : (
                <span className="text-2xl">&#128240;</span>
              )}
              <div>
                <p className="text-lg font-semibold text-white">{item.source}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
                  Toon: {item.tone}
                </p>
              </div>
            </div>
            {item.sourcing_pattern && (
              <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-200">
                  Bronnenpatroon
                </p>
                <p className="text-sm text-rose-100">{item.sourcing_pattern}</p>
              </div>
            )}
            {item.questions_not_asked && item.questions_not_asked.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Niet-gestelde vragen
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-slate-300">
                  {item.questions_not_asked.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            {item.perspectives_omitted && item.perspectives_omitted.length > 0 && (
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-300">
                  Weggelaten perspectieven
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-purple-100">
                  {item.perspectives_omitted.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {item.framing_by_omission && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-300">
                  Framing door weglating
                </p>
                <p className="text-sm text-red-100">{item.framing_by_omission}</p>
              </div>
            )}
            {item.copy_paste_score && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Kopie-score:
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                  item.copy_paste_score === 'hoog' ? 'bg-red-500/20 text-red-300' :
                  item.copy_paste_score === 'middel' ? 'bg-yellow-500/20 text-yellow-300' :
                  'bg-green-500/20 text-green-300'
                }`}>
                  {item.copy_paste_score}
                </span>
              </div>
            )}
            {(item.anonymous_source_count !== undefined && item.anonymous_source_count > 0) && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Anonieme bronnen:
                </span>
                <span className="inline-flex items-center rounded-full bg-gray-500/20 px-2 py-0.5 text-xs font-semibold text-gray-300">
                  {item.anonymous_source_count}
                </span>
              </div>
            )}
            {item.narrative_alignment && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Narratief
                </p>
                <p className="text-sm text-slate-200">{item.narrative_alignment}</p>
              </div>
            )}
            {item.what_if_wrong && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                  Wat als dit fout is?
                </p>
                <p className="text-sm text-amber-100">{item.what_if_wrong}</p>
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
    <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-5">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">&#128300;</span>
          <div>
            <p className="text-lg font-semibold text-white">{data.topic}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
              Wetenschappelijk debat
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Gepresenteerde visie
          </p>
          <p className="text-sm text-slate-200">{data.presented_view}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
              data.alternative_views_mentioned
                ? "bg-green-500/20 text-green-300"
                : "bg-red-500/20 text-red-300"
            }`}
          >
            {data.alternative_views_mentioned
              ? "Alternatieven genoemd"
              : "Alternatieven NIET genoemd"}
          </span>
        </div>
        {data.known_debates.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Bekende debatten
            </p>
            <ul className="mt-1 list-inside list-disc text-sm text-slate-300">
              {data.known_debates.map((debate, i) => (
                <li key={i}>{debate}</li>
              ))}
            </ul>
          </div>
        )}
        {data.notable_dissenters && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Afwijkende stemmen
            </p>
            <p className="text-sm text-slate-200">{data.notable_dissenters}</p>
          </div>
        )}
        <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
            Beoordeling
          </p>
          <p className="text-sm text-cyan-100">{data.assessment}</p>
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
          className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1 text-2xl">&#128202;</span>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-semibold text-red-200">Statistische claim</p>
                <p className="text-base text-white">{item.claim}</p>
              </div>
              <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-200">
                  Probleem
                </p>
                <p className="text-sm text-red-100">{item.issue}</p>
              </div>
              {item.better_framing && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-300">
                    Betere presentatie
                  </p>
                  <p className="text-sm text-green-100">{item.better_framing}</p>
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
    <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">&#8986;</span>
          <div>
            <p className="text-lg font-semibold text-white">Timing Analyse</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
              Waarom nu?
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Reden voor timing
          </p>
          <p className="text-sm text-slate-200">{data.why_now}</p>
        </div>
        {data.cui_bono && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
              Cui bono? (Wie profiteert?)
            </p>
            <p className="text-sm text-amber-100">{data.cui_bono}</p>
          </div>
        )}
        {data.upcoming_events && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Aankomende gebeurtenissen
            </p>
            <p className="text-sm text-slate-200">{data.upcoming_events}</p>
          </div>
        )}
      </div>
    </div>
  );
}
