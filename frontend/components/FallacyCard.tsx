"use client";

import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import type { Fallacy } from "@/lib/types";
import { SourceIconLink } from "@/components/SourceIconLink";

interface FallacyCardProps {
  item: Fallacy;
  index: number;
}

export function FallacyCard({ item, index }: FallacyCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="rounded-lg border-l-4 border-l-amber-500 border border-paper-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-amber-600">
          <AlertCircle size={18} />
          <span className="text-xs font-semibold uppercase tracking-wider">Drogreden</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
            {item.type}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-ink-700 whitespace-pre-line">
          {item.description}
        </p>
        <div className="flex flex-wrap gap-2 pt-2 border-t border-paper-200">
          {item.sources.map((url) => (
            <SourceIconLink key={url} url={url} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
