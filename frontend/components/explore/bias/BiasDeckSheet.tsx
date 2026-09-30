"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight, Pin, ScanText, UserSearch } from "lucide-react";

import { biasCards, biasByOutlet, objectivity } from "@/lib/explore/bias";
import { hasEntityLinks } from "@/lib/explore/entity-linker";
import { BIAS_SOURCE_LABELS, biasTypeLabel } from "@/lib/explore/labels";
import { actorKeys } from "@/lib/explore/normalize";
import { truncate } from "@/lib/explore/summary";

import { useExplore } from "../ExploreContext";
import { useEntityLinks } from "../entity/EntityLinks";
import { EntityText } from "../entity/EntityText";
import { Favicon, Tag } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";

const SWIPE_THRESHOLD = 80;

/** Who said a quoted sentence: known names link inline, any other speaker opens the entity panel. */
function Speaker({ speaker }: { speaker: string }) {
  const links = useEntityLinks();
  const { panel } = useExplore();
  if (links && hasEntityLinks(speaker, links.links)) {
    return (
      <Tag>
        <EntityText text={speaker} />
      </Tag>
    );
  }
  const keys = actorKeys(speaker);
  if (!keys.slug) return <Tag>{speaker}</Tag>;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        panel.open(`entiteit:${keys.slug}`, { n: keys.display });
      }}
      className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-paper-300 bg-white px-2.5 text-[11px] font-semibold text-accent-blue"
    >
      <UserSearch size={12} aria-hidden="true" /> {speaker}
    </button>
  );
}

export function BiasDeckSheet({ outletKey }: { outletKey: string }) {
  const { exploration, panel, reveal, pin, eventId } = useExplore();
  const { input, index, clues } = exploration;
  const outlet = index.outlet(outletKey);
  const [includeQuotes, setIncludeQuotes] = useState(false);
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [direction, setDirection] = useState(1);

  const cards = useMemo(() => biasCards(input, { outletKey, includeQuotes }), [input, outletKey, includeQuotes]);
  const summary = biasByOutlet(input).get(outletKey);
  const card = cards[Math.min(position, Math.max(cards.length - 1, 0))];

  useEffect(() => {
    const clue = clues.find((candidate) => candidate.type === "bias" && candidate.outletKeys.includes(outletKey));
    if (clue) reveal([clue.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletKey]);

  useEffect(() => {
    setPosition(0);
    setFlipped(false);
  }, [includeQuotes]);

  const go = (delta: number) => {
    if (cards.length === 0) return;
    setDirection(delta);
    setFlipped(false);
    setPosition((current) => (current + delta + cards.length) % cards.length);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) go(1);
    else if (info.offset.x > SWIPE_THRESHOLD) go(-1);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title={`Gekleurde zinnen${outlet ? ` bij ${outlet.name}` : ""}`}
      subtitle={summary ? `Objectiviteit eigen tekst ${objectivity(summary.averageRating)}%` : "Bias per zin"}
      icon={<ScanText size={22} />}
      handleOnly
    >
      <div
        className="space-y-4"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") go(1);
          if (event.key === "ArrowLeft") go(-1);
          if (event.key === " ") {
            event.preventDefault();
            setFlipped((value) => !value);
          }
        }}
        aria-label="Swipe door de zinnen; pijltjestoetsen om te bladeren, spatie om om te draaien"
      >
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="h-5 w-5 accent-accent-blue" checked={includeQuotes} onChange={(e) => setIncludeQuotes(e.target.checked)} />
          Ook bias in citaten tonen (telt niet mee)
        </label>

        {cards.length === 0 || !card ? (
          <p className="rounded-2xl border border-paper-300 bg-paper-100 p-6 text-center text-sm text-ink-500">
            Nog geen bias-analyse voor deze bron.
          </p>
        ) : (
          <>
            <div className="relative h-[300px]" style={{ perspective: 1200 }}>
              <AnimatePresence initial={false} custom={direction} mode="popLayout">
                <motion.div
                  key={`${card.articleId}-${card.sentence_index}-${card.bias_source}`}
                  custom={direction}
                  initial={{ x: direction * 280, opacity: 0, rotate: direction * 4 }}
                  animate={{ x: 0, opacity: 1, rotate: 0 }}
                  exit={{ x: -direction * 280, opacity: 0, rotate: -direction * 4 }}
                  transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.7}
                  onDragEnd={onDragEnd}
                  onClick={() => setFlipped((value) => !value)}
                  className="absolute inset-0 cursor-grab touch-pan-y select-none active:cursor-grabbing"
                  role="button"
                  aria-label={flipped ? "Toon de zin" : "Toon uitleg"}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {!flipped ? (
                      <motion.div
                        key="front"
                        initial={{ rotateY: -90, opacity: 0 }}
                        animate={{ rotateY: 0, opacity: 1 }}
                        exit={{ rotateY: 90, opacity: 0 }}
                        transition={{ duration: 0.16 }}
                        className="absolute inset-0 flex flex-col justify-between rounded-3xl border border-paper-300 bg-paper-50 p-5 shadow-card"
                      >
                        <div className="flex items-center gap-2 text-xs text-ink-500">
                          <Favicon name={outlet?.name ?? outletKey} domain={outlet?.domain} size={16} />
                          {outlet?.name} · zin {card.sentence_index + 1}
                        </div>
                        <p className="font-serif text-xl leading-snug text-ink-900">“{truncate(card.sentence_text, 200)}”</p>
                        <p className="text-xs text-ink-400">Tik voor uitleg · veeg voor de volgende</p>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="back"
                        initial={{ rotateY: -90, opacity: 0 }}
                        animate={{ rotateY: 0, opacity: 1 }}
                        exit={{ rotateY: 90, opacity: 0 }}
                        transition={{ duration: 0.16 }}
                        className="absolute inset-0 flex flex-col gap-3 overflow-y-auto rounded-3xl border border-purple-200 bg-purple-50 p-5 shadow-card"
                      >
                        <p className="font-serif text-lg font-bold text-ink-900">{biasTypeLabel(card.bias_type)}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Tag tone={card.bias_source === "quote" ? "neutral" : "purple"}>{BIAS_SOURCE_LABELS[card.bias_source] ?? card.bias_source}</Tag>
                          {card.speaker ? <Speaker speaker={card.speaker} /> : null}
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-ink-500">Sterkte</p>
                          <span className="block h-2 rounded-full bg-white">
                            <span className="block h-2 rounded-full bg-purple-500" style={{ width: `${Math.round(card.score * 100)}%` }} />
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-ink-800">
                          <EntityText text={card.explanation} />
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => go(-1)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-paper-300"
                aria-label="Vorige zin"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm text-ink-500">
                {position + 1} / {cards.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  pin({
                    id: `bias:${eventId}:${card.articleId}:${card.sentence_index}:${card.bias_source}`,
                    kind: "bias",
                    title: truncate(card.sentence_text, 90),
                    subtitle: `${biasTypeLabel(card.bias_type)} · ${outlet?.name ?? ""}`,
                    outletKey,
                    text: card.explanation,
                    keys: [`outlet:${outletKey}`, `bias:${card.bias_type}`],
                  })
                }
                className="flex min-h-[44px] items-center gap-2 rounded-full border border-paper-300 px-4 text-sm font-semibold"
              >
                <Pin size={16} /> Bewaar
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-paper-300"
                aria-label="Volgende zin"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
