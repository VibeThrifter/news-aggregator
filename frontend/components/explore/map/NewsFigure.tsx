"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff } from "lucide-react";

import { isOutletShown } from "@/lib/explore/layout/bubbles";
import {
  buildFigure,
  gapAnchor,
  outletAnchor,
  speakerAnchor,
  type ContradictionLine,
  type FigureGroup,
  type FoundSpeakerRef,
  type Marker,
  type OutletBalloonModel,
} from "@/lib/explore/figure";
import { useFocusStore } from "@/lib/explore/focus";
import { ownEntryOf, sourceOutletKey } from "@/lib/explore/own";
import type { Speaker } from "@/lib/explore/speakers";
import { useExploreStore } from "@/lib/explore/store";
import { truncate } from "@/lib/explore/summary";
import type { ExploreOutlet, OwnKind } from "@/lib/explore/types";
import { getCountryFlag } from "@/lib/format";

import { useExplore } from "../ExploreContext";
import { OutletCard } from "../outlet/OutletCard";
import { Balloon } from "../ui/Balloon";
import { Favicon } from "../ui/primitives";
import { Badge, MarkerButton, useFocusRing } from "./Markers";
import { AddButton, FoundTag, OwnForm, OwnTag } from "./OwnForm";
import { Avatar, GhostCard, SpeakerCard } from "./PeopleCards";
import { SpectrumMap } from "./SpectrumMap";
import { ScrollRow } from "../ui/ScrollRow";

const RING = "ring-4 ring-amber-300 ring-offset-2";

