"use client";

import { useState } from "react";
import useSWR from "swr";

import { getLlmUsage, type ClaudeWindow, type LlmUsagePeriod, type LlmUsageSummary, type LlmUsageTotals } from "@/lib/api";

import { AdminCard } from "./ui";

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5-uursvenster",
  seven_day: "Week",
  seven_day_sonnet: "Week (Sonnet)",
  seven_day_opus: "Week (Opus)",
};

const PROVIDER_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  mistral: "Mistral",
  "gemini-fast": "Gemini",
  "gemini-search": "Gemini + Google",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  "deepseek-r1": "DeepSeek R1",
};

const STEP_LABELS: Record<string, string> = {
  classification: "Soort nieuws",
  event_assignment: "Koppelen aan nieuws",
  factual: "Analyse: feiten",
  critical: "Analyse: kritisch",
  keyword_extraction: "Trefwoorden buitenland",
  bias: "Gekleurde zinnen",
  digest: "Wat schreef …?",
  voice_search: "Zoek met AI: controle",
  voice_web: "Zoek met AI: Google",
};

const compact = new Intl.NumberFormat("nl-NL", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("nl-NL");
const dollars = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });
const dayClock = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? clock.format(date) : dayClock.format(date);
}

function until(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "";
  if (minutes < 60) return `nog ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `nog ${hours} u${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `nog ${Math.round(hours / 24)} dagen`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Fill and track of a meter: blue, amber from 75%, red from 90% (same ramp for both). */
function meterTone(share: number, stopped: boolean): { fill: string; track: string; word: string | null } {
  if (stopped || share >= 0.9) return { fill: "bg-red-600", track: "bg-red-100", word: stopped ? "op" : "bijna op" };
  if (share >= 0.75) return { fill: "bg-amber-500", track: "bg-amber-100", word: "loopt op" };
  return { fill: "bg-brand-500", track: "bg-brand-100", word: null };
}

function Meter({ share, stopped = false, label }: { share: number; stopped?: boolean; label: string }) {
  const tone = meterTone(share, stopped);
  const width = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      className={`h-2 w-full overflow-hidden rounded-full ${tone.track}`}
    >
      <div className={`h-full rounded-full ${tone.fill}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function ClaudeWindowRow({ window, stopped }: { window: ClaudeWindow; stopped: boolean }) {
  const label = WINDOW_LABELS[window.key] ?? window.key;
  const share = window.utilization;
  if (window.expired || share === null) {
    return (
      <li className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-ink-900">{label}</span>
          <span className="text-sm text-ink-500">nieuw venster</span>
        </div>
        <Meter share={0} label={label} />
        <p className="text-xs text-ink-500">Gereset om {when(window.resets_at)}; de nieuwe stand komt bij de volgende Claude-aanroep.</p>
      </li>
    );
  }
  const tone = meterTone(share, stopped);
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink-900">{label}</span>
        <span className="text-sm text-ink-700">
          <span className="font-semibold tabular-nums text-ink-900">{percent(share)}</span> gebruikt
          {tone.word ? <span className="ml-1.5 font-semibold text-ink-900">· {tone.word}</span> : null}
        </span>
      </div>
      <Meter share={share} stopped={stopped} label={`${label}: ${percent(share)} gebruikt`} />
      <p className="text-xs text-ink-500">
        Reset {when(window.resets_at)}
        {until(window.resets_at) ? ` · ${until(window.resets_at)}` : ""}
      </p>
    </li>
  );
}

function ClaudeSubscription({ claude }: { claude: LlmUsageSummary["claude"] }) {
  if (!claude) {
    return <p className="text-sm text-ink-500">Nog niet gemeten: de stand verschijnt na de eerste Claude-aanroep van de app.</p>;
  }
  const stopped = claude.status === "rejected";
  return (
    <div className="space-y-3">
      {stopped ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          Limiet bereikt: de Claude-stappen wachten{claude.resets_at ? ` tot ${when(claude.resets_at)}` : ""}.
        </p>
      ) : null}
      <ul className="space-y-4">
        {claude.windows.map((window) => (
          <ClaudeWindowRow key={window.key} window={window} stopped={stopped && claude.limit_type === window.key} />
        ))}
      </ul>
      <p className="text-xs text-ink-500">
        Gemeten {when(claude.measured_at)}, bij de laatste aanroep van de app. Dit is het hele abonnement: je eigen Claude Code-sessies tellen mee.
      </p>
    </div>
  );
}

function GeminiFreeTier({ gemini }: { gemini: LlmUsageSummary["gemini"] }) {
  if (!gemini.models.length) return null;
  const limit = gemini.limit;
  return (
    <section aria-labelledby="ai-gemini-title" className="space-y-3">
      <h3 id="ai-gemini-title" className="font-serif text-base font-bold text-ink-900">
        Gemini, gratis
      </h3>
      <ul className="space-y-4">
        {gemini.models.map((item) => {
          const share = limit ? item.requests / limit : 0;
          return (
            <li key={item.model} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="font-mono text-sm text-ink-800">{item.model}</span>
                <span className="text-sm text-ink-700">
                  <span className="font-semibold tabular-nums text-ink-900">{item.requests}</span>
                  {limit ? ` van ${limit}` : ""} vandaag
                  {item.limited ? <span className="ml-1.5 font-semibold text-ink-900">· limiet bereikt</span> : null}
                </span>
              </div>
              {limit ? <Meter share={item.limited ? 1 : share} stopped={item.limited} label={`${item.model}: ${item.requests} van ${limit}`} /> : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-500">Per model per dag; reset {when(gemini.resets_at)} (middernacht in Californië).</p>
    </section>
  );
}

function periodLabel(period: LlmUsagePeriod): string {
  if (period.key === "five_hour") return period.subscription_window ? "Dit 5-uursvenster" : "Laatste 5 uur";
  if (period.key === "today") return "Vandaag";
  return period.subscription_window ? "Deze abonnementsweek" : "Laatste 7 dagen";
}

function tokensTitle(totals: LlmUsageTotals): string {
  return [
    `${whole.format(totals.input_tokens)} in`,
    `${whole.format(totals.output_tokens)} uit`,
    `${whole.format(totals.cache_read_tokens)} uit cache`,
    `${whole.format(totals.cache_write_tokens)} naar cache`,
  ].join(" · ");
}

function ShareList({ title, rows, total }: { title: string; rows: Array<LlmUsageTotals & { key: string; name: string; detail?: string }>; total: number }) {
  return (
    <section className="min-w-0 space-y-2">
      <h4 className="text-sm font-semibold text-ink-700">{title}</h4>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.key} className="space-y-1" title={tokensTitle(row)}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink-900">
                {row.name}
                {row.detail ? <span className="ml-1.5 font-mono text-xs text-ink-500">{row.detail}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums text-ink-700">{compact.format(row.tokens)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${total ? (row.tokens / total) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-ink-500">
              {whole.format(row.calls)} {row.calls === 1 ? "aanroep" : "aanroepen"}
              {row.failed ? ` · ${row.failed} mislukt` : ""}
              {row.cost_usd !== null ? ` · ${dollars.format(row.cost_usd)} API-prijs` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppUsage({ periods }: { periods: LlmUsagePeriod[] }) {
  const [selected, setSelected] = useState<LlmUsagePeriod["key"]>("five_hour");
  const period = periods.find((p) => p.key === selected) ?? periods[0];
  if (!period) return null;
  const { totals } = period;

  return (
    <section aria-labelledby="ai-app-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="ai-app-title" className="font-serif text-base font-bold text-ink-900">
          Tokens van de app
        </h3>
        <div role="tablist" aria-label="Periode" className="flex flex-wrap gap-1.5">
          {periods.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={p.key === period.key}
              onClick={() => setSelected(p.key)}
              className={`min-h-[32px] rounded-full border px-3 text-xs font-semibold transition-colors ${
                p.key === period.key ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 bg-paper-50 text-ink-700 hover:bg-paper-200"
              }`}
            >
              {periodLabel(p)}
            </button>
          ))}
        </div>
      </div>

      {totals.calls === 0 ? (
        <p className="text-sm text-ink-500">Geen AI-aanroepen sinds {when(period.since)}.</p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-ink-900">
              <span className="text-2xl font-semibold tabular-nums">{compact.format(totals.tokens)}</span> tokens
              <span className="text-sm text-ink-500"> sinds {when(period.since)}</span>
            </p>
            <p className="text-sm text-ink-600">
              {whole.format(totals.calls)} {totals.calls === 1 ? "aanroep" : "aanroepen"}
              {totals.failed ? ` · ${totals.failed} mislukt` : ""}
              {totals.cost_usd !== null ? ` · ${dollars.format(totals.cost_usd)} als het via de API ging` : ""}
            </p>
            <p className="text-xs text-ink-500">
              {compact.format(totals.input_tokens)} in · {compact.format(totals.output_tokens)} uit · {compact.format(totals.cache_read_tokens)} uit cache ·{" "}
              {compact.format(totals.cache_write_tokens)} naar cache
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <ShareList
              title="Per model"
              total={totals.tokens}
              rows={period.models.map((m) => ({
                ...m,
                key: `${m.provider}/${m.model}`,
                name: PROVIDER_LABELS[m.provider] ?? m.provider,
                detail: m.model,
              }))}
            />
            <ShareList
              title="Per stap"
              total={totals.tokens}
              rows={period.steps.map((s) => ({ ...s, key: s.step ?? "overig", name: s.step ? (STEP_LABELS[s.step] ?? s.step) : "Overig" }))}
            />
          </div>
        </>
      )}
    </section>
  );
}

/**
 * AI-gebruik: how much of the Claude subscription (5-hour window, week) and of Gemini's free tier
 * is used, and the tokens of the app's own LLM calls per model and per step. From the local backend.
 */
export function AiUsage() {
  const { data, error, isLoading } = useSWR("llm-usage", getLlmUsage, { refreshInterval: 60_000, revalidateOnFocus: true });

  return (
    <AdminCard id="ai-usage-title" title="AI-gebruik" subtitle="Hoeveel van het abonnement op is en wat de app aan tokens gebruikt">
      {isLoading ? <p className="text-sm text-ink-500">Laden…</p> : null}
      {error && !data ? <p className="text-sm text-ink-500">De backend is niet bereikbaar; het AI-gebruik komt van de lokale backend.</p> : null}
      {data ? (
        <div className="space-y-6">
          <section aria-labelledby="ai-claude-title" className="space-y-3">
            <h3 id="ai-claude-title" className="font-serif text-base font-bold text-ink-900">
              Claude-abonnement
            </h3>
            <ClaudeSubscription claude={data.claude} />
          </section>
          <GeminiFreeTier gemini={data.gemini} />
          <AppUsage periods={data.periods} />
        </div>
      ) : null}
    </AdminCard>
  );
}
