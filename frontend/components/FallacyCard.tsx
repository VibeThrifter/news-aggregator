"use client";

import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import type { Fallacy } from "@/lib/types";
import { SourceTag } from "@/components/SourceTag";

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
      className="relative overflow-hidden rounded-3xl border border-amber-400/40 bg-amber-500/10 p-6 backdrop-blur"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-amber-400/20 to-transparent opacity-40 pointer-events-none" />
      <div className="relative space-y-3 text-slate-50">
        <div className="flex items-center gap-2 text-amber-200">
          <AlertCircle size={20} />
          <span className="text-xs uppercase tracking-[0.3em]">Drogreden</span>
        </div>
        <h3 className="text-lg font-semibold text-slate-50">{item.type}</h3>
        <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-line">
          {item.description}
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          {item.sources.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1 text-xs text-amber-100 transition hover:bg-amber-400/20"
            >
              Bron
            </a>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
