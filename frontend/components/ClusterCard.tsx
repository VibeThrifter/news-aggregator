"use client";

import { motion } from "framer-motion";
import { Users } from "lucide-react";
import type { Cluster } from "@/lib/types";
import { SourceTag } from "@/components/SourceTag";

interface ClusterCardProps {
  cluster: Cluster;
  index: number;
}

export function ClusterCard({ cluster, index }: ClusterCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className="rounded-lg border-l-4 border-l-teal-500 border border-paper-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-teal-600" />
          <span className="text-xs font-semibold uppercase tracking-wider text-teal-600">{cluster.label}</span>
        </div>
        <p className="text-sm leading-relaxed text-ink-700 whitespace-pre-line">
          {cluster.summary}
        </p>
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-paper-200">
          {cluster.sources.map((source) => (
            <SourceTag key={source.url} {...source} compact />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
