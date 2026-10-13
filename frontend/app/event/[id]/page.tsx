import { Suspense } from "react";

import { ExploreScreen, ExploreSkeleton } from "@/components/explore/ExploreScreen";

interface DetailPageProps {
  params: {
    id: string;
  };
}

export const revalidate = 0;

export default function EventDetailPage({ params }: DetailPageProps) {
  const eventIdentifier = decodeURIComponent(params.id);
  return (
    <Suspense fallback={<ExploreSkeleton />}>
      <ExploreScreen eventId={eventIdentifier} />
    </Suspense>
  );
}
