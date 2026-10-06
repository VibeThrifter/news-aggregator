"use client";

/**
 * Jumps between the picture and the list (Epic 14): tap a number on a balloon and its row opens;
 * tap the number in a row and the picture scrolls to the balloon. The target scrolls itself into
 * view and rings for a moment. Also the requests to open the form for an entry of your own (from a
 * popover) and to edit one. Not persisted.
 */

import { create } from "zustand";

import type { OwnKind } from "./types";

export type FocusTarget = { kind: "finding" | "anchor"; id: string; nonce: number };
/** `about`: the finding of the analysis an error corrects */
export type ComposeRequest = { kind: OwnKind; anchor: string | null; about?: string | null; nonce: number };

interface FocusState {
  target: FocusTarget | null;
  focus(kind: FocusTarget["kind"], id: string): void;
  clear(): void;
  /** Open the form for an own entry of this kind (in its tab), hanging on `anchor` */
  compose: ComposeRequest | null;
  requestCompose(kind: OwnKind, anchor: string | null, about?: string | null): void;
  clearCompose(): void;
  /** The own entry being edited */
  editing: string | null;
  setEditing(id: string | null): void;
  /** "Van anderen" under the tabs is open (closed on every visit: nothing of others is shown unasked) */
  othersOpen: boolean;
  setOthersOpen(open: boolean): void;
}

let nonce = 0;

export const useFocusStore = create<FocusState>((set) => ({
  target: null,
  focus(kind, id) {
    nonce += 1;
    set({ target: { kind, id, nonce } });
  },
  clear() {
    set({ target: null });
  },
  compose: null,
  requestCompose(kind, anchor, about = null) {
    nonce += 1;
    set({ compose: { kind, anchor, about, nonce } });
  },
  clearCompose() {
    set({ compose: null });
  },
  editing: null,
  setEditing(id) {
    set({ editing: id });
  },
  othersOpen: false,
  setOthersOpen(open) {
    set({ othersOpen: open });
  },
}));

/** How long a jump target keeps its ring */
export const RING_MS = 2000;

/** Scroll an element to the middle of the screen (instantly with reduced motion). */
export function scrollToElement(element: Element | null) {
  if (!element) return;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}
