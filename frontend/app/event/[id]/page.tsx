import { Suspense } from "react";

import { ExploreScreen, ExploreSkeleton } from "@/components/explore/ExploreScreen";

import EventDetailScreen from "./EventDetailScreen";

interface DetailPageProps {
  params: {
    id: string;
  };
}

export const revalidate = 0;

/** Epic 11: the Onderzoeksmodus replaces the old page when enabled, and always for demo events. */
function shouldUseExploreUi(identifier: string): boolean {
  if (process.env.NEXT_PUBLIC_EXPLORE_UI === "1") return true;
  return process.env.NEXT_PUBLIC_ENABLE_DEMO === "true" && identifier === "demo";
}

export default function EventDetailPage({ params }: DetailPageProps) {
  const eventIdentifier = decodeURIComponent(params.id);
  if (shouldUseExploreUi(eventIdentifier)) {
    return (
      <Suspense fallback={<ExploreSkeleton />}>
        <ExploreScreen eventId={eventIdentifier} />
      </Suspense>
    );
  }
  return <EventDetailScreen eventId={eventIdentifier} />;
}
