"use client";

import { FlaskConical } from "lucide-react";

import { ExploreHeader } from "./ExploreHeader";
import { ExploreShell, ExploreSkeleton } from "./ExploreShell";
import { BubbleMap } from "./bubbles/BubbleMap";
import { Dock } from "./dossier/Dock";
import { RelatedTrail } from "./related/RelatedTrail";
import { SourcesRow } from "./sources/SourcesRow";
import { SporenGrid } from "./sporen/SporenGrid";
import { SummaryTeaser } from "./SummaryTeaser";

export { ExploreSkeleton };

export function DemoBanner() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <FlaskConical size={18} className="mt-0.5 shrink-0" />
      <p>
        <strong>Verzonnen voorbeeld.</strong> Dijkerhoven, de personen, organisaties en citaten bestaan niet. De bronnamen zijn
        echt, hun berichtgeving hier niet. Bedoeld om de onderzoeksmodus te proberen.
      </p>
    </div>
  );
}

export function ExploreScreen({ eventId }: { eventId: string }) {
  return (
    <ExploreShell eventId={eventId}>
      {(exploration) => (
        <>
          <div data-explore className="mx-auto max-w-3xl space-y-6 pb-32">
            {exploration.input.event.isDemo ? <DemoBanner /> : null}
            <ExploreHeader />
            <BubbleMap />
            <SummaryTeaser />
            <SporenGrid />
            <RelatedTrail />
            <SourcesRow />
          </div>
          <Dock />
        </>
      )}
    </ExploreShell>
  );
}
