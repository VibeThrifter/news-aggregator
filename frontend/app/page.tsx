import { Suspense } from "react";

import EventFeed, { FrontPageSkeleton } from "@/components/EventFeed";

function EventFeedFallback() {
  return (
    <div className="space-y-5">
      <div className="flex justify-center gap-1.5 overflow-hidden py-2" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="h-10 w-24 shrink-0 animate-pulse rounded-full bg-paper-200" />
        ))}
      </div>
      <span className="mx-auto block h-10 w-full max-w-2xl animate-pulse rounded-full bg-paper-200" aria-hidden="true" />
      <FrontPageSkeleton />
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="space-y-8">
      <Suspense fallback={<EventFeedFallback />}>
        <EventFeed />
      </Suspense>
    </div>
  );
}
