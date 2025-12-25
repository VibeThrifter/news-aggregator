"use client";

import { AlertTriangle } from "lucide-react";

interface InsightsFallbackProps {
  eventId: number;
  reason?: string | null;
}

export function InsightsFallback({ eventId, reason }: InsightsFallbackProps) {
  return (
    <aside className="rounded-lg border-l-4 border-l-amber-500 border border-paper-200 bg-amber-50 p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 text-amber-600 shrink-0" size={20} />
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700">Insights ontbreken</h2>
            <p className="mt-1 text-sm text-ink-700">
              {reason ?? "Voor dit event zijn nog geen LLM-insights beschikbaar. Insights worden automatisch gegenereerd tijdens de ingest-pipeline."}
            </p>
          </div>
          <p className="text-xs text-ink-500">
            Insights worden gegenereerd wanneer nieuwe artikelen worden toegevoegd aan dit event. Wacht op de volgende RSS-poll (elke 15 minuten).
          </p>
        </div>
      </div>
    </aside>
  );
}
