"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, ArrowLeft, FlaskConical, Waypoints } from "lucide-react";

import { pmMatch, pmNeighborhood } from "@/lib/api";
import { useUrlPanel } from "@/lib/explore/hooks";
import { actorKeys } from "@/lib/explore/normalize";
import { bestMatch, compatibleMatches, MIN_NETWORK_DEGREE } from "@/lib/explore/pm-graph";
import { kindForPmType, resolveActorParams } from "@/lib/explore/research";
import type { EntityKind } from "@/lib/types";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { fetchResearchLookup, researchSwrKey, researchSwrOptions } from "../entity/useEntityResearch";
import { WikipediaBlock } from "../entity/Wikipedia";
import { AutoApprovedTag } from "../network/MiniEgoNetwork";
import { PILL, Tag } from "../ui/primitives";
import { ActorResearchSection, AppearancesSection, CooccurrenceSection, DatasetAttribution, SectionTitle } from "./ActorSections";

const ActorNetwork = dynamic(() => import("./ActorNetwork").then((m) => m.ActorNetwork), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-2xl bg-paper-200" aria-label="Netwerk laden" />,
});
const ActorPanels = dynamic(() => import("./ActorPanels").then((m) => m.ActorPanels), { ssr: false });

const DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO === "true";

export function ActorSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24" aria-busy="true" aria-label="Laden">
      <div className="space-y-3 rounded-2xl border border-paper-300 bg-paper-50 p-5">
        <span className="block h-3 w-32 animate-pulse rounded bg-paper-200" />
        <span className="block h-7 w-2/3 animate-pulse rounded bg-paper-200" />
      </div>
      <div className="h-[420px] animate-pulse rounded-2xl border border-paper-300 bg-paper-100" />
    </div>
  );
}

function ActorDemoBanner() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <FlaskConical size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>
        <strong>Verzonnen voorbeeld.</strong> Mensen en organisaties uit Dijkerhoven en hun onderzoek bestaan niet. Media en
        mediabedrijven komen uit het echte propagandamodel.
      </p>
    </div>
  );
}

const KIND_LABELS: Record<string, string> = { person: "Persoon", org: "Organisatie" };

/**
 * /actor/[slug]: who is this person or organisation, independent of one event. The propaganda-model
 * ego-network (explorable), who appears in the same news, other news, Wikipedia and the research status.
 */
