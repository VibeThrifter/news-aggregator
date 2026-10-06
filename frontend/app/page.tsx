import { Suspense } from "react";

import EventFeed from "@/components/EventFeed";

function EventFeedFallback() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Nieuws laden">
      <div className="flex gap-1.5 overflow-hidden py-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="h-10 w-24 shrink-0 animate-pulse rounded-full bg-paper-200" aria-hidden="true" />
        ))}
      </div>
      <span className="block h-10 w-full animate-pulse rounded-full bg-paper-200 lg:w-80" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="aspect-[4/3] animate-pulse rounded-3xl bg-paper-200 lg:col-span-5" />
        <div className="space-y-4 lg:col-span-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <span className="h-24 w-32 shrink-0 animate-pulse rounded-2xl bg-paper-200" aria-hidden="true" />
              <span className="flex-1 space-y-2">
                <span className="block h-4 w-11/12 animate-pulse rounded-full bg-paper-200" />
                <span className="block h-4 w-2/3 animate-pulse rounded-full bg-paper-200" />
              </span>
            </div>
          ))}
        </div>
        <div className="hidden h-96 animate-pulse rounded-2xl bg-paper-200 lg:col-span-3 lg:block" />
      </div>
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
