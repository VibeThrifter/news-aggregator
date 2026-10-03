"use client";

import { ChevronRight, FileText, MicOff, Pin, Plus, Sparkles, UserSearch } from "lucide-react";

import { useFocusStore } from "@/lib/explore/focus";
import { findingLabel, findingTitle } from "@/lib/explore/findings";
import { OWN_KINDS, ownEntryOf } from "@/lib/explore/own";
import { initials, type Speaker } from "@/lib/explore/speakers";
import { truncate } from "@/lib/explore/summary";

import { dossierIds, useExplore } from "../ExploreContext";
import { EntityText } from "../entity/EntityText";
import { Chip, Eyebrow, Favicon, Tag } from "../ui/primitives";
import { NumberBadge } from "./Markers";
import { FoundTag, OwnTag } from "./OwnForm";
import { FoundVoices, VoiceSearchCompact } from "./VoiceSearch";

const KIND_COLORS: Record<Speaker["kind"], string> = {
  person: "#1F75CE",
  org: "#b7791f",
  group: "#64748b",
  anonymous: "#94a3b8",
};

/** Round avatar with initials (people blue, organisations amber, groups grey). */
export function Avatar({ speaker, size = 28 }: { speaker: Pick<Speaker, "name" | "kind">; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, backgroundColor: KIND_COLORS[speaker.kind] }}
    >
      {speaker.kind === "anonymous" ? "?" : initials(speaker.name)}
    </span>
  );
}

/** "Pas aan · Verwijder" for an entry of your own (the form opens in its row). */
export function OwnManage({ id, onNavigate }: { id: string; onNavigate?: () => void }) {
  const { toFinding, removeOwn } = useExplore();
  const setEditing = useFocusStore((state) => state.setEditing);
  return (
    <p className="flex items-center gap-1 text-xs">
      <OwnTag />
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          setEditing(id);
          toFinding(id);
        }}
        className="min-h-[36px] px-1.5 font-semibold text-accent-blue"
      >
        Pas aan
      </button>
      <span aria-hidden="true" className="text-ink-300">
        ·
      </span>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          removeOwn(id);
        }}
        className="min-h-[36px] px-1.5 font-semibold text-red-700"
      >
        Verwijder
      </button>
    </p>
  );
}

