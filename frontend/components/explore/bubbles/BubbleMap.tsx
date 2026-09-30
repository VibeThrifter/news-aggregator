"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Globe2, List, Zap } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  bubbleBoxes,
  bubbleGroupKey,
  buildBubbleScene,
  layoutBubbles,
  type Bubble,
  type BubbleGroup,
  type HeroLens,
} from "@/lib/explore/layout/bubbles";
import { truncate } from "@/lib/explore/summary";
import { useExploreStore } from "@/lib/explore/store";

import { useExplore } from "../ExploreContext";
import { OutletCard } from "../outlet/OutletCard";
import { Balloon } from "../ui/Balloon";
import { Favicon } from "../ui/primitives";
import { BubbleList } from "./BubbleList";
import { DraggableOutlet } from "../dnd/DraggableOutlet";

const LENSES: { id: HeroLens; label: string }[] = [
  { id: "invalshoek", label: "Invalshoek" },
  { id: "spectrum", label: "Spectrum" },
  { id: "frame", label: "Frame" },
  { id: "tegenspraak", label: "Tegenspraak" },
];

export const GROUP_COLORS = ["#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#10b981", "#ec4899", "#64748b"];

/** Width of a group label on one line (11px semibold, px-2), for the layout; the pill wraps to two lines when needed */
function labelWidth(text: string): number {
  return Math.ceil(18 + 6.4 * text.length);
}

