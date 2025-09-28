"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { fetchAggregation } from "@/lib/api";
import type { AggregationResponse } from "@/lib/types";

interface QueryFormProps {
  onResult: (data: AggregationResponse) => void;
}

export function QueryForm({ onResult }: QueryFormProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAggregation(query.trim());
      onResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 max-w-3xl mx-auto">
      <form
        onSubmit={handleSubmit}
        className="group rounded-full border border-white/10 bg-white/[0.03] p-2 backdrop-blur transition focus-within:border-aurora-500/60"
      >
        <div className="flex items-center gap-3 px-4">
          <Sparkles className="h-5 w-5 text-aurora-500" />
          <input
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-400 outline-none"
            placeholder="Voorbeeld: anti-immigratie demonstratie Malieveld 20 september 2025"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="submit"
            className="flex items-center gap-2 rounded-full bg-gradient-to-r from-aurora-500 via-aurora-600 to-aurora-700 px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:shadow-lg disabled:opacity-60"
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Bezig..." : "Analyseer"}
          </button>
        </div>
      </form>
      {error && (
        <p className="mt-3 text-sm text-red-300 text-center">{error}</p>
      )}
    </div>
  );
}
