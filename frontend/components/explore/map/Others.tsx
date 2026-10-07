"use client";

/**
 * "Van anderen" (Epic 14, Story 14.15): what other readers shared about this news. Closed until you
 * open it, and nothing of it enters your picture until you take it over ("Neem over"). Also the
 * "Deel" button on what you added and how what you shared is doing. No AI: you are the filter;
 * reports hide what is abuse (lib/shared.ts, migration 012).
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Check, ChevronDown, ChevronRight, ExternalLink, EyeOff, Flag, MicOff, Plus, Search, Share2, Users, CalendarDays } from "lucide-react";

import { useAccess } from "@/lib/explore/access";
import { markerTypeOf } from "@/lib/explore/figure";
import { findingTitle } from "@/lib/explore/findings";
import { useFocusStore } from "@/lib/explore/focus";
import { fallacyLabel, OWN_KIND_LABELS } from "@/lib/explore/labels";
import { anchorOutletKey, OWN_KINDS } from "@/lib/explore/own";
import {
  groupShared,
  groupsAbout,
  groupsInTab,
  matchesQuery,
  shareFields,
  sharedKey,
  sortGroups,
  type SharedGroup,
  type SharedOrder,
} from "@/lib/explore/others";
import { guessSpeakerKind } from "@/lib/explore/speakers";
import { useExploreStore } from "@/lib/explore/store";
import { truncate } from "@/lib/explore/summary";
import { urlHost } from "@/lib/explore/normalize";
import type { OwnEntry, OwnKind, TabId } from "@/lib/explore/types";
import { moderateSharedEntry, reportSharedEntry, sharedEntriesForEvent, type ReportReason, type SharedEntry } from "@/lib/shared";

import { useExplore } from "../ExploreContext";
import { SubHeading, Favicon } from "../ui/primitives";
import { useToast } from "../ui/Toast";
import { Badge, MARKER_STYLE } from "./Markers";
import { AnchorInline, Avatar } from "./PeopleCards";
import { ScrollRow } from "../ui/ScrollRow";

const NO_ENTRIES: SharedEntry[] = [];
const FIRST = 8;
const day = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

/** What readers shared about this news; `available` is false when the database cannot share yet. */
export function useShared() {
  const { exploration, eventId } = useExplore();
  const demo = exploration.input.event.isDemo;
  const swr = useSWR(["shared", eventId, demo], () => sharedEntriesForEvent(eventId, { demo }), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 30_000,
  });
  return { entries: swr.data ?? NO_ENTRIES, available: Boolean(swr.data) && !swr.error, demo, refresh: () => void swr.mutate() };
}

/**
 * The rows of others: one per entry however many shared it, without what only you shared, and
 * with whether you took it over or have it already.
 */
export function useSharedGroups() {
  const { exploration, eventId } = useExplore();
  const { entries, available, demo } = useShared();
  const own = useExploreStore((state) => state.own[String(eventId)]);
  const groups = useMemo(() => {
    const adoptedIds = new Set((own ?? []).map((entry) => entry.from).filter((id): id is string => Boolean(id)));
    return groupShared(entries, adoptedIds).filter((group) => group.entries.some((entry) => !entry.mine));
  }, [entries, own]);
  // What you have already, also when you wrote it yourself (the same words, on the same thing)
  const have = useMemo(
    () =>
      new Set(
        (own ?? []).map((entry) => {
          const fields = shareFields(entry, exploration.speakers);
          return sharedKey({
            kind: fields.kind,
            text: fields.text,
            anchor: fields.anchor ?? null,
            against: fields.against ?? null,
            about: fields.about ?? null,
            fallacy: fields.fallacy ?? null,
            url: fields.url ?? null,
            date: fields.date ?? null,
          });
        }),
      ),
    [exploration.speakers, own],
  );
  return { groups, have, available, demo, entries };
}

