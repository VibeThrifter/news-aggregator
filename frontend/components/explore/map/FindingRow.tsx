"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Crosshair, Pencil, Pin, Trash2 } from "lucide-react";

import type { MarkerType } from "@/lib/explore/figure";
import { useFocusStore } from "@/lib/explore/focus";
import { findingLabel, findingTitle } from "@/lib/explore/findings";
import { TAB_BY_ID } from "@/lib/explore/labels";
import { anchorOutletKey, OWN_KINDS, ownEntryOf, resolveOwnAnchor } from "@/lib/explore/own";
import { truncate } from "@/lib/explore/summary";
import type { Finding } from "@/lib/explore/types";

import { dossierIds, useExplore } from "../ExploreContext";
import { Favicon } from "../ui/primitives";
import { NumberBadge, useFocusRing } from "./Markers";
import { OwnForm, OwnTag } from "./OwnForm";
import { Avatar } from "./PeopleCards";
import { FindingDetail, findingHeadline } from "./FindingDetail";

const MARKED: Partial<Record<Finding["type"], MarkerType>> = {
  claim: "claim",
  statistic: "statistic",
  fallacy: "fallacy",
  contradiction: "contradiction",
  gap: "gap",
};

/** The marker a finding has on the picture (own entries by their kind). */
export function markerTypeOf(finding: Finding): MarkerType | null {
  const entry = ownEntryOf(finding);
  return entry ? OWN_KINDS[entry.kind].marker : (MARKED[finding.type] ?? null);
}

/** Who a finding is about: the speaker of a claim ("Van den Beukel · via NOS") or its outlets. */
function Attribution({ finding }: { finding: Finding }) {
  const { exploration } = useExplore();
  const entry = ownEntryOf(finding);
  // An own entry hangs on the speaker or outlet the reader chose
  const ownAnchor = entry ? resolveOwnAnchor(entry, exploration) : null;
  const anchor = entry
    ? ownAnchor?.startsWith("speaker:")
      ? { kind: "speaker" as const, id: ownAnchor.slice("speaker:".length) }
      : null
    : exploration.speakers.claimAnchor.get(finding.id);
  const speaker = anchor?.kind === "speaker" ? exploration.speakers.byId.get(anchor.id) : undefined;
  const outletKeys = speaker
    ? [speaker.outletKey]
    : entry
      ? [anchorOutletKey(ownAnchor, exploration.speakers)].filter((key): key is string => Boolean(key))
      : finding.outletKeys;
  const outlets = outletKeys.map((key) => exploration.index.outlet(key)).filter(Boolean);
  if (!speaker && outlets.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-500">
      {speaker ? (
        <>
          <Avatar speaker={speaker} size={16} />
          <span className="font-semibold text-ink-700">{speaker.name}</span>
          {speaker.org ? <span>({speaker.org})</span> : null}
          <span>via</span>
        </>
      ) : null}
      {outlets.slice(0, 4).map((outlet) =>
        outlet ? (
          <span key={outlet.key} className="inline-flex items-center gap-1">
            <Favicon name={outlet.name} domain={outlet.domain} size={14} />
            {outlet.name}
          </span>
        ) : null,
      )}
      {outlets.length > 4 ? <span>+{outlets.length - 4}</span> : null}
    </span>
  );
}

const actionClass =
  "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 px-3 text-xs font-medium text-ink-700 hover:bg-paper-100";

/**
 * A finding as a compact row; opens inline. Rings and opens when it is the target of a jump.
 * The reader's own entries can be changed and removed here.
 */
export function FindingRow({ finding, extra, leading }: { finding: Finding; extra?: ReactNode; leading?: ReactNode }) {
  const { exploration, eventId, pin, isPinned, anchorOf, toAnchor, removeOwn } = useExplore();
  const entry = ownEntryOf(finding);
  const editing = useFocusStore((state) => Boolean(entry) && state.editing === finding.id);
  const setEditing = useFocusStore((state) => state.setEditing);
  const [open, setOpen] = useState(false);
  const { ref, ringing } = useFocusRing<HTMLLIElement>("finding", finding.id, () => setOpen(true));
  const { title, meta } = findingHeadline(finding);
  const marker = markerTypeOf(finding);
  const anchor = anchorOf.get(finding.id) ?? (finding.type === "contradiction" ? `contradiction:${finding.id}` : null);
  const pinId = dossierIds.finding(eventId, finding.id);
  const italic = finding.type === "claim" || finding.type === "statistic" || entry?.kind === "claim";

  if (entry && editing) {
    return (
      <li ref={ref} id={`finding-${finding.id}`} className={`relative scroll-mt-28 py-2.5 ${leading ? "" : "pl-9"}`}>
        {leading}
        <OwnForm kind={entry.kind} initial={entry} onCancel={() => setEditing(null)} onDone={() => setEditing(null)} />
      </li>
    );
  }

  return (
    <li
      ref={ref}
      id={`finding-${finding.id}`}
      className={`relative scroll-mt-28 rounded-xl transition-shadow ${ringing ? "ring-4 ring-amber-300 ring-offset-2" : ""}`}
    >
      <div className="flex items-start gap-2.5 py-2.5">
        {leading ??
          (marker ? (
            <span className="pt-0.5">
              <NumberBadge findingId={finding.id} type={marker} />
            </span>
          ) : (
            <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TAB_BY_ID[finding.tab].color }} />
          ))}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <span className={`block text-sm leading-snug text-ink-900 ${italic ? "italic" : "font-semibold"}`}>
            {truncate(title || findingTitle(finding, exploration.index), open ? 600 : 180)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Attribution finding={finding} />
            {/* An opened own entry shows its source as a link below */}
            {meta && !(open && entry?.url) ? <span className="text-xs text-ink-500">{meta}</span> : null}
            {entry ? <OwnTag /> : null}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-paper-100"
          aria-label={open ? "Dichtklappen" : "Openklappen"}
        >
          <ChevronDown size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open ? (
        <div className={`space-y-3 pb-3 ${leading ? "" : "pl-9"}`}>
          <FindingDetail finding={finding} />
          {extra}
          <div className="flex flex-wrap gap-2">
            {anchor ? (
              <button type="button" onClick={() => toAnchor(anchor)} className={actionClass}>
                <Crosshair size={14} /> Toon in het beeld
              </button>
            ) : null}
            {entry ? (
              <>
                <button type="button" onClick={() => setEditing(finding.id)} className={actionClass}>
                  <Pencil size={14} /> Pas aan
                </button>
                <button type="button" onClick={() => removeOwn(finding.id)} className={actionClass}>
                  <Trash2 size={14} /> Verwijder
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-pressed={isPinned(pinId)}
              onClick={() =>
                pin({
                  id: pinId,
                  kind: "finding",
                  refId: finding.id,
                  findingId: finding.id,
                  tab: finding.tab,
                  title: truncate(findingTitle(finding, exploration.index), 90),
                  subtitle: entry ? `${findingLabel(finding)} · jij` : findingLabel(finding),
                  text: entry?.detail,
                  url: entry?.url,
                  keys: finding.links,
                })
              }
              className={actionClass}
            >
              <Pin size={14} /> {isPinned(pinId) ? "Bewaard" : "Bewaar"}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
