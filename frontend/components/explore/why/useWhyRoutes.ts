"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { pmMatch, pmPaths } from "@/lib/api";
import { actorKeys } from "@/lib/explore/normalize";
import { eventActorAliases, eventOutletSeeds, followedOutletIds, matchActorIds } from "@/lib/explore/pm-seeds";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { useExplore } from "../ExploreContext";

/**
 * Epic 13/14: routes (at most two steps) from every followed outlet — also those that did not bring
 * this news — to the parties and speakers of this news. One request per news item, shared by "Wie zit
 * erachter?" and the filters sheet.
 */
export function useWhyRoutes(enabled = true) {
  const { exploration } = useExplore();
  const { input } = exploration;
  const demo = input.event.isDemo;
  const newsOutletIds = useMemo(() => eventOutletSeeds(input).map((seed) => seed.id), [input]);
  const from = useMemo(() => Array.from(new Set([...newsOutletIds, ...followedOutletIds()])).slice(0, 12), [newsOutletIds]);
  // Named people/organisations, authorities, and the speakers parsed from the analysis
  const actors = useMemo(
    () => [
      ...eventActorAliases(input),
      ...exploration.speakers.speakers
        .filter((speaker) => speaker.kind === "person" || speaker.kind === "org")
        .map((speaker) => ({ aliases: actorKeys(speaker.name, { person: speaker.kind === "person" }).aliases, kind: speaker.kind as "person" | "org" })),
    ],
    [input, exploration.speakers],
  );

  // Speakers the reader adds join the lookup right away (their names are part of the key)
  const actorKey = useMemo(() => actors.map((actor) => actor.aliases[0] ?? "").join("|"), [actors]);
  const matches = useSWR(
    enabled && actors.length ? ["pm-news-actors", input.event.id, demo, actorKey] : null,
    () => pmMatch(actors.flatMap((actor) => actor.aliases), { demo }),
    exploreAuxSwrOptions,
  );
  const actorIds = useMemo(
    () => (matches.data ? matchActorIds(actors, matches.data, new Set(from)).slice(0, 40) : null),
    [actors, matches.data, from],
  );
  const routes = useSWR(
    enabled && actorIds && actorIds.length ? ["why-routes", input.event.id, demo, from.join(","), actorIds.join(",")] : null,
    () => pmPaths(from, actorIds as number[], { demo, maxHops: 2, limit: 2 }),
    exploreAuxSwrOptions,
  );

  const settled = !matches.isLoading && !routes.isLoading;
  return {
    newsOutletIds,
    actorIds,
    paths: routes.data ?? null,
    loading: enabled && (matches.isLoading || routes.isLoading),
    /** No party of this news is in the model */
    noActors: settled && (actors.length === 0 || (actorIds !== null && actorIds.length === 0)),
    /** The routes could not be looked up (the database function is missing or the call failed) */
    unavailable: settled && Boolean(actorIds?.length) && (Boolean(routes.error) || routes.data === null),
  };
}

/**
 * Epic 15: routes (at most two steps) between the parties of this news themselves, for "Hoe hangen
 * ze samen?" (decision-making ties are filtered by the caller, governanceRoutes).
 */
export function useBetweenRoutes(actorIds: number[] | null, enabled = true) {
  const { exploration } = useExplore();
  const { input } = exploration;
  const demo = input.event.isDemo;
  const ids = actorIds ?? [];
  const between = useSWR(
    enabled && ids.length >= 2 ? ["between-routes", input.event.id, demo, ids.join(",")] : null,
    () => pmPaths(ids.slice(0, 12), ids, { demo, maxHops: 2, limit: 1 }),
    exploreAuxSwrOptions,
  );
  return { paths: between.data ?? null, loading: between.isLoading };
}
