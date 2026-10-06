"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronRight, SlidersHorizontal } from "lucide-react";

import {
  listSources,
  updateSource,
  initializeSources,
  type NewsSource,
} from "@/lib/api";
import { getSpectrumLabel, isAlternativeSource } from "@/lib/format";
import { AccessCodeForm } from "@/components/admin/AccessCodeForm";
import { ReportedShared } from "@/components/admin/ReportedShared";
import { AdminHeader, BUTTON_SECONDARY, Notice, Toggle } from "@/components/admin/ui";
import { Favicon } from "@/components/explore/ui/primitives";

function SpectrumBadge({ spectrum }: { spectrum: string | number | null }) {
  if (spectrum === null || spectrum === undefined) return null;

  if (isAlternativeSource(spectrum)) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-800">
        Alternatief
      </span>
    );
  }

  // Numeric spectrum (0-10 scale): left blue, centre grey, right red (like the spectrum bars)
  const score = typeof spectrum === "number" ? spectrum : 5;
  const style =
    score <= 3
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : score >= 7
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-paper-300 bg-paper-100 text-ink-700";

  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${style}`}>
      {getSpectrumLabel(score)} · {score}
    </span>
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
    <tr className="border-t border-paper-200 hover:bg-paper-100/60">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Favicon name={source.display_name} size={20} />
          <div className="min-w-0">
            <p className="font-semibold text-ink-900">{source.display_name}</p>
            <p className="font-mono text-xs text-ink-400">{source.source_id}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <SpectrumBadge spectrum={source.spectrum} />
      </td>
      <td className="max-w-[280px] px-4 py-3">
        <p className="truncate text-xs text-ink-500" title={source.feed_url}>
          {source.feed_url.replace(/^https?:\/\/(www\.)?/, "")}
        </p>
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-center">
          <Toggle
            checked={source.enabled}
            onChange={(enabled) => onUpdate(source.source_id, { enabled })}
            disabled={updating}
            label={`${source.display_name} ophalen`}
          />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-center">
          <Toggle
            checked={source.is_main_source}
            onChange={(is_main_source) => onUpdate(source.source_id, { is_main_source })}
            disabled={updating}
            label={`${source.display_name} als hoofdbron`}
          />
        </div>
      </td>
    </tr>
  );
}

/** On phones a source is a row of its own, with both switches in view. */
function SourceItem({
  source,
  onUpdate,
  updating,
}: {
  source: NewsSource;
  onUpdate: (sourceId: string, update: { enabled?: boolean; is_main_source?: boolean }) => Promise<void>;
  updating: boolean;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Favicon name={source.display_name} size={20} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold text-ink-900">{source.display_name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <SpectrumBadge spectrum={source.spectrum} />
          <span className="font-mono text-xs text-ink-400">{source.source_id}</span>
        </div>
      </div>
      <div className="shrink-0 space-y-2 text-xs text-ink-500">
        <label className="flex items-center justify-end gap-2">
          Ophalen
          <Toggle
            checked={source.enabled}
            onChange={(enabled) => onUpdate(source.source_id, { enabled })}
            disabled={updating}
            label={`${source.display_name} ophalen`}
          />
        </label>
        <label className="flex items-center justify-end gap-2">
          Hoofdbron
          <Toggle
            checked={source.is_main_source}
            onChange={(is_main_source) => onUpdate(source.source_id, { is_main_source })}
            disabled={updating}
            label={`${source.display_name} als hoofdbron`}
          />
        </label>
      </div>
    </li>
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
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      <AdminHeader
        back={{ href: "/", label: "Nieuws" }}
        title="Beheer"
        subtitle="Nieuwsbronnen, toegang en wat lezers meldden"
        action={
          <button type="button" onClick={handleInitialize} disabled={updating} className={BUTTON_SECONDARY}>
            {updating ? "Bezig…" : "Bronnen initialiseren"}
          </button>
        }
      />

      <AccessCodeForm />
      <ReportedShared />

      <Link
        href="/admin/llm-config"
        className="group flex items-center gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 transition-colors hover:bg-paper-100"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-700">
          <SlidersHorizontal size={18} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg font-bold text-ink-900">LLM-configuratie</span>
          <span className="block text-sm text-ink-500">Welk model elke stap gebruikt, de prompts, parameters en scores</span>
        </span>
        <ChevronRight size={20} className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}

      <section aria-labelledby="sources-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="sources-title" className="font-serif text-2xl font-bold text-ink-900">
            Bronnen
          </h2>
          {!loading ? (
            <p className="text-sm text-ink-500">
              {sources.length} bronnen · {enabledCount} worden opgehaald · {mainCount} {mainCount === 1 ? "hoofdbron" : "hoofdbronnen"}
            </p>
          ) : null}
        </div>

        <ul className="divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-paper-50 text-sm md:hidden">
          {loading ? <li className="px-4 py-8 text-center text-ink-500">Laden…</li> : null}
          {!loading && sources.length === 0 ? (
            <li className="px-4 py-8 text-center text-ink-500">Geen bronnen gevonden. Kies &quot;Bronnen initialiseren&quot; om te beginnen.</li>
          ) : null}
          {sources.map((source) => (
            <SourceItem key={source.source_id} source={source} onUpdate={handleUpdate} updating={updating} />
          ))}
        </ul>

        <div className="hidden overflow-x-auto rounded-2xl border border-paper-300 bg-paper-50 md:block">
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-semibold text-ink-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Bron</th>
                <th className="px-4 py-3 font-semibold">Spectrum</th>
                <th className="px-4 py-3 font-semibold">Feed</th>
                <th className="px-4 py-3 text-center font-semibold">Ophalen</th>
                <th className="px-4 py-3 text-center font-semibold">Hoofdbron</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-paper-200">
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-500">
                    Laden…
                  </td>
                </tr>
              ) : sources.length === 0 ? (
                <tr className="border-t border-paper-200">
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-500">
                    Geen bronnen gevonden. Kies &quot;Bronnen initialiseren&quot; om te beginnen.
                  </td>
                </tr>
              ) : (
                sources.map((source) => <SourceRow key={source.source_id} source={source} onUpdate={handleUpdate} updating={updating} />)
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-1.5 text-sm text-ink-600">
          <p>
            <strong className="font-semibold text-ink-900">Ophalen:</strong> de feed wordt elke 15 minuten gelezen op nieuwe artikelen. Uitgezette bronnen
            worden niet meer opgehaald.
          </p>
          <p>
            <strong className="font-semibold text-ink-900">Hoofdbron:</strong> een nieuwsitem verschijnt alleen als het minstens één artikel van een hoofdbron
            heeft. De andere bronnen vullen het aan voor de vergelijking. Tip: NOS als hoofdbron, de rest aanvullend.
          </p>
        </div>
      </section>
    </div>
  );
}