/** Who or what an entry of another reader is about, as this news knows them. */
function describeAnchor(anchor: string | null, exploration: ReturnType<typeof useExplore>["exploration"]): string | null {
  if (!anchor) return null;
  const speaker = anchor.startsWith("speaker:") ? exploration.speakers.byId.get(anchor.slice("speaker:".length)) : undefined;
  if (speaker) return speaker.name;
  return exploration.index.outlet(anchorOutletKey(anchor, exploration.speakers))?.name ?? null;
}

/** The kind of an entry, as a small sign: its marker, a face, a site, a date. */
function KindSign({ entry }: { entry: SharedEntry }) {
  const marker = OWN_KINDS[entry.kind]?.marker;
  if (entry.kind === "gap") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-teal-600/60 text-teal-700">
        <MicOff size={12} aria-hidden="true" />
      </span>
    );
  }
  if (marker) {
    const style = MARKER_STYLE[marker];
    return (
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-white text-[11px] font-bold"
        style={{ borderColor: style.color, color: style.color }}
      >
        {style.sign || "•"}
      </span>
    );
  }
  if (entry.kind === "speaker") return <Avatar speaker={{ name: entry.text, kind: guessSpeakerKind(entry.text) }} size={24} />;
  if (entry.kind === "source" && entry.url) return <Favicon name={urlHost(entry.url)} domain={urlHost(entry.url)} size={20} className="mt-0.5" />;
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-paper-300 text-ink-500">
      <CalendarDays size={12} aria-hidden="true" />
    </span>
  );
}

/** "Drogreden · Vals dilemma", "Bron · trouw.nl", "Moment · 12 jun 2019" */
function kindLine(entry: SharedEntry): string {
  const label = OWN_KIND_LABELS[entry.kind];
  if (entry.kind === "fallacy") return `${label} · ${fallacyLabel(entry.fallacy)}`;
  if (entry.kind === "source" && entry.url) return `${label} · ${urlHost(entry.url)}`;
  if (entry.kind === "moment" && entry.date) {
    const date = new Date(`${entry.date}T12:00:00`);
    return Number.isNaN(date.getTime()) ? label : `${label} · ${day.format(date)}`;
  }
  return label;
}

function hrefOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: "spam", label: "Spam of reclame" },
  { id: "beledigend", label: "Beledigend" },
  { id: "prive", label: "Over een privépersoon" },
  { id: "anders", label: "Iets anders" },
];

const actionClass =
  "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 px-3 text-xs font-medium text-ink-700 hover:bg-paper-100";

/** "Meld": why, then gone for you; 3 reports hide it for everyone until the admin looks. */
function Report({ entry, onDone }: { entry: SharedEntry; onDone: () => void }) {
  const { exploration } = useExplore();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const demo = exploration.input.event.isDemo;
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={actionClass}>
        <Flag size={14} aria-hidden="true" /> Meld
      </button>
    );
  }
  return (
    <div role="group" aria-label="Waarom meld je dit?" className="flex basis-full flex-wrap gap-1.5">
      {REPORT_REASONS.map((reason) => (
        <button
          key={reason.id}
          type="button"
          onClick={async () => {
            setAsking(false);
            try {
              const result = await reportSharedEntry(entry.id, reason.id, { demo });
              toast(result.ok ? "Gemeld. Je ziet het niet meer." : "Melden lukte niet.");
            } catch {
              toast("Melden lukte niet.");
            }
            onDone();
          }}
          className="min-h-[36px] rounded-full border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800 hover:bg-red-100"
        >
          {reason.label}
        </button>
      ))}
      <button type="button" onClick={() => setAsking(false)} className="min-h-[36px] px-2 text-xs font-semibold text-ink-500">
        Annuleren
      </button>
    </div>
  );
}

/** The admin: hide it for everyone right away. */
function AdminHide({ entry, onDone }: { entry: SharedEntry; onDone: () => void }) {
  const { exploration } = useExplore();
  const access = useAccess();
  const toast = useToast();
  if (access.role !== "admin" || !access.code) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        const result = await moderateSharedEntry(access.code as string, entry.id, "verberg", { demo: exploration.input.event.isDemo }).catch(() => ({ ok: false }));
        toast(result.ok ? "Verborgen voor iedereen" : "Verbergen lukte niet.");
        onDone();
      }}
      className={actionClass}
    >
      <EyeOff size={14} aria-hidden="true" /> Verberg · admin
    </button>
  );
}

