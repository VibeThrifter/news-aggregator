import { Suspense } from "react";

import EventFeed from "@/components/EventFeed";

function EventFeedFallback() {
  return (
    <div className="space-y-6">
      {/* Category nav skeleton */}
      <nav className="sticky top-0 z-10 -mx-4 bg-slate-900/95 backdrop-blur-sm sm:-mx-6 lg:-mx-8">
        <div className="flex items-center gap-1 overflow-x-auto px-4 py-3 sm:justify-center sm:gap-2 sm:px-6 lg:px-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className="h-9 w-20 animate-pulse rounded-full bg-slate-700"
              aria-hidden="true"
            />
          ))}
        </div>
      </nav>

      {/* Status banner skeleton */}
      <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3">
        <span className="h-4 w-32 animate-pulse rounded bg-slate-700" aria-hidden="true" />
        <span className="h-8 w-24 animate-pulse rounded-full bg-slate-700" aria-hidden="true" />
      </div>

      {/* Event cards skeleton */}
      <div className="grid gap-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-sm"
          >
            <div className="flex flex-col gap-4">
              <div className="space-y-3">
                <span className="block h-4 w-24 rounded-full bg-slate-700" aria-hidden="true" />
                <span className="block h-6 w-3/4 rounded-full bg-slate-700" aria-hidden="true" />
                <span className="block h-4 w-1/2 rounded-full bg-slate-700" aria-hidden="true" />
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-block h-6 w-24 rounded-full bg-slate-700" aria-hidden="true" />
                <span className="inline-block h-6 w-20 rounded-full bg-slate-700" aria-hidden="true" />
              </div>
            </div>
          </div>
        ))}
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
