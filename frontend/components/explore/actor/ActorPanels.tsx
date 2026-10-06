"use client";

import Link from "next/link";
import useSWR from "swr";
import { ExternalLink, UserRound, Waypoints } from "lucide-react";

import { pmDetails } from "@/lib/api";
import { useUrlPanel } from "@/lib/explore/hooks";
import { FILTERS, filterColor, pmRelationLabel } from "@/lib/explore/labels";
import { actorHref } from "@/lib/explore/research";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { WikipediaBlock } from "../entity/Wikipedia";
import { AutoApprovedTag } from "../network/MiniEgoNetwork";
import { PmRelationDiscussion, relationSentence } from "../network/PmEvidence";
import { PmAttribution } from "../network/PmSection";
import { SubHeading, Tag } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";

const CERTAINTY_LABELS: Record<string, { label: string; tone: "green" | "neutral" | "orange" }> = {
  onderbouwd: { label: "Onderbouwd", tone: "green" },
  aannemelijk: { label: "Aannemelijk", tone: "neutral" },
  onzeker: { label: "Onzeker", tone: "orange" },
};

/**
 * "Meer weten" on the actor page: description, mechanism, dates and sources of a propaganda-model
 * entity or relation, with the Epic 12 labels (automatically added, sources not yet reviewed).
 */
export function ActorPmDetailsSheet({ kind, id, demo }: { kind: "entity" | "relation"; id: number; demo: boolean }) {
  const panel = useUrlPanel();
  const { data, error, isLoading } = useSWR(["pm-details", kind, id, demo], () => pmDetails(kind, id, { demo }), exploreAuxSwrOptions);
  const certainty = data?.certainty_label ? CERTAINTY_LABELS[data.certainty_label] : null;
  const filters = (data?.filters?.length ? data.filters : data?.filter ? [data.filter] : [])
    .map((filterId) => FILTERS.find((item) => item.id === filterId))
    .filter((item): item is (typeof FILTERS)[number] => Boolean(item));

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title={(data ? relationSentence(data) : null) ?? data?.title ?? (isLoading ? "Laden…" : "Propagandamodel")}
      subtitle={kind === "relation" ? "Verband in het propagandamodel" : data?.type ?? undefined}
      icon={<Waypoints size={22} />}
    >
      {error ? <p className="text-sm text-red-700">Kon dit niet laden.</p> : null}
      {!isLoading && !error && !data ? <p className="text-sm text-ink-500">Niet gevonden in het propagandamodel.</p> : null}
      {data ? (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {data.type && kind === "relation" && !relationSentence(data) ? <Tag>{pmRelationLabel(data.type, data.mechanism)}</Tag> : null}
            {filters.map((filter) => (
              <span key={filter.id} className="inline-flex items-center gap-1 rounded-full border border-paper-300 px-2 py-0.5 text-[11px] font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: filterColor(filter.id) }} aria-hidden="true" />
                {filter.label}
              </span>
            ))}
            {data.mechanism ? <Tag tone="purple">{data.mechanism}</Tag> : null}
            {/* With the discussion the verdict below says how sure it is (Story 14.13) */}
            {certainty && !(kind === "relation" && data.arguments) ? <Tag tone={certainty.tone}>{certainty.label}</Tag> : null}
            {data.active_from || data.active_until ? (
              <Tag>
                {data.active_from ?? "?"}–{data.active_until ?? "nu"}
              </Tag>
            ) : null}
            {data.auto_approved ? <AutoApprovedTag /> : null}
          </div>
          {data.auto_approved ? (
            <p className="text-xs text-ink-500">
              Automatisch toegevoegd door de nieuws-pijplijn: alleen neutrale structuurfeiten met een bron. Een mens kan het terugdraaien.
            </p>
          ) : null}
          {kind === "relation" && data.arguments ? (
            <PmRelationDiscussion details={data} demo={demo} />
          ) : data.description ? (
            <p className="leading-relaxed text-ink-800">{data.description}</p>
          ) : (
            <p className="text-ink-500">Geen beschrijving.</p>
          )}
          {kind === "entity" ? (
            <>
              <Link
                href={actorHref(`pm-${id}`, { kind: data.type === "persoon" ? "person" : "org", name: data.title, demo })}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-paper-300 px-4 text-sm font-semibold text-ink-800 hover:bg-paper-100"
              >
                <UserRound size={16} aria-hidden="true" /> Profiel van {data.title}
              </Link>
              <div className="space-y-2">
                <SubHeading>Achtergrond</SubHeading>
                <WikipediaBlock key={data.title} name={data.title} />
              </div>
            </>
          ) : null}
          {data.sources.length && !(kind === "relation" && data.arguments?.length) ? (
            <div className="space-y-2">
              <SubHeading>Bronnen</SubHeading>
              <ul className="space-y-2">
                {data.sources.map((source, i) => (
                  <li key={i} className="rounded-xl border border-paper-300 bg-paper-50 p-3">
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 font-semibold text-accent-blue">
                        {source.title || source.url}
                        <ExternalLink size={12} className="mt-1 shrink-0" aria-hidden="true" />
                      </a>
                    ) : (
                      <p className="font-semibold">{source.title}</p>
                    )}
                    <p className="text-xs text-ink-500">{[source.publisher, source.published_at].filter(Boolean).join(" · ")}</p>
                    {source.unreviewed ? (
                      <Tag tone="orange" className="mt-1">
                        nog niet gecontroleerd
                      </Tag>
                    ) : null}
                    {source.quote ? <p className="mt-1 text-xs italic text-ink-700">“{source.quote}”</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <PmAttribution />
        </div>
      ) : null}
    </Sheet>
  );
}

/** Panels of the actor page (?p=pm:entity:<id> / pm:relation:<id>), so back closes them. */
export function ActorPanels({ demo }: { demo: boolean }) {
  const panel = useUrlPanel();
  const current = panel.panel;
  if (!current) return null;
  if (current.startsWith("pm:entity:")) return <ActorPmDetailsSheet kind="entity" id={Number(current.slice("pm:entity:".length))} demo={demo} />;
  if (current.startsWith("pm:relation:")) return <ActorPmDetailsSheet kind="relation" id={Number(current.slice("pm:relation:".length))} demo={demo} />;
  return null;
}
