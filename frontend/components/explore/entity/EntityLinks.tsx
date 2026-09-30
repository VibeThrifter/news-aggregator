"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { buildEntityLinks, type EntityLink } from "@/lib/explore/entity-linker";

import { useExplore } from "../ExploreContext";

export interface EntityLinksValue {
  /** Link targets of this event (outlets, people, organisations, authorities, unique surnames) */
  links: EntityLink[];
  /** Open the entity panel ("Wie is dit?") */
  openEntity: (key: string, name: string) => void;
}

export const EntityLinksContext = createContext<EntityLinksValue | null>(null);

/** null outside the explore shell: texts then stay plain. */
export const useEntityLinks = () => useContext(EntityLinksContext);

/** Builds the event's link targets once, so any text in the explore UI can make names tappable. */
export function EntityLinksProvider({ children }: { children: ReactNode }) {
  const { exploration, panel } = useExplore();
  const { input } = exploration;
  const open = panel.open;

  const links = useMemo(
    () =>
      buildEntityLinks({
        outlets: input.outlets,
        entities: input.entities,
        authorities: (input.insight?.authority_analysis ?? []).map((authority) => authority.authority),
      }),
    [input],
  );
  const openEntity = useCallback((key: string, name: string) => open(`entiteit:${key}`, { n: name }), [open]);
  const value = useMemo(() => ({ links, openEntity }), [links, openEntity]);

  return <EntityLinksContext.Provider value={value}>{children}</EntityLinksContext.Provider>;
}
