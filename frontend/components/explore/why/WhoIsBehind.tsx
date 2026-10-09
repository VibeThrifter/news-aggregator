"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CornerDownRight, Info, Network } from "lucide-react";

import { pmDetails, pmRelationArguments, requestRelationResearch } from "@/lib/api";
import {
  evidenceExtras,
  evidenceOf,
  evidenceSummary,
  researchNote,
  VERDICT_LABELS,
  VERDICT_RANK,
  verdictOf,
  type Evidence,
} from "@/lib/explore/evidence";
import { filterColor, pmTypeLabel } from "@/lib/explore/labels";
import { displayFilter } from "@/lib/explore/pm-graph";
import { eventOutletSeeds } from "@/lib/explore/pm-seeds";
import {
  behindParties,
  entityName,
  governanceFilter,
  governanceRoutes,
  isGovernanceRelation,
  joinNames,
  lineRelationIds,
  specificParties,
  type BehindLine,
  type BehindParty,
  type GovernanceRoute,
} from "@/lib/explore/why";
import { exploreAuxSwrOptions } from "@/lib/swr-config";
import type { PmEntity, RelationResearch } from "@/lib/types";

import { useExplore } from "../ExploreContext";
import { AutoApprovedTag } from "../network/MiniEgoNetwork";
import { PmAttribution } from "../network/PmSection";
import { stepLabel } from "../network/RouteList";
import { PILL, Tag } from "../ui/primitives";
import { useBetweenRoutes, useWhyRoutes } from "./useWhyRoutes";

/** Parties shown before "Nog …" */
const PARTIES_SHOWN = 3;
/** Lines per party shown before "Nog …" */
const LINES_SHOWN = 2;
/** Routes between parties shown before "Nog …" (Epic 15) */
const TOGETHER_SHOWN = 3;

/**
 * "Wie zit erachter?" (Epic 14): the parties and speakers of this news that reach the outlets that
 * brought it in the propaganda model, read from the party ("RIVM is vaste bron voor NOS en de
 * Volkskrant"). Under every line what it rests on in the model (Story 14.12): the claim of its
 * strongest argument and how strong that is ("1 bron: persbericht · niet gecontroleerd"), nuance
 * and arguments against. Story 14.13: a verdict first ("dun bewijs"), a source of the party itself
 * named as such, and thin links are handed to the propaganda model to research (their status
 * shows under the line). Story 14.23: only what is about this news — a link without a source, or one
 * whose evidence does not name the outlet ("PVV valt de pers aan" is no link with the AD), is left
 * out, and people who belong to both the party and the outlet come first. Best supported next;
 * outlets with the same link and support share one line. Loaded once the block scrolls into view.
 */