/** "Wie zegt wat?": outlets, the speakers they give the word to and the voices that are missing. */
export function NewsFigure() {
  const { exploration, eventId } = useExplore();
  const { input } = exploration;
  const sources = useExploreStore((state) => state.events[String(eventId)]?.sources);
  const setOutletShown = useExploreStore((state) => state.setOutletShown);
  const mapMode = useExploreStore((state) => state.prefs.mapMode);
  const setPref = useExploreStore((state) => state.setPref);

  const shown = useCallback((outlet: ExploreOutlet) => isOutletShown(outlet, sources), [sources]);
  const figure = useMemo(() => buildFigure(exploration, shown), [exploration, shown]);
  const placed = input.outlets.filter((outlet) => shown(outlet) && (outlet.x !== null || outlet.establishment !== null));
  const spectrumAvailable = placed.length >= 3;
  const spectrum = spectrumAvailable && mapMode === "spectrum";
  const outlets = useMemo(() => [...input.outlets, ...(exploration.ownOutlets ?? [])], [exploration.ownOutlets, input.outlets]);
  const [addingSource, setAddingSource] = useState(false);
  const focus = useFocusStore((state) => state.focus);

  if (input.outlets.length === 0 && figure.groups.length === 0) return null;

  return (
    <section aria-labelledby="figure-title" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h2 id="figure-title" className="font-serif text-xl font-bold text-ink-900">
          Wie zegt wat?
        </h2>
        {spectrumAvailable ? (
          <div role="radiogroup" aria-label="Weergave" className="flex rounded-full border border-paper-300 bg-paper-50 p-0.5 text-xs font-semibold">
            {[
              { id: "auto" as const, label: "Gesprek" },
              { id: "spectrum" as const, label: "Links/rechts" },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={mapMode === option.id}
                onClick={() => setPref("mapMode", option.id)}
                className={`min-h-[36px] rounded-full px-3 ${mapMode === option.id ? "bg-ink-900 text-white" : "text-ink-600"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {outlets.length > 1 ? (
        <SourcePicker
          outlets={outlets}
          isShown={shown}
          onToggle={(outlet) => setOutletShown(eventId, outlet, !shown(outlet))}
          add={addingSource ? null : <AddButton small onClick={() => setAddingSource(true)}>Bron</AddButton>}
        />
      ) : addingSource ? null : (
        <AddButton small onClick={() => setAddingSource(true)}>
          Bron
        </AddButton>
      )}
      {addingSource ? (
        <OwnForm
          kind="source"
          onCancel={() => setAddingSource(false)}
          onDone={(entry) => {
            setAddingSource(false);
            const key = sourceOutletKey(entry.url);
            if (key) focus("anchor", outletAnchor(key));
          }}
        />
      ) : null}

      {spectrum ? (
        <SpectrumMap shown={shown} />
      ) : (
        <FigureCanvas groups={figure.groups} markers={figure.markers} contradictions={figure.contradictions} />
      )}
    </section>
  );
}

function FigureCanvas({
  groups,
  markers,
  contradictions,
}: {
  groups: FigureGroup[];
  markers: Map<string, Marker[]>;
  contradictions: ContradictionLine[];
}) {
  const container = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={container} className="relative space-y-3">
      {groups.map((group) => (
        <GroupView key={group.key} group={group} markers={markers} />
      ))}
      {contradictions.length ? <ContradictionLines container={container} lines={contradictions} /> : null}
    </div>
  );
}

function GroupView({ group, markers }: { group: FigureGroup; markers: Map<string, Marker[]> }) {
  const { exploration } = useExplore();
  const missing = group.kind === "missing";
  return (
    <motion.section
      initial={false}
      aria-label={group.label}
      className={`rounded-3xl border-2 p-3 ${missing ? "border-dashed" : ""}`}
      style={{ borderColor: `${group.color}${missing ? "88" : "55"}`, backgroundColor: `${group.color}0d` }}
    >
      <GroupHeader group={group} />
      {group.kind === "outlet" ? (
        <div className="mt-2 space-y-2">
          {group.outlets.map((balloon) => (
            <OutletBalloon key={balloon.anchor} balloon={balloon} markers={markers} color={group.color} wide />
          ))}
          <SpeakerList
            speakers={group.speakers}
            markers={markers}
            add={group.outlets[0] ? <FigureAdd kind="speaker" anchor={group.outlets[0].anchor} label="Spreker" /> : null}
          />
        </div>
      ) : null}
      {group.kind === "perspective" || group.kind === "unclassified" || group.kind === "own" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {group.outlets.map((balloon) => (
            <OutletBalloon key={balloon.anchor} balloon={balloon} markers={markers} color={group.color} />
          ))}
        </div>
      ) : null}
      {group.kind === "foreign" ? (
        <div className="mt-2 space-y-2">
          {group.outlets.map((balloon) => (
            <OutletBalloon key={balloon.anchor} balloon={balloon} markers={markers} color={group.color} wide />
          ))}
          {/* A missing voice found abroad speaks here too */}
          <SpeakerList speakers={group.outlets.flatMap((balloon) => balloon.speakers.filter((speaker) => speaker.found))} markers={markers} />
        </div>
      ) : null}
      {missing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {group.ghosts.map((ghost) => (
            <GhostPill
              key={ghost.anchor}
              anchor={ghost.anchor}
              findingId={ghost.findingId}
              label={ghost.label}
              own={ghost.own}
              found={ghost.found}
              markers={markers}
            />
          ))}
          <FigureAdd kind="gap" label="Toevoegen" />
        </div>
      ) : null}
      {group.kind === "outlet" && group.speakers.length === 0 && group.outlets[0]?.textKind === "none" && exploration.input.insight === null ? (
        <p className="mt-2 text-xs text-ink-500">Nog niet geanalyseerd</p>
      ) : null}
    </motion.section>
  );
}

function GroupHeader({ group }: { group: FigureGroup }) {
  const { exploration } = useExplore();
  if (group.kind === "outlet") {
    const outlet = exploration.index.outlet(group.outlets[0]?.outletKey ?? "");
    const meta = [group.meta?.time, group.meta?.tone, group.meta?.frames.join(", ")].filter(Boolean);
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-600">
        {outlet ? <Favicon name={outlet.name} domain={outlet.domain} size={16} /> : null}
        <strong className="text-sm font-semibold text-ink-900">{group.label}</strong>
        {meta.map((item) => (
          <span key={item} className="before:mr-1.5 before:content-['·']">
            {item}
          </span>
        ))}
        {group.own ? <OwnTag /> : null}
      </p>
    );
  }
  if (group.kind === "missing") {
    return (
      <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-800">
        <MicOff size={14} aria-hidden="true" /> {group.label}
      </p>
    );
  }
  return (
    <span
      className="inline-block rounded-[10px] px-2 py-0.5 text-[11px] font-semibold leading-tight text-white"
      style={{ backgroundColor: group.color }}
    >
      {group.label}
    </span>
  );
}

function MarkerRow({ list }: { list: Marker[] | undefined }) {
  if (!list?.length) return null;
  return (
    <span className="absolute -top-2.5 right-2 z-10 flex gap-1">
      {list.slice(0, 4).map((marker) => (
        <MarkerButton key={marker.findingId} marker={marker} />
      ))}
      {list.length > 4 ? <span className="rounded-full bg-ink-900 px-1.5 text-[10px] font-bold leading-6 text-white">+{list.length - 4}</span> : null}
    </span>
  );
}

/** A balloon with a popover; rings when it is the target of a jump. */
function Anchored({
  anchor,
  label,
  card,
  children,
  markers,
  alsoFor = [],
  className = "",
}: {
  anchor: string;
  /** Other anchors this balloon stands for (speakers drawn as avatars in it) */
  alsoFor?: string[];
  label: string;
  card: (close: () => void) => ReactNode;
  children: ReactNode;
  /** Numbered markers: buttons of their own, so they sit next to (not inside) the balloon button */
  markers?: Marker[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { ref, ringing } = useFocusRing<HTMLDivElement>("anchor", alsoFor.length ? [anchor, ...alsoFor] : anchor);
  return (
    // z-10: above the contradiction lines (z-[5]), which run between the balloons
    <div ref={ref} data-anchor={anchor} className={`relative z-10 rounded-[20px] transition-shadow ${ringing ? RING : ""} ${className}`}>
      <Balloon label={label} open={open} onOpenChange={setOpen} content={card}>
        {({ ref: triggerRef, props }) => (
          <button ref={triggerRef} {...props} type="button" className="block w-full text-left">
            {children}
          </button>
        )}
      </Balloon>
      <MarkerRow list={markers} />
    </div>
  );
}

function OutletBalloon({ balloon, markers, color, wide = false }: { balloon: OutletBalloonModel; markers: Map<string, Marker[]>; color: string; wide?: boolean }) {
  const { exploration } = useExplore();
  const outlet = exploration.index.outlet(balloon.outletKey);
  if (!outlet) return null;
  const text = balloon.text ? truncate(balloon.text, wide ? 220 : 110) : null;
  return (
    <Anchored
      anchor={balloon.anchor}
      label={`Over ${outlet.name}`}
      card={(close) => <OutletCard outletKey={outlet.key} onNavigate={close} />}
      markers={markers.get(balloon.anchor)}
      alsoFor={wide ? [] : balloon.speakers.map((speaker) => `speaker:${speaker.id}`)}
    >
      <span
        className={`relative flex items-start gap-2 rounded-[20px] border-2 bg-white px-3 py-2 shadow-bubble ${balloon.estimated ? "border-dashed" : ""}`}
        style={{ borderColor: color }}
      >
        <Favicon name={outlet.name} domain={outlet.domain} size={20} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          {!wide || outlet.isInternational ? (
            <span className="flex items-center gap-1 truncate text-[12px] font-semibold text-ink-900">
              <span className="truncate">
                {outlet.name} {outlet.isInternational ? getCountryFlag(outlet.country) : ""}
              </span>
              {balloon.offDate ? <span className="font-normal text-ink-500">{balloon.offDate}</span> : null}
              {outlet.own ? <OwnTag /> : null}
            </span>
          ) : null}
          {text ? (
            <span className={`block text-[13px] leading-snug text-ink-800 ${wide ? "" : "line-clamp-3"}`}>{text}</span>
          ) : outlet.isInternational ? (
            <span className="block text-[12px] text-ink-500">alleen de kop</span>
          ) : (
            <span className="block text-[12px] text-ink-500">
              {outlet.articleIds.length} {outlet.articleIds.length === 1 ? "artikel" : "artikelen"}
            </span>
          )}
          {balloon.via.length || (!wide && balloon.speakers.length) ? (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {balloon.via.slice(0, 3).map((name) => (
                <span key={name} className="rounded-full bg-paper-100 px-1.5 text-[10px] font-semibold text-ink-600">
                  via {name}
                </span>
              ))}
              {!wide && balloon.speakers.length ? (
                <span className="flex -space-x-1.5" aria-label={`${balloon.speakers.length} sprekers`}>
                  {balloon.speakers.slice(0, 3).map((speaker) => (
                    <span key={speaker.id} className="rounded-full ring-2 ring-white">
                      <Avatar speaker={speaker} size={18} />
                    </span>
                  ))}
                  {balloon.speakers.length > 3 ? <span className="pl-2 text-[10px] font-semibold text-ink-500">+{balloon.speakers.length - 3}</span> : null}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="absolute -bottom-[7px] left-5 h-3 w-3 rotate-45 border-b-2 border-r-2 bg-white" style={{ borderColor: color }} />
      </span>
    </Anchored>
  );
}

/** "＋" in the picture: the form opens right there; what you add rings when it appears. */
function FigureAdd({ kind, anchor = null, label }: { kind: OwnKind; anchor?: string | null; label: string }) {
  const [open, setOpen] = useState(false);
  const focus = useFocusStore((state) => state.focus);
  if (!open) {
    return (
      <AddButton small onClick={() => setOpen(true)}>
        {label}
      </AddButton>
    );
  }
  return (
    <OwnForm
      kind={kind}
      anchor={anchor}
      onCancel={() => setOpen(false)}
      onDone={(entry) => {
        setOpen(false);
        const outletKey = entry.anchor?.startsWith("outlet:") ? entry.anchor.slice("outlet:".length) : null;
        if (kind === "gap") focus("anchor", gapAnchor(entry.id));
        else if (outletKey) focus("anchor", speakerAnchor(`${outletKey}:${entry.id}`));
      }}
    />
  );
}

function SpeakerList({ speakers, markers, add }: { speakers: Speaker[]; markers: Map<string, Marker[]>; add?: ReactNode }) {
  // Speakers with something to say are balloons (a claim, or what the reader wrote down), the rest pills
  const talking = speakers.filter((speaker) => speaker.claimIds.length > 0 || speaker.quote);
  const others = speakers.filter((speaker) => speaker.claimIds.length === 0 && !speaker.quote);
  return (
    <>
      {talking.map((speaker, i) => (
        <SpeakerBalloon key={speaker.id} speaker={speaker} markers={markers} right={i % 2 === 0} />
      ))}
      {others.length || add ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {others.map((speaker) => (
            <SpeakerPill key={speaker.id} speaker={speaker} markers={markers} />
          ))}
          {add}
        </div>
      ) : null}
    </>
  );
}

/** A speaker the reader took over from another reader */
function useAdopted(ownId: string | undefined | null): boolean {
  const { exploration } = useExplore();
  return Boolean(ownId && ownEntryOf(exploration.findingById.get(ownId))?.from);
}

function SpeakerBalloon({ speaker, markers, right }: { speaker: Speaker; markers: Map<string, Marker[]>; right: boolean }) {
  const { exploration } = useExplore();
  const adopted = useAdopted(speaker.ownId);
  const anchor = `speaker:${speaker.id}`;
  const claim = exploration.findingById.get(speaker.claimIds[0]);
  const text = claim?.body.type === "claim" ? claim.body.claim.claim : (speaker.quote ?? null);
  return (
    <div className={`w-[88%] ${right ? "ml-auto" : ""}`}>
      <Anchored
        anchor={anchor}
        label={`Over ${speaker.name}`}
        card={(close) => <SpeakerCard speakerId={speaker.id} onNavigate={close} />}
        markers={markers.get(anchor)}
      >
        <span className="relative flex items-start gap-2 rounded-[20px] border border-paper-300 bg-white px-3 py-2 shadow-bubble">
          <Avatar speaker={speaker} size={26} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-tight">
              <strong className="font-semibold text-ink-900">{speaker.name}</strong>
              {speaker.org || speaker.role ? <span className="text-ink-500">{truncate(speaker.org ?? speaker.role ?? "", 40)}</span> : null}
              {speaker.via ? <span className="text-ink-500">via {speaker.via}</span> : null}
              {speaker.interest ? <span className="rounded-full bg-orange-100 px-1.5 text-[10px] font-semibold text-orange-800">belang</span> : null}
              {speaker.ownId ? <OwnTag adopted={adopted} /> : null}
              {speaker.found ? <FoundTag /> : null}
            </span>
            {text ? <span className="mt-0.5 block text-[13px] italic leading-snug text-ink-800">{truncate(text, 170)}</span> : null}
          </span>
          <span
            aria-hidden="true"
            className={`absolute -bottom-[6px] h-2.5 w-2.5 rotate-45 border-b border-r border-paper-300 bg-white ${right ? "right-6" : "left-6"}`}
          />
        </span>
      </Anchored>
    </div>
  );
}

function SpeakerPill({ speaker, markers }: { speaker: Speaker; markers: Map<string, Marker[]> }) {
  const adopted = useAdopted(speaker.ownId);
  const anchor = speakerAnchor(speaker.id);
  return (
    <Anchored
      anchor={anchor}
      label={`Over ${speaker.name}`}
      card={(close) => <SpeakerCard speakerId={speaker.id} onNavigate={close} />}
      markers={markers.get(anchor)}
      className="rounded-full"
    >
      <span className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 bg-white py-1 pl-1 pr-3 text-[12px] shadow-sm">
        <Avatar speaker={speaker} size={24} />
        <span className="font-semibold text-ink-900">{truncate(speaker.name, 28)}</span>
        {speaker.role || speaker.org ? <span className="max-w-[9rem] truncate text-ink-500">{speaker.org ?? speaker.role}</span> : null}
        {speaker.interest ? <span className="rounded-full bg-orange-100 px-1.5 text-[10px] font-semibold text-orange-800">belang</span> : null}
        {speaker.ownId ? <OwnTag adopted={adopted} /> : null}
        {speaker.found ? <FoundTag /> : null}
      </span>
    </Anchored>
  );
}

function GhostPill({
  anchor,
  findingId,
  label,
  own = false,
  found = [],
  markers,
}: {
  anchor: string;
  findingId: string;
  label: string;
  own?: boolean;
  /** Where an AI search found this voice speaking after all */
  found?: FoundSpeakerRef[];
  markers: Map<string, Marker[]>;
}) {
  const { exploration } = useExplore();
  const adopted = useAdopted(own ? findingId : null);
  const marker = markers.get(anchor)?.[0];
  const foundAt = found.length ? exploration.index.outlet(found[0].outletKey) : null;
  return (
    <Anchored anchor={anchor} label={label} card={(close) => <GhostCard findingId={findingId} onNavigate={close} />} className="max-w-full rounded-2xl">
      <span className="flex min-h-[36px] max-w-full items-center gap-1.5 rounded-2xl border-2 border-dashed border-teal-600/50 bg-white/70 py-1 pl-2 pr-1.5 text-[12px] leading-snug text-ink-800">
        {foundAt ? (
          <Mic size={14} className="shrink-0 text-teal-700" aria-hidden="true" />
        ) : (
          <MicOff size={14} className="shrink-0 text-teal-700" aria-hidden="true" />
        )}
        <span className="line-clamp-2 min-w-0">
          {label}
          {foundAt ? (
            <span className="font-semibold text-teal-800">
              {" "}
              · wél bij {foundAt.name}
              {found.length > 1 ? ` +${found.length - 1}` : ""}
            </span>
          ) : null}
        </span>
        {own ? <OwnTag adopted={adopted} /> : null}
        {marker ? <Badge type="gap" number={marker.number} small own={own} /> : null}
      </span>
    </Anchored>
  );
}

/** Dashed red lines between outlets that contradict each other, with the numbered ⚡ in the middle. */
function ContradictionLines({
  container,
  lines,
}: {
  container: React.MutableRefObject<HTMLDivElement | null>;
  lines: ContradictionLine[];
}) {
  const [geometry, setGeometry] = useState<{ id: string; number: number; own: boolean; x1: number; y1: number; x2: number; y2: number }[]>([]);
  const measure = () => {
    const root = container.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const center = (anchor: string) => {
      const element = root.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 };
    };
    const next = lines.flatMap((line) => {
      const a = center(line.from);
      const b = center(line.to);
      return a && b
        ? [{ id: line.findingId, number: line.number, own: Boolean(line.own), x1: Math.round(a.x), y1: Math.round(a.y), x2: Math.round(b.x), y2: Math.round(b.y) }]
        : [];
    });
    // Only a real change re-renders (measuring after every render would never end)
    setGeometry((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [lines]);
  useEffect(() => {
    const root = container.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible" aria-hidden="true">
        {geometry.map((line) => (
          <line
            key={line.id}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="#E30613"
            strokeWidth={2.5}
            strokeDasharray={line.own ? "2 5" : "6 5"}
            strokeLinecap="round"
            opacity={0.75}
          />
        ))}
      </svg>
      {geometry.map((line) => (
        <span
          key={line.id}
          data-anchor={`contradiction:${line.id}`}
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: (line.x1 + line.x2) / 2, top: (line.y1 + line.y2) / 2 }}
        >
          <ContradictionButton findingId={line.id} number={line.number} own={line.own} />
        </span>
      ))}
    </>
  );
}

function ContradictionButton({ findingId, number, own }: { findingId: string; number: number; own: boolean }) {
  const { ref, ringing } = useFocusRing<HTMLSpanElement>("anchor", `contradiction:${findingId}`);
  return (
    <span ref={ref} className={`inline-block rounded-full ${ringing ? RING : ""}`}>
      <MarkerButton marker={{ findingId, number, type: "contradiction", ...(own ? { own } : {}) }} />
    </span>
  );
}

/**
 * Which outlets are in the picture: the Dutch ones by default; foreign ones can be added, Dutch
 * ones left out. Remembered per news item.
 */
function SourcePicker({
  outlets,
  isShown,
  onToggle,
  add,
}: {
  outlets: ExploreOutlet[];
  isShown: (outlet: ExploreOutlet) => boolean;
  onToggle: (outlet: ExploreOutlet) => void;
  /** "＋ Bron": a source of your own */
  add?: ReactNode;
}) {
  const dutch = outlets.filter((outlet) => !outlet.isInternational);
  const foreign = outlets.filter((outlet) => outlet.isInternational);
  const chip = (outlet: ExploreOutlet) => {
    const on = isShown(outlet);
    return (
      <button
        key={outlet.key}
        type="button"
        aria-pressed={on}
        onClick={() => onToggle(outlet)}
        className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors ${
          on ? "border-paper-300 bg-paper-50 text-ink-800 hover:bg-paper-100" : "border-dashed border-paper-300 text-ink-400 hover:text-ink-600"
        }`}
      >
        <span className={on ? "" : "opacity-40 grayscale"}>
          <Favicon name={outlet.name} domain={outlet.domain} size={16} />
        </span>
        {outlet.name}
        {outlet.isInternational && outlet.country ? <span aria-hidden="true">{getCountryFlag(outlet.country)}</span> : null}
        {outlet.own ? <OwnTag /> : null}
      </button>
    );
  };
  return (
    <ScrollRow role="group" aria-label="Bronnen in het beeld" className="-mx-1 items-center gap-1.5 px-1 pb-1">
      {dutch.map(chip)}
      {foreign.length ? (
        <span className="shrink-0 border-l border-paper-300 pl-2 text-xs font-medium text-ink-400">Buitenland</span>
      ) : null}
      {foreign.map(chip)}
      {add}
    </ScrollRow>
  );
}