/** One row of others: what it is, about whom, how many readers have it, and "Neem over". */
export function SharedRow({ group, have, onNavigate }: { group: SharedGroup; have: boolean; onNavigate?: () => void }) {
  const { exploration, numbers, adopt, toFinding } = useExplore();
  const [open, setOpen] = useState(false);
  const { lead } = group;
  const demo = exploration.input.event.isDemo;
  const { refresh } = useShared();
  const own = useExploreStore((state) => state.own[String(exploration.input.event.id)]);
  const copy = (own ?? []).find((entry) => entry.from && group.entries.some((item) => String(item.id) === entry.from));
  // A speaker needs their outlet in this news (a source you do not have yet is missing)
  const missingOutlet =
    lead.kind === "speaker" && !(lead.anchor?.startsWith("outlet:") && exploration.index.outlet(lead.anchor.slice("outlet:".length)));
  const about = lead.about ? exploration.findingById.get(lead.about) : undefined;
  const aboutMarker = about ? markerTypeOf(about) : null;
  const aboutNumber = about ? numbers.get(about.id) : undefined;
  const sides = [lead.anchor, lead.against].filter((anchor): anchor is string => Boolean(anchor));
  const link = lead.url ? hrefOf(lead.url) : null;

  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="pt-0.5">
          <KindSign entry={lead} />
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="block w-full text-left">
            <span className="block text-xs font-semibold text-ink-500">{kindLine(lead)}</span>
            <span className={`block text-sm leading-snug text-ink-900 ${lead.kind === "claim" || lead.kind === "fallacy" ? "italic" : ""}`}>
              {truncate(lead.text, open ? 300 : 160)}
            </span>
          </button>
          {/* Not inside the button: the names in it open their balloon. A tap elsewhere on the line opens the row. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-500" onClick={() => setOpen((value) => !value)}>
            {about ? (
              <span className="inline-flex items-center gap-1">
                over
                {aboutMarker && aboutNumber ? (
                  <Badge type={aboutMarker} number={aboutNumber} small />
                ) : (
                  <span className="font-semibold text-ink-700">{truncate(findingTitle(about, exploration.index), 40)}</span>
                )}
              </span>
            ) : null}
            {sides.map((anchor, i) => (
              <span key={anchor} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span aria-label="tegenover">⚡</span> : null}
                <AnchorInline anchor={anchor} plain={Boolean(onNavigate)} />
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <Users size={12} aria-hidden="true" /> {group.readers} {group.readers === 1 ? "lezer" : "lezers"}
            </span>
            {group.mine ? <span className="rounded-full border border-ink-300 px-1.5 text-[10px] font-semibold leading-4 text-ink-700">jij ook</span> : null}
          </div>
        </div>
        {copy || (group.adopted && !have) ? (
          <button
            type="button"
            onClick={() => {
              if (!copy) return;
              onNavigate?.();
              toFinding(copy.id);
            }}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold text-teal-800"
          >
            <Check size={14} aria-hidden="true" /> Overgenomen
          </button>
        ) : group.mine || have ? (
          <span className="inline-flex min-h-[36px] shrink-0 items-center gap-1 px-1 text-xs font-semibold text-ink-500">
            <Check size={14} aria-hidden="true" /> Heb je al
          </span>
        ) : (
          <button
            type="button"
            disabled={missingOutlet}
            onClick={() => adopt(lead)}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-ink-900 bg-white px-3 text-xs font-semibold text-ink-900 hover:bg-paper-100 disabled:opacity-40"
          >
            <Plus size={14} aria-hidden="true" /> Neem over
          </button>
        )}
      </div>
      {open ? (
        <div className="space-y-2 pb-1 pl-[34px] pt-2">
          {lead.quote ? <p className="text-sm italic leading-relaxed text-ink-800">{lead.quote}</p> : null}
          {lead.detail ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">{lead.detail}</p> : null}
          {lead.url ? (
            link && !demo ? (
              <a href={link} target="_blank" rel="nofollow ugc noopener noreferrer" className="inline-flex min-h-[36px] items-center gap-1.5 text-sm font-semibold text-accent-blue">
                {lead.kind === "source" && lead.title ? truncate(lead.title, 120) : `Bron: ${urlHost(lead.url)}`}
                <span className="text-xs font-normal text-ink-500">{lead.kind === "source" && lead.title ? urlHost(lead.url) : null}</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : (
              // Demo: these sources do not exist
              <p className="text-sm text-ink-500">{lead.kind === "source" && lead.title ? `${truncate(lead.title, 120)} · ${urlHost(lead.url)}` : `Bron: ${urlHost(lead.url)}`}</p>
            )
          ) : null}
          {missingOutlet ? <p className="text-xs text-ink-500">Bij een bron die jij nog niet hebt.</p> : null}
          <div className="flex flex-wrap gap-2">
            {group.mine ? null : <Report entry={lead} onDone={refresh} />}
            <AdminHide entry={lead} onDone={refresh} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** The kinds you can filter on in a tab (only when there is more than one). */
function kindsOf(groups: SharedGroup[]): OwnKind[] {
  return Array.from(new Set(groups.map((group) => group.lead.kind)));
}

/**
 * Under a tab: "Van anderen · n", closed until you open it. Then search, filter on kind, order by
 * how many readers have it or by what is new, and take over what you find good.
 */
export function OthersSection({ tab }: { tab: TabId }) {
  const { exploration } = useExplore();
  const { groups, have, available } = useSharedGroups();
  const open = useFocusStore((state) => state.othersOpen);
  const setOpen = useFocusStore((state) => state.setOthersOpen);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<OwnKind | null>(null);
  const [order, setOrder] = useState<SharedOrder>("lezers");
  const [all, setAll] = useState(false);
  const inTab = useMemo(() => groupsInTab(groups, tab), [groups, tab]);
  const kinds = kindsOf(inTab);
  const describe = (entry: SharedEntry) => [describeAnchor(entry.anchor, exploration), describeAnchor(entry.against, exploration)].filter(Boolean).join(" ");
  const shown = sortGroups(
    inTab.filter((group) => (!kind || group.lead.kind === kind) && matchesQuery(group, query, describe)),
    order,
  );
  if (!available || inTab.length === 0) return null;

  return (
    <section aria-label="Van anderen" className="mt-4 border-t border-paper-200 pt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-[44px] w-full items-center gap-2 text-left">
        <Users size={16} className="text-ink-500" aria-hidden="true" />
        <span className="text-sm font-semibold text-ink-900">Van anderen</span>
        <span className="text-xs text-ink-400">{inTab.length}</span>
        <ChevronDown size={18} className={`ml-auto text-ink-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="space-y-2">
          {inTab.length > 4 ? (
            <label className="flex items-center gap-2 rounded-xl border border-paper-300 bg-paper-50 px-3">
              <Search size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Zoek"
                aria-label="Zoek in wat anderen deelden"
                className="min-h-[40px] w-full bg-transparent text-base text-ink-900 focus:outline-none sm:text-sm"
              />
            </label>
          ) : null}
          {kinds.length > 1 && inTab.length > 3 ? (
            <ScrollRow className="-mx-1 gap-1.5 px-1 pb-1">
              {[null, ...kinds].map((item) => (
                  <button
                    key={item ?? "alles"}
                    type="button"
                    aria-pressed={kind === item}
                    onClick={() => setKind(item)}
                    className={`min-h-[36px] shrink-0 rounded-full border px-3 text-xs font-semibold ${
                      kind === item ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 bg-paper-50 text-ink-700"
                    }`}
                  >
                    {item ? OWN_KIND_LABELS[item] : "Alles"}
                  </button>
              ))}
            </ScrollRow>
          ) : null}
          {inTab.length > 2 ? (
            <div className="flex justify-end">
              <span role="radiogroup" aria-label="Volgorde" className="flex rounded-full border border-paper-300 bg-paper-50 p-0.5 text-xs font-semibold">
                {(
                  [
                    { id: "lezers", label: "Meeste lezers" },
                    { id: "nieuw", label: "Nieuwste" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={order === option.id}
                    onClick={() => setOrder(option.id)}
                    className={`min-h-[32px] rounded-full px-2.5 ${order === option.id ? "bg-ink-900 text-white" : "text-ink-600"}`}
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            </div>
          ) : null}
          {shown.length ? (
            <ul className="divide-y divide-paper-200">
              {(all ? shown : shown.slice(0, FIRST)).map((group) => (
                <SharedRow key={group.key} group={group} have={have.has(group.key)} />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-ink-500">Niets gevonden.</p>
          )}
          {!all && shown.length > FIRST ? (
            <button type="button" onClick={() => setAll(true)} className="min-h-[40px] text-sm font-semibold text-accent-blue">
              Nog {shown.length - FIRST}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** In a popover: what others shared about this speaker or outlet; the rest is in the tabs. */
export function OthersAbout({ anchor, onNavigate }: { anchor: string; onNavigate?: () => void }) {
  const { groups, have, available } = useSharedGroups();
  const setOthersOpen = useFocusStore((state) => state.setOthersOpen);
  const setPref = useExploreStore((state) => state.setPref);
  const about = useMemo(() => sortGroups(groupsAbout(groups, anchor), "lezers"), [anchor, groups]);
  if (!available || about.length === 0) return null;
  const tab = OWN_KINDS[about[0].lead.kind].tab;
  return (
    <div className="space-y-1">
      <SubHeading className="flex items-center gap-1.5">
        <Users size={14} aria-hidden="true" /> Van anderen
      </SubHeading>
      <ul className="divide-y divide-paper-200">
        {about.slice(0, 3).map((group) => (
          <SharedRow key={group.key} group={group} have={have.has(group.key)} onNavigate={onNavigate} />
        ))}
      </ul>
      {about.length > 3 ? (
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            setOthersOpen(true);
            setPref("findingsTab", tab);
          }}
          className="inline-flex min-h-[40px] items-center gap-1 text-sm font-semibold text-accent-blue"
        >
          Nog {about.length - 3} <ChevronRight size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** On what you added: "Deel", or that you share it, how many readers took it over, and "Niet meer delen". */
export function ShareControl({ entry, compact = false }: { entry: OwnEntry; compact?: boolean }) {
  const { share, unshare } = useExplore();
  const { entries, available } = useShared();
  const [busy, setBusy] = useState(false);
  if (!available || entry.from) return null;
  const shared = entries.find((item) => item.mine && item.own_id === entry.id);
  if (!entry.sharedAt) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await share(entry.id);
          setBusy(false);
        }}
        className={compact ? "min-h-[36px] px-1.5 text-xs font-semibold text-accent-blue" : actionClass}
      >
        {compact ? null : <Share2 size={14} aria-hidden="true" />} Deel
      </button>
    );
  }
  return (
    <button type="button" onClick={() => void unshare(entry.id)} className={compact ? "min-h-[36px] px-1.5 text-xs font-semibold text-ink-600" : actionClass}>
      {compact ? null : <Share2 size={14} aria-hidden="true" />} Niet meer delen
      {shared?.hidden ? <span className="sr-only"> (verborgen)</span> : null}
    </button>
  );
}

/** "gedeeld · 3 lezers" (or hidden after reports) on an entry you shared. */
export function SharedTag({ entry }: { entry: OwnEntry }) {
  const { entries, available } = useShared();
  if (!available || !entry.sharedAt) return null;
  const shared = entries.find((item) => item.mine && item.own_id === entry.id);
  if (shared?.hidden) {
    return <span className="rounded-full bg-red-50 px-1.5 text-[10px] font-semibold leading-4 text-red-800">verborgen na meldingen</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-1.5 text-[10px] font-semibold leading-4 text-sky-800">
      <Share2 size={10} aria-hidden="true" /> gedeeld
      {shared?.adopted ? ` · ${shared.adopted} ${shared.adopted === 1 ? "lezer" : "lezers"}` : ""}
    </span>
  );
}
