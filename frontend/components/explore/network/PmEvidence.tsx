"use client";

import useSWR from "swr";
import { ExternalLink } from "lucide-react";

import { relationResearchStatus } from "@/lib/api";
import {
  ARGUMENT_STATUS_LABELS,
  evidenceGaps,
  evidenceOf,
  evidenceSummary,
  fromParty,
  isChecked,
  researchNote,
  shortName,
  sourceLabel,
  VERDICT_LABELS,
  verdictOf,
} from "@/lib/explore/evidence";
import { labelSourceId, pmRelationLabel } from "@/lib/explore/labels";
import { exploreAuxSwrOptions } from "@/lib/swr-config";
import type { PmArgument, PmArgumentSource, PmDetails } from "@/lib/types";

import { Eyebrow, Tag } from "../ui/primitives";

type RelationEnds = Pick<PmDetails, "type" | "mechanism" | "source" | "target">;

/** The end a relation is read from (who has the influence, or the person of a tie) and the other */
function readEnds(details: RelationEnds) {
  const { source, target } = details;
  if (!source || !target || !details.type) return null;
  const relation = { source_id: source.id, target_id: target.id, relation_type: details.type, mechanism: details.mechanism ?? null };
  const first = labelSourceId(relation, (id) => (id === source.id ? source.type : target.type)) === source.id ? source : target;
  return { first, last: first === source ? target : source };
}

/** "RIVM is vaste bron voor NOS", "Heinen is lid van VVD": a relation as a sentence. Null without both ends. */
export function relationSentence(details: RelationEnds): string | null {
  const ends = readEnds(details);
  return ends && details.type ? `${ends.first.name} ${pmRelationLabel(details.type, details.mechanism)} ${ends.last.name}` : null;
}

export function ArgumentStatusTag({ status, checked = false }: { status: string; checked?: boolean }) {
  // Checked by the automatic review of the propaganda model (not by a person)
  if (checked && status !== "geverifieerd") return <Tag tone="green">automatisch gecontroleerd</Tag>;
  const known = ARGUMENT_STATUS_LABELS[status];
  return <Tag tone={known?.tone ?? "neutral"}>{known?.label ?? status.replace(/_/g, " ")}</Tag>;
}

function SourceItem({ source, party }: { source: PmArgumentSource; party?: string | null }) {
  const own = party && fromParty(source, party) ? `van ${shortName(party)} zelf` : null;
  return (
    <li className="rounded-xl border border-paper-300 bg-paper-50 p-2.5">
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-sm font-semibold text-accent-blue">
          {source.title || source.url}
          <ExternalLink size={12} className="mt-1 shrink-0" aria-hidden="true" />
        </a>
      ) : (
        <p className="text-sm font-semibold">{source.title}</p>
      )}
      <p className="text-xs text-ink-500">{[sourceLabel(source), own, source.checked ? "citaat teruggevonden" : null].filter(Boolean).join(" · ")}</p>
      {source.quote ? <p className="mt-1 text-xs italic text-ink-700">“{source.quote}”</p> : null}
    </li>
  );
}

