"use client";

import { motion } from "framer-motion";

export function AnimatedBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <motion.div
        className="absolute -top-32 -left-32 h-72 w-72 rounded-full bg-aurora-600/40 blur-3xl"
        animate={{
          x: [0, 40, -20, 0],
          y: [0, 20, -30, 0],
          scale: [1, 1.1, 0.95, 1],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-1/2 -right-20 h-80 w-80 rounded-full bg-aurora-500/30 blur-3xl"
        animate={{
          x: [0, -30, 20, 0],
          y: [0, -25, 30, 0],
          scale: [1, 0.9, 1.1, 1],
        }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
