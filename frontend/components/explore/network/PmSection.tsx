"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, Waypoints } from "lucide-react";

import { pmMatch, pmNeighborhood } from "@/lib/api";
import { bestMatch, compatibleMatches, MIN_NETWORK_DEGREE } from "@/lib/explore/pm-graph";
import { actorHref, keySlug, kindForPmType, researchTarget } from "@/lib/explore/research";
import { actorKeys } from "@/lib/explore/normalize";
import type { EventEntity } from "@/lib/types";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { useExplore } from "../ExploreContext";
import { ResearchStatusCard } from "../entity/ResearchStatus";
import { fetchResearchLookup, researchSwrKey, researchSwrOptions, useEntityResearch } from "../entity/useEntityResearch";
import { SubHeading } from "../ui/primitives";
import { AutoApprovedTag, MiniEgoNetwork } from "./MiniEgoNetwork";

// Kept here for existing imports (usePmExplorer, sheets); the helper itself lives in pm-graph
export { compatibleMatches };

export function PmAttribution({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] text-ink-500 ${className}`}>
      Bron: Propagandamodel — NL-mediamachtsgraaf. Structuur en bronnen, geen oordeel over personen of organisaties.
    </p>
  );
}

const linkButton =
  "inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue";

/**
 * "Netwerk & onderzoek" in the entity panel (Epic 12). A name that is in the propaganda model with at
 * least three relations shows a mini ego-network; otherwise its automatic research status (the name
 * is requested once per session). Links go to the standalone actor page and the event network.
 */
export function PmSection({
  aliases,
  name,
  kind,
  entityKey,
  entity,
}: {
  aliases: string[];
  name: string;
  kind: EventEntity["kind"] | null;
  /** Key the panel was opened with (entiteit:<key>) */
  entityKey?: string;
  entity?: EventEntity;
}) {
  const { exploration, panel } = useExplore();
  const { input } = exploration;
  const demo = input.event.isDemo;
  const kindHint = panel.param("k");
  const effectiveKind: EventEntity["kind"] | null = kind ?? (kindHint === "person" || kindHint === "org" ? kindHint : null);

  const match = useSWR(["pm-match", aliases.join("|"), demo], () => pmMatch(aliases, { demo }), exploreAuxSwrOptions);
  const matches = compatibleMatches(match.data ?? [], effectiveKind);
  const best = bestMatch(matches, aliases);
  const matchSettled = match.data !== undefined || Boolean(match.error);

  // Epic 15: a local office holder the register names with initials ("B.C.M. Vostermans
  // (burgemeester Peel en Maas)") has no alias match; the research triage links him on surname,
  // office and initial or place. Same SWR key as useEntityResearch below: one call.
  const target = researchTarget({ entity, panelKey: entityKey ?? keySlug(entity?.entity_key ?? name), name, kindHint: effectiveKind });
  const researchKeys = target ? [target.key] : [];
  const lookup = useSWR(matchSettled && !best ? researchSwrKey(researchKeys, demo) : null, () => fetchResearchLookup(researchKeys, demo), researchSwrOptions);
  const linked = !best && lookup.data?.row?.pm_entity_id ? lookup.data.row : null;
  const pmEntityId = best?.entity_id ?? linked?.pm_entity_id ?? null;
  const knownDegree = best ? best.degree : linked?.pm_degree ?? null;

  const wantHood = Boolean(pmEntityId && (knownDegree == null || knownDegree >= MIN_NETWORK_DEGREE));
  const hood = useSWR(
    wantHood && pmEntityId ? ["pm-mini", pmEntityId, demo] : null,
    () => pmNeighborhood(pmEntityId as number, { demo, limit: 10 }),
    exploreAuxSwrOptions,
  );
  const degree = pmEntityId ? knownDegree ?? hood.data?.center.degree ?? null : null;
  const hoodSettled = !wantHood || hood.data !== undefined || Boolean(hood.error);
  const showNetwork = Boolean(pmEntityId && hood.data && (degree ?? 0) >= MIN_NETWORK_DEGREE && hood.data.relations.length > 0);

  const eventSlug = input.event.slug ?? String(input.event.id);
  const research = useEntityResearch({
    keys: researchKeys,
    name,
    demo,
    // Only research what is not already in the network, once the lookups have settled
    request: target && matchSettled && hoodSettled && !showNetwork ? { kind: target.kind, eventSlug } : null,
  });

  // Actor page: the entity's own slug (news appearances, research) or the pm entity
  const actorKind = effectiveKind === "person" || effectiveKind === "org" ? effectiveKind : kindForPmType(best?.type);
  const slug = entity ? keySlug(entity.entity_key) : target ? keySlug(target.key) : actorKeys(name).slug;
  const inModel = Boolean(pmEntityId) || Boolean(research.row?.pm_entity_id);
  const actorLink = slug ? actorHref(slug, { kind: actorKind, name, demo }) : pmEntityId ? actorHref(`pm-${pmEntityId}`, { kind: actorKind, name, demo }) : null;
  const networkLink = pmEntityId
    ? `/event/${encodeURIComponent(eventSlug)}/netwerk?lens=propaganda&focus=${encodeURIComponent(`pm:${pmEntityId}`)}`
    : null;

  const researchVisible = Boolean(target) && research.available && !showNetwork;
  if (!matchSettled) {
    return target ? <div className="h-20 animate-pulse rounded-xl bg-paper-200" aria-label="Netwerk laden" /> : null;
  }
  if (!showNetwork && !researchVisible && !pmEntityId) return null;

  return (
    <section className="space-y-3" aria-labelledby="network-research-title">
      <div className="flex items-center gap-2">
        <Waypoints size={16} className="text-accent-red" aria-hidden="true" />
        <SubHeading>
          <span id="network-research-title">Netwerk &amp; onderzoek</span>
        </SubHeading>
      </div>

      {wantHood && !hood.data && !hood.error ? <div className="h-40 animate-pulse rounded-xl bg-paper-200" aria-label="Netwerk laden" /> : null}

      {showNetwork && hood.data ? (
        <>
          <p className="text-sm text-ink-600">
            {name} staat in het propagandamodel met {degree} verbanden: eigenaren, financiers, adviseurs en bronnen.
            {hood.data.center.auto_approved ? (
              <>
                {" "}
                <AutoApprovedTag className="align-middle" />
              </>
            ) : null}
          </p>
          <MiniEgoNetwork hood={hood.data} demo={demo} />
        </>
      ) : null}

      {researchVisible ? (
        research.loading ? (
          <div className="h-16 animate-pulse rounded-xl bg-paper-200" aria-label="Onderzoeksstatus laden" />
        ) : (
          <ResearchStatusCard row={research.row} name={name} requesting={research.requesting} />
        )
      ) : null}

      {pmEntityId && !showNetwork && hoodSettled ? (
        <p className="text-sm text-ink-600">
          {name} staat in het propagandamodel{degree != null ? ` met ${degree} ${degree === 1 ? "verband" : "verbanden"}` : ""}.
        </p>
      ) : null}

      {actorLink && (target || pmEntityId) ? (
        <div className="flex flex-wrap gap-2">
          <Link href={actorLink} className={`${linkButton} bg-ink-900 text-white hover:bg-ink-800`}>
            {inModel || showNetwork ? "Bekijk netwerk" : "Bekijk profiel"} <ArrowRight size={16} aria-hidden="true" />
          </Link>
          {networkLink ? (
            <Link href={networkLink} className={`${linkButton} border border-paper-300 text-ink-800 hover:bg-paper-100`}>
              In het netwerk van dit nieuws
            </Link>
          ) : null}
        </div>
      ) : null}

      {pmEntityId || showNetwork ? <PmAttribution /> : null}
    </section>
  );
}
