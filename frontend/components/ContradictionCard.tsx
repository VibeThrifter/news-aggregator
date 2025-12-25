"use client";

import { AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import type { Contradiction } from "@/lib/types";
import { SourceIconLink } from "@/components/SourceIconLink";

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
      className="rounded-lg border-l-4 border-l-red-500 border border-paper-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-2 text-red-600">
        <AlertTriangle size={18} />
        <h3 className="text-xs font-semibold uppercase tracking-wider">Tegenstrijdige claim</h3>
      </div>
      <p className="mt-2 text-base font-semibold text-ink-900">{data.topic}</p>
      <div className="mt-4 grid gap-4 text-sm">
        <div className="space-y-2 rounded-lg bg-red-50 p-3 border border-red-100">
          <p className="font-semibold text-red-700">Claim A</p>
          <p className="text-ink-700">{data.claim_a.summary}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {data.claim_a.sources.map((url) => (
              <SourceIconLink key={url} url={url} />
            ))}
          </div>
        </div>
        <div className="space-y-2 rounded-lg bg-red-50 p-3 border border-red-100">
          <p className="font-semibold text-red-700">Claim B</p>
          <p className="text-ink-700">{data.claim_b.summary}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {data.claim_b.sources.map((url) => (
              <SourceIconLink key={url} url={url} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 border border-red-200">
            Status: {data.verification}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
