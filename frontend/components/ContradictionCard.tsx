"use client";

import { AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import type { Contradiction } from "@/lib/types";
import { SourceTag } from "@/components/SourceTag";

interface ContradictionCardProps {
  data: Contradiction;
  index: number;
}

export function ContradictionCard({ data, index }: ContradictionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="rounded-3xl border border-red-400/30 bg-red-500/10 p-5 backdrop-blur"
    >
      <div className="flex items-center gap-3 text-red-200">
        <AlertTriangle size={20} />
        <h3 className="text-sm uppercase tracking-[0.3em]">Tegenstrijdige claim</h3>
      </div>
      <p className="mt-2 text-base font-semibold text-slate-50">{data.topic}</p>
      <div className="mt-3 grid gap-3 text-sm text-slate-200">
        <div className="space-y-1">
          <p className="font-semibold text-red-100">Claim A</p>
          <p>{data.claim_a.summary}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {data.claim_a.sources.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-red-300/40 bg-red-400/10 px-2 py-0.5 text-xs text-red-100 transition hover:bg-red-400/20"
              >
                Bron
              </a>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-red-100">Claim B</p>
          <p>{data.claim_b.summary}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {data.claim_b.sources.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-red-300/40 bg-red-400/10 px-2 py-0.5 text-xs text-red-100 transition hover:bg-red-400/20"
              >
                Bron
              </a>
            ))}
          </div>
        </div>
        <p className="text-xs uppercase tracking-widest text-red-300">Status: {data.verification}</p>
      </div>
    </motion.div>
  );
}
