"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  Coins,
  EyeOff,
  Globe2,
  History,
  Megaphone,
  MessagesSquare,
  SearchCheck,
  type LucideIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import type { Exploration } from "@/lib/explore/exploration";
import { useUrlPanel } from "@/lib/explore/hooks";
import { SPOOR_BY_ID } from "@/lib/explore/labels";
import { useExploreStore, type DossierItem } from "@/lib/explore/store";
import type { SpoorId } from "@/lib/explore/types";

import { useToast } from "./ui/Toast";

export const SPOOR_ICONS: Record<SpoorId, LucideIcon> = {
  "wie-zegt-wat": MessagesSquare,
  "wat-klopt-niet": SearchCheck,
  "wie-heeft-belang": Coins,
  "hoe-gebracht": Megaphone,
  "wat-zie-je-niet": EyeOff,
  "hoe-liep-het": History,
  buitenland: Globe2,
};

/** Accent colour per spoor (Tailwind-independent so SVG can use it too). */
export const SPOOR_COLORS: Record<SpoorId, string> = {
  "wie-zegt-wat": "#1F75CE",
  "wat-klopt-niet": "#E30613",
  "wie-heeft-belang": "#b7791f",
  "hoe-gebracht": "#7c3aed",
  "wat-zie-je-niet": "#0f766e",
  "hoe-liep-het": "#475569",
  buitenland: "#0369a1",
};

export type PinInput = Omit<DossierItem, "addedAt" | "eventId" | "eventSlug" | "eventTitle"> & { eventId?: number | null };

interface ExploreContextValue {
  exploration: Exploration;
  eventId: number;
  revealed: ReadonlySet<string>;
  /** Speurmodus off: everything visible */
  revealAll: boolean;
  isRevealed: (clueId: string | null | undefined) => boolean;
  reveal: (clueIds: string[]) => void;
  panel: ReturnType<typeof useUrlPanel>;
  pin: (item: PinInput) => void;
  isPinned: (id: string) => boolean;
  dossierCount: number;
}

const ExploreContext = createContext<ExploreContextValue | null>(null);

export function useExplore(): ExploreContextValue {
  const value = useContext(ExploreContext);
  if (!value) {
    throw new Error("useExplore must be used inside <ExploreProvider>");
  }
  return value;
}

export function ExploreProvider({ exploration, children }: { exploration: Exploration; children: ReactNode }) {
  const { input } = exploration;
  const eventId = input.event.id;
  const eventKey = String(eventId);
  const toast = useToast();
  const panel = useUrlPanel();

  const { revealedList, questMode, dossierItems, touchEvent, revealStore, addItem, removeItem, markSpoorCompleted } =
    useExploreStore(
      useShallow((state) => ({
        revealedList: state.events[eventKey]?.revealed,
        questMode: state.prefs.questMode,
        dossierItems: state.dossier.items,
        touchEvent: state.touchEvent,
        revealStore: state.reveal,
        addItem: state.addItem,
        removeItem: state.removeItem,
        markSpoorCompleted: state.markSpoorCompleted,
      })),
    );

  useEffect(() => {
    touchEvent(eventId, { slug: input.event.slug, title: input.event.title });
  }, [eventId, input.event.slug, input.event.title, touchEvent]);

  const revealed = useMemo(() => new Set(revealedList ?? []), [revealedList]);
  const revealAll = !questMode;

  const isRevealed = useCallback(
    (clueId: string | null | undefined) => revealAll || (clueId ? revealed.has(clueId) : false),
    [revealAll, revealed],
  );

  const reveal = useCallback(
    (clueIds: string[]) => {
      const fresh = clueIds.filter((id) => !revealed.has(id));
      if (fresh.length === 0) return;
      revealStore(eventId, fresh);
      // Toast when a spoor gets completed
      const after = new Set([...Array.from(revealed), ...fresh]);
      const spoorsTouched = new Set(fresh.map((id) => exploration.clueById.get(id)?.spoor).filter(Boolean) as SpoorId[]);
      for (const spoor of Array.from(spoorsTouched)) {
        const all = exploration.bySpoor.get(spoor) ?? [];
        if (all.length > 0 && all.every((clue) => after.has(clue.id))) {
          markSpoorCompleted(eventId, spoor);
          toast(`Spoor "${SPOOR_BY_ID[spoor].question}" onderzocht`);
        }
      }
    },
    [eventId, exploration.bySpoor, exploration.clueById, markSpoorCompleted, revealStore, revealed, toast],
  );

  const pin = useCallback(
    (item: PinInput) => {
      const result = addItem({
        ...item,
        eventId: item.eventId === undefined ? eventId : item.eventId,
        eventSlug: input.event.slug,
        eventTitle: input.event.title,
      });
      if (result === "added") {
        toast(`Bewaard in je dossier: ${item.title}`, { actionLabel: "Ongedaan maken", onAction: () => removeItem(item.id) });
      } else if (result === "exists") {
        toast("Staat al in je dossier");
      } else {
        toast("Je dossier is vol (300 kaarten). Ruim wat op of exporteer het.");
      }
    },
    [addItem, eventId, input.event.slug, input.event.title, removeItem, toast],
  );

  const isPinned = useCallback((id: string) => Boolean(dossierItems[id]), [dossierItems]);

  const value = useMemo<ExploreContextValue>(
    () => ({
      exploration,
      eventId,
      revealed,
      revealAll,
      isRevealed,
      reveal,
      panel,
      pin,
      isPinned,
      dossierCount: Object.keys(dossierItems).length,
    }),
    [dossierItems, eventId, exploration, isPinned, isRevealed, panel, pin, reveal, revealAll, revealed],
  );

  return <ExploreContext.Provider value={value}>{children}</ExploreContext.Provider>;
}

/** Stable dossier ids per kind. */
export const dossierIds = {
  clue: (eventId: number, clueId: string) => `clue:${eventId}:${clueId}`,
  outlet: (outletKey: string) => `outlet:${outletKey}`,
  actor: (slug: string) => `actor:${slug}`,
  entity: (entityKey: string) => `entity:${entityKey}`,
  event: (eventId: number) => `event:${eventId}`,
  country: (iso: string) => `country:${iso.toLowerCase()}`,
  pm: (pmId: number) => `pm:${pmId}`,
};
