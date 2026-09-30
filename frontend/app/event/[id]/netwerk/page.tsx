import { Suspense } from "react";

import { NetworkScreen } from "@/components/explore/network/NetworkScreen";

export const revalidate = 0;

export default function EventNetworkPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={null}>
      <NetworkScreen eventId={decodeURIComponent(params.id)} />
    </Suspense>
  );
}
