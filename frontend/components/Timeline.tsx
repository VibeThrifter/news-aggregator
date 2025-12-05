"use client";

import { motion } from "framer-motion";
import type { TimelineEvent } from "@/lib/types";

interface TimelineProps {
  data: TimelineEvent[];
}

function formatTime(time: string): string {
  const date = new Date(time);
  if (isNaN(date.getTime())) return time;
  const day = date.getDate();
  const month = date.toLocaleDateString("nl-NL", { month: "short" });
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${hours}:${minutes}`;
}

export function Timeline({ data }: TimelineProps) {
  if (!data.length) return null;

  return (
    <div className="rounded-3xl bg-white/5 p-6 shadow-glow border border-white/10 backdrop-blur">
      <h2 className="text-xl font-semibold mb-4">Neutrale tijdlijn</h2>
      <div className="space-y-4">
        {data.map((item, index) => (
          <motion.div
            key={`${item.time}-${index}`}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="flex items-start gap-3"
          >
            <span className="text-sm text-aurora-500 font-mono w-24 shrink-0">{formatTime(item.time)}</span>
            <p className="text-sm text-slate-200 leading-snug">{item.headline}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