export function WhoIsBehind() {
  const { exploration, eventId } = useExplore();
  const { input } = exploration;
  const seeds = useMemo(() => eventOutletSeeds(input), [input]);
  const block = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const element = block.current;
    if (!element || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setInView(true), { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView]);

  const why = useWhyRoutes(inView && seeds.length > 0);
  const demo = input.event.isDemo;
  // The lines without evidence first: they tell which relations to look up (one call)
  const draft = useMemo(() => behindParties(why.paths, why.newsOutletIds), [why.paths, why.newsOutletIds]);
  const ids = useMemo(() => lineRelationIds(draft), [draft]);
  const discussion = useSWR(ids.length ? ["pm-relation-arguments", demo, ids.join(",")] : null, () => pmRelationArguments(ids, { demo }), exploreAuxSwrOptions);
  // Null before migration 010 (or when the lookup failed): the lines show the model's description
  const evidence = useMemo(
    () => (discussion.data ? new Map(ids.map((id) => [id, evidenceOf(discussion.data?.get(id))])) : null),
    [discussion.data, ids],
  );
  // The model's own verdict on a link (its score) next to what the arguments show
  const certainty = useMemo(() => new Map((why.paths?.relations ?? []).map((relation) => [relation.id, relation.certainty_label ?? null])), [why.paths]);
  const entities = useMemo(() => new Map((why.paths?.entities ?? []).map((entity) => [entity.id, entity])), [why.paths]);
  // Story 14.23: only links whose evidence is about these two parties, and never an unproven one
  const parties = useMemo(() => {
    if (!evidence || !discussion.data) return draft;
    const args = discussion.data;
    const verdict = (id: number) => (evidence.has(id) ? verdictOf(evidence.get(id) as Evidence, certainty.get(id)) : null);
    const ranked = behindParties(why.paths, why.newsOutletIds, (id) => {
      const known = verdict(id);
      return known ? VERDICT_RANK[known] : undefined;
    });
    return specificParties(ranked, (id) => (ids.includes(id) ? args.get(id) ?? [] : undefined), (id) => entityName(entities, id))
      .map((party) => ({ ...party, lines: party.lines.filter((line) => verdict(line.explain[0]) !== "onbewezen") }))
      .filter((party) => party.lines.length > 0);
  }, [evidence, discussion.data, certainty, draft, ids, entities, why.paths, why.newsOutletIds]);
  // Thin links this page shows go to the propaganda model to be researched; their status comes back
  const thin = useMemo(() => {
    if (!evidence) return [];
    const telling = parties.flatMap((party) => party.lines.map((line) => line.explain[0]));
    return Array.from(new Set(telling)).filter((id) => evidence.has(id) && VERDICT_RANK[verdictOf(evidence.get(id) as Evidence, certainty.get(id))] > VERDICT_RANK.stevig);
  }, [evidence, certainty, parties]);
  const slug = input.event.slug ?? null;
  const research = useSWR(thin.length ? ["relation-research-request", demo, slug, thin.join(",")] : null, () => requestRelationResearch(thin, slug, { demo }), exploreAuxSwrOptions);
  const loading = why.loading || (ids.length > 0 && discussion.isLoading);
  // Epic 15: how the parties of this news hang together through decision-making
  const between = useBetweenRoutes(why.actorIds, inView);
  const together = useMemo(() => governanceRoutes(between.paths), [between.paths]);
  const togetherEntities = useMemo(() => new Map((between.paths?.entities ?? []).map((entity) => [entity.id, entity])), [between.paths]);

  if (seeds.length === 0 || why.unavailable) return null;
  const networkHref = `/event/${encodeURIComponent(input.event.slug ?? String(eventId))}/netwerk`;
  const shown = all ? parties : parties.slice(0, PARTIES_SHOWN);
  const total = parties.reduce((sum, party) => sum + party.lines.length, 0);
  const visible = shown.reduce((sum, party) => sum + (all ? party.lines.length : Math.min(party.lines.length, LINES_SHOWN)), 0);
  const hidden = total - visible;

  return (
    <section ref={block} aria-labelledby="behind-title" className="space-y-2" aria-busy={loading}>
      <div className="flex items-end justify-between gap-3">
        <h2 id="behind-title" className="font-serif text-xl font-bold text-ink-900">
          Wie zit erachter?
        </h2>
        <Link
          href={networkHref}
          className={PILL}
        >
          <Network size={15} /> Netwerk
        </Link>
      </div>
      {!inView || loading ? <div className="h-24 animate-pulse rounded-2xl bg-paper-200" /> : null}
      {inView && !why.loading && why.noActors ? <p className="text-sm text-ink-600">Geen partij uit dit nieuws in het propagandamodel.</p> : null}
      {inView && !why.loading && !why.noActors && parties.length === 0 ? (
        <p className="text-sm text-ink-600">Geen verband binnen twee stappen tussen de bronnen en de partijen van dit nieuws.</p>
      ) : null}
      {parties.length && !loading ? (
        <ol aria-label="Routes tussen de bronnen en de partijen van dit nieuws" className="divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-paper-50">
          {shown.map((party) => (
            <PartyRow
              key={party.partyId}
              party={party}
              entities={entities}
              evidence={evidence}
              research={research.data ?? null}
              lines={all ? party.lines : party.lines.slice(0, LINES_SHOWN)}
            />
          ))}
        </ol>
      ) : null}
      {hidden > 0 && !loading ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-[40px] rounded-full border border-paper-300 bg-paper-50 px-3 text-sm font-semibold text-ink-800 hover:bg-paper-100"
        >
          Nog {hidden} {hidden === 1 ? "verband" : "verbanden"}
        </button>
      ) : null}
      {together.length && !loading ? <TogetherRoutes routes={together} entities={togetherEntities} /> : null}
      {parties.length || together.length ? <PmAttribution /> : null}
    </section>
  );
}

/**
 * "Hoe hangen ze samen?" (Epic 15): how parties of this news hang together through decision-making
 * (an office, a hierarchy, oversight, a gift, lobby access), one line per pair, read with the
 * influence. Tap for its sources.
 */
