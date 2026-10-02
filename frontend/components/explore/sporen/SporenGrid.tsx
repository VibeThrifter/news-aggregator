"use client";

import { spoorProgress } from "@/lib/explore/visibility";
import { SPOREN } from "@/lib/explore/labels";

import { SPOOR_COLORS, SPOOR_ICONS, useExplore } from "../ExploreContext";
import { ProgressRing } from "../ui/primitives";

export function SporenGrid() {
  const { exploration, revealed, revealAll, panel } = useExplore();
  const progress = spoorProgress(exploration.clues, revealAll ? new Set(exploration.clues.map((clue) => clue.id)) : revealed);
  const hasCriticalFields = Boolean(
    exploration.input.insight?.authority_analysis || exploration.input.insight?.media_analysis,
  );

  return (
    <section aria-labelledby="sporen-title" className="space-y-3">
      <div>
        <h2 id="sporen-title" className="font-serif text-xl font-bold text-ink-900">
          Onderzoek het zelf
        </h2>
        <p className="text-sm text-ink-500">Kies een spoor. Achter elke kaart zit een aanwijzing.</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SPOREN.map((spoor) => {
          const Icon = SPOOR_ICONS[spoor.id];
          const entry = progress.get(spoor.id) ?? { revealed: 0, total: 0 };
          const empty = entry.total === 0;
          const reason =
            spoor.id === "buitenland"
              ? "Geen andere landen"
              : !hasCriticalFields && ["wie-heeft-belang", "wat-zie-je-niet", "hoe-gebracht"].includes(spoor.id)
                ? "Oudere analyse zonder kritische velden"
                : "Niets gevonden";
          return (
            <li key={spoor.id}>
              <button
                type="button"
                disabled={empty}
                onClick={() => panel.open(`spoor:${spoor.id}`)}
                className="group flex h-full min-h-[112px] w-full flex-col justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 text-left shadow-card-light transition hover:-translate-y-0.5 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                style={{ borderTopColor: empty ? undefined : SPOOR_COLORS[spoor.id], borderTopWidth: empty ? undefined : 3 }}
              >
                <div className="flex items-start justify-between gap-2">
                  <Icon size={20} style={{ color: SPOOR_COLORS[spoor.id] }} aria-hidden="true" />
                  {!empty ? <ProgressRing value={entry.revealed} total={entry.total} size={34} color={SPOOR_COLORS[spoor.id]} /> : null}
                </div>
                <div>
                  <p className="font-semibold leading-snug text-ink-900">{spoor.question}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {empty ? reason : `${entry.total} ${entry.total === 1 ? "aanwijzing" : "aanwijzingen"}`}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
