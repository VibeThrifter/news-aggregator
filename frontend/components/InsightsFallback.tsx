"use client";

import { AlertTriangle } from "lucide-react";

interface InsightsFallbackProps {
  eventId: number;
  reason?: string | null;
}

export function InsightsFallback({ eventId, reason }: InsightsFallbackProps) {
  return (
    <aside className="rounded-3xl border border-amber-400/60 bg-amber-500/10 p-6 text-amber-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 text-amber-900" size={20} />
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.3em]">Insights ontbreken</h2>
            <p className="mt-1 text-sm text-amber-900">
              {reason ?? "Voor dit event zijn nog geen LLM-insights beschikbaar. Insights worden automatisch gegenereerd tijdens de ingest-pipeline."}
            </p>
          </div>
          <p className="text-xs text-amber-800">
            Insights worden gegenereerd wanneer nieuwe artikelen worden toegevoegd aan dit event. Wacht op de volgende RSS-poll (elke 15 minuten).
          </p>
        </div>
      </div>
    </aside>
  );
}
