"use client";

import type { ReactNode } from "react";
import { ArrowLeftRight, Scale } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { objectivity } from "@/lib/explore/bias";
import { contradictionsBetween, outletProfileView, type OutletProfileView } from "@/lib/explore/compare";
import { useExploreStore } from "@/lib/explore/store";

import { useExplore } from "../ExploreContext";
import { OutletCard } from "../outlet/OutletCard";
import { Chip, Eyebrow, Favicon } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";

function Cell({ children }: { children: ReactNode }) {
  return <div className="min-w-0 text-sm leading-snug text-ink-800">{children ?? <span className="text-ink-400">—</span>}</div>;
}

function CompareRow({ label, a, b, differ }: { label: string; a: ReactNode; b: ReactNode; differ?: boolean }) {
  return (
    <div className={`space-y-1 rounded-xl p-2 ${differ ? "bg-amber-50" : ""}`}>
      <Eyebrow>{label}</Eyebrow>
      <div className="grid grid-cols-2 gap-3">
        <Cell>{a}</Cell>
        <Cell>{b}</Cell>
      </div>
    </div>
  );
}

const joinOr = (items: string[]) => (items.length ? items.join(", ") : null);

function OutletPicker({ exclude, onPick }: { exclude: (string | null)[]; onPick: (key: string) => void }) {
  const { exploration } = useExplore();
  const options = exploration.input.outlets.filter((outlet) => !outlet.isInternational && !exclude.includes(outlet.key));
  return (
    <div className="space-y-2">
      <Eyebrow>Kies een bron om mee te vergelijken</Eyebrow>
      <div className="flex flex-wrap gap-1.5">
        {options.map((outlet) => (
          <Chip key={outlet.key} icon={<Favicon name={outlet.name} domain={outlet.domain} size={14} />} onClick={() => onPick(outlet.key)}>
            {outlet.name}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function CompareSheet() {
  const { exploration, panel, eventId } = useExplore();
  const { compare, setCompareSlot, swapCompare, clearCompare } = useExploreStore(
    useShallow((state) => ({
      compare: state.compare,
      setCompareSlot: state.setCompareSlot,
      swapCompare: state.swapCompare,
      clearCompare: state.clearCompare,
    })),
  );
  const a = compare.eventId === eventId ? compare.a : null;
  const b = compare.eventId === eventId ? compare.b : null;
  const viewA = a ? outletProfileView(a, exploration.input, exploration.findings, exploration.index) : null;
  const viewB = b ? outletProfileView(b, exploration.input, exploration.findings, exploration.index) : null;
  const between = a && b ? contradictionsBetween(a, b, exploration.findings) : [];

  const differ = (pick: (view: OutletProfileView) => unknown) =>
    viewA && viewB ? JSON.stringify(pick(viewA)) !== JSON.stringify(pick(viewB)) : false;

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title="Vergelijk"
      icon={<Scale size={22} />}
    >
      {!viewA || !viewB ? (
        <div className="space-y-4">
          {viewA ? <OutletCard outletKey={viewA.outlet.key} /> : null}
          <OutletPicker exclude={[a, b]} onPick={(key) => setCompareSlot(eventId, key)} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[viewA, viewB].map((view) => (
              <div key={view.outlet.key} className="flex items-center gap-2">
                <Favicon name={view.outlet.name} domain={view.outlet.domain} size={22} />
                <span className="truncate font-semibold text-ink-900">{view.outlet.name}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Chip icon={<ArrowLeftRight size={14} />} onClick={swapCompare}>
              Wissel
            </Chip>
            <Chip onClick={clearCompare}>Opnieuw kiezen</Chip>
          </div>

          {between.length ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <Eyebrow className="text-red-700">Ze spreken elkaar tegen</Eyebrow>
              {between.map((finding) =>
                finding.body.type === "contradiction" ? (
                  <p key={finding.id} className="mt-1 font-semibold">
                    {finding.body.contradiction.topic}
                  </p>
                ) : null,
              )}
            </div>
          ) : null}

          <CompareRow
            label="Invalshoek"
            a={joinOr(viewA.perspectives.map((p) => p.label))}
            b={joinOr(viewB.perspectives.map((p) => p.label))}
            differ={differ((view) => view.perspectives.map((p) => p.label))}
          />
          <CompareRow
            label="Standpunt"
            a={viewA.perspectives[0]?.stance ? `“${viewA.perspectives[0].stance}”` : null}
            b={viewB.perspectives[0]?.stance ? `“${viewB.perspectives[0].stance}”` : null}
          />
          <CompareRow label="Toon" a={viewA.tone} b={viewB.tone} differ={differ((view) => view.tone)} />
          <CompareRow label="Eigen frames" a={joinOr(viewA.ownFrames)} b={joinOr(viewB.ownFrames)} differ={differ((view) => view.ownFrames)} />
          <CompareRow
            label="Aan het woord"
            a={joinOr(viewA.voices.map((voice) => voice.name))}
            b={joinOr(viewB.voices.map((voice) => voice.name))}
            differ={differ((view) => view.voices.map((voice) => voice.name))}
          />
          <CompareRow label="Bronpatroon" a={viewA.sourcingPattern} b={viewB.sourcingPattern} />
          <CompareRow
            label="Kopieergedrag · anoniem"
            a={[viewA.copyPaste, viewA.anonymousSources ? `${viewA.anonymousSources} anoniem` : null].filter(Boolean).join(" · ") || null}
            b={[viewB.copyPaste, viewB.anonymousSources ? `${viewB.anonymousSources} anoniem` : null].filter(Boolean).join(" · ") || null}
          />
          <CompareRow
            label="Objectiviteit eigen tekst"
            a={viewA.bias ? `${objectivity(viewA.bias.averageRating)}%` : null}
            b={viewB.bias ? `${objectivity(viewB.bias.averageRating)}%` : null}
            differ={Boolean(viewA.bias && viewB.bias && Math.abs(viewA.bias.averageRating - viewB.bias.averageRating) > 0.15)}
          />
          <CompareRow
            label="Claims zonder bewijs"
            a={String(viewA.claimCount)}
            b={String(viewB.claimCount)}
            differ={viewA.claimCount !== viewB.claimCount}
          />
          <CompareRow label="Niet gevraagd" a={viewA.questionsNotAsked[0] ?? null} b={viewB.questionsNotAsked[0] ?? null} />
        </div>
      )}
    </Sheet>
  );
}
