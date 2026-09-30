"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, Loader2, SearchX, ShieldOff, type LucideIcon } from "lucide-react";

import { noResearchCopy, researchCopy, type ResearchTone } from "@/lib/explore/research";
import type { EntityResearch } from "@/lib/types";

const TONES: Record<ResearchTone, string> = {
  neutral: "border-paper-300 bg-paper-100 text-ink-800",
  busy: "border-blue-200 bg-blue-50 text-blue-900",
  good: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  bad: "border-red-200 bg-red-50 text-red-900",
};

const ICONS: Record<string, LucideIcon> = {
  nieuw: Clock3,
  wachtrij: Clock3,
  bezig: Loader2,
  klaar: CheckCircle2,
  niets_gevonden: SearchX,
  twijfel: CircleHelp,
  overgeslagen: ShieldOff,
  niet_nodig: CheckCircle2,
  fout: AlertTriangle,
};

const dateFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function when(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

/** The research status of a name as a small card (every status has its own Dutch explanation). */
export function ResearchStatusCard({ row, name, requesting = false }: { row: EntityResearch | null; name: string; requesting?: boolean }) {
  const copy = row ? researchCopy({ ...row, name: row.name || name }) : noResearchCopy(name, requesting);
  const Icon = row ? ICONS[row.status] ?? CircleHelp : requesting ? Loader2 : Clock3;
  const spinning = (row?.status === "bezig" || (!row && requesting)) && Icon === Loader2;
  const stamp = row?.status === "klaar" || row?.status === "niets_gevonden" ? when(row.researched_at) : when(row?.queued_at);

  return (
    <div className={`flex gap-3 rounded-xl border p-3 ${TONES[copy.tone]}`} role="status" aria-live="polite" data-research-status={row?.status ?? "geen"}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${spinning ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="text-sm leading-relaxed opacity-90">{copy.body}</p>
        {row?.role_label && row.status !== "overgeslagen" ? <p className="text-xs opacity-75">Rol in het nieuws: {row.role_label}</p> : null}
        {stamp ? (
          <p className="text-xs opacity-75">
            {row?.status === "klaar" || row?.status === "niets_gevonden" ? "Uitgezocht op" : "Aangevraagd op"} {stamp}
          </p>
        ) : null}
      </div>
    </div>
  );
}
