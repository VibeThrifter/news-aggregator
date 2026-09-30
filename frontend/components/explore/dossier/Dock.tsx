"use client";

import { FolderOpen, Scale, X } from "lucide-react";

import { useExploreStore } from "@/lib/explore/store";

import { useExplore } from "../ExploreContext";
import { DROP_COMPARE, DROP_DOSSIER, useDndState, useDropZone } from "../dnd/ExploreDnd";
import { Favicon } from "../ui/primitives";

/**
 * Floating dock at the bottom: the dossier (drop target, Story 11.7) and the compare tray.
 */
export function Dock() {
  const { exploration, dossierCount, panel, eventId } = useExplore();
  const compare = useExploreStore((state) => state.compare);
  const clearCompare = useExploreStore((state) => state.clearCompare);
  const compareActive = compare.eventId === eventId && (compare.a || compare.b);
  const slotOutlet = (key: string | null) => (key ? exploration.index.outlet(key) : null);
  const { active } = useDndState();
  const dossierZone = useDropZone(DROP_DOSSIER);
  const compareZone = useDropZone(DROP_COMPARE);
  const showCompare = compareActive || Boolean(active?.outletKey);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-dock flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+14px)]">
      {/* The dossier stays centred; the compare tray sits next to it without shifting the drop target */}
      <div className="pointer-events-auto relative flex items-center rounded-full border border-paper-300 bg-paper-50/95 p-1.5 shadow-balloon backdrop-blur">
        <button
          ref={dossierZone.setNodeRef}
          type="button"
          data-dropzone="dossier"
          onClick={() => panel.open("dossier")}
          className={`flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-semibold text-white transition-all ${
            dossierZone.isOver ? "scale-110 bg-accent-orange" : active ? "bg-accent-orange/90 ring-4 ring-orange-200" : "bg-ink-900"
          }`}
        >
          <FolderOpen size={16} aria-hidden="true" />
          Dossier
          <span className="rounded-full bg-white/20 px-1.5 text-xs" aria-label={`${dossierCount} kaarten`}>
            {dossierCount}
          </span>
        </button>
        {showCompare ? (
          <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-paper-300 bg-paper-50/95 p-1.5 shadow-balloon backdrop-blur">
            <button
              ref={compareZone.setNodeRef}
              type="button"
              data-dropzone="compare"
              onClick={() => panel.open("vergelijk")}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-sm font-semibold text-accent-blue transition-all ${
                compareZone.isOver ? "scale-110 border-accent-blue bg-blue-100" : "border-accent-blue/40 bg-blue-50"
              }`}
            >
              <Scale size={16} aria-hidden="true" />
              {[compare.a, compare.b].map((key, i) => {
                const outlet = slotOutlet(key);
                return outlet ? (
                  <Favicon key={outlet.key} name={outlet.name} domain={outlet.domain} size={18} />
                ) : (
                  <span key={i} className="h-[18px] w-[18px] rounded-sm border border-dashed border-accent-blue/50" />
                );
              })}
              <span>{compare.a && compare.b ? "Vergelijk" : "Kies 2e bron"}</span>
            </button>
            <button
              type="button"
              onClick={clearCompare}
              className="flex h-11 w-11 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200"
              aria-label="Vergelijking wissen"
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
