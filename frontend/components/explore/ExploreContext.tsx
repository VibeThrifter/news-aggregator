"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { mutate as revalidate } from "swr";
import { useShallow } from "zustand/react/shallow";

import type { Exploration } from "@/lib/explore/exploration";
import { numberFindings, type FigureModel } from "@/lib/explore/figure";
import { useFocusStore } from "@/lib/explore/focus";
import { useUrlPanel } from "@/lib/explore/hooks";
import { adoptionOf, shareFields } from "@/lib/explore/others";
import { newOwnId, OWN_KINDS, OWN_LIMITS, withOwn } from "@/lib/explore/own";
import { useExploreStore, type DossierItem, type OwnPatch } from "@/lib/explore/store";
import { truncate } from "@/lib/explore/summary";
import type { OwnEntry, OwnKind } from "@/lib/explore/types";
import { adoptSharedEntry, shareEntry, unshareEntry, type ShareFailure, type SharedEntry } from "@/lib/shared";

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
  /** Open the form for an own entry in its tab, hanging on `anchor` (from a popover or sheet); an
   * error can be `about` a finding of the analysis */
  compose: (kind: OwnKind, anchor?: string | null, about?: string | null) => void;
  /** Share an own entry with other readers ("Van anderen"), or stop sharing it */
  share: (id: string) => Promise<void>;
  unshare: (id: string) => Promise<void>;
  /** Take over what another reader shared: it becomes an entry of your own */
  adopt: (shared: SharedEntry) => OwnEntry | null;
}

const SHARE_FAILURES: Record<ShareFailure, string> = {
  geen_apparaat: "Delen lukt niet: deze browser bewaart niets.",
  ongeldig: "Dit kan niet gedeeld worden.",
  onbekend_event: "Dit nieuwsitem staat niet in de database.",
  limiet: "Je hebt vandaag al veel gedeeld. Probeer het morgen weer.",
  druk: "Het is te druk, probeer het later nog eens.",
  niet_beschikbaar: "Delen kan nog niet.",
};

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
  const demo = input.event.isDemo;
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

  // What others shared stays closed until you open it, on every news item
  const setOthersOpen = useFocusStore((state) => state.setOthersOpen);
  useEffect(() => setOthersOpen(false), [eventId, setOthersOpen]);

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

  // What others see of it: the list "Van anderen" of this news (lib/shared.ts)
  const refreshShared = useCallback(() => revalidate((key) => Array.isArray(key) && key[0] === "shared" && key[1] === eventId), [eventId]);
  const ownEntry = useCallback((id: string) => useExploreStore.getState().own[String(eventId)]?.find((entry) => entry.id === id) ?? null, [eventId]);

  /** Send the entry as it is now (a share, or an update of one); false when it failed */
  const publish = useCallback(
    async (entry: OwnEntry, quiet = false) => {
      try {
        const result = await shareEntry(eventId, shareFields(entry, exploration.speakers), { demo });
        if (!result.ok) {
          if (!quiet) toast(SHARE_FAILURES[result.reason]);
          return false;
        }
        return true;
      } catch {
        if (!quiet) toast("Delen lukte niet.");
        return false;
      } finally {
        void refreshShared();
      }
    },
    [demo, eventId, exploration.speakers, refreshShared, toast],
  );

  const unshare = useCallback(
    async (id: string) => {
      storeUpdateOwn(eventId, id, { sharedAt: undefined });
      try {
        await unshareEntry(eventId, id, { demo });
      } catch {
        toast("Intrekken lukte niet.");
      }
      void refreshShared();
    },
    [demo, eventId, refreshShared, storeUpdateOwn, toast],
  );

  const share = useCallback(
    async (id: string) => {
      const entry = ownEntry(id);
      if (!entry || entry.from) return;
      if (!(await publish(entry))) return;
      storeUpdateOwn(eventId, id, { sharedAt: new Date().toISOString() });
      toast(`Gedeeld, zonder je naam: ${truncate(entry.text, 40)}`, { actionLabel: "Ongedaan maken", onAction: () => void unshare(id) });
    },
    [eventId, ownEntry, publish, storeUpdateOwn, toast, unshare],
  );

  const updateOwn = useCallback(
    (id: string, patch: OwnPatch) => {
      storeUpdateOwn(eventId, id, patch);
      // Others see the new version of what you shared
      const entry = ownEntry(id);
      if (entry?.sharedAt) void publish(entry);
    },
    [eventId, ownEntry, publish, storeUpdateOwn],
  );

  const removeOwn = useCallback(
    (id: string) => {
      const removed = storeRemoveOwn(eventId, id);
      if (!removed) return;
      const { entry } = removed;
      // Gone for others too; taken over: no longer counted
      if (entry.sharedAt) void unshareEntry(eventId, entry.id, { demo }).finally(() => void refreshShared());
      if (entry.from) void adoptSharedEntry(Number(entry.from), false, { demo }).finally(() => void refreshShared());
      toast(`Verwijderd: ${truncate(entry.text, 40)}`, {
        actionLabel: "Ongedaan maken",
        onAction: () => {
          restoreOwn(eventId, entry, removed.index);
          if (entry.sharedAt) void publish(entry, true);
          if (entry.from) void adoptSharedEntry(Number(entry.from), true, { demo }).finally(() => void refreshShared());
        },
      });
    },
    [demo, eventId, publish, refreshShared, restoreOwn, storeRemoveOwn, toast],
  );

  const adopt = useCallback(
    (shared: SharedEntry) => {
      const entry: OwnEntry = { ...adoptionOf(shared), id: newOwnId(), createdAt: new Date().toISOString() };
      const result = storeAddOwn(eventId, entry);
      if (result === "full") toast(`Je hebt ${OWN_LIMITS.perEvent} dingen toegevoegd aan dit nieuws, het maximum.`);
      if (result !== "added") return null;
      void adoptSharedEntry(shared.id, true, { demo }).finally(() => void refreshShared());
      toast(`Overgenomen: ${truncate(shared.text, 40)}`, {
        actionLabel: "Ongedaan maken",
        onAction: () => {
          storeRemoveOwn(eventId, entry.id);
          void adoptSharedEntry(shared.id, false, { demo }).finally(() => void refreshShared());
        },
      });
      return entry;
    },
    [demo, eventId, refreshShared, storeAddOwn, storeRemoveOwn, toast],
  );

  const compose = useCallback(
    (kind: OwnKind, anchor: string | null = null, about: string | null = null) =>
      afterSheet(() => {
        setPref("findingsTab", OWN_KINDS[kind].tab);
        requestCompose(kind, anchor, about);
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
      share,
      unshare,
      adopt,
    }),
    [adopt, addOwn, compose, dossierItems, eventId, exploration, isPinned, numbered, panel, pin, removeOwn, share, toAnchor, toFinding, unshare, updateOwn],
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
