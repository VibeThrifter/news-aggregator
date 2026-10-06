"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronRight } from "lucide-react";

import {
  listLlmConfigs,
  updateLlmConfig,
  seedLlmConfig,
  type LlmConfig,
} from "@/lib/api";
import { AdminCard, AdminHeader, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, Notice } from "@/components/admin/ui";

// Config type labels in Dutch
const configTypeLabels: Record<string, string> = {
  prompt: "Prompts",
  parameter: "Parameters",
  scoring: "Scoring",
  provider: "Providers",
};

// Config type colors
const configTypeColors: Record<string, string> = {
  prompt: "border-purple-200 bg-purple-50 text-purple-800",
  parameter: "border-blue-200 bg-blue-50 text-blue-800",
  scoring: "border-emerald-200 bg-emerald-50 text-emerald-800",
  provider: "border-orange-200 bg-orange-50 text-orange-800",
};

// Available LLM providers. claude-code[:model] runs the Claude Code CLI on the backend machine
// (the owner's subscription, no API key): selectable per step like the others.
const LLM_PROVIDERS = ["mistral", "gemini", "deepseek", "deepseek-r1", "claude-code:haiku", "claude-code:sonnet", "claude-code:opus"];

// Provider display info: the short name is the button, the rest says what it is
const PROVIDER_INFO: Record<string, { label: string; short: string; description: string }> = {
  mistral: { label: "Mistral", short: "Mistral", description: "Gratis, snel" },
  deepseek: { label: "DeepSeek", short: "DeepSeek", description: "Goedkoop, goed" },
  "deepseek-r1": { label: "DeepSeek R1", short: "DeepSeek R1", description: "Reasoning, 2x duurder" },
  gemini: { label: "Gemini", short: "Gemini", description: "Gratis, 1500/dag" },
  "claude-code:haiku": { label: "Claude Code · Haiku", short: "Haiku", description: "Lokaal, snel" },
  "claude-code:sonnet": { label: "Claude Code · Sonnet", short: "Sonnet", description: "Lokaal, sterk" },
  "claude-code:opus": { label: "Claude Code · Opus", short: "Opus", description: "Lokaal, sterkst, traag" },
};

// The buttons per step, in two rows
const PROVIDER_GROUPS: { label: string; providers: string[] }[] = [
  { label: "Lokaal (Claude Code)", providers: ["claude-code:haiku", "claude-code:sonnet", "claude-code:opus"] },
  { label: "API", providers: ["mistral", "gemini", "deepseek", "deepseek-r1"] },
];

/** A value that is not in the list (e.g. "claude-code" without a model) still shows. */
function providerInfo(provider: string) {
  return PROVIDER_INFO[provider] ?? { label: provider, short: provider, description: "" };
}

// Phase display names
const PHASE_LABELS: Record<string, string> = {
  provider_classification: "Classificatie",
  provider_event_assignment: "Event-toewijzing",
  provider_factual: "Fase 1: Feitelijk",
  provider_critical: "Fase 2: Kritisch",
  provider_digest: "Kern buitenlandse artikelen",
  provider_voice_search: "Zoek met AI (ontbrekende stemmen)",
  provider_bias: "Bias per zin",
};
const PHASE_ORDER = Object.keys(PHASE_LABELS);

