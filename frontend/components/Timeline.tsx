"use client";

import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import type { TimelineEvent } from "@/lib/types";

interface TimelineProps {
  data: TimelineEvent[];
}

function formatTime(time: string, headline?: string): string {
  // Year-only format (e.g., "1934", "1952")
  if (/^\d{4}$/.test(time)) {
    return time;
  }

  const date = new Date(time);
  if (isNaN(date.getTime())) return time;

  const now = new Date();
  const currentYear = now.getFullYear();
  const eventYear = date.getFullYear();

  // Detect malformed timestamps: 1970-01-01T00:XX:XX indicates LLM converted year to Unix seconds
  // e.g., "1934" becomes 1934 seconds after epoch = 1970-01-01T00:32:14
  if (eventYear === 1970 && date.getMonth() === 0 && date.getDate() === 1) {
    // Try to extract year from headline (e.g., "Geboren in 1934" or historical context)
    if (headline) {
      const yearMatch = headline.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
      if (yearMatch) {
        return yearMatch[1];
      }
    }
    // If no year in headline, this is likely a historical event - hide the broken date
    return "–";
  }

  const day = date.getDate();
  const month = date.toLocaleDateString("nl-NL", { month: "short" });

  // Check if time is midnight (00:00) - likely a date-only value
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;

  // Historical events (more than 1 year ago): show day month year
  if (eventYear < currentYear - 1) {
    return `${day} ${month} ${eventYear}`;
  }

  // Recent events with time: show day month hour:min
  if (hasTime) {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${day} ${month} ${hours}:${minutes}`;
  }

  // Recent date-only: show day month year
  return `${day} ${month} ${eventYear}`;
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
            <span className="text-sm text-blue-600 font-mono w-28 shrink-0 font-medium">{formatTime(item.time, item.headline)}</span>
            <p className="text-sm text-ink-700 leading-snug">{item.headline}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