function ArgumentItem({ argument, all, party, depth = 0 }: { argument: PmArgument; all: readonly PmArgument[]; party?: string | null; depth?: number }) {
  const replies = all.filter((reply) => reply.parent_id === argument.id);
  return (
    <li className={depth ? "border-l-2 border-paper-300 pl-3" : ""}>
      <div className="space-y-1.5">
        {depth ? <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{argument.stance === "contradicting" ? "Reactie: tegen" : argument.stance === "contextual" ? "Reactie: nuance" : "Reactie: steun"}</p> : null}
        <p className="leading-relaxed text-ink-800">{argument.claim}</p>
        <div className="flex flex-wrap gap-1.5">
          <ArgumentStatusTag status={argument.status} checked={isChecked(argument)} />
          {argument.aspect && argument.aspect !== "existence" ? <Tag>over: {ASPECT_LABELS[argument.aspect] ?? argument.aspect.replace(/_/g, " ")}</Tag> : null}
          {argument.sources.length === 0 ? <Tag>zonder bron</Tag> : null}
        </div>
        {argument.sources.length ? (
          <ul className="space-y-1.5" aria-label="Bronnen van dit argument">
            {argument.sources.map((source, index) => (
              <SourceItem key={`${source.url ?? source.title ?? ""}-${index}`} source={source} party={party} />
            ))}
          </ul>
        ) : null}
      </div>
      {replies.length ? (
        <ul className="mt-2 space-y-3">
          {replies.map((reply) => (
            <ArgumentItem key={reply.id} argument={reply} all={all} party={party} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const ASPECT_LABELS: Record<string, string> = {
  certainty: "zekerheid",
  influence: "invloed",
  description: "beschrijving",
  active_from: "begin",
  active_until: "einde",
  relation_type: "soort band",
};

function ArgumentSection({ title, items, all, party }: { title: string; items: PmArgument[]; all: readonly PmArgument[]; party?: string | null }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <Eyebrow>{title}</Eyebrow>
      <ul className="space-y-4">
        {items.map((argument) => (
          <ArgumentItem key={argument.id} argument={argument} all={all} party={party} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Story 14.12: the discussion behind a relation of the propaganda model. First the verdict and what
 * it rests on in one line ("dun bewijs · 1 bron: persbericht van PBL zelf · niet gecontroleerd"),
 * what is missing and how far its research is (Story 14.13), then what the mechanism means, the
 * arguments for it, nuance and arguments against, each with its review status and sources.
 */
export function PmRelationDiscussion({ details, demo = false }: { details: PmDetails; demo?: boolean }) {
  const all = details.arguments ?? [];
  const roots = all.filter((argument) => !argument.parent_id);
  const evidence = evidenceOf(all);
  const verdict = verdictOf(evidence, details.certainty_label);
  // The party that has the influence: its own press release shows what it says, not what others did
  const party = readEnds(details)?.first.name ?? null;
  const gaps = verdict === "stevig" ? [] : evidenceGaps(evidence, party);
  const research = useSWR(["relation-research", demo, details.id], () => relationResearchStatus([details.id], { demo }), exploreAuxSwrOptions);
  const note = researchNote(research.data?.get(details.id));
  // The description is often the claim of an older argument: only when there is no discussion
  const summary = all.length === 0 ? details.description?.trim() || null : null;
  return (
    <div className="space-y-5">
      <div className="space-y-1.5 rounded-xl bg-paper-100 px-3 py-2 text-sm text-ink-800">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">Onderbouwing:</span>
          <Tag tone={VERDICT_LABELS[verdict].tone}>{VERDICT_LABELS[verdict].label}</Tag>
          <span>{evidenceSummary(evidence, party, true)}</span>
        </p>
        {gaps.length ? <p className="text-xs text-ink-600">Wat ontbreekt: {gaps.join(" · ")}</p> : null}
        {note ? <p className="text-xs font-semibold text-ink-700">{note.charAt(0).toUpperCase() + note.slice(1)}</p> : null}
      </div>
      {details.mechanism_description ? (
        <div className="space-y-1">
          <Eyebrow>{details.mechanism ? `Wat het model bedoelt met ${details.mechanism.toLowerCase()}` : "Wat het model hiermee bedoelt"}</Eyebrow>
          <p className="leading-relaxed text-ink-700">{details.mechanism_description}</p>
          {details.mechanism_effect ? <p className="text-xs leading-relaxed text-ink-500">Gevolg: {details.mechanism_effect}</p> : null}
        </div>
      ) : null}
      <ArgumentSection title="Waarop het rust" items={roots.filter((argument) => argument.stance === "supporting")} all={all} party={party} />
      <ArgumentSection title="Nuance" items={roots.filter((argument) => argument.stance === "contextual")} all={all} party={party} />
      <ArgumentSection title="Tegenargumenten" items={roots.filter((argument) => argument.stance === "contradicting")} all={all} party={party} />
      {summary ? (
        <div className="space-y-1">
          <Eyebrow>Samenvatting in het model</Eyebrow>
          <p className="leading-relaxed text-ink-700">{summary}</p>
        </div>
      ) : null}
    </div>
  );
}
