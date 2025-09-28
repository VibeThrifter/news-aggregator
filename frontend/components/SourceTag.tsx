import { ExternalLink } from "lucide-react";
import type { ClusterSource } from "@/lib/types";

export function SourceTag({ title, url }: ClusterSource) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 transition hover:border-aurora-500/60 hover:text-white"
    >
      <ExternalLink size={14} />
      <span className="truncate max-w-[12rem]">{title}</span>
    </a>
  );
}
