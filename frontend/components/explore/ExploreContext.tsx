"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Exploration } from "@/lib/explore/exploration";
import { numberFindings, type FigureModel } from "@/lib/explore/figure";
import { useFocusStore } from "@/lib/explore/focus";
import { useUrlPanel } from "@/lib/explore/hooks";
import { newOwnId, OWN_KINDS, OWN_LIMITS, withOwn } from "@/lib/explore/own";
import { useExploreStore, type DossierItem, type OwnPatch } from "@/lib/explore/store";
import { truncate } from "@/lib/explore/summary";
import type { OwnEntry, OwnKind } from "@/lib/explore/types";

import { useToast } from "./ui/Toast";

export type PinInput = Omit<DossierItem, "addedAt" | "eventId" | "eventSlug" | "eventTitle"> & { eventId?: number | null };

/** A sheet closes before a jump: vaul keeps the page fixed while it is open. */
const SHEET_CLOSE_MS = 350;

interface ExploreContextValue {
  /** The analysis plus what the reader added themselves (own.ts) */
  exploration: Exploration;
  eventId: number;
  /** Numbers of the findings drawn on the picture (fixed per event) */
  numbers: FigureModel["numbers"];
  anchorOf: FigureModel["anchorOf"];
  panel: ReturnType<typeof useUrlPanel>;
  /** Open the tab of a finding and ring its row */
  toFinding: (findingId: string) => void;
  /** Scroll the picture to a balloon (`outlet:<key>`, `speaker:<id>`, `gap:<findingId>`) and ring it */
  toAnchor: (anchor: string) => void;
  pin: (item: PinInput) => void;
  isPinned: (id: string) => boolean;
  dossierCount: number;
  /** Add an entry of your own; null when it could not be added */
  addOwn: (entry: Omit<OwnEntry, "id" | "createdAt">) => OwnEntry | null;
  updateOwn: (id: string, patch: OwnPatch) => void;
  /** Remove an own entry, with undo */
  removeOwn: (id: string) => void;
  /** Open the form for an own entry in its tab, hanging on `anchor` (from a popover or sheet) */
  compose: (kind: OwnKind, anchor?: string | null) => void;
}

const ExploreContext = createContext<ExploreContextValue | null>(null);

export function useExplore(): ExploreContextValue {
  const value = useContext(ExploreContext);
  if (!value) {
    throw new Error("useExplore must be used inside <ExploreProvider>");
  }
  return value;
}

