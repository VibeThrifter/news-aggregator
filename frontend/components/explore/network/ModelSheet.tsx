"use client";

import { Info } from "lucide-react";

import { FILTERS } from "@/lib/explore/labels";

import { useExplore } from "../ExploreContext";
import { Sheet } from "../ui/Sheet";
import { PmAttribution } from "./PmSection";

const FILTER_TEXT: Record<string, string> = {
  eigendom: "Wie bezit de media? Concentratie van eigendom bij grote concerns kan bepalen wat als nieuws geldt.",
  advertentie: "Wie betaalt? Media die van adverteerders of subsidie afhangen, hebben belang bij een bepaald publiek en klimaat.",
  sourcing: "Wie mag het verhaal vertellen? Journalisten leunen vaak op officiële bronnen, persberichten en vaste experts.",
  flak: "Wie oefent druk uit? Georganiseerde kritiek, klachten en rechtszaken kunnen berichtgeving sturen.",
  ideologie: "Welk wereldbeeld is vanzelfsprekend? Frames die niet ter discussie staan, bepalen wat redelijk lijkt.",
  tegenmacht: "Wat houdt macht in toom? Onafhankelijke journalistiek, toezicht en kritische stemmen werken tegen de filters in.",
};

export function ModelSheet() {
  const { panel } = useExplore();
  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title="Over het propagandamodel"
      subtitle="Herman & Chomsky, Manufacturing Consent (1988)"
      icon={<Info size={22} />}
    >
      <div className="space-y-5 text-sm leading-relaxed text-ink-800">
        <p>
          Het propagandamodel beschrijft hoe nieuws gefilterd wordt door structuren, <strong>niet door een complot</strong>.
          Eigendom, geld, bronnen, druk en ideologie werken samen, meestal zonder dat iemand dat zo bedoelt.
        </p>
        <ul className="space-y-3">
          {FILTERS.map((filter) => (
            <li key={filter.id} className="flex gap-3">
              <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: filter.color }} />
              <span>
                <strong>{filter.label}.</strong> {FILTER_TEXT[filter.id]}
              </span>
            </li>
          ))}
        </ul>
        <div className="space-y-2 rounded-xl border border-paper-300 bg-paper-100 p-3">
          <p className="font-semibold text-ink-900">Hoe lees je dit?</p>
          <p>
            Je ziet twee soorten bewijs: <strong>structurele verbanden</strong> uit het propagandamodel (wie bezit, financiert,
            adviseert of bekritiseert wie, met bronnen) en <strong>signalen in dit nieuws</strong> uit de AI-analyse (bronpatronen,
            frames, toon). Dat zijn aanwijzingen, geen bewijs van sturing en geen oordeel over personen of organisaties.
          </p>
          <p>
            &ldquo;Geen signalen&rdquo; betekent niet dat een filter geen rol speelt, alleen dat de analyse er in dit nieuws geen
            aanwijzingen voor vond.
          </p>
        </div>
        <PmAttribution />
      </div>
    </Sheet>
  );
}
