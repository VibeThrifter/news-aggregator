"use client";

import Link from "next/link";
import useSWR from "swr";
import { ExternalLink, UserRound, Waypoints } from "lucide-react";

import { pmDetails } from "@/lib/api";
import { nameAliases } from "@/lib/explore/coverage";
import { actorHref } from "@/lib/explore/research";
import { FILTERS, filterColor, pmRelationLabel } from "@/lib/explore/labels";
import { wikiTitleCandidates } from "@/lib/explore/wikipedia";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { useExplore } from "../ExploreContext";
import { ArticleSearch, EntityCoverage } from "../entity/ArticleMentions";
import { WikipediaBlock } from "../entity/Wikipedia";
import { SubHeading, Tag } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";
import { AutoApprovedTag } from "./MiniEgoNetwork";
import { PmRelationDiscussion, relationSentence } from "./PmEvidence";
import { PmAttribution } from "./PmSection";

const CERTAINTY_LABELS: Record<string, { label: string; tone: "green" | "neutral" | "orange" }> = {
  onderbouwd: { label: "Onderbouwd", tone: "green" },
  aannemelijk: { label: "Aannemelijk", tone: "neutral" },
  onzeker: { label: "Onzeker", tone: "orange" },
};

/** "Meer weten": description, mechanism, dates and sources of a propaganda-model entity or relation. */
export function PmDetailsSheet({ kind, id }: { kind: "entity" | "relation"; id: number }) {
  const { exploration, panel } = useExplore();
  const demo = exploration.input.event.isDemo;
  const { data, error, isLoading } = useSWR(["pm-details", kind, id, demo], () => pmDetails(kind, id, { demo }), exploreAuxSwrOptions);
  const certainty = data?.certainty_label ? CERTAINTY_LABELS[data.certainty_label] : null;
  // A relation can belong to several filters; entities show their primary filter
  const filters = (data?.filters?.length ? data.filters : data?.filter ? [data.filter] : [])
    .map((id) => FILTERS.find((item) => item.id === id))
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
      {data ? (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {data.type && kind === "relation" && !relationSentence(data) ? <Tag>{pmRelationLabel(data.type, data.mechanism, data.functie)}</Tag> : null}
            {filters.map((filter) => (
              <span key={filter.id} className="inline-flex items-center gap-1 rounded-full border border-paper-300 px-2 py-0.5 text-[11px] font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: filterColor(filter.id) }} />
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
              Automatisch toegevoegd: een onafhankelijke controle vond het in de bron. Een mens kan het terugdraaien.
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
            <Link
              href={actorHref(`pm-${id}`, { kind: data.type === "persoon" ? "person" : "org", name: data.title, demo })}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-paper-300 px-4 text-sm font-semibold text-ink-800 hover:bg-paper-100"
            >
              <UserRound size={16} aria-hidden="true" /> Profiel van {data.title}
            </Link>
          ) : null}
          {kind === "entity" ? (
            <div className="space-y-2">
              <SubHeading>Achtergrond</SubHeading>
              <WikipediaBlock key={data.title} name={data.title} />
            </div>
          ) : null}
          {kind === "entity" ? (
            <>
              <EntityCoverage aliases={nameAliases(data.title)} kind={null} excludeEventId={null} title="Wie schreef erover?" />
              <ArticleSearch key={data.title} initialQuery={wikiTitleCandidates(data.title)[0] ?? data.title} />
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
                        <ExternalLink size={12} className="mt-1 shrink-0" />
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
