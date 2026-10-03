"use client";

import { FlaskConical } from "lucide-react";

import { ExploreHeader } from "./ExploreHeader";
import { ExploreShell, ExploreSkeleton } from "./ExploreShell";
import { FindingsTabs } from "./map/FindingsTabs";
import { NewsFigure } from "./map/NewsFigure";
import { SourcesRow } from "./sources/SourcesRow";
import { WhoIsBehind } from "./why/WhoIsBehind";

export { ExploreSkeleton };

export function DemoBanner() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <FlaskConical size={18} className="mt-0.5 shrink-0" />
      <p>
        <strong>Verzonnen voorbeeld.</strong> Dijkerhoven, de mensen, NordVind en alle uitspraken bestaan niet. De media en
        landelijke instanties (zoals RIVM en ANP) zijn echt, hun berichtgeving en rol hier niet.
      </p>
    </div>
  );
}

/**
 * The event page (Epic 14 "Eén beeld"): the head, "Wie zegt wat?" as one picture with the findings
 * per question underneath, who is behind it, and the sources.
 */
export function ExploreScreen({ eventId }: { eventId: string }) {
  return (
    <ExploreShell eventId={eventId}>
      {(exploration) => (
        <div data-explore className="mx-auto max-w-3xl space-y-7 pb-16">
          {exploration.input.event.isDemo ? <DemoBanner /> : null}
          <ExploreHeader />
          <div className="space-y-4">
            <NewsFigure />
            <FindingsTabs />
          </div>
          <WhoIsBehind />
          <SourcesRow />
        </div>
      )}
    </ExploreShell>
  );
}
