"use client";

import { X, AlertTriangle, MessageSquareQuote, Newspaper, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import type { ArticleBiasAnalysis, SentenceBias } from "@/lib/types";

interface BiasAnalysisModalProps {
  analysis: ArticleBiasAnalysis;
  articleTitle: string;
  onClose: () => void;
}

const BIAS_SOURCE_LABELS: Record<string, string> = {
  journalist: "Eigen tekst",
  framing: "Framing",
  quote_selection: "Quote-selectie",
  quote: "Quote",
};

const BIAS_SOURCE_ICONS: Record<string, React.ReactNode> = {
  journalist: <Newspaper size={14} />,
  framing: <AlertTriangle size={14} />,
  quote_selection: <AlertTriangle size={14} />,
  quote: <MessageSquareQuote size={14} />,
};

function getBiasScoreColor(score: number): string {
  if (score >= 0.8) return "bg-red-100 text-red-800 border-red-200";
  if (score >= 0.6) return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function SentenceBiasCard({ bias }: { bias: SentenceBias }) {
  const [expanded, setExpanded] = useState(false);
  const scoreColor = getBiasScoreColor(bias.score);

  return (
    <div className="rounded-lg border border-paper-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          {/* Bias type and source */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${scoreColor}`}>
              {BIAS_SOURCE_ICONS[bias.bias_source]}
              {BIAS_SOURCE_LABELS[bias.bias_source] || bias.bias_source}
            </span>
            <span className="text-xs font-medium text-ink-700">{bias.bias_type}</span>
            {bias.speaker && (
              <span className="text-xs text-ink-500">— {bias.speaker}</span>
            )}
          </div>

          {/* Sentence text (truncated) */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-left w-full group"
          >
            <p className={`text-sm text-ink-700 ${expanded ? "" : "line-clamp-2"}`}>
              &ldquo;{bias.sentence_text}&rdquo;
            </p>
            {bias.sentence_text.length > 100 && (
              <span className="inline-flex items-center gap-1 text-xs text-accent-red mt-1">
                {expanded ? (
                  <>
                    <ChevronUp size={12} />
                    Minder tonen
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} />
                    Meer tonen
                  </>
                )}
              </span>
            )}
          </button>
        </div>

        {/* Score badge */}
        <div className="flex-shrink-0">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${scoreColor}`}>
            {Math.round(bias.score * 100)}%
          </span>
        </div>
      </div>

      {/* Explanation */}
      <div className="mt-2 text-xs text-ink-500 bg-paper-50 rounded p-2">
        {bias.explanation}
      </div>
    </div>
  );
}

function BiasSection({
  title,
  icon,
  biases,
  description,
}: {
  title: string;
  icon: React.ReactNode;
  biases: SentenceBias[];
  description: string;
}) {
  if (biases.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h4 className="font-semibold text-ink-900">{title}</h4>
        <span className="rounded-full bg-paper-200 px-2 py-0.5 text-xs text-ink-600">
          {biases.length}
        </span>
      </div>
      <p className="text-xs text-ink-500">{description}</p>
      <div className="space-y-2">
        {biases.map((bias, index) => (
          <SentenceBiasCard key={`${bias.sentence_index}-${index}`} bias={bias} />
        ))}
      </div>
    </div>
  );
}

export function BiasAnalysisModal({
  analysis,
  articleTitle,
  onClose,
}: BiasAnalysisModalProps) {
  const { summary, journalist_biases, quote_biases } = analysis;
  const objectivityScore = Math.round((1 - summary.overall_journalist_rating) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-paper-200 bg-white px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-ink-900">Bias Analyse</h3>
            <p className="text-sm text-ink-500 line-clamp-1">{articleTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-ink-500 hover:bg-paper-100 hover:text-ink-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-120px)] p-6 space-y-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-lg border border-paper-200 bg-paper-50 p-3 text-center">
              <div className="text-2xl font-bold text-ink-900">{objectivityScore}%</div>
              <div className="text-xs text-ink-500">Objectiviteit</div>
            </div>
            <div className="rounded-lg border border-paper-200 bg-paper-50 p-3 text-center">
              <div className="text-2xl font-bold text-ink-900">{summary.total_sentences}</div>
              <div className="text-xs text-ink-500">Zinnen</div>
            </div>
            <div className="rounded-lg border border-paper-200 bg-paper-50 p-3 text-center">
              <div className="text-2xl font-bold text-ink-900">{summary.journalist_bias_count}</div>
              <div className="text-xs text-ink-500">Journalist biases</div>
            </div>
            <div className="rounded-lg border border-paper-200 bg-paper-50 p-3 text-center">
              <div className="text-2xl font-bold text-ink-900">{summary.quote_bias_count}</div>
              <div className="text-xs text-ink-500">Quote biases</div>
            </div>
          </div>

          {/* Most frequent bias */}
          {summary.most_frequent_journalist_bias && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle size={16} />
                <span className="font-medium">Meest voorkomende bias:</span>
                <span>{summary.most_frequent_journalist_bias}</span>
                <span className="text-amber-600">
                  ({summary.most_frequent_count}x)
                </span>
              </div>
            </div>
          )}

          {/* Journalist biases (count toward score) */}
          <BiasSection
            title="Journalistieke Biases"
            icon={<Newspaper size={18} className="text-orange-600" />}
            biases={journalist_biases}
            description="Bias in de eigen tekst, framing of quote-selectie van de journalist. Deze tellen mee in de objectiviteitsscore."
          />

          {/* Quote biases (informational only) */}
          <BiasSection
            title="Quote Biases"
            icon={<MessageSquareQuote size={18} className="text-blue-600" />}
            biases={quote_biases}
            description="Bias in geciteerde uitspraken van bronnen. Dit is informatief maar telt niet mee in de score - bronnen mogen hun mening geven."
          />

          {/* No biases message */}
          {journalist_biases.length === 0 && quote_biases.length === 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
              <div className="text-green-700 font-medium">
                Geen biases gedetecteerd in dit artikel
              </div>
              <p className="text-sm text-green-600 mt-1">
                Dit artikel scoort zeer objectief op onze analyse.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-paper-200 bg-paper-50 px-6 py-3">
          <div className="flex items-center justify-between text-xs text-ink-500">
            <span>
              Geanalyseerd: {new Date(analysis.analyzed_at).toLocaleDateString("nl-NL")}
            </span>
            <span>
              Provider: {analysis.provider} / {analysis.model}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