export function ExploreProvider({ exploration: analysis, children }: { exploration: Exploration; children: ReactNode }) {
  const { input } = analysis;
  const eventId = input.event.id;
  const toast = useToast();
  const panel = useUrlPanel();
  const focus = useFocusStore((state) => state.focus);
  const requestCompose = useFocusStore((state) => state.requestCompose);

  const { dossierItems, ownEntries, touchEvent, addItem, removeItem, setPref, storeAddOwn, storeUpdateOwn, storeRemoveOwn, restoreOwn } =
    useExploreStore(
      useShallow((state) => ({
        dossierItems: state.dossier.items,
        ownEntries: state.own[String(eventId)],
        touchEvent: state.touchEvent,
        addItem: state.addItem,
        removeItem: state.removeItem,
        setPref: state.setPref,
        storeAddOwn: state.addOwn,
        storeUpdateOwn: state.updateOwn,
        storeRemoveOwn: state.removeOwn,
        restoreOwn: state.restoreOwn,
      })),
    );

  useEffect(() => {
    touchEvent(eventId, { slug: input.event.slug, title: input.event.title });
  }, [eventId, input.event.slug, input.event.title, touchEvent]);

  // What the reader added is part of the picture, the tabs and the numbering
  const exploration = useMemo(() => withOwn(analysis, ownEntries), [analysis, ownEntries]);
  const numbered = useMemo(() => numberFindings(exploration), [exploration]);

  const afterSheet = useCallback(
    (run: () => void) => {
      if (panel.panel) {
        panel.close();
        window.setTimeout(run, SHEET_CLOSE_MS);
      } else {
        run();
      }
    },
    [panel],
  );

  const toFinding = useCallback(
    (findingId: string) => {
      const finding = exploration.findingById.get(findingId);
      if (!finding) return;
      afterSheet(() => {
        setPref("findingsTab", finding.tab);
        focus("finding", findingId);
      });
    },
    [afterSheet, exploration.findingById, focus, setPref],
  );

  const toAnchor = useCallback((anchor: string) => afterSheet(() => focus("anchor", anchor)), [afterSheet, focus]);

  const pin = useCallback(
    (item: PinInput) => {
      const result = addItem({
        ...item,
        eventId: item.eventId === undefined ? eventId : item.eventId,
        eventSlug: input.event.slug,
        eventTitle: input.event.title,
      });
      if (result === "added") {
        toast(`Bewaard: ${item.title}`, { actionLabel: "Ongedaan maken", onAction: () => removeItem(item.id) });
      } else if (result === "exists") {
        toast("Al bewaard");
      } else {
        toast("Je hebt 300 dingen bewaard, het maximum. Ruim wat op of exporteer het.");
      }
    },
    [addItem, eventId, input.event.slug, input.event.title, removeItem, toast],
  );

  const isPinned = useCallback((id: string) => Boolean(dossierItems[id]), [dossierItems]);

  const addOwn = useCallback(
    (fields: Omit<OwnEntry, "id" | "createdAt">) => {
      const entry: OwnEntry = { ...fields, id: newOwnId(), createdAt: new Date().toISOString() };
      const result = storeAddOwn(eventId, entry);
      if (result === "full") toast(`Je hebt ${OWN_LIMITS.perEvent} dingen toegevoegd aan dit nieuws, het maximum.`);
      return result === "added" ? entry : null;
    },
    [eventId, storeAddOwn, toast],
  );

  const updateOwn = useCallback((id: string, patch: OwnPatch) => storeUpdateOwn(eventId, id, patch), [eventId, storeUpdateOwn]);

  const removeOwn = useCallback(
    (id: string) => {
      const removed = storeRemoveOwn(eventId, id);
      if (!removed) return;
      toast(`Verwijderd: ${truncate(removed.entry.text, 40)}`, {
        actionLabel: "Ongedaan maken",
        onAction: () => restoreOwn(eventId, removed.entry, removed.index),
      });
    },
    [eventId, restoreOwn, storeRemoveOwn, toast],
  );

  const compose = useCallback(
    (kind: OwnKind, anchor: string | null = null) =>
      afterSheet(() => {
        setPref("findingsTab", OWN_KINDS[kind].tab);
        requestCompose(kind, anchor);
      }),
    [afterSheet, requestCompose, setPref],
  );

  const value = useMemo<ExploreContextValue>(
    () => ({
      exploration,
      eventId,
      numbers: numbered.numbers,
      anchorOf: numbered.anchorOf,
      panel,
      toFinding,
      toAnchor,
      pin,
      isPinned,
      dossierCount: Object.keys(dossierItems).length,
      addOwn,
      updateOwn,
      removeOwn,
      compose,
    }),
    [addOwn, compose, dossierItems, eventId, exploration, isPinned, numbered, panel, pin, removeOwn, toAnchor, toFinding, updateOwn],
  );

  return <ExploreContext.Provider value={value}>{children}</ExploreContext.Provider>;
}

/** Stable dossier ids per kind. */
export const dossierIds = {
  finding: (eventId: number, findingId: string) => `clue:${eventId}:${findingId}`,
  outlet: (outletKey: string) => `outlet:${outletKey}`,
  actor: (slug: string) => `actor:${slug}`,
  entity: (entityKey: string) => `entity:${entityKey}`,
  event: (eventId: number) => `event:${eventId}`,
  country: (iso: string) => `country:${iso.toLowerCase()}`,
  pm: (pmId: number) => `pm:${pmId}`,
};
