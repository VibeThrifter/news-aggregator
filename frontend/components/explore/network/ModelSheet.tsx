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
  formele_macht: "Wie mag hierover besluiten? Kabinet en ministeries met hun topambtenaren, uitvoeringsorganisaties, gemeenten, provincies, waterschappen en de EU.",
  belangen: "Wie heeft er belang bij, en hoe komt het binnen? Lobby met een toegangspas tot de Kamer, geschenken en betaalde reizen, subsidies en nevenfuncties.",
  kennis_advies: "Wie levert de kennis en het advies? De Raad van State, planbureaus, adviescolleges, consultants en denktanks.",
  polder: "Wie zit er aan tafel? Werkgevers en vakbonden in de SER en bij akkoorden die vastliggen voordat de Kamer erover praat.",
  werving: "Wie komt waar terecht, en via wie? Benoemingen, kandidatenlijsten en de overstap tussen politiek, ambtenarij, bedrijfsleven en media.",
};

function FilterList({ group }: { group: "media" | "besluitvorming" }) {
  return (
    <ul className="space-y-3">
      {FILTERS.filter((filter) => filter.group === group).map((filter) => (
        <li key={filter.id} className="flex gap-3">
          <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: filter.color }} />
          <span>
            <strong>{filter.label}.</strong> {FILTER_TEXT[filter.id]}
          </span>
        </li>
      ))}
    </ul>
  );
}

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
        <FilterList group="media" />
        <div className="space-y-3">
          <h3 className="font-serif text-lg font-bold text-ink-900">Besluitvorming</h3>
          <p>
            In hetzelfde netwerk staat ook wie besluit en wie daar invloed op heeft, naar G. William Domhoff (<em>Who Rules
            America?</em>). Eén verband kan in meer categorieën vallen.
          </p>
          <FilterList group="besluitvorming" />
        </div>
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
