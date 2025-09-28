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
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-red-100">
              {data.source_A ? data.source_A.title : 'Bron A'}
            </p>
            {data.source_A && (
              <SourceTag title={data.source_A.title} url={data.source_A.url} />
            )}
          </div>
          <p>{data.claim_A}</p>
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-red-100">
              {data.source_B ? data.source_B.title : 'Bron B'}
            </p>
            {data.source_B && (
              <SourceTag title={data.source_B.title} url={data.source_B.url} />
            )}
          </div>
          <p>{data.claim_B}</p>
        </div>
        <p className="text-xs uppercase tracking-widest text-red-300">Status: {data.status}</p>
      </div>
    </motion.div>
  );
}
