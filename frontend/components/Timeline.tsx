"use client";

import { motion } from "framer-motion";
import { Clock } from "lucide-react";
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
    <div className="rounded-lg border-l-4 border-l-blue-500 border border-paper-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Clock size={20} className="text-blue-600" />
        <h2 className="font-serif text-xl font-bold text-ink-900">Neutrale tijdlijn</h2>
      </div>
      <div className="space-y-4 border-l-2 border-blue-200 ml-2 pl-4">
        {data.map((item, index) => (
          <motion.div
            key={`${item.time}-${index}`}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="relative flex items-start gap-3"
          >
            <div className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-sm text-blue-600 font-mono w-28 shrink-0 font-medium">{formatTime(item.time)}</span>
            <p className="text-sm text-ink-700 leading-snug">{item.headline}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
