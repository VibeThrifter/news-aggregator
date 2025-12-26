"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  listLlmConfigs,
  updateLlmConfig,
  seedLlmConfig,
  type LlmConfig,
} from "@/lib/api";

// Config type labels in Dutch
const configTypeLabels: Record<string, string> = {
  prompt: "Prompts",
  parameter: "Parameters",
  scoring: "Scoring",
  provider: "Providers",
};

// Config type colors
const configTypeColors: Record<string, string> = {
  prompt: "bg-purple-600",
  parameter: "bg-blue-500",
  scoring: "bg-green-500",
  provider: "bg-orange-500",
};

// Available LLM providers
const LLM_PROVIDERS = ["mistral", "gemini", "deepseek", "deepseek-r1"];

// Provider display info
const PROVIDER_INFO: Record<string, { label: string; description: string; color: string }> = {
  mistral: {
    label: "Mistral",
    description: "Gratis, snel",
    color: "bg-blue-600",
  },
  deepseek: {
    label: "DeepSeek",
    description: "Goedkoop, goed",
    color: "bg-emerald-600",
  },
  "deepseek-r1": {
    label: "DeepSeek R1",
    description: "Reasoning, 2x duurder",
    color: "bg-amber-600",
  },
  gemini: {
    label: "Gemini",
    description: "Gratis, 1500/dag",
    color: "bg-pink-600",
  },
};

// Phase display names
const PHASE_LABELS: Record<string, string> = {
  provider_classification: "Classificatie",
  provider_factual: "Fase 1: Feitelijk",
  provider_critical: "Fase 2: Kritisch",
};

