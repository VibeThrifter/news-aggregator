"use client";

import type { Cluster } from "@/lib/types";

import { ClusterCard } from "./ClusterCard";

interface ClusterGridProps {
  clusters: Cluster[];
}

export function ClusterGrid({ clusters }: ClusterGridProps) {
  if (!clusters.length) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-200">
        Nog geen invalshoeken beschikbaar. Vraag een onafhankelijke analyse aan of wacht op LLM-resultaten.
      </div>
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {clusters.map((cluster, index) => (
        <ClusterCard key={`${cluster.label}-${index}`} cluster={cluster} index={index} />
      ))}
    </div>
  );
}
