"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { AlertTriangle } from "lucide-react";

import { ApiClientError } from "@/lib/api";
import type { Exploration } from "@/lib/explore/exploration";
import { useExploreHydration } from "@/lib/explore/hooks";
import { useExploration } from "@/lib/explore/useExploration";

import { ExploreProvider } from "./ExploreContext";
import { ExploreDndProvider } from "./dnd/ExploreDnd";
import { EntityLinksProvider } from "./entity/EntityLinks";
import { PanelHost } from "./PanelHost";
import { ToastProvider } from "./ui/Toast";

export function ExploreSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-28" aria-busy="true" aria-label="Event laden">
      <div className="space-y-3 rounded-2xl border border-paper-300 bg-paper-50 p-5">
        <span className="block h-3 w-40 animate-pulse rounded bg-paper-200" />
        <span className="block h-7 w-4/5 animate-pulse rounded bg-paper-200" />
        <span className="block h-4 w-1/2 animate-pulse rounded bg-paper-200" />
      </div>
      <div className="h-72 animate-pulse rounded-2xl border border-paper-300 bg-paper-100" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="h-24 animate-pulse rounded-2xl bg-paper-200" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notFound = error instanceof ApiClientError && error.status === 404;
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={18} />
        {notFound ? "Dit event bestaat niet (meer)" : "Kon dit event niet laden"}
      </div>
      <p className="mt-2 text-sm">
        {notFound ? "Misschien is het gearchiveerd of is de link verouderd." : "De database is niet bereikbaar. Probeer het zo nog eens."}
      </p>
      {!notFound ? (
        <button type="button" onClick={onRetry} className="mt-4 min-h-[44px] rounded-full border border-red-300 bg-white px-5 text-sm font-semibold text-red-800">
          Opnieuw proberen
        </button>
      ) : null}
    </div>
  );
}

/** Loads an event and provides everything the Onderzoeksmodus screens share (store, toasts, drag & drop, sheets). */
export function ExploreShell({ eventId, children }: { eventId: string; children: (exploration: Exploration) => ReactNode }) {
  const hydrated = useExploreHydration();
  const { exploration, error, retry } = useExploration(eventId);

  if (error && !exploration) {
    return <ErrorState error={error} onRetry={retry} />;
  }
  if (!exploration || !hydrated) {
    return <ExploreSkeleton />;
  }

  return (
    <ToastProvider>
      <ExploreProvider exploration={exploration}>
        <EntityLinksProvider>
          <ExploreDndProvider>
            <MotionConfig reducedMotion="user">
              {children(exploration)}
              <PanelHost />
            </MotionConfig>
          </ExploreDndProvider>
        </EntityLinksProvider>
      </ExploreProvider>
    </ToastProvider>
  );
}
