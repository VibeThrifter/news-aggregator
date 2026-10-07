"use client";

import { useState } from "react";
import { ChevronDown, Pencil, Trash2, UserSearch } from "lucide-react";

import { useFocusStore } from "@/lib/explore/focus";
import { ownEntryOf, sourceOutletKey } from "@/lib/explore/own";
import type { Speaker } from "@/lib/explore/speakers";
import { truncate } from "@/lib/explore/summary";
import { slugify } from "@/lib/explore/normalize";

import { useExplore } from "../ExploreContext";
import { OutletInline } from "../entity/EntityText";
import { Chip, Favicon } from "../ui/primitives";
import { FindingDetail } from "./FindingDetail";
import { FindingRow } from "./FindingRow";
import { ShareControl, SharedTag } from "./Others";
import { NumberBadge, useFocusRing } from "./Markers";
import { FoundTag, OwnForm, OwnTag } from "./OwnForm";
import { Avatar, OwnAbout } from "./PeopleCards";

/**
 * "Wie praat?": per outlet who gets the word, their role and interests; a matrix with ≥ 2 outlets.
 * Sources you added are listed with their outlet.
 */
export function StemmenTab() {
  const { exploration } = useExplore();
  const { input, speakers, findings } = exploration;
  const sources = findings.filter((finding) => ownEntryOf(finding)?.kind === "source");
  const sourcesOf = (key: string) => sources.filter((finding) => sourceOutletKey(ownEntryOf(finding)?.url) === key);
  const outlets = [...input.outlets, ...(exploration.ownOutlets ?? [])].filter(
    (outlet) =>
      (speakers.byOutlet.get(outlet.key)?.length ?? 0) > 0 ||
      findings.some((f) => f.body.type === "voices" && f.body.outletKey === outlet.key) ||
      sourcesOf(outlet.key).length > 0,
  );
  if (outlets.length === 0) return null;
  return (
    <div className="space-y-5">
      {outlets.length >= 2 ? <VoicesMatrix /> : null}
      {outlets.map((outlet) => {
        const voices = findings.find((finding) => finding.body.type === "voices" && finding.body.outletKey === outlet.key);
        const pattern = voices?.body.type === "voices" ? voices.body.sourcingPattern : null;
        const list = speakers.byOutlet.get(outlet.key) ?? [];
        return (
          <section key={outlet.key} className="space-y-1" aria-label={`Wie praat bij ${outlet.name}`}>
            <p className="flex items-center gap-1.5 text-sm">
              <OutletInline outletKey={outlet.key} />
              {outlet.own ? <OwnTag /> : null}
            </p>
            {pattern ? <p className="text-sm leading-relaxed text-ink-700">{pattern}</p> : null}
            <ul className="divide-y divide-paper-200">
              {list.map((speaker) => (
                <SpeakerRow key={speaker.id} speaker={speaker} />
              ))}
              {sourcesOf(outlet.key).map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SpeakerRow({ speaker }: { speaker: Speaker }) {
  const { exploration, panel, removeOwn } = useExplore();
  const [open, setOpen] = useState(false);
  const authority = speaker.authorityId ? exploration.findingById.get(speaker.authorityId) : undefined;
  const entry = speaker.ownId ? ownEntryOf(exploration.findingById.get(speaker.ownId)) : null;
  const editing = useFocusStore((state) => Boolean(speaker.ownId) && state.editing === speaker.ownId);
  const setEditing = useFocusStore((state) => state.setEditing);
  // A jump to the authority finding (or to a speaker you added) opens this row
  const { ref, ringing } = useFocusRing<HTMLLIElement>("finding", speaker.authorityId ?? speaker.ownId ?? `-speaker:${speaker.id}`, () =>
    setOpen(true),
  );
  if (entry && editing) {
    return (
      <li ref={ref} className="scroll-mt-28 py-2.5">
        <OwnForm kind="speaker" initial={entry} onCancel={() => setEditing(null)} onDone={() => setEditing(null)} />
      </li>
    );
  }
  return (
    <li ref={ref} className={`scroll-mt-28 rounded-xl ${ringing ? "ring-4 ring-amber-300 ring-offset-2" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2.5 py-2.5 text-left">
        <Avatar speaker={speaker} size={28} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
            <strong className="font-semibold text-ink-900">{speaker.name}</strong>
            {speaker.org ? <span className="text-ink-500">({speaker.org})</span> : null}
            {speaker.interest ? <span className="rounded-full bg-orange-100 px-1.5 text-[10px] font-semibold text-orange-800">belang</span> : null}
            {speaker.ownId ? <OwnTag adopted={Boolean(entry?.from)} /> : null}
            {entry ? <SharedTag entry={entry} /> : null}
            {speaker.found ? <FoundTag /> : null}
          </span>
          {speaker.role ? <span className="block truncate text-xs text-ink-500">{speaker.role}</span> : null}
        </span>
        {speaker.claimIds.map((id) => (
          <NumberBadge key={id} findingId={id} type="claim" />
        ))}
        <ChevronDown size={18} className={`shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="space-y-3 pb-3 pl-10">
          {speaker.claimIds.map((id) => {
            const claim = exploration.findingById.get(id);
            return claim?.body.type === "claim" ? (
              <p key={id} className="flex items-start gap-2 text-sm italic text-ink-800">
                <NumberBadge findingId={id} type="claim" />
                <span>{truncate(claim.body.claim.claim, 220)}</span>
              </p>
            ) : null;
          })}
          {speaker.quote ? <p className="text-sm italic leading-relaxed text-ink-800">{speaker.quote}</p> : null}
          {authority ? <FindingDetail finding={authority} /> : null}
          <OwnAbout anchor={`speaker:${speaker.id}`} />
          <div className="flex flex-wrap gap-2">
            {speaker.kind !== "anonymous" ? (
              <Chip
                tone="blue"
                icon={<UserSearch size={14} />}
                onClick={() =>
                  panel.open(`entiteit:${speaker.entityKey ?? speaker.slug}`, {
                    n: speaker.name,
                    k: speaker.kind === "person" ? "person" : speaker.kind === "org" ? "org" : null,
                  })
                }
              >
                Meer over {truncate(speaker.name, 28)}
              </Chip>
            ) : null}
            {speaker.ownId ? (
              <>
                <Chip icon={<Pencil size={14} />} onClick={() => setEditing(speaker.ownId ?? null)}>
                  Pas aan
                </Chip>
                <Chip icon={<Trash2 size={14} />} onClick={() => speaker.ownId && removeOwn(speaker.ownId)}>
                  Verwijder
                </Chip>
                {entry ? <ShareControl entry={entry} /> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Speakers × outlets: ● gets the word, ○ only mentioned (by name, in the articles). */
function VoicesMatrix() {
  const { exploration } = useExplore();
  const { input, speakers } = exploration;
  const outlets = input.outlets.filter((outlet) => !outlet.isInternational);
  const rows = new Map<string, { name: string; kind: Speaker["kind"]; speaking: Set<string>; entityKey: string | null }>();
  for (const speaker of speakers.speakers) {
    const row = rows.get(speaker.slug) ?? { name: speaker.name, kind: speaker.kind, speaking: new Set<string>(), entityKey: speaker.entityKey };
    row.speaking.add(speaker.outletKey);
    rows.set(speaker.slug, row);
  }
  const mentions = (entityKey: string | null, outletName: string) => {
    if (!entityKey) return false;
    const entity = input.entities.find((item) => item.entity_key === entityKey);
    if (!entity) return false;
    return Object.entries(entity.outlet_counts ?? {}).some(([name, count]) => count > 0 && slugify(name) === slugify(outletName));
  };
  const sorted = Array.from(rows.values()).sort((a, b) => b.speaking.size - a.speaking.size || a.name.localeCompare(b.name, "nl"));
  if (sorted.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label="Wie praat bij welke bron">
        <thead>
          <tr>
            <th />
            {outlets.map((outlet) => (
              <th key={outlet.key} className="w-7 px-0.5 pb-2" title={outlet.name}>
                <span className="flex justify-center">
                  <Favicon name={outlet.name} domain={outlet.domain} size={18} />
                </span>
                <span className="sr-only">{outlet.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 14).map((row) => (
            <tr key={row.name} className="border-t border-paper-200">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <span className="flex items-center gap-1.5">
                  <Avatar speaker={row} size={18} />
                  <span className="line-clamp-2">{row.name}</span>
                </span>
              </th>
              {outlets.map((outlet) => {
                const speaking = row.speaking.has(outlet.key);
                const mentioned = !speaking && mentions(row.entityKey, outlet.name);
                return (
                  <td key={outlet.key} className="px-0.5 text-center" aria-label={speaking ? "aan het woord" : mentioned ? "genoemd" : "niet"}>
                    {speaking ? <span className="text-base text-ink-900">●</span> : mentioned ? <span className="text-base text-ink-400">○</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-ink-500">● aan het woord · ○ alleen genoemd</p>
    </div>
  );
}
