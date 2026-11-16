"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

import { ScrollRow } from "@/components/explore/ui/ScrollRow";
import { CATEGORIES } from "@/lib/categories";
import {
  countrySpots,
  dutchSpots,
  fetchPlaceRows,
  itemsLabel,
  parseBeeld,
  parsePeriode,
  PERIODE_LABEL,
  PERIODE_PHRASE,
  visibleRows,
  type Beeld,
  type Periode,
  type Spot,
} from "@/lib/kaart/data";

import { NederlandMap } from "./NederlandMap";
import { PlaceNews } from "./PlaceNews";
import { WorldGlobe } from "./WorldGlobe";

const BEELDEN: { value: Beeld; label: string }[] = [
  { value: "nederland", label: "Nederland" },
  { value: "wereld", label: "Wereld" },
];
const PERIODES: Periode[] = ["vandaag", "week", "maand"];
// Sport gets no places (clubs and teams are town and country names)
const KAART_CATEGORIES = CATEGORIES.filter((category) => category.slug !== "sports");
/** Pills under the map before "Alle …" */
const FIRST_PILLS = 12;

function pillClass(active: boolean): string {
  return `inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors ${
    active ? "border-ink-900 bg-ink-900 text-paper-50" : "border-paper-300 bg-paper-50 text-ink-800 hover:bg-paper-200"
  }`;
}

/** Waar speelt het nieuws? The Netherlands per place, the world per country (Story 14.38). */
export function KaartPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const beeld = parseBeeld(params.get("beeld"));
  const periode = parsePeriode(params.get("periode"));
  const category = KAART_CATEGORIES.some((item) => item.slug === params.get("categorie")) ? (params.get("categorie") as string) : "all";
  const plek = params.get("plek");
  const [allPills, setAllPills] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, error, isLoading } = useSWR(["kaart", periode], () => fetchPlaceRows(periode), {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
  });

  const spots = useMemo(() => {
    if (!data) return [];
    const rows = visibleRows(data.rows, { mainSources: data.mainSources, category });
    return beeld === "nederland" ? dutchSpots(rows) : countrySpots(rows);
  }, [beeld, category, data]);

  // Open with the place that has the most news: there is something to read straight away
  const selected: Spot | null = spots.find((spot) => spot.key === plek) ?? spots[0] ?? null;
  const total = useMemo(() => new Set(spots.flatMap((spot) => spot.items.map((item) => item.id))).size, [spots]);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  useEffect(() => setAllPills(false), [beeld, periode, category]);

  const pills = allPills ? spots : spots.slice(0, FIRST_PILLS);

  return (
    <div className="mx-auto w-full max-w-6xl pb-12 pt-2 lg:pt-4">
      <h1 className="font-serif text-[28px] font-bold leading-tight text-ink-900 sm:text-3xl">Waar speelt het nieuws?</h1>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          {BEELDEN.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={beeld === item.value}
              className={pillClass(beeld === item.value)}
              onClick={() => update({ beeld: item.value === "nederland" ? null : item.value, plek: null })}
            >
              {item.label}
            </button>
          ))}
          <span aria-hidden="true" className="mx-1 hidden w-px self-stretch bg-paper-300 sm:block" />
          {PERIODES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={periode === item}
              className={pillClass(periode === item)}
              onClick={() => update({ periode: item === "week" ? null : item, plek: null })}
            >
              {PERIODE_LABEL[item]}
            </button>
          ))}
        </div>
        <ScrollRow className="gap-2" aria-label="Categorie">
          {KAART_CATEGORIES.map((item) => (
            <button
              key={item.slug}
              type="button"
              aria-pressed={category === item.slug}
              className={pillClass(category === item.slug)}
              onClick={() => update({ categorie: item.slug === "all" ? null : item.slug, plek: null })}
            >
              {item.label}
            </button>
          ))}
        </ScrollRow>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <div className="rounded-2xl border border-paper-300 bg-paper-50 p-3 sm:p-5">
          {error ? (
            <p className="p-6 text-sm text-ink-600">De kaart kon niet laden. Probeer het later opnieuw.</p>
          ) : isLoading && !data ? (
            <div className="aspect-square w-full animate-pulse rounded-2xl bg-paper-200" aria-hidden="true" />
          ) : (
            <>
              <div className={beeld === "nederland" ? "mx-auto max-w-[440px]" : ""}>
                {beeld === "nederland" ? (
                  <NederlandMap spots={spots} selected={selected?.key ?? null} onSelect={(key) => update({ plek: key })} />
                ) : (
                  <WorldGlobe spots={spots} selected={selected?.key ?? null} onSelect={(key) => update({ plek: key })} />
                )}
              </div>
              <p className="mt-3 text-sm text-ink-500">
                {spots.length
                  ? `${itemsLabel(total)} ${PERIODE_PHRASE[periode]} op ${spots.length} ${
                      beeld === "nederland" ? (spots.length === 1 ? "plek" : "plekken") : spots.length === 1 ? "land" : "landen"
                    }`
                  : `Geen plekken ${PERIODE_PHRASE[periode]}`}
              </p>
              {spots.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {pills.map((spot) => (
                    <button
                      key={spot.key}
                      type="button"
                      aria-pressed={spot.key === selected?.key}
                      className={pillClass(spot.key === selected?.key)}
                      onClick={() => update({ plek: spot.key })}
                    >
                      {spot.name}
                      <span className={spot.key === selected?.key ? "text-paper-300" : "text-ink-400"}>{spot.items.length}</span>
                    </button>
                  ))}
                  {spots.length > FIRST_PILLS ? (
                    <button type="button" className={pillClass(false)} onClick={() => setAllPills((value) => !value)}>
                      {allPills ? "Minder" : `Alle ${spots.length}`}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        {selected ? (
          <PlaceNews
            spot={selected}
            periode={periode}
            expanded={expanded === selected.key}
            onExpand={() => setExpanded(selected.key)}
          />
        ) : null}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-ink-500">
        Een plek telt als de kop of het begin van een artikel haar noemt. Kaart: Natural Earth, CBS · Plaatsnamen: GeoNames
      </p>
    </div>
  );
}