function TypeBadge({ type }: { type: string }) {
  const colorClass = configTypeColors[type] || "border-paper-300 bg-paper-100 text-ink-700";
  const label = configTypeLabels[type] || type;
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${colorClass}`}>{label}</span>;
}

function ProviderToggle({
  config,
  onToggle,
  disabled,
}: {
  config: LlmConfig;
  onToggle: (newProvider: string) => void;
  disabled: boolean;
}) {
  const currentProvider = config.value;
  const phaseLabel = PHASE_LABELS[config.key] || config.key;
  const current = providerInfo(currentProvider);
  // A value outside the list (e.g. "claude-code" without a model) still shows as chosen
  const groups = LLM_PROVIDERS.includes(currentProvider) ? PROVIDER_GROUPS : [...PROVIDER_GROUPS, { label: "Anders", providers: [currentProvider] }];

  return (
    <div className="space-y-3 rounded-2xl border border-paper-300 bg-paper-50 p-4">
      <div>
        <h3 className="font-serif text-base font-bold text-ink-900">{phaseLabel}</h3>
        {config.description ? <p className="mt-0.5 text-xs text-ink-500">{config.description}</p> : null}
      </div>
      <div className="space-y-2">
        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="text-xs font-medium text-ink-500">{group.label}</p>
            <div role="radiogroup" aria-label={`${phaseLabel}: ${group.label}`} className="flex flex-wrap gap-1.5">
              {group.providers.map((provider) => {
                const info = providerInfo(provider);
                const isActive = currentProvider === provider;
                return (
                  <button
                    key={provider}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    title={`${info.label} · ${info.description}`}
                    onClick={() => !isActive && onToggle(provider)}
                    disabled={disabled && !isActive}
                    className={`min-h-[36px] rounded-full border px-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                      isActive ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 bg-paper-50 text-ink-700 hover:bg-paper-200"
                    }`}
                  >
                    {info.short}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-500">
        Nu: <span className="font-semibold text-ink-800">{current.label}</span>
        {current.description ? ` · ${current.description.toLowerCase()}` : ""}
      </p>
    </div>
  );
}

function ConfigEditor({
  config,
  onSave,
  onCancel,
  saving,
}: {
  config: LlmConfig;
  onSave: (value: string) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(config.value);
  const isPrompt = config.config_type === "prompt";
  const isProvider = config.config_type === "provider";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-all font-mono text-base font-semibold text-ink-900">{config.key}</h3>
          {config.description ? <p className="mt-0.5 text-sm text-ink-500">{config.description}</p> : null}
        </div>
        <TypeBadge type={config.config_type} />
      </div>

      {isPrompt ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          rows={20}
          className={`${INPUT} p-4 font-mono text-[13px] leading-relaxed`}
          placeholder="Prompt tekst..."
        />
      ) : isProvider ? (
        <select value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} className={INPUT}>
          {LLM_PROVIDERS.map((provider) => {
            const info = PROVIDER_INFO[provider];
            return (
              <option key={provider} value={provider}>
                {info?.label || provider} - {info?.description || ""}
              </option>
            );
          })}
        </select>
      ) : (
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} className={INPUT} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-500">Laatst bijgewerkt: {new Date(config.updated_at).toLocaleString("nl-NL")}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className={BUTTON_SECONDARY}>
            Annuleren
          </button>
          <button type="button" onClick={() => onSave(value)} disabled={saving || value === config.value} className={BUTTON_PRIMARY}>
            {saving ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({
  config,
  onClick,
}: {
  config: LlmConfig;
  onClick: () => void;
}) {
  const isPrompt = config.config_type === "prompt";
  const displayValue = isPrompt ? `${config.value.slice(0, 100)}…` : config.value;

  return (
    <tr onClick={onClick} className="cursor-pointer border-t border-paper-200 hover:bg-paper-100/60">
      <td className="px-4 py-3 align-top">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className="text-left"
        >
          <span className="block break-all font-mono text-[13px] font-semibold text-ink-900">{config.key}</span>
          {config.description ? <span className="mt-0.5 block text-xs text-ink-500">{config.description}</span> : null}
        </button>
      </td>
      <td className="px-4 py-3 align-top">
        <TypeBadge type={config.config_type} />
      </td>
      <td className="hidden max-w-[360px] px-4 py-3 align-top md:table-cell">
        <p className={`truncate ${isPrompt ? "font-mono text-xs text-ink-500" : "text-sm font-medium text-ink-800"}`} title={config.value}>
          {displayValue}
        </p>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right align-top text-xs text-ink-500">
        <span className="inline-flex items-center gap-1">
          {new Date(config.updated_at).toLocaleDateString("nl-NL")}
          <ChevronRight size={14} className="text-ink-300" aria-hidden="true" />
        </span>
      </td>
    </tr>
  );
}

export default function LlmConfigPage() {
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<LlmConfig | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await listLlmConfigs(filterType || undefined);
      setConfigs(response.configs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configs");
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleSave = async (value: string) => {
    if (!selectedConfig) return;

    try {
      setSaving(true);
      setError(null);
      const updated = await updateLlmConfig(selectedConfig.key, { value });
      setConfigs((prev) =>
        prev.map((c) => (c.key === selectedConfig.key ? updated : c))
      );
      setSelectedConfig(null);
      setMessage(`${selectedConfig.key} bijgewerkt`);
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update config");
    } finally {
      setSaving(false);
    }
  };

  const handleProviderToggle = async (configKey: string, newProvider: string) => {
    try {
      setSaving(true);
      setError(null);
      const updated = await updateLlmConfig(configKey, { value: newProvider });
      setConfigs((prev) =>
        prev.map((c) => (c.key === configKey ? updated : c))
      );
      const phaseLabel = PHASE_LABELS[configKey] || configKey;
      const providerLabel = PROVIDER_INFO[newProvider]?.label || newProvider;
      setMessage(`${phaseLabel} → ${providerLabel}`);
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update provider");
    } finally {
      setSaving(false);
    }
  };

  const handleSeed = async () => {
    try {
      setSaving(true);
      setError(null);
      const result = await seedLlmConfig(false);
      setMessage(
        `${result.stats.created} nieuw, ${result.stats.updated} bijgewerkt, ${result.stats.skipped} overgeslagen`
      );
      await loadConfigs();
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed configs");
    } finally {
      setSaving(false);
    }
  };

  const promptCount = configs.filter((c) => c.config_type === "prompt").length;
  const paramCount = configs.filter((c) => c.config_type === "parameter").length;
  const scoringCount = configs.filter((c) => c.config_type === "scoring").length;
  const providerConfigs = configs.filter((c) => c.config_type === "provider");
  const providerCount = providerConfigs.length;

  // Filter to just phase provider configs (exclude legacy deepseek_use_reasoner if present)
  const phaseProviderConfigs = providerConfigs.filter((c) => c.key !== "deepseek_use_reasoner");

  // Sort provider configs in logical order
  const sortedProviderConfigs = [...phaseProviderConfigs].sort((a, b) => {
    const rank = (key: string) => (PHASE_ORDER.indexOf(key) < 0 ? PHASE_ORDER.length : PHASE_ORDER.indexOf(key));
    return rank(a.key) - rank(b.key);
  });

  // Filter out providers from table when showing all
  const tableConfigs = filterType === null
    ? configs.filter((c) => c.config_type !== "provider")
    : configs;

  const filters: { id: string | null; label: string; count: number }[] = [
    { id: null, label: "Alles", count: configs.length },
    { id: "provider", label: "Providers", count: providerCount },
    { id: "prompt", label: "Prompts", count: promptCount },
    { id: "parameter", label: "Parameters", count: paramCount },
    { id: "scoring", label: "Scoring", count: scoringCount },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      <AdminHeader
        back={{ href: "/admin", label: "Beheer" }}
        title="LLM-configuratie"
        subtitle="Welk model elke stap gebruikt, en de prompts, parameters en scores"
        action={
          <button type="button" onClick={handleSeed} disabled={saving} className={BUTTON_SECONDARY}>
            {saving ? "Bezig…" : "Seed defaults"}
          </button>
        }
      />

      <div role="tablist" aria-label="Soort instelling" className="flex flex-wrap gap-1.5">
        {filters.map((filter) => {
          const active = filterType === filter.id;
          return (
            <button
              key={filter.label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilterType(filter.id)}
              className={`flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                active ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 bg-paper-50 text-ink-700 hover:bg-paper-200"
              }`}
            >
              {filter.label}
              <span className={`text-xs ${active ? "text-white/70" : "text-ink-400"}`}>{filter.count}</span>
            </button>
          );
        })}
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}

      {/* Provider per step: always in view */}
      {sortedProviderConfigs.length > 0 && !selectedConfig ? (
        <section aria-labelledby="providers-title" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="providers-title" className="font-serif text-2xl font-bold text-ink-900">
              Model per stap
            </h2>
            <p className="text-sm text-ink-500">Direct actief, zonder herstart</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {sortedProviderConfigs.map((config) => (
              <ProviderToggle
                key={config.key}
                config={config}
                onToggle={(newProvider) => handleProviderToggle(config.key, newProvider)}
                disabled={saving}
              />
            ))}
          </div>
        </section>
      ) : null}

      {selectedConfig ? (
        <AdminCard>
          <ConfigEditor config={selectedConfig} onSave={handleSave} onCancel={() => setSelectedConfig(null)} saving={saving} />
        </AdminCard>
      ) : (
        <section aria-labelledby="settings-title" className="space-y-3">
          <h2 id="settings-title" className="font-serif text-2xl font-bold text-ink-900">
            Instellingen
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-paper-300 bg-paper-50">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-semibold text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Sleutel</th>
                  <th className="px-4 py-3 font-semibold">Soort</th>
                  <th className="hidden px-4 py-3 font-semibold md:table-cell">Waarde</th>
                  <th className="px-4 py-3 text-right font-semibold">Bijgewerkt</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="border-t border-paper-200">
                    <td colSpan={4} className="px-4 py-8 text-center text-ink-500">
                      Laden…
                    </td>
                  </tr>
                ) : tableConfigs.length === 0 ? (
                  <tr className="border-t border-paper-200">
                    <td colSpan={4} className="px-4 py-8 text-center text-ink-500">
                      {configs.length === 0 ? "Geen configuratie gevonden. Kies \"Seed defaults\" om te beginnen." : "Geen items in deze categorie."}
                    </td>
                  </tr>
                ) : (
                  tableConfigs.map((config) => <ConfigRow key={config.key} config={config} onClick={() => setSelectedConfig(config)} />)
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="space-y-1.5 rounded-2xl bg-paper-200/60 p-5 text-sm text-ink-700">
        <p>
          <strong className="font-semibold text-ink-900">Providers:</strong> kies per stap welk model het werk doet. Claude Code draait lokaal op het
          abonnement van de eigenaar; de API-modellen hebben een sleutel en tegoed nodig.
        </p>
        <p>
          <strong className="font-semibold text-ink-900">Prompts:</strong> de instructies voor de analyse. Gebruik {"{event_context}"} en{" "}
          {"{article_capsules}"} als plaatshouders.
        </p>
        <p>
          <strong className="font-semibold text-ink-900">Parameters:</strong> modelinstellingen zoals temperature, max tokens en artikellimieten.
        </p>
        <p>
          <strong className="font-semibold text-ink-900">Scoring:</strong> gewichten en drempels voor het samenvoegen van artikelen tot nieuwsitems.
        </p>
        <p className="text-ink-500">De cache wordt bij elke wijziging gewist: de volgende LLM-aanroep gebruikt meteen de nieuwe instelling.</p>
      </div>
    </div>
  );
}
