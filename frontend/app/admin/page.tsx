"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  listSources,
  updateSource,
  initializeSources,
  type NewsSource,
} from "@/lib/api";
import { getSpectrumLabel, isAlternativeSource } from "@/lib/format";

function SpectrumBadge({ spectrum }: { spectrum: string | number | null }) {
  if (spectrum === null || spectrum === undefined) return null;

  // Alternative sources
  if (isAlternativeSource(spectrum)) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full border border-purple-500/60 bg-purple-500/10 px-2 py-0.5 text-xs font-semibold text-purple-200">
        Alternatief
      </span>
    );
  }

  // Numeric spectrum (0-10 scale)
  const score = typeof spectrum === "number" ? spectrum : 5;
  const label = getSpectrumLabel(score);

  // Color based on position: left=rose, center=sky, right=amber
  let style = "border-sky-500/60 bg-sky-500/10 text-sky-200"; // default center
  if (score <= 3) {
    style = "border-rose-500/60 bg-rose-500/10 text-rose-200"; // left
  } else if (score >= 7) {
    style = "border-amber-500/60 bg-amber-500/10 text-amber-200"; // right
  }

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${style}`}>
      {label} ({score})
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="peer sr-only"
      />
      <div className="peer h-6 w-11 rounded-full bg-slate-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-brand-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand-300 peer-disabled:cursor-not-allowed peer-disabled:opacity-50"></div>
      <span className="sr-only">{label}</span>
    </label>
  );
}

function SourceRow({
  source,
  onUpdate,
  updating,
}: {
  source: NewsSource;
  onUpdate: (sourceId: string, update: { enabled?: boolean; is_main_source?: boolean }) => Promise<void>;
  updating: boolean;
}) {
  return (
    <tr className="border-b border-slate-700 hover:bg-slate-800/50">
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-slate-100">{source.display_name}</span>
          <span className="text-xs text-slate-400">{source.source_id}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <SpectrumBadge spectrum={source.spectrum} />
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        <span className="max-w-xs truncate text-xs text-slate-400" title={source.feed_url}>
          {source.feed_url}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        <Toggle
          checked={source.enabled}
          onChange={(enabled) => onUpdate(source.source_id, { enabled })}
          disabled={updating}
          label={`Toggle ${source.display_name} enabled`}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <Toggle
          checked={source.is_main_source}
          onChange={(is_main_source) => onUpdate(source.source_id, { is_main_source })}
          disabled={updating}
          label={`Toggle ${source.display_name} as main source`}
        />
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await listSources();
      setSources(response.sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const handleUpdate = async (
    sourceId: string,
    update: { enabled?: boolean; is_main_source?: boolean }
  ) => {
    try {
      setUpdating(true);
      setError(null);
      const updatedSource = await updateSource(sourceId, update);
      setSources((prev) =>
        prev.map((s) => (s.source_id === sourceId ? updatedSource : s))
      );
      setMessage(`${updatedSource.display_name} bijgewerkt`);
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update source");
    } finally {
      setUpdating(false);
    }
  };

  const handleInitialize = async () => {
    try {
      setUpdating(true);
      setError(null);
      const result = await initializeSources();
      setMessage(`${result.stats.created} nieuwe bronnen geinitialiseerd, ${result.stats.existing} bestonden al`);
      await loadSources();
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize sources");
    } finally {
      setUpdating(false);
    }
  };

  const enabledCount = sources.filter((s) => s.enabled).length;
  const mainCount = sources.filter((s) => s.is_main_source).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-brand-400 hover:text-brand-300"
          >
            &larr; Terug naar events
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-100">
            Admin Dashboard
          </h1>
          <p className="text-sm text-slate-400">
            Beheer nieuwsbronnen en hun instellingen
          </p>
        </div>
        <button
          onClick={handleInitialize}
          disabled={updating}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updating ? "Bezig..." : "Bronnen initialiseren"}
        </button>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/llm-config"
          className="rounded-lg border border-slate-700 bg-slate-800 p-4 transition-colors hover:border-slate-600 hover:bg-slate-700/50"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-100">LLM Configuratie</p>
              <p className="text-sm text-slate-400">Prompts, parameters en scoring</p>
            </div>
            <span className="text-slate-400">&rarr;</span>
          </div>
        </Link>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-100">Bronnen beheer</p>
              <p className="text-sm text-slate-400">Hieronder op deze pagina</p>
            </div>
            <span className="text-slate-400">&darr;</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <p className="text-sm text-slate-400">Totaal bronnen</p>
          <p className="text-2xl font-bold text-slate-100">{sources.length}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <p className="text-sm text-slate-400">Ingeschakeld voor polling</p>
          <p className="text-2xl font-bold text-green-400">{enabledCount}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <p className="text-sm text-slate-400">Hoofdbronnen (voor weergave)</p>
          <p className="text-2xl font-bold text-brand-400">{mainCount}</p>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 px-4 py-3 text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-green-700 bg-green-900/30 px-4 py-3 text-green-300">
          {message}
        </div>
      )}

      {/* Explanation */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <h2 className="mb-2 font-semibold text-slate-100">Uitleg</h2>
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <strong className="text-green-400">Ingeschakeld:</strong> Bronnen worden gepolled voor nieuwe artikelen (elke 15 minuten).
            Uitgezette bronnen worden niet meer gepolled.
          </p>
          <p>
            <strong className="text-brand-400">Hoofdbron:</strong> Events worden alleen getoond als ze minstens een artikel van een hoofdbron bevatten.
            Andere bronnen dienen als aanvulling voor pluriformiteitsanalyse.
          </p>
          <p className="text-slate-400">
            Tip: Gebruik NOS als baseline hoofdbron en de rest als aanvullende bronnen voor diverse perspectieven.
          </p>
        </div>
      </div>

      {/* Sources table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-800 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Bron</th>
              <th className="px-4 py-3">Spectrum</th>
              <th className="hidden px-4 py-3 md:table-cell">Feed URL</th>
              <th className="px-4 py-3 text-center">Ingeschakeld</th>
              <th className="px-4 py-3 text-center">Hoofdbron</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Laden...
                </td>
              </tr>
            ) : sources.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Geen bronnen gevonden. Klik op &quot;Bronnen initialiseren&quot; om te beginnen.
                </td>
              </tr>
            ) : (
              sources.map((source) => (
                <SourceRow
                  key={source.source_id}
                  source={source}
                  onUpdate={handleUpdate}
                  updating={updating}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
