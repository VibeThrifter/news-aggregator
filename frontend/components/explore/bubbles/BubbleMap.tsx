"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { List, Zap } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  bubbleBoxes,
  bubbleGroupKey,
  buildBubbleScene,
  isOutletShown,
  layoutBubbles,
  selectBubbles,
  type Bubble,
  type BubbleGroup,
  type HeroLens,
} from "@/lib/explore/layout/bubbles";
import { truncate } from "@/lib/explore/summary";
import { useExploreStore } from "@/lib/explore/store";
import type { ExploreOutlet } from "@/lib/explore/types";
import { getCountryFlag } from "@/lib/format";

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
  const sources = useExploreStore((state) => state.events[String(eventId)]?.sources);
  const setOutletShown = useExploreStore((state) => state.setOutletShown);

  const fullScene = useMemo(() => buildBubbleScene(input, clues, index), [input, clues, index]);
  // Only the outlets the reader chose: Dutch ones by default, foreign ones when added
  const scene = useMemo(
    () => selectBubbles(fullScene, (bubble) => isOutletShown({ key: bubble.outletKey, isInternational: bubble.isInternational }, sources)),
    [fullScene, sources],
  );
  const groups: BubbleGroup[] = lens === "tegenspraak" ? scene.groupsByLens.invalshoek : scene.groupsByLens[lens];
  const colorByGroup = useMemo(() => {
    const map = new Map<string, string>();
    scene.groupsByLens.invalshoek.forEach((group, i) => map.set(group.key, GROUP_COLORS[i % GROUP_COLORS.length]));
    scene.groupsByLens.frame.forEach((group, i) => map.set(group.key, GROUP_COLORS[(i + 2) % GROUP_COLORS.length]));
    return map;
  }, [scene]);

  const layoutLens: HeroLens = lens === "tegenspraak" ? "invalshoek" : lens;
  // The spectrum map only places outlets with a known position (never "in the middle" by default)
  const unplaced = layoutLens === "spectrum" ? scene.bubbles.filter((bubble) => bubble.x === null && bubble.establishment === null) : [];
  const layout = useMemo(() => {
    const placeable = layoutLens === "spectrum" ? { ...scene, bubbles: scene.bubbles.filter((bubble) => bubble.x !== null || bubble.establishment !== null) } : scene;
    if (width === 0 || placeable.bubbles.length === 0) return null;
    return layoutBubbles(
      bubbleBoxes(placeable, layoutLens),
      groups.map((group) => group.key),
      {
        width,
        seed: Math.abs(eventId) + 17,
        minHeight: layoutLens === "spectrum" ? 400 : undefined,
        // Room for the whole label, so it is readable in full
        labelWidths: layoutLens === "spectrum" ? undefined : Object.fromEntries(groups.map((group) => [group.key, labelWidth(group.label)])),
      },
    );
  }, [width, scene, layoutLens, groups, eventId]);

  /** One tap opens the balloon with details; what the bubble shows counts as found. */
  const onBubbleTap = (bubble: Bubble) => {
    if (!seenHints.includes("bubbles")) markHintSeen("bubbles");
    const found = [bubble.perspectiveClueId, lens === "frame" ? bubble.frameClueId : null].filter(
      (id): id is string => Boolean(id) && !isRevealed(id as string),
    );
    if (found.length) reveal(found);
    return true;
  };

  if (fullScene.bubbles.length === 0) {
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
          <p className="text-sm text-ink-500">Elke ballon is een bron met haar invalshoek. Tik voor meer.</p>
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

      <SourcePicker
        outlets={input.outlets}
        isShown={(outlet) => isOutletShown(outlet, sources)}
        onToggle={(outlet) => setOutletShown(eventId, outlet, !isOutletShown(outlet, sources))}
      />

      {scene.bubbles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-paper-300 p-4 text-sm text-ink-500">Kies hierboven een of meer bronnen.</p>
      ) : null}

      {lens === "tegenspraak" && scene.contradictions.length === 0 && scene.bubbles.length > 0 ? (
        <p className="text-sm font-semibold text-ink-500">Geen tegenspraak gevonden — ook een bevinding.</p>
      ) : null}

      {scene.bubbles.length === 0 ? null : listMode ? (
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
              Tik op een ballon voor meer
            </div>
          ) : null}

          {layout && layoutLens === "spectrum" ? <SpectrumAxes /> : null}

          {layout && layoutLens !== "spectrum"
            ? layout.groups.map((placed) => {
                const group = groups.find((candidate) => candidate.key === placed.key);
                if (!group) return null;
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
                      {group.label}
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
                // Not (yet) put in a perspective by the analysis: name and "nog niet ingedeeld"
                const plain = !bubble.perspectiveClueId;
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
                      hover
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
                            aria-label={
                              plain
                                ? `${outlet.name}, ${bubble.estimated ? "geschatte invalshoek" : "nog niet ingedeeld"}`
                                : `${outlet.name}: ${bubble.stance ?? "standpunt"}`
                            }
                            className="group relative block h-full w-full text-left"
                          >
                            <span
                              className={`animate-float relative flex h-full w-full items-center gap-2 rounded-[22px] border-2 bg-white px-2.5 shadow-bubble transition-colors ${
                                bubble.estimated ? "border-dashed" : ""
                              }`}
                              style={{ borderColor: color, animationDelay: `${(i % 7) * -0.6}s` }}
                            >
                              <Favicon name={outlet.name} domain={outlet.domain} size={20} />
                              {plain ? (
                                <span className="min-w-0 leading-tight">
                                  <span className="block truncate text-[12px] font-semibold text-ink-800">{outlet.name}</span>
                                  <span className="block truncate text-[11px] text-ink-500">{bubble.estimated ? "geschatte invalshoek" : "nog niet ingedeeld"}</span>
                                </span>
                              ) : (
                                <span className="line-clamp-3 text-[12px] font-medium leading-tight text-ink-800">
                                  {truncate(bubble.stance ?? outlet.name, 90)}
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
          {unplaced.length ? ` Zonder bekende positie: ${unplaced.map((bubble) => index.outlet(bubble.outletKey)?.name ?? bubble.outletKey).join(", ")}.` : ""}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Which outlets are in the map: the Dutch ones by default; foreign ones can be added (instead of a
 * separate page), Dutch ones left out. Remembered per news item.
 */
function SourcePicker({
  outlets,
  isShown,
  onToggle,
}: {
  outlets: ExploreOutlet[];
  isShown: (outlet: ExploreOutlet) => boolean;
  onToggle: (outlet: ExploreOutlet) => void;
}) {
  const dutch = outlets.filter((outlet) => !outlet.isInternational);
  const foreign = outlets.filter((outlet) => outlet.isInternational);
  const chip = (outlet: ExploreOutlet) => {
    const on = isShown(outlet);
    return (
      <button
        key={outlet.key}
        type="button"
        aria-pressed={on}
        onClick={() => onToggle(outlet)}
        className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors ${
          on ? "border-paper-300 bg-paper-50 text-ink-800 hover:bg-paper-100" : "border-dashed border-paper-300 text-ink-400 hover:text-ink-600"
        }`}
      >
        <span className={on ? "" : "opacity-40 grayscale"}>
          <Favicon name={outlet.name} domain={outlet.domain} size={16} />
        </span>
        {outlet.name}
        {outlet.isInternational && outlet.country ? <span aria-hidden="true">{getCountryFlag(outlet.country)}</span> : null}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Bronnen in de kaart" className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Bronnen</span>
      {dutch.map(chip)}
      {foreign.length ? (
        <span className="shrink-0 border-l border-paper-300 pl-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Buitenland</span>
      ) : null}
      {foreign.map(chip)}
    </div>
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
  // "Geen tegenspraak gevonden" is shown above the map, where it cannot cover a bubble
  if (scene.contradictions.length === 0) return null;
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
