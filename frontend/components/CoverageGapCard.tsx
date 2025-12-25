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
      className="rounded-lg border-l-4 border-l-indigo-500 border border-paper-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-indigo-600">
          <Info size={18} />
          <span className="text-xs font-semibold uppercase tracking-wider">Onderbelicht perspectief</span>
        </div>
        <h3 className="text-base font-semibold text-ink-900">{item.perspective}</h3>
        <p className="text-sm leading-relaxed text-ink-700 whitespace-pre-line">
          {item.description}
        </p>
        <div className="space-y-2 pt-2 border-t border-paper-200">
          <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
            Relevantie
          </div>
          <p className="text-sm text-ink-600">{item.relevance}</p>
        </div>
        {item.potential_sources?.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
              Mogelijke bronnen
            </div>
            <div className="flex flex-wrap gap-2">
              {item.potential_sources.map((source, idx) => (
                <span
                  key={idx}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
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
