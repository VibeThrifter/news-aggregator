"use client";

import { motion } from "framer-motion";
import { Frame as FrameIcon } from "lucide-react";
import type { Frame } from "@/lib/types";

interface FrameCardProps {
  item: Frame;
  index: number;
}

export function FrameCard({ item, index }: FrameCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="relative overflow-hidden rounded-3xl border border-indigo-400/40 bg-indigo-500/10 p-6 backdrop-blur"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-400/20 to-transparent opacity-40 pointer-events-none" />
      <div className="relative space-y-3 text-slate-50">
        <div className="flex items-center gap-2 text-indigo-200">
          <FrameIcon size={20} />
          <span className="text-xs uppercase tracking-[0.3em]">Frame</span>
        </div>
        <h3 className="text-lg font-semibold text-slate-50">{item.frame_type}</h3>
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
              className="rounded-full border border-indigo-300/40 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-100 transition hover:bg-indigo-400/20"
            >
              Bron
            </a>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
