"use client";

import type { ReactNode } from "react";

import { OWNERSHIP_TYPE_LABELS } from "@/lib/explore/media-landscape";

import { dossierIds, useExplore } from "../ExploreContext";
import { Favicon } from "../ui/primitives";
import { Draggable } from "./ExploreDnd";

/** An outlet that can be long-pressed and dragged into the dossier or the compare tray. */
export function DraggableOutlet({ id, outletKey, children, className }: { id: string; outletKey: string; children: ReactNode; className?: string }) {
  const { exploration } = useExplore();
  const outlet = exploration.index.outlet(outletKey);
  if (!outlet) return <>{children}</>;
  const ownership = outlet.profile?.ownershipType;
  return (
    <Draggable
      id={id}
      className={className}
      payload={{
        label: outlet.name,
        icon: <Favicon name={outlet.name} domain={outlet.domain} size={16} />,
        outletKey,
        pin: {
          id: dossierIds.outlet(outletKey),
          kind: "outlet",
          eventId: null,
          refId: outletKey,
          title: outlet.name,
          subtitle: ownership && ownership !== "unknown" ? OWNERSHIP_TYPE_LABELS[ownership] : undefined,
          outletKey,
          keys: [`outlet:${outletKey}`, ...(outlet.profile?.pmEntityId ? [`pm:${outlet.profile.pmEntityId}`] : [])],
        },
      }}
    >
      {children}
    </Draggable>
  );
}
