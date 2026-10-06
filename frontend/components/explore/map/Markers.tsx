"use client";

import { useEffect, useRef, useState } from "react";

import type { Marker, MarkerType } from "@/lib/explore/figure";
import { RING_MS, scrollToElement, useFocusStore, type FocusTarget } from "@/lib/explore/focus";

import { useExplore } from "../ExploreContext";

export const MARKER_STYLE: Record<MarkerType, { color: string; sign: string; label: string; ownLabel: string }> = {
  claim: { color: "#E30613", sign: "!", label: "Claim zonder bewijs", ownLabel: "Twijfel van jou" },
  statistic: { color: "#d97706", sign: "#", label: "Cijfer", ownLabel: "Cijfer" },
  fallacy: { color: "#7c3aed", sign: "↯", label: "Redeneerfout", ownLabel: "Drogreden van jou" },
  contradiction: { color: "#E30613", sign: "⚡", label: "Tegenspraak", ownLabel: "Tegenspraak van jou" },
  error: { color: "#c2410c", sign: "✕", label: "Fout", ownLabel: "Fout volgens jou" },
  gap: { color: "#0f766e", sign: "", label: "Ontbrekende stem", ownLabel: "Ontbrekende stem van jou" },
  question: { color: "#0f766e", sign: "?", label: "Niet gestelde vraag", ownLabel: "Vraag van jou" },
  note: { color: "#475569", sign: "✎", label: "Opmerking", ownLabel: "Opmerking van jou" },
};

const markerLabel = (type: MarkerType, own: boolean | undefined) => (own ? MARKER_STYLE[type].ownLabel : MARKER_STYLE[type].label);

/**
 * Scroll the element into view and ring it when it is the jump target (`kind`/`id`).
 * Returns the ref to attach and whether it is ringing now.
 */
export function useFocusRing<T extends HTMLElement>(kind: FocusTarget["kind"], id: string | string[], onFocus?: () => void) {
  const ref = useRef<T | null>(null);
  const target = useFocusStore((state) => state.target);
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    if (!target || target.kind !== kind || !(Array.isArray(id) ? id.includes(target.id) : target.id === id)) return;
    onFocus?.();
    // Let an opening row or tab render before scrolling
    const scroll = window.setTimeout(() => scrollToElement(ref.current), 60);
    setRinging(true);
    const stop = window.setTimeout(() => setRinging(false), RING_MS);
    return () => {
      window.clearTimeout(scroll);
      window.clearTimeout(stop);
    };
    // Only a new jump (nonce) triggers this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.nonce]);
  return { ref, ringing };
}

/** A numbered badge: filled for the analysis, outlined for what the reader added. */
export function Badge({ type, number, small = false, own = false }: { type: MarkerType; number: number; small?: boolean; own?: boolean }) {
  const style = MARKER_STYLE[type];
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold shadow ring-2 ring-white ${own ? "border-2 bg-white" : "text-white"} ${
        small ? "h-5 min-w-[20px] px-1 text-[10px]" : "h-6 min-w-[24px] px-1.5 text-[11px]"
      }`}
      style={own ? { borderColor: style.color, color: style.color } : { backgroundColor: style.color }}
    >
      {style.sign ? <span className="mr-0.5">{style.sign}</span> : null}
      {number}
    </span>
  );
}

/** A numbered badge with a 32px tap area; a tap opens the finding in the list. */
export function MarkerButton({ marker, size = "md" }: { marker: Marker; size?: "sm" | "md" }) {
  const { toFinding } = useExplore();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        toFinding(marker.findingId);
      }}
      className="-m-1 inline-flex h-8 min-w-[32px] shrink-0 items-center justify-center"
      aria-label={`${markerLabel(marker.type, marker.own)} ${marker.number}`}
    >
      <Badge type={marker.type} number={marker.number} small={size === "sm"} own={marker.own} />
    </button>
  );
}

/** The number of a finding as it appears in a row; a tap scrolls the picture to its balloon. */
export function NumberBadge({ findingId, type }: { findingId: string; type: MarkerType }) {
  const { numbers, anchorOf, toAnchor, exploration } = useExplore();
  const number = numbers.get(findingId);
  if (!number) return null;
  const own = exploration.findingById.get(findingId)?.type === "own";
  const anchor = anchorOf.get(findingId) ?? (type === "contradiction" ? `contradiction:${findingId}` : null);
  if (!anchor) return <Badge type={type} number={number} own={own} />;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        toAnchor(anchor);
      }}
      className="-m-1 inline-flex h-8 min-w-[32px] shrink-0 items-center justify-center"
      aria-label={`${markerLabel(type, own)} ${number}: toon in het beeld`}
    >
      <Badge type={type} number={number} own={own} />
    </button>
  );
}
