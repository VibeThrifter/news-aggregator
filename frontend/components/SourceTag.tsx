import { ExternalLink } from "lucide-react";

import type { ClusterSource } from "@/lib/types";
import { SPECTRUM_LABELS, SPECTRUM_STYLES } from "@/lib/format";

function buildSpectrumBadge(spectrum?: string | null) {
  if (!spectrum) {
    return null;
  }

  const label = SPECTRUM_LABELS[spectrum] ?? spectrum;
  const style = SPECTRUM_STYLES[spectrum] ?? "border-slate-600 bg-slate-700 text-slate-200";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${style}`}
    >
      {label}
    </span>
  );
}

export function SourceTag({ title, url, spectrum }: ClusterSource) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 transition hover:border-aurora-500/60 hover:text-white"
    >
      <ExternalLink size={14} />
      <span className="truncate max-w-[12rem]">{title}</span>
      {buildSpectrumBadge(spectrum)}
    </a>
  );
}
