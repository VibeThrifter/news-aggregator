"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Network } from "lucide-react";

import { eventOutletSeeds } from "@/lib/explore/pm-seeds";
import { whyRoutesFor, type WhyRoute } from "@/lib/explore/why";

import { useExplore } from "../ExploreContext";
import { RouteList } from "../network/RouteList";
import { PmAttribution } from "../network/PmSection";
import { Tag } from "../ui/primitives";
import { useWhyRoutes } from "./useWhyRoutes";

/** Routes shown on the event page */
const SHOWN = 3;

/**
 * "Wie zit erachter?" (Epic 14): the most specific routes in the propaganda model between the
 * outlets of this news and its parties and speakers. Routes every outlet shares explain no
 * difference, so they come after an outlet's own; ownership comes last (the weakest route: owning
 * is no proof of steering). Loaded once the block scrolls into view.
 */
export function WhoIsBehind() {
  const { exploration, eventId, panel } = useExplore();
  const { input } = exploration;
  const seeds = useMemo(() => eventOutletSeeds(input), [input]);
  const block = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

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
  const routes: WhyRoute[] = useMemo(() => {
    const all = why.newsOutletIds.flatMap((id) => whyRoutesFor(why.paths, id, why.newsOutletIds, SHOWN));
    return all
      .sort((a, b) => Number(a.ownership) - Number(b.ownership) || a.sharedInNews.length - b.sharedInNews.length || a.route.hops - b.route.hops)
      .slice(0, SHOWN);
  }, [why.paths, why.newsOutletIds]);
  const entities = useMemo(() => new Map((why.paths?.entities ?? []).map((entity) => [entity.id, entity])), [why.paths]);
  const relations = useMemo(() => new Map((why.paths?.relations ?? []).map((relation) => [relation.id, relation])), [why.paths]);

  if (seeds.length === 0 || why.unavailable) return null;
  const networkHref = `/event/${encodeURIComponent(input.event.slug ?? String(eventId))}/netwerk`;

  return (
    <section ref={block} aria-labelledby="behind-title" className="space-y-2" aria-busy={why.loading}>
      <div className="flex items-end justify-between gap-3">
        <h2 id="behind-title" className="font-serif text-xl font-bold text-ink-900">
          Wie zit erachter?
        </h2>
        <Link
          href={networkHref}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 text-sm font-semibold text-ink-800 hover:bg-paper-100"
        >
          <Network size={15} /> Netwerk
        </Link>
      </div>
      {!inView || why.loading ? <div className="h-24 animate-pulse rounded-2xl bg-paper-200" /> : null}
      {inView && !why.loading && why.noActors ? <p className="text-sm text-ink-600">Geen partij uit dit nieuws in het propagandamodel.</p> : null}
      {inView && !why.loading && !why.noActors && routes.length === 0 ? (
        <p className="text-sm text-ink-600">Geen verband binnen twee stappen tussen de bronnen en de partijen van dit nieuws.</p>
      ) : null}
      {routes.length ? (
        <RouteList
          routes={routes.map((item) => item.route)}
          entities={entities}
          relations={relations}
          onRelation={(id) => panel.open(`pm:relation:${id}`)}
          label="Routes tussen de bronnen en de partijen van dit nieuws"
          note={(route) => {
            const item = routes.find((candidate) => candidate.route === route);
            if (!item) return null;
            if (item.ownership) return <Tag>eigendom</Tag>;
            return item.sharedInNews.length ? null : <Tag tone="blue">alleen {entities.get(route.from)?.name}</Tag>;
          }}
        />
      ) : null}
      {routes.length ? <PmAttribution /> : null}
    </section>
  );
}