/** What you added that hangs on this speaker or outlet, numbered; a tap opens it in its tab. */
export function OwnAbout({ anchor, onNavigate }: { anchor: string; onNavigate?: () => void }) {
  const { exploration, anchorOf, toFinding } = useExplore();
  const own = exploration.findings.filter((finding) => finding.type === "own" && anchorOf.get(finding.id) === anchor);
  if (own.length === 0) return null;
  return (
    <div className="space-y-1">
      <Eyebrow>Van jou</Eyebrow>
      <ul className="space-y-1">
        {own.map((finding) => {
          const entry = ownEntryOf(finding);
          const marker = entry ? OWN_KINDS[entry.kind].marker : null;
          return entry ? (
            <li key={finding.id}>
              <button
                type="button"
                onClick={() => {
                  onNavigate?.();
                  toFinding(finding.id);
                }}
                className="flex min-h-[44px] w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-paper-100"
              >
                {marker ? <NumberBadge findingId={finding.id} type={marker} /> : null}
                <span className={`flex-1 text-ink-800 ${entry.kind === "claim" ? "italic" : ""}`}>{truncate(entry.text, 160)}</span>
                <ChevronRight size={14} className="mt-1 shrink-0 text-ink-400" aria-hidden="true" />
              </button>
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}

/** A speaker in this news: who they are, what they claim, their interests, and where to go next. */
export function SpeakerCard({ speakerId, onNavigate, inSheet = false }: { speakerId: string; onNavigate?: () => void; inSheet?: boolean }) {
  const { exploration, panel, pin, isPinned, toFinding, compose } = useExplore();
  const speaker = exploration.speakers.byId.get(speakerId);
  if (!speaker) return null;
  const outlet = exploration.index.outlet(speaker.outletKey);
  const authority = speaker.authorityId ? exploration.findingById.get(speaker.authorityId) : undefined;
  const a = authority?.body.type === "authority" ? authority.body.authority : null;
  const claims = speaker.claimIds.map((id) => exploration.findingById.get(id)).filter((finding) => finding?.body.type === "claim");
  const pinId = speaker.entityKey ? dossierIds.entity(speaker.entityKey) : dossierIds.actor(speaker.slug);
  const anchor = `speaker:${speaker.id}`;

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-3 ${inSheet ? "hidden" : ""}`}>
        <Avatar speaker={speaker} size={36} />
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-ink-900">{speaker.name}</p>
          <p className="text-xs text-ink-500">{[speaker.role, speaker.org].filter(Boolean).join(" · ") || "In dit nieuws"}</p>
        </div>
      </div>
      {speaker.ownId ? <OwnManage id={speaker.ownId} onNavigate={onNavigate} /> : null}

      {outlet ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-700">
          Aan het woord bij <Favicon name={outlet.name} domain={outlet.domain} size={16} />
          <strong className="font-semibold">{outlet.name}</strong>
          {speaker.via ? <span className="text-ink-500">via {speaker.via}</span> : null}
        </p>
      ) : null}

      {speaker.quote ? <p className="text-sm italic leading-relaxed text-ink-800">{speaker.quote}</p> : null}
      {speaker.found ? (
        <div className="space-y-1.5 rounded-xl bg-teal-50 p-2.5 text-sm text-teal-900">
          <p className="flex flex-wrap items-center gap-1.5">
            <FoundTag /> <Sparkles size={12} aria-hidden="true" /> Gezocht als ontbrekende stem: <strong className="font-semibold">{speaker.found.perspective}</strong>
          </p>
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              panel.open(`artikel:${speaker.found?.articleId}`);
            }}
            className="inline-flex min-h-[36px] items-center gap-1.5 font-semibold text-accent-blue"
          >
            <FileText size={14} aria-hidden="true" /> Het artikel
          </button>
        </div>
      ) : null}

      {claims.length ? (
        <div className="space-y-1">
          <Eyebrow>Beweert, zonder bewijs</Eyebrow>
          <ul className="space-y-1">
            {claims.map((finding) =>
              finding && finding.body.type === "claim" ? (
                <li key={finding.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate?.();
                      toFinding(finding.id);
                    }}
                    className="flex min-h-[44px] w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-paper-100"
                  >
                    <NumberBadge findingId={finding.id} type="claim" />
                    <span className="flex-1 italic text-ink-800">{truncate(finding.body.claim.claim, 160)}</span>
                    <ChevronRight size={14} className="mt-1 shrink-0 text-ink-400" aria-hidden="true" />
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ) : null}

      {a ? (
        <div className="space-y-1.5 text-sm">
          <Eyebrow>Belang</Eyebrow>
          {a.actual_role ? (
            <p className="text-ink-800">
              <EntityText text={a.actual_role} />
            </p>
          ) : null}
          {a.funding_sources ? (
            <p className="text-ink-700">
              <span className="text-ink-500">Betaald door: </span>
              <EntityText text={a.funding_sources} />
            </p>
          ) : null}
          {a.independence_check ? (
            <p className="text-ink-700">
              <span className="text-ink-500">Onafhankelijk? </span>
              <EntityText text={a.independence_check} />
            </p>
          ) : null}
          {a.potential_interests?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {a.potential_interests.slice(0, 4).map((interest) => (
                <Tag key={interest} tone="orange">
                  {interest}
                </Tag>
              ))}
            </div>
          ) : null}
          {authority ? (
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                toFinding(authority.id);
              }}
              className="min-h-[40px] text-sm font-semibold text-accent-blue"
            >
              Alles over deze bron in Wie praat?
            </button>
          ) : null}
        </div>
      ) : null}

      <OwnAbout anchor={anchor} onNavigate={onNavigate} />

      <div className={`flex flex-wrap gap-2 ${inSheet ? "hidden" : ""}`}>
        {speaker.kind !== "anonymous" ? (
          <Chip
            tone="blue"
            icon={<UserSearch size={14} />}
            onClick={() => {
              onNavigate?.();
              panel.open(`entiteit:${speaker.entityKey ? speaker.entityKey : speaker.slug}`, {
                n: speaker.name,
                k: speaker.kind === "person" ? "person" : speaker.kind === "org" ? "org" : null,
              });
            }}
          >
            Meer over {truncate(speaker.name, 28)}
          </Chip>
        ) : null}
        {speaker.kind !== "anonymous" ? (
          <Chip
            icon={<Pin size={14} />}
            aria-pressed={isPinned(pinId)}
            onClick={() =>
              pin({
                id: pinId,
                kind: speaker.entityKey ? "entity" : "actor",
                eventId: null,
                refId: speaker.entityKey ?? speaker.slug,
                title: speaker.name,
                subtitle: speaker.role ?? undefined,
                keys: [`actor:${speaker.slug}`, `alias:${speaker.slug}`, ...(speaker.entityKey ? [`entity:${speaker.entityKey}`] : [])],
              })
            }
          >
            {isPinned(pinId) ? "Bewaard" : "Bewaar"}
          </Chip>
        ) : null}
        {(["claim", "question"] as const).map((kind) => (
          <Chip
            key={kind}
            icon={<Plus size={14} />}
            onClick={() => {
              onNavigate?.();
              compose(kind, anchor);
            }}
          >
            {kind === "claim" ? "Twijfel" : "Vraag"}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** A voice that is missing from the coverage. */
export function GhostCard({ findingId, onNavigate }: { findingId: string; onNavigate?: () => void }) {
  const { exploration, pin, isPinned, eventId } = useExplore();
  const finding = exploration.findingById.get(findingId);
  const entry = ownEntryOf(finding);
  if (finding && entry?.kind === "gap") return <OwnGhostCard findingId={finding.id} onNavigate={onNavigate} />;
  if (!finding || finding.body.type !== "gap") return null;
  const gap = finding.body.gap;
  const pinId = dossierIds.finding(eventId, finding.id);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-teal-600 text-teal-700">
          <MicOff size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-ink-900">{gap.perspective}</p>
          <p className="text-xs text-ink-500">Niet aan het woord</p>
        </div>
        <NumberBadge findingId={finding.id} type="gap" />
      </div>
      <p className="text-sm leading-relaxed text-ink-800">
        <EntityText text={gap.description} />
      </p>
      {gap.relevance ? (
        <p className="text-sm text-ink-700">
          <span className="text-ink-500">Waarom het ertoe doet: </span>
          <EntityText text={gap.relevance} />
        </p>
      ) : null}
      {gap.potential_sources?.length ? (
        <div className="space-y-1">
          <Eyebrow>Wie had het kunnen zeggen</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {gap.potential_sources.map((source) => (
              <Tag key={source}>{source}</Tag>
            ))}
          </div>
        </div>
      ) : null}
      <FoundVoices findingId={finding.id} label={gap.perspective} onNavigate={onNavigate} />
      <VoiceSearchCompact
        target={{ findingId: finding.id, perspective: gap.perspective, context: [gap.description, gap.relevance].filter(Boolean).join(" "), origin: "analyse" }}
        onNavigate={onNavigate}
      />
      <Chip
        icon={<Pin size={14} />}
        aria-pressed={isPinned(pinId)}
        onClick={() =>
          pin({
            id: pinId,
            kind: "finding",
            refId: finding.id,
            findingId: finding.id,
            tab: finding.tab,
            title: truncate(findingTitle(finding, exploration.index), 90),
            subtitle: findingLabel(finding),
            keys: finding.links,
          })
        }
      >
        {isPinned(pinId) ? "Bewaard" : "Bewaar"}
      </Chip>
    </div>
  );
}

/** A missing voice the reader added. */
function OwnGhostCard({ findingId, onNavigate }: { findingId: string; onNavigate?: () => void }) {
  const { exploration, pin, isPinned, eventId } = useExplore();
  const finding = exploration.findingById.get(findingId);
  const entry = ownEntryOf(finding);
  if (!finding || !entry) return null;
  const pinId = dossierIds.finding(eventId, finding.id);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-teal-600 text-teal-700">
          <MicOff size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-ink-900">{entry.text}</p>
          <p className="text-xs text-ink-500">Niet aan het woord</p>
        </div>
        <NumberBadge findingId={finding.id} type="gap" />
      </div>
      <OwnManage id={finding.id} onNavigate={onNavigate} />
      {entry.detail ? (
        <p className="whitespace-pre-line text-sm text-ink-700">
          <span className="text-ink-500">Waarom het ertoe doet: </span>
          {entry.detail}
        </p>
      ) : null}
      <FoundVoices findingId={finding.id} label={entry.text} onNavigate={onNavigate} />
      <VoiceSearchCompact target={{ findingId: finding.id, perspective: entry.text, context: entry.detail ?? null, origin: "eigen" }} onNavigate={onNavigate} />
      <Chip
        icon={<Pin size={14} />}
        aria-pressed={isPinned(pinId)}
        onClick={() =>
          pin({
            id: pinId,
            kind: "finding",
            refId: finding.id,
            findingId: finding.id,
            tab: finding.tab,
            title: truncate(entry.text, 90),
            subtitle: `${findingLabel(finding)} · jij`,
            text: entry.detail,
            keys: finding.links,
          })
        }
      >
        {isPinned(pinId) ? "Bewaard" : "Bewaar"}
      </Chip>
    </div>
  );
}