function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.round(element.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function BubbleMap() {
  const { exploration, isRevealed, reveal, panel, eventId } = useExplore();
  const { input, clues, index } = exploration;
  const { lens, listMode, seenHints, setPref, markHintSeen } = useExploreStore(
    useShallow((state) => ({
      lens: state.prefs.heroLens,
      listMode: state.prefs.listMode,
      seenHints: state.prefs.seenHints,
      setPref: state.setPref,
      markHintSeen: state.markHintSeen,
    })),
  );
  const { ref, width } = useContainerWidth();
  const [openBalloon, setOpenBalloon] = useState<string | null>(null);

  const scene = useMemo(() => buildBubbleScene(input, clues, index), [input, clues, index]);
  const groups: BubbleGroup[] = lens === "tegenspraak" ? scene.groupsByLens.invalshoek : scene.groupsByLens[lens];
  const colorByGroup = useMemo(() => {
    const map = new Map<string, string>();
    scene.groupsByLens.invalshoek.forEach((group, i) => map.set(group.key, GROUP_COLORS[i % GROUP_COLORS.length]));
    scene.groupsByLens.frame.forEach((group, i) => map.set(group.key, GROUP_COLORS[(i + 2) % GROUP_COLORS.length]));
    return map;
  }, [scene]);

  const openIds = useMemo(
    () => new Set(scene.bubbles.filter((bubble) => bubble.perspectiveClueId && isRevealed(bubble.perspectiveClueId)).map((b) => b.id)),
    [scene.bubbles, isRevealed],
  );
  const layoutLens: HeroLens = lens === "tegenspraak" ? "invalshoek" : lens;
  const layout = useMemo(() => {
    if (width === 0 || scene.bubbles.length === 0) return null;
    return layoutBubbles(
      bubbleBoxes(scene, layoutLens, openIds),
      groups.map((group) => group.key),
      {
        width,
        seed: Math.abs(eventId) + 17,
        minHeight: layoutLens === "spectrum" ? 400 : undefined,
        // Room for the label that is shown (hidden or discovered), so it is readable in full
        labelWidths:
          layoutLens === "spectrum"
            ? undefined
            : Object.fromEntries(
                groups.map((group) => [group.key, labelWidth(!group.clueId || isRevealed(group.clueId) ? group.label : group.maskedLabel)]),
              ),
      },
    );
  }, [width, scene, layoutLens, openIds, groups, eventId, isRevealed]);

  const onBubbleTap = (bubble: Bubble) => {
    if (!seenHints.includes("bubbles")) markHintSeen("bubbles");
    if (bubble.perspectiveClueId && !isRevealed(bubble.perspectiveClueId)) {
      reveal([bubble.perspectiveClueId]);
      return false;
    }
    if (lens === "frame" && bubble.frameClueId && !isRevealed(bubble.frameClueId)) {
      reveal([bubble.frameClueId]);
    }
    return true;
  };

  if (scene.bubbles.length === 0) {
    return null;
  }
  // Until the first tap a hint sits at the bottom of the map: give it its own room
  const hint = !seenHints.includes("bubbles");
  const hintRoom = hint && layoutLens !== "spectrum" ? 44 : 0;

  return (
    <section aria-labelledby="bubbles-title" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="bubbles-title" className="font-serif text-xl font-bold text-ink-900">
            Wie zegt wat?
          </h2>
          <p className="text-sm text-ink-500">Elke ballon is een bron. Tik om te horen wat ze zegt.</p>
        </div>
        <button
          type="button"
          onClick={() => setPref("listMode", !listMode)}
          aria-pressed={listMode}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${listMode ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 text-ink-600"}`}
          aria-label="Toon als lijst"
        >
          <List size={18} />
        </button>
      </div>

      <div role="radiogroup" aria-label="Lens" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {LENSES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={lens === item.id}
            onClick={() => setPref("heroLens", item.id)}
            className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-semibold transition-colors ${
              lens === item.id ? "bg-ink-900 text-white" : "border border-paper-300 bg-paper-50 text-ink-600 hover:bg-paper-100"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {listMode ? (
        <BubbleList scene={scene} lens={layoutLens} onTap={onBubbleTap} />
      ) : (
        <div
          ref={ref}
          className="relative w-full overflow-hidden rounded-3xl border border-paper-300 bg-gradient-to-b from-paper-50 to-paper-100 touch-pan-y"
          style={{ height: (layout?.height ?? 300) + hintRoom }}
        >
          {hint ? (
            <div
              className={`pointer-events-none absolute z-10 rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold text-white shadow-bubble ${
                layoutLens === "spectrum" ? "bottom-3 right-3" : "bottom-3 left-1/2 -translate-x-1/2"
              }`}
            >
              Tik op een ballon
            </div>
          ) : null}

          {layout && layoutLens === "spectrum" ? <SpectrumAxes /> : null}

          {layout && layoutLens !== "spectrum"
            ? layout.groups.map((placed) => {
                const group = groups.find((candidate) => candidate.key === placed.key);
                if (!group) return null;
                const discovered = group.clueId ? isRevealed(group.clueId) : true;
                const color = colorByGroup.get(group.key) ?? "#94a3b8";
                return (
                  <motion.div
                    key={placed.key}
                    initial={false}
                    animate={{ left: placed.x, top: placed.y, width: placed.width, height: placed.height }}
                    transition={{ type: "spring", stiffness: 180, damping: 26 }}
                    className="pointer-events-none absolute rounded-[28px] border-2 border-dashed"
                    style={{ borderColor: `${color}66`, backgroundColor: `${color}0f` }}
                  >
                    <span
                      className="absolute -top-3 left-3 line-clamp-2 max-w-[calc(100%-24px)] rounded-[10px] px-2 py-0.5 text-[11px] font-semibold leading-tight text-white shadow"
                      style={{ backgroundColor: color }}
                    >
                      {discovered ? group.label : group.maskedLabel}
                    </span>
                  </motion.div>
                );
              })
            : null}

          {layout && lens === "tegenspraak" ? (
            <ContradictionLayer layout={layout} scene={scene} onOpen={(clueId) => panel.open("spoor:wat-klopt-niet", { c: clueId })} />
          ) : null}

          {layout
            ? scene.bubbles.map((bubble, i) => {
                const placed = layout.bubbles.get(bubble.id);
                const outlet = index.outlet(bubble.outletKey);
                if (!placed || !outlet) return null;
                const open = openIds.has(bubble.id);
                const color = colorByGroup.get(bubbleGroupKey(bubble, layoutLens === "spectrum" ? "invalshoek" : layoutLens)) ?? "#94a3b8";
                return (
                  <motion.div
                    key={bubble.id}
                    initial={false}
                    animate={{ x: placed.x - placed.width / 2, y: placed.y - placed.height / 2 }}
                    transition={{ type: "spring", stiffness: 170, damping: 24, delay: i * 0.008 }}
                    className="absolute left-0 top-0"
                    style={{ width: placed.width, height: placed.height }}
                  >
                    <Balloon
                      label={`Over ${outlet.name}`}
                      hover={open}
                      open={openBalloon === bubble.id}
                      onOpenChange={(next) => {
                        if (next) {
                          if (onBubbleTap(bubble)) setOpenBalloon(bubble.id);
                        } else if (openBalloon === bubble.id) {
                          setOpenBalloon(null);
                        }
                      }}
                      content={(close) => <OutletCard outletKey={bubble.outletKey} onNavigate={close} />}
                    >
                      {({ ref: triggerRef, props }) => (
                        <DraggableOutlet id={`bubble:${bubble.id}`} outletKey={bubble.outletKey} className="h-full w-full">
                          <button
                            ref={triggerRef}
                            {...props}
                            type="button"
                            aria-label={open ? `${outlet.name}: ${bubble.stance ?? "standpunt"}` : `${outlet.name}, tik om te onthullen`}
                            className="group relative block h-full w-full text-left"
                          >
                            <span
                              className="animate-float relative flex h-full w-full items-center gap-2 rounded-[22px] border-2 bg-white px-2.5 shadow-bubble transition-colors"
                              style={{ borderColor: color, animationDelay: `${(i % 7) * -0.6}s` }}
                            >
                              <Favicon name={outlet.name} domain={outlet.domain} size={20} />
                              {open ? (
                                <span className="line-clamp-2 text-[12px] font-medium leading-tight text-ink-800">
                                  {truncate(bubble.stance ?? outlet.name, 70)}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1" aria-hidden="true">
                                  {[0, 1, 2].map((dot) => (
                                    <span
                                      key={dot}
                                      className="animate-typing h-1.5 w-1.5 rounded-full bg-ink-400"
                                      style={{ animationDelay: `${dot * 0.18}s` }}
                                    />
                                  ))}
                                </span>
                              )}
                              {bubble.articleCount > 1 ? (
                                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-ink-900 px-1 text-[10px] font-bold text-white">
                                  {bubble.articleCount}
                                </span>
                              ) : null}
                              {/* speech-bubble tail */}
                              <span
                                aria-hidden="true"
                                className="absolute -bottom-[7px] left-5 h-3 w-3 rotate-45 border-b-2 border-r-2 bg-white"
                                style={{ borderColor: color }}
                              />
                            </span>
                          </button>
                        </DraggableOutlet>
                      )}
                    </Balloon>
                  </motion.div>
                );
              })
            : null}
        </div>
      )}

      {layoutLens === "spectrum" && !listMode ? (
        <p className="text-xs text-ink-500">
          Posities zijn een redactionele inschatting: links–rechts en hoe gevestigd of alternatief een bron is.
        </p>
      ) : null}

      {scene.internationalCount > 0 ? (
        <button
          type="button"
          onClick={() => panel.open("spoor:buitenland")}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-paper-300 bg-paper-50 px-4 text-sm font-semibold text-ink-700 hover:bg-paper-100"
        >
          <Globe2 size={16} className="text-accent-blue" /> +{scene.internationalCount} buitenlandse{" "}
          {scene.internationalCount === 1 ? "bron" : "bronnen"}
        </button>
      ) : null}
    </section>
  );
}

function ContradictionLayer({
  layout,
  scene,
  onOpen,
}: {
  layout: NonNullable<ReturnType<typeof layoutBubbles>>;
  scene: ReturnType<typeof buildBubbleScene>;
  onOpen: (clueId: string) => void;
}) {
  const { isRevealed, reveal } = useExplore();
  if (scene.contradictions.length === 0) {
    return (
      <p className="absolute inset-x-0 bottom-3 text-center text-xs font-semibold text-ink-500">
        Geen tegenspraak gevonden — ook een bevinding.
      </p>
    );
  }
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {scene.contradictions.map((line) => {
          const from = layout.bubbles.get(line.from);
          const to = layout.bubbles.get(line.to);
          if (!from || !to) return null;
          const known = isRevealed(line.clueId);
          return (
            <line
              key={line.clueId}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={known ? "#E30613" : "#94a3b8"}
              strokeWidth={known ? 3 : 2}
              strokeDasharray="6 5"
            />
          );
        })}
      </svg>
      {placeButtons(scene.contradictions, layout).map(({ line, x, y }) => {
        const known = isRevealed(line.clueId);
        return (
          <button
            key={line.clueId}
            type="button"
            onClick={() => {
              reveal([line.clueId]);
              onOpen(line.clueId);
            }}
            className={`absolute z-[1] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 shadow-bubble ${
              known ? "border-accent-red bg-white text-accent-red" : "border-paper-300 bg-white text-ink-400"
            }`}
            style={{ left: x, top: y }}
            aria-label={known ? `Tegenspraak: ${line.topic}` : "Tegenspraak — tik om te onthullen"}
          >
            <Zap size={18} />
          </button>
        );
      })}
    </>
  );
}

/** Place a ⚡ button on each contradiction line; slide it along its line when it would overlap another. */
function placeButtons(
  lines: ReturnType<typeof buildBubbleScene>["contradictions"],
  layout: NonNullable<ReturnType<typeof layoutBubbles>>,
) {
  const placed: { line: (typeof lines)[number]; x: number; y: number }[] = [];
  for (const line of lines) {
    const from = layout.bubbles.get(line.from);
    const to = layout.bubbles.get(line.to);
    if (!from || !to) continue;
    let chosen = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    for (const t of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      const candidate = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      if (placed.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= 48)) {
        chosen = candidate;
        break;
      }
    }
    placed.push({ line, ...chosen });
  }
  return placed;
}

/** Axes of the 2D spectrum map: links <-> rechts and gevestigd <-> alternatief. */
function SpectrumAxes() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {/* quadrant cross */}
      <span className="absolute inset-y-8 left-1/2 border-l border-dashed border-paper-300" />
      <span className="absolute inset-x-8 top-1/2 border-t border-dashed border-paper-300" />
      {/* vertical axis: gevestigd (top) -> alternatief (bottom) */}
      <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-paper-50 px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
        ▲ Gevestigd
      </span>
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-paper-50 px-2 text-[10px] font-semibold uppercase tracking-wider text-purple-600">
        ▼ Alternatief
      </span>
      {/* horizontal axis: links -> rechts */}
      <span className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-paper-50 px-1 text-[10px] font-semibold uppercase tracking-wider text-blue-600">
        ◀ Links
      </span>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-paper-50 px-1 text-[10px] font-semibold uppercase tracking-wider text-red-600">
        Rechts ▶
      </span>
    </div>
  );
}
