"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { QueryForm } from "@/components/QueryForm";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { Timeline } from "@/components/Timeline";
import { ClusterCard } from "@/components/ClusterCard";
import { ContradictionCard } from "@/components/ContradictionCard";
import { FallacyCard } from "@/components/FallacyCard";
import type { AggregationResponse } from "@/lib/types";

export default function HomePage() {
  const [data, setData] = useState<AggregationResponse | null>(null);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 px-6 pb-24 pt-20 lg:px-16">
        <header className="mx-auto flex max-w-4xl flex-col items-center text-center gap-6">
          <motion.span
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1 text-xs uppercase tracking-[0.4em] text-aurora-500"
          >
            360° Nieuwsperceptie
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-semibold text-slate-50 sm:text-5xl lg:text-6xl"
          >
            Vergelijk alle perspectieven <span className="bg-gradient-to-r from-aurora-500 via-aurora-600 to-aurora-700 bg-clip-text text-transparent">op één plek</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="max-w-2xl text-sm text-slate-300 leading-6"
          >
            Voer een actuele gebeurtenis in. We zoeken live bronnen via Tavily, scrapen de inhoud en laten ChatGPT pluriforme samenvattingen maken.
          </motion.p>
        </header>

        <section className="mt-12">
          <QueryForm onResult={setData} />
        </section>

        {data && (
          <section className="mx-auto mt-16 grid max-w-6xl gap-10">
            {data.llm_provider && (
              <p className="text-center text-xs uppercase tracking-[0.4em] text-slate-400">
                Samenvatting via {data.llm_provider}
              </p>
            )}
            <Timeline data={data.timeline} />
            <div>
              <h2 className="mb-4 text-xl font-semibold text-slate-50">Invalshoeken</h2>
              <div className="grid gap-6 md:grid-cols-2">
                {data.clusters.map((cluster, index) => (
                  <ClusterCard key={cluster.angle + index} cluster={cluster} index={index} />
                ))}
              </div>
            </div>
            {data.fallacies.length > 0 && (
              <div>
                <h2 className="mb-4 text-xl font-semibold text-slate-50">Gedetecteerde drogredeneringen</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {data.fallacies.map((item, index) => (
                    <FallacyCard key={item.type + index + item.claim} item={item} index={index} />
                  ))}
                </div>
              </div>
            )}
            {data.contradictions.length > 0 && (
              <div>
                <h2 className="mb-4 text-xl font-semibold text-slate-50">Tegenstrijdige claims</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {data.contradictions.map((item, index) => (
                    <ContradictionCard key={item.topic + index} data={item} index={index} />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