function TogetherRoutes({ routes, entities }: { routes: GovernanceRoute[]; entities: ReadonlyMap<number, PmEntity> }) {
  const { panel } = useExplore();
  const [all, setAll] = useState(false);
  const shown = all ? routes : routes.slice(0, TOGETHER_SHOWN);
  return (
    <div className="space-y-2 pt-2">
      <h3 id="together-title" className="font-serif text-lg font-bold text-ink-900">
        Hoe hangen ze samen?
      </h3>
      <ol aria-labelledby="together-title" className="divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-paper-50">
        {shown.map((route) => {
          const telling = route.steps.find((step) => isGovernanceRelation(step.relation)) ?? route.steps[0];
          const auto = route.steps.some((step) => step.relation.auto_approved);
          return (
            <li key={route.key} className="px-2 py-1">
              <button
                type="button"
                onClick={() => panel.open(`pm:relation:${telling.relation.id}`)}
                className="flex min-h-[44px] w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-paper-100"
              >
                <span
                  className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: filterColor(governanceFilter(telling.relation) ?? displayFilter(telling.relation)) }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 space-y-0.5 text-sm leading-snug text-ink-800">
                  {route.steps.map((step, index) => (
                    <span key={step.relation.id} className="block">
                      {index > 0 ? <CornerDownRight size={13} className="mr-1 inline align-[-2px] text-ink-400" aria-hidden="true" /> : null}
                      <span className="font-semibold text-ink-900">{entityName(entities, step.from)}</span> {stepLabel(step)}{" "}
                      <span className="font-semibold text-ink-900">{entityName(entities, step.to)}</span>
                    </span>
                  ))}
                  {route.historic || auto ? (
                    <span className="flex flex-wrap gap-1.5 pt-0.5">
                      {route.historic ? <Tag>historisch</Tag> : null}
                      {auto ? <AutoApprovedTag /> : null}
                    </span>
                  ) : null}
                </span>
                <Info size={14} className="mt-[3px] shrink-0 text-ink-400" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      {routes.length > shown.length ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-[40px] rounded-full border border-paper-300 bg-paper-50 px-3 text-sm font-semibold text-ink-800 hover:bg-paper-100"
        >
          Nog {routes.length - shown.length} {routes.length - shown.length === 1 ? "verband" : "verbanden"}
        </button>
      ) : null}
    </div>
  );
}

function PartyRow({
  party,
  entities,
  evidence,
  research,
  lines,
}: {
  party: BehindParty;
  entities: ReadonlyMap<number, PmEntity>;
  evidence: ReadonlyMap<number, Evidence> | null;
  research: ReadonlyMap<number, RelationResearch> | null;
  lines: BehindLine[];
}) {
  const { panel } = useExplore();
  const entity = entities.get(party.partyId);
  return (
    <li className="space-y-0.5 px-3 py-2.5">
      <button
        type="button"
        onClick={() => panel.open(`pm:entity:${party.partyId}`)}
        className="block min-h-[36px] max-w-full py-1 text-left hover:underline"
      >
        <span className="font-semibold text-ink-900">{entityName(entities, party.partyId)}</span>
        {entity?.type ? <span className="ml-2 text-xs text-ink-500">{pmTypeLabel(entity.type)}</span> : null}
      </button>
      <ul className="space-y-0.5">
        {lines.map((line) => (
          <LineRow
            key={line.key}
            line={line}
            partyName={entityName(entities, party.partyId)}
            entities={entities}
            evidence={evidence ? evidence.get(line.explain[0]) ?? null : undefined}
            research={research?.get(line.explain[0]) ?? null}
          />
        ))}
      </ul>
    </li>
  );
}

/**
 * One way the party reaches outlets: "is vaste bron voor NOS en de Volkskrant", or over a station
 * "heeft als medewerker Marko Hekkert ↳ Marko Hekkert treedt op als deskundige bij NOS". Below it
 * the verdict ("dun bewijs"), what the model bases it on and how strong that is (or, before
 * migration 010, its description), and how far its research is. Unproven, disputed and outdated
 * links are greyed. Tap for the whole discussion and its sources.
 */
function LineRow({
  line,
  partyName,
  entities,
  evidence,
  research,
}: {
  line: BehindLine;
  partyName: string;
  entities: ReadonlyMap<number, PmEntity>;
  /** undefined = arguments not available (before migration 010): the description is shown */
  evidence: Evidence | null | undefined;
  /** Research of a thin link (migration 011); null when there is none */
  research: RelationResearch | null;
}) {
  const { panel } = useExplore();
  const explanation = useExplanation(evidence === undefined ? line.explain : []);
  const final = line.last[0];
  const outlets = joinNames(line.last.map((step) => entityName(entities, step.to)));
  const clauses = [
    ...line.lead.map((step, index) => ({ key: step.relation.id, subject: index === 0 ? null : entityName(entities, step.from), words: stepLabel(step), object: entityName(entities, step.to) })),
    { key: final.relation.id, subject: line.lead.length ? entityName(entities, final.from) : null, words: stepLabel(final), object: outlets },
  ];
  const relations = [...line.lead, ...line.last].map((step) => step.relation);
  // The relation that carries the influence: its filter colours the line, a tap opens its sources
  const telling = relations.find((relation) => relation.id === line.explain[0]) ?? final.relation;
  const unsure = evidence === undefined && relations.some((relation) => relation.certainty_label === "onzeker");
  const sentence = clauses.map((clause) => [clause.subject, clause.words, clause.object].filter(Boolean).join(" ")).join(", ");
  const verdict = evidence ? verdictOf(evidence, telling.certainty_label) : null;
  const weak = verdict ? VERDICT_RANK[verdict] >= VERDICT_RANK.onbewezen : false;
  // The party that has the influence (a source of its own says what it says, not what others did)
  const influencer = entityName(entities, telling.source_id);
  const note = verdict && verdict !== "stevig" ? researchNote(research) : null;
  // With several outlets on one line, the claim is about the first one: say which
  const tellingStep = line.last.find((step) => step.relation.id === telling.id);
  const about = evidence?.lead && tellingStep && line.last.length > 1 ? `${entityName(entities, tellingStep.to)}: ` : "";
  const extras = evidence ? evidenceExtras(evidence) : [];

  return (
    <li>
      <button
        type="button"
        onClick={() => panel.open(`pm:relation:${telling.id}`)}
        aria-label={`Bronnen van ${partyName} ${sentence}`}
        className="flex min-h-[44px] w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-paper-100"
      >
        <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: filterColor(displayFilter(telling)) }} aria-hidden="true" />
        <span className={`min-w-0 flex-1 space-y-0.5 text-sm leading-snug ${weak ? "text-ink-500" : "text-ink-800"}`}>
          {clauses.map((clause) => (
            <span key={clause.key} className="block">
              {clause.subject ? (
                <>
                  <CornerDownRight size={13} className="mr-1 inline align-[-2px] text-ink-400" aria-hidden="true" />
                  <span className="font-semibold text-ink-900">{clause.subject}</span>{" "}
                </>
              ) : null}
              {clause.words} <span className={`font-semibold ${weak ? "text-ink-600" : "text-ink-900"}`}>{clause.object}</span>
            </span>
          ))}
          {evidence?.lead ? (
            <span className="pt-0.5 text-[13px] text-ink-700 line-clamp-3">
              {about ? <span className="font-semibold">{about}</span> : null}
              {evidence.lead.claim}
            </span>
          ) : null}
          {evidence && verdict ? (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-0.5 text-xs text-ink-500">
              <Tag tone={VERDICT_LABELS[verdict].tone}>{VERDICT_LABELS[verdict].label}</Tag>
              <span>{[evidenceSummary(evidence, influencer, true), ...extras].join(" · ")}</span>
            </span>
          ) : null}
          {note ? <span className="block text-xs font-medium text-ink-600">{note.charAt(0).toUpperCase() + note.slice(1)}</span> : null}
          {explanation ? <span className="text-xs text-ink-500 line-clamp-2">{explanation}</span> : null}
          {unsure || line.historic || relations.some((relation) => relation.auto_approved) ? (
            <span className="flex flex-wrap gap-1.5 pt-0.5">
              {unsure ? <Tag tone="orange">onzeker</Tag> : null}
              {line.historic ? <Tag>historisch</Tag> : null}
              {relations.some((relation) => relation.auto_approved) ? <AutoApprovedTag /> : null}
            </span>
          ) : null}
        </span>
        <Info size={14} className="mt-[3px] shrink-0 text-ink-400" aria-hidden="true" />
      </button>
    </li>
  );
}

/** The model's explanation of a line: the first of its relations that has one (at most two looked up). */
function useExplanation(ids: readonly number[]): string | null {
  const { exploration } = useExplore();
  const demo = exploration.input.event.isDemo;
  const [first, second] = ids;
  const one = useSWR(first ? ["pm-details", "relation", first, demo] : null, () => pmDetails("relation", first, { demo }), exploreAuxSwrOptions);
  const needSecond = Boolean(second) && one.data !== undefined && !one.data?.description?.trim();
  const two = useSWR(needSecond ? ["pm-details", "relation", second, demo] : null, () => pmDetails("relation", second, { demo }), exploreAuxSwrOptions);
  return one.data?.description?.trim() || two.data?.description?.trim() || null;
}
