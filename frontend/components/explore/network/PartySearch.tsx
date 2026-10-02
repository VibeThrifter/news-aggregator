"use client";

import { useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";

import { pmSearch } from "@/lib/api";
import { filterColor, pmTypeLabel } from "@/lib/explore/labels";
import type { PmEntity } from "@/lib/types";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

/** Search the propaganda model for a second party ("Zoek verband met …"), in the event network and on the actor page. */
export function PartySearch({ exclude, onPick, label, demo }: { exclude: number; onPick: (entity: PmEntity) => void; label: string; demo: boolean }) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useSWR(query.trim().length >= 2 ? ["pm-search", query.trim(), demo] : null, () => pmSearch(query, { demo }), exploreAuxSwrOptions);
  const results = (data ?? []).filter((entity: PmEntity) => entity.id !== exclude);
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 rounded-full border border-paper-300 bg-paper-50 px-3">
        <Search size={16} className="text-ink-400" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Naam van een persoon, bedrijf of medium…"
          className="min-h-[40px] w-full bg-transparent text-base outline-none sm:text-sm"
          aria-label={label}
          autoFocus
        />
      </label>
      {query.trim().length >= 2 ? (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto" aria-label="Gevonden">
          {isLoading ? <li className="p-2 text-sm text-ink-500">Zoeken…</li> : null}
          {results.map((entity: PmEntity) => (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() => onPick(entity)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-paper-100"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: filterColor(entity.primary_filter as string) }} aria-hidden="true" />
                <span className="flex-1 font-medium">{entity.name}</span>
                <span className="text-xs text-ink-500">{pmTypeLabel(entity.type)}</span>
              </button>
            </li>
          ))}
          {!isLoading && data && results.length === 0 ? <li className="p-2 text-sm text-ink-500">Niets gevonden</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
