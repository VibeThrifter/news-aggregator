"use client";

import type {
  UnsubstantiatedClaim,
  AuthorityAnalysis,
  MediaAnalysis,
  ScientificPlurality,
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
            {item.scope_creep && (
              <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">
                  Mandaatoverschrijding
                </p>
                <p className="text-sm text-orange-100">{item.scope_creep}</p>
              </div>
            )}
            {item.composition_question && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Samenstelling
                </p>
                <p className="text-sm text-slate-200">{item.composition_question}</p>
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
            <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-200">
                Patroon
              </p>
              <p className="text-sm text-rose-100">{item.pattern}</p>
            </div>
            {item.questions_not_asked.length > 0 && (
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
            {item.perspectives_omitted.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Weggelaten perspectieven
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-slate-300">
                  {item.perspectives_omitted.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
                Framing door weglating
              </p>
              <p className="text-sm text-rose-100">{item.framing_by_omission}</p>
            </div>
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
