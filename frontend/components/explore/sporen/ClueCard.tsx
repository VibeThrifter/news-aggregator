"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pin, PinOff } from "lucide-react";

import { CLUE_TYPE_LABELS, revealedTitle } from "@/lib/explore/clues";
import { truncate } from "@/lib/explore/summary";
import type { Clue } from "@/lib/explore/types";
import { useExploreStore } from "@/lib/explore/store";

import { SPOOR_COLORS, dossierIds, useExplore } from "../ExploreContext";
import { Favicon } from "../ui/primitives";
import { ClueBody } from "./ClueBody";
import { Draggable } from "../dnd/ExploreDnd";

export function ClueCard({ clue, highlighted = false }: { clue: Clue; highlighted?: boolean }) {
  const { exploration, isRevealed, reveal, pin, isPinned, eventId } = useExplore();
  const removeItem = useExploreStore((state) => state.removeItem);
  const open = isRevealed(clue.id);
  const color = SPOOR_COLORS[clue.spoor];
  const dossierId = dossierIds.clue(eventId, clue.id);
  const pinned = isPinned(dossierId);
  const outlets = clue.outletKeys.map((key) => exploration.index.outlet(key)).filter(Boolean);

  const pinInput = {
    id: dossierId,
    kind: "clue" as const,
    refId: clue.id,
    spoor: clue.spoor,
    title: truncate(revealedTitle(clue, exploration.index), 90),
    subtitle: CLUE_TYPE_LABELS[clue.type],
    keys: clue.links,
  };
  const pinClue = () => {
    if (pinned) {
      removeItem(dossierId);
      return;
    }
    pin(pinInput);
  };

  return (
    <article
      id={`clue-${clue.id}`}
      className={`relative rounded-2xl ${highlighted ? "ring-2 ring-offset-2" : ""}`}
      style={{ perspective: 1200, ...(highlighted ? { ["--tw-ring-color" as string]: color } : {}) }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.div
            key="front"
            initial={{ rotateY: -90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="rounded-2xl border border-paper-300 bg-paper-50 p-4 shadow-card-light"
            style={{ borderLeftColor: color, borderLeftWidth: 4 }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color }}>
                {CLUE_TYPE_LABELS[clue.type]}
              </span>
              <button
                type="button"
                onClick={pinClue}
                className={`-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-full ${pinned ? "text-accent-orange" : "text-ink-400 hover:text-ink-900"}`}
                aria-label={pinned ? "Uit dossier halen" : "Bewaar in dossier"}
                aria-pressed={pinned}
              >
                {pinned ? <PinOff size={18} /> : <Pin size={18} />}
              </button>
            </div>
            <Draggable id={`clue:${clue.id}`} payload={{ label: pinInput.title, pin: pinInput }}>
              <ClueBody clue={clue} />
            </Draggable>
          </motion.div>
        ) : (
          <motion.button
            key="back"
            type="button"
            exit={{ rotateY: 90, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeIn" }}
            onClick={() => reveal([clue.id])}
            aria-expanded={false}
            aria-label={`${clue.teaser.title}${clue.teaser.hint ? `, ${clue.teaser.hint}` : ""}. Tik om te onthullen`}
            className="relative block min-h-[104px] w-full overflow-hidden rounded-2xl bg-ink-900 p-4 text-left text-white shadow-card transition-transform active:scale-[0.99]"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-2 -top-6 select-none font-serif text-[120px] font-black leading-none text-white/[0.06]"
            >
              ?
            </span>
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: color }} />
            <span className="relative block pl-2">
              <span className="block text-base font-semibold leading-snug">{clue.teaser.title}</span>
              {clue.teaser.hint ? <span className="mt-1 block text-sm text-white/70">{clue.teaser.hint}</span> : null}
              <span className="mt-3 flex items-center justify-between gap-2">
                <span className="flex -space-x-1">
                  {outlets.slice(0, 5).map((outlet) =>
                    outlet ? (
                      <span key={outlet.key} className="rounded-sm bg-white p-0.5">
                        <Favicon name={outlet.name} domain={outlet.domain} size={14} />
                      </span>
                    ) : null,
                  )}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-white/60">Tik om te onthullen</span>
              </span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </article>
  );
}