export function ActorScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const panel = useUrlPanel();
  const demo = DEMO_ENABLED && params?.get("demo") === "1";
  const resolved = useMemo(() => resolveActorParams(slug, { k: params?.get("k"), n: params?.get("n") }), [slug, params]);

  // Which propaganda-model entity is this? (pm-<id> directly, else an alias match of a compatible type)
  const match = useSWR(
    resolved.pmId === null && resolved.aliases.length ? ["actor-pm-match", resolved.aliases.join("|"), demo] : null,
    () => pmMatch(resolved.aliases, { demo }),
    exploreAuxSwrOptions,
  );
  const best = resolved.pmId === null ? bestMatch(compatibleMatches(match.data ?? [], resolved.kind), resolved.aliases) : null;
  // Epic 15: a local office holder the register names with initials is linked by the research triage
  // (surname, office and initial or place), not by an alias
  const unmatched = resolved.pmId === null && (match.data !== undefined || Boolean(match.error)) && !best;
  const lookup = useSWR(
    unmatched ? researchSwrKey(resolved.researchKeys, demo) : null,
    () => fetchResearchLookup(resolved.researchKeys, demo),
    researchSwrOptions,
  );
  const linkedId = unmatched ? lookup.data?.row?.pm_entity_id ?? null : null;
  const pmId = resolved.pmId ?? best?.entity_id ?? linkedId;
  const matching =
    resolved.pmId === null &&
    resolved.aliases.length > 0 &&
    ((match.data === undefined && !match.error) || (unmatched && lookup.data === undefined && !lookup.error && resolved.researchKeys.length > 0));

  // Header facts of the pm entity (one small call; the network loads its own neighbourhood)
  const center = useSWR(pmId !== null ? ["pm-center", pmId, demo] : null, () => pmNeighborhood(pmId as number, { demo, limit: 1 }), exploreAuxSwrOptions);
  const entity = center.data?.center ?? null;

  const name = resolved.name || entity?.name || best?.name || "Onbekend";
  const kind: "person" | "org" | null = resolved.kind ?? kindForPmType(entity?.type ?? best?.type);
  const aliases = useMemo(() => {
    if (resolved.aliases.length) return resolved.aliases;
    return name && name !== "Onbekend" ? actorKeys(name, { person: kind === "person" }).aliases : [];
  }, [kind, name, resolved.aliases]);
  const researchKeys = useMemo(() => {
    if (resolved.researchKeys.length) return resolved.researchKeys;
    const own = aliases[0];
    if (!own) return [];
    return kind ? [`${kind}:${own}`] : [`person:${own}`, `org:${own}`, `actor:${own}`];
  }, [aliases, kind, resolved.researchKeys]);

  const typeLabel = [entity?.type, entity?.role].filter(Boolean).join(" · ") || (kind ? KIND_LABELS[kind] : "Actor");
  const pmError = Boolean(match.error || center.error);

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <>
      <div data-explore className="mx-auto max-w-3xl space-y-6 pb-24">
        {demo ? <ActorDemoBanner /> : null}

        <header className="space-y-3">
          <button
            type="button"
            onClick={goBack}
            className={PILL}
          >
            <ArrowLeft size={16} aria-hidden="true" /> Terug
          </button>
          <p className="text-sm font-medium text-ink-500">Wie is dit?</p>
          <h1 className="font-serif text-2xl font-bold leading-tight text-ink-900 sm:text-3xl">{name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag>{typeLabel}</Tag>
            {entity ? <Tag tone="blue">{entity.degree === 1 ? "1 verband" : `${entity.degree} verbanden`} in het propagandamodel</Tag> : null}
            {entity?.auto_approved ? <AutoApprovedTag /> : null}
          </div>
        </header>

        <section className="space-y-3" aria-labelledby="actor-network">
          <SectionTitle id="actor-network" icon={<Waypoints size={18} className="text-accent-red" aria-hidden="true" />}>
            Netwerk
          </SectionTitle>
          {matching || (pmId !== null && !center.data && !center.error) ? (
            <div className="h-[420px] animate-pulse rounded-2xl bg-paper-200" aria-label="Netwerk laden" />
          ) : pmError ? (
            <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="space-y-2">
                <p>Het propagandamodel is nu niet bereikbaar.</p>
                <button
                  type="button"
                  onClick={() => {
                    void match.mutate();
                    void center.mutate();
                  }}
                  className="min-h-[44px] rounded-full border border-red-300 bg-white px-4 font-semibold"
                >
                  Opnieuw proberen
                </button>
              </div>
            </div>
          ) : pmId !== null && entity ? (
            <ActorNetwork pmId={pmId} slug={resolved.slug} demo={demo} aliases={aliases} />
          ) : (
            <p className="rounded-2xl border border-paper-300 bg-paper-50 p-4 text-sm text-ink-700">
              {name} staat (nog) niet in het propagandamodel. Zodra het uitzoeken iets oplevert, verschijnt hier het netwerk.
            </p>
          )}
        </section>

        <ActorResearchSection keys={researchKeys} name={name} demo={demo} inModel={(entity?.degree ?? 0) >= MIN_NETWORK_DEGREE} />

        <CooccurrenceSection aliases={aliases} demo={demo} />

        <AppearancesSection aliases={aliases} kind={kind as EntityKind | null} demo={demo} />

        {name !== "Onbekend" ? (
          <section className="space-y-2" aria-labelledby="actor-background">
            <SectionTitle id="actor-background">Achtergrond</SectionTitle>
            <WikipediaBlock key={name} name={name} />
          </section>
        ) : null}

        <DatasetAttribution demo={demo} />
      </div>
      {panel.panel ? <ActorPanels demo={demo} /> : null}
    </>
  );
}
