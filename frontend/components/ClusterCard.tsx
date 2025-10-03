import { motion } from "framer-motion";
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
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-glow backdrop-blur"
    >
      <div className="absolute inset-0 opacity-20 bg-gradient-to-br from-aurora-500/20 to-transparent pointer-events-none" />
      <div className="relative space-y-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-aurora-500">{cluster.angle}</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-50">Kernsamenvatting</h3>
        </div>
        <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-line">
          {cluster.summary}
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          {cluster.sources.map((source) => (
            <SourceTag key={source.url} {...source} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
