import Image from "next/image";
import { ExternalLink } from "lucide-react";

import type { ClusterSource } from "@/lib/types";
import { getDomainFromUrl, getFaviconUrl, SPECTRUM_LABELS, SPECTRUM_STYLES } from "@/lib/format";

function buildSpectrumBadge(spectrum?: string | null, compact?: boolean) {
  if (!spectrum) {
    return null;
  }

  const label = SPECTRUM_LABELS[spectrum] ?? spectrum;
  const style = SPECTRUM_STYLES[spectrum] ?? "border-slate-600 bg-slate-700 text-slate-200";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border ${compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"} font-semibold uppercase tracking-[0.2em] ${style}`}
    >
      {label}
    </span>
  );
}

interface SourceTagProps extends ClusterSource {
  /** Compact mode: only show favicon + spectrum badge with domain tooltip */
  compact?: boolean;
}

export function SourceTag({ title, url, spectrum, compact = false }: SourceTagProps) {
  const favicon = getFaviconUrl(url);
  const domain = getDomainFromUrl(url);

  if (compact) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${domain}: ${title}`}
        className="group inline-flex items-center gap-1.5 rounded-full border border-paper-200 bg-white px-2 py-1 shadow-sm transition hover:border-paper-300 hover:shadow"
      >
        <Image
          src={favicon}
          alt={domain}
          width={14}
          height={14}
          className="shrink-0 rounded-sm"
          unoptimized
        />
        {buildSpectrumBadge(spectrum, true)}
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:border-aurora-500/60 hover:text-white"
    >
      <Image
        src={favicon}
        alt=""
        width={14}
        height={14}
        className="shrink-0 rounded-sm"
        unoptimized
      />
      <span className="min-w-0 truncate">{title}</span>
      {buildSpectrumBadge(spectrum)}
      <ExternalLink size={10} className="shrink-0 opacity-50" />
    </a>
  );
}