function TypeBadge({ type }: { type: string }) {
  const colorClass = configTypeColors[type] || "bg-slate-500";
  const label = configTypeLabels[type] || type;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white ${colorClass}`}>
      {label}
    </span>
  );
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

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="mb-3">
        <h3 className="font-medium text-slate-100">{phaseLabel}</h3>
        <p className="text-xs text-slate-400">{config.description}</p>
      </div>
      <div className="flex gap-2">
        {LLM_PROVIDERS.map((provider) => {
          const info = PROVIDER_INFO[provider];
          const isActive = currentProvider === provider;
          return (
            <button
              key={provider}
              onClick={() => !isActive && onToggle(provider)}
              disabled={disabled || isActive}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                isActive
                  ? `${info.color} text-white ring-2 ring-offset-2 ring-offset-slate-800 ring-white/30`
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50"
              }`}
            >
              <div>{info.label}</div>
              <div className="text-xs opacity-75">{info.description}</div>
            </button>
          );
        })}
      </div>
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">{config.key}</h3>
          {config.description && (
            <p className="text-sm text-slate-400">{config.description}</p>
          )}
        </div>
        <TypeBadge type={config.config_type} />
      </div>

      {isPrompt ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          rows={20}
          className="w-full rounded-lg border border-slate-600 bg-slate-800 p-4 font-mono text-sm text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
          placeholder="Prompt tekst..."
        />
      ) : isProvider ? (
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        >
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
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        />
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Laatst bijgewerkt: {new Date(config.updated_at).toLocaleString("nl-NL")}
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-600 disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            onClick={() => onSave(value)}
            disabled={saving || value === config.value}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Opslaan..." : "Opslaan"}
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
  const displayValue = isPrompt
    ? `${config.value.slice(0, 100)}...`
    : config.value;

  return (
    <tr
      onClick={onClick}
      className="cursor-pointer border-b border-slate-700 hover:bg-slate-800/50"
    >
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-slate-100">{config.key}</span>
          {config.description && (
            <span className="text-xs text-slate-400">{config.description}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <TypeBadge type={config.config_type} />
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        <span
          className={`max-w-xs truncate text-sm ${isPrompt ? "font-mono text-slate-500" : "text-slate-300"}`}
          title={config.value}
        >
          {displayValue}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-xs text-slate-500">
        {new Date(config.updated_at).toLocaleDateString("nl-NL")}
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
    const order = ["provider_classification", "provider_factual", "provider_critical"];
    return order.indexOf(a.key) - order.indexOf(b.key);
  });

  // Filter out providers from table when showing all
  const tableConfigs = filterType === null
    ? configs.filter((c) => c.config_type !== "provider")
    : configs;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/admin"
            className="text-sm text-brand-400 hover:text-brand-300"
          >
            &larr; Terug naar admin
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-100">
            LLM Configuratie
          </h1>
          <p className="text-sm text-slate-400">
            Beheer prompts, parameters en scoring instellingen
          </p>
        </div>
        <button
          onClick={handleSeed}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Bezig..." : "Seed defaults"}
        </button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-5">
        <button
          onClick={() => setFilterType(null)}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filterType === null
              ? "border-brand-500 bg-brand-900/20"
              : "border-slate-700 bg-slate-800 hover:border-slate-600"
          }`}
        >
          <p className="text-sm text-slate-400">Totaal</p>
          <p className="text-2xl font-bold text-slate-100">{configs.length}</p>
        </button>
        <button
          onClick={() => setFilterType("provider")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filterType === "provider"
              ? "border-orange-500 bg-orange-900/20"
              : "border-slate-700 bg-slate-800 hover:border-slate-600"
          }`}
        >
          <p className="text-sm text-slate-400">Providers</p>
          <p className="text-2xl font-bold text-orange-400">{providerCount}</p>
        </button>
        <button
          onClick={() => setFilterType("prompt")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filterType === "prompt"
              ? "border-purple-500 bg-purple-900/20"
              : "border-slate-700 bg-slate-800 hover:border-slate-600"
          }`}
        >
          <p className="text-sm text-slate-400">Prompts</p>
          <p className="text-2xl font-bold text-purple-400">{promptCount}</p>
        </button>
        <button
          onClick={() => setFilterType("parameter")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filterType === "parameter"
              ? "border-blue-500 bg-blue-900/20"
              : "border-slate-700 bg-slate-800 hover:border-slate-600"
          }`}
        >
          <p className="text-sm text-slate-400">Parameters</p>
          <p className="text-2xl font-bold text-blue-400">{paramCount}</p>
        </button>
        <button
          onClick={() => setFilterType("scoring")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            filterType === "scoring"
              ? "border-green-500 bg-green-900/20"
              : "border-slate-700 bg-slate-800 hover:border-slate-600"
          }`}
        >
          <p className="text-sm text-slate-400">Scoring</p>
          <p className="text-2xl font-bold text-green-400">{scoringCount}</p>
        </button>
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

      {/* Provider Toggles - Always visible */}
      {sortedProviderConfigs.length > 0 && !selectedConfig && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">LLM Provider per Fase</h2>
            <span className="text-xs text-slate-400">Wijzigingen direct actief (geen restart nodig)</span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {sortedProviderConfigs.map((config) => (
              <ProviderToggle
                key={config.key}
                config={config}
                onToggle={(newProvider) => handleProviderToggle(config.key, newProvider)}
                disabled={saving}
              />
            ))}
          </div>
        </div>
      )}

      {/* Editor modal */}
      {selectedConfig && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
          <ConfigEditor
            config={selectedConfig}
            onSave={handleSave}
            onCancel={() => setSelectedConfig(null)}
            saving={saving}
          />
        </div>
      )}

      {/* Config table */}
      {!selectedConfig && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Type</th>
                <th className="hidden px-4 py-3 md:table-cell">Waarde</th>
                <th className="px-4 py-3 text-right">Bijgewerkt</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    Laden...
                  </td>
                </tr>
              ) : tableConfigs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    {configs.length === 0
                      ? "Geen configuratie gevonden. Klik op \"Seed defaults\" om te beginnen."
                      : "Geen items in deze categorie."}
                  </td>
                </tr>
              ) : (
                tableConfigs.map((config) => (
                  <ConfigRow
                    key={config.key}
                    config={config}
                    onClick={() => setSelectedConfig(config)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Help text */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <h2 className="mb-2 font-semibold text-slate-100">Uitleg</h2>
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <strong className="text-orange-400">LLM Providers:</strong> Wissel direct tussen Mistral,
            DeepSeek, DeepSeek R1 (reasoning) en Gemini (gratis, 1500/dag) per analysefase. Wijzigingen zijn
            <em className="text-emerald-400"> direct actief</em> - geen backend restart nodig.
          </p>
          <p>
            <strong className="text-purple-400">Prompts:</strong> LLM instructies voor analyse.
            Gebruik {"{event_context}"} en {"{article_capsules}"} als placeholders.
          </p>
          <p>
            <strong className="text-blue-400">Parameters:</strong> Model instellingen zoals
            temperature, max tokens, en artikel limieten.
          </p>
          <p>
            <strong className="text-green-400">Scoring:</strong> Gewichten en drempelwaarden
            voor event clustering algoritme.
          </p>
          <p className="text-slate-400">
            Tip: De cache wordt automatisch gewist bij updates. Volgende LLM calls
            gebruiken direct de nieuwe instellingen.
          </p>
        </div>
      </div>
    </div>
  );
}
