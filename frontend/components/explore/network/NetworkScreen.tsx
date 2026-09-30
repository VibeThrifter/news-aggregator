"use client";

import { ExploreShell } from "../ExploreShell";
import { NetworkView } from "./NetworkView";

export function NetworkScreen({ eventId }: { eventId: string }) {
  return <ExploreShell eventId={eventId}>{() => <NetworkView />}</ExploreShell>;
}
