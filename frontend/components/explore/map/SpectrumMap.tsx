"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";

import { bubbleBoxes, buildBubbleScene, layoutBubbles, selectBubbles } from "@/lib/explore/layout/bubbles";
import { truncate } from "@/lib/explore/summary";
import type { ExploreOutlet } from "@/lib/explore/types";

import { useExplore } from "../ExploreContext";
import { OutletCard } from "../outlet/OutletCard";
import { Balloon } from "../ui/Balloon";
import { Favicon } from "../ui/primitives";

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

/** The outlets on two axes: left–right and established–alternative (editorial estimates). */
export function SpectrumMap({ shown }: { shown: (outlet: ExploreOutlet) => boolean }) {
  const { exploration, eventId } = useExplore();
  const { input, findings, index } = exploration;
  const { ref, width } = useContainerWidth();
  const [about, setAbout] = useState(false);

  const scene = useMemo(() => {
    const full = buildBubbleScene(input, findings, index);
    return selectBubbles(full, (bubble) => {
      const outlet = index.outlet(bubble.outletKey);
      return Boolean(outlet && shown(outlet) && (bubble.x !== null || bubble.establishment !== null));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, findings, index, shown]);
  // One balloon per outlet on the map
  const bubbles = useMemo(() => scene.bubbles.filter((bubble, i, all) => all.findIndex((other) => other.outletKey === bubble.outletKey) === i), [scene]);
  const layout = useMemo(() => {
    if (width === 0 || bubbles.length === 0) return null;
    return layoutBubbles(bubbleBoxes({ ...scene, bubbles }, "spectrum"), ["s:main"], { width, seed: Math.abs(eventId) + 17, minHeight: 400 });
  }, [width, scene, bubbles, eventId]);
  const unplaced = input.outlets.filter((outlet) => shown(outlet) && outlet.x === null && outlet.establishment === null);

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        className="relative w-full overflow-hidden rounded-3xl border border-paper-300 bg-gradient-to-b from-paper-50 to-paper-100 touch-pan-y"
        style={{ height: layout?.height ?? 400 }}
      >
        <SpectrumAxes />
        {layout
          ? bubbles.map((bubble, i) => {
              const placed = layout.bubbles.get(bubble.id);
              const outlet = index.outlet(bubble.outletKey);
              if (!placed || !outlet) return null;
              return (
                <motion.div
                  key={bubble.id}
                  initial={false}
                  animate={{ x: placed.x - placed.width / 2, y: placed.y - placed.height / 2 }}
                  transition={{ type: "spring", stiffness: 170, damping: 24, delay: i * 0.008 }}
                  className="absolute left-0 top-0"
                  style={{ width: placed.width, height: placed.height }}
                >
                  <Balloon label={`Over ${outlet.name}`} content={(close) => <OutletCard outletKey={outlet.key} onNavigate={close} />}>
                    {({ ref: triggerRef, props }) => (
                      <button ref={triggerRef} {...props} type="button" className="block h-full w-full text-left">
                        <span className="flex h-full w-full items-center gap-2 rounded-[22px] border-2 border-ink-300 bg-white px-2.5 shadow-bubble">
                          <Favicon name={outlet.name} domain={outlet.domain} size={20} />
                          <span className="line-clamp-3 text-[12px] font-medium leading-tight text-ink-800">
                            {bubble.perspectiveFindingId && bubble.stance ? truncate(bubble.stance, 80) : outlet.name}
                          </span>
                        </span>
                      </button>
                    )}
                  </Balloon>
                </motion.div>
              );
            })
          : null}
      </div>
      <div className="flex items-start gap-2 text-xs text-ink-500">
        <button
          type="button"
          onClick={() => setAbout((value) => !value)}
          aria-expanded={about}
          className="-m-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-paper-200"
          aria-label="Over deze posities"
        >
          <Info size={14} />
        </button>
        <p>
          {about ? "Posities zijn een redactionele inschatting. " : null}
          {unplaced.length ? `Zonder positie: ${unplaced.map((outlet) => outlet.name).join(", ")}.` : null}
        </p>
      </div>
    </div>
  );
}

/** Axes of the 2D spectrum map: links <-> rechts and gevestigd <-> alternatief. */
function SpectrumAxes() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <span className="absolute inset-y-8 left-1/2 border-l border-dashed border-paper-300" />
      <span className="absolute inset-x-8 top-1/2 border-t border-dashed border-paper-300" />
      <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-paper-50 px-2 text-[11px] font-semibold text-ink-600">
        ▲ Gevestigd
      </span>
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-paper-50 px-2 text-[11px] font-semibold text-purple-600">
        ▼ Alternatief
      </span>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-paper-50 px-1 text-[11px] font-semibold text-blue-600">
        ◀ Links
      </span>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-paper-50 px-1 text-[11px] font-semibold text-red-600">
        Rechts ▶
      </span>
    </div>
  );
}
