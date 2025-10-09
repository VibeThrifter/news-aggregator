"use client";

import { motion } from "framer-motion";
import { Info } from "lucide-react";
import type { CoverageGap } from "@/lib/types";

interface CoverageGapCardProps {
  item: CoverageGap;
  index: number;
}

export function CoverageGapCard({ item, index }: CoverageGapCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="relative overflow-hidden rounded-3xl border border-indigo-400/40 bg-indigo-500/10 p-6 backdrop-blur"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-400/20 to-transparent opacity-40 pointer-events-none" />
      <div className="relative space-y-3 text-slate-50">
        <div className="flex items-center gap-2 text-indigo-200">
          <Info size={20} />
          <span className="text-xs uppercase tracking-[0.3em]">Onderbelicht perspectief</span>
        </div>
        <h3 className="text-lg font-semibold text-slate-50">{item.perspective}</h3>
        <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-line">
          {item.description}
        </p>
        <div className="space-y-2 pt-2">
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
            Relevantie
          </div>
          <p className="text-sm text-slate-200">{item.relevance}</p>
        </div>
        {item.potential_sources?.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
              Mogelijke bronnen
            </div>
            <div className="flex flex-wrap gap-2">
              {item.potential_sources.map((source, idx) => (
                <span
                  key={idx}
                  className="rounded-full border border-indigo-300/40 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-100"
                >
                  {source}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
