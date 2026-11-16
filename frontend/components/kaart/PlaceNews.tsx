"use client";

import Link from "next/link";

import { resolveEventSlug } from "@/lib/format";
import { itemsLabel, PERIODE_PHRASE, whenLabel, type Periode, type Spot } from "@/lib/kaart/data";

/** Show this many rows, the rest after "Meer" */
const FIRST = 12;

/** The news of one place: name, how much, then a row per news item that opens its page. */
export function PlaceNews({
  spot,
  periode,
  expanded,
  onExpand,
}: {
  spot: Spot;
  periode: Periode;
  expanded: boolean;
  onExpand: () => void;
}) {
  const rows = expanded ? spot.items : spot.items.slice(0, FIRST);
  return (
    <section className="rounded-2xl border border-paper-300 bg-paper-50 p-4 sm:p-5" aria-live="polite">
      <h2 className="font-serif text-xl font-bold leading-snug text-ink-900">{spot.name}</h2>
      <p className="mt-1 text-sm text-ink-500">
        {itemsLabel(spot.items.length)} {PERIODE_PHRASE[periode]}
        {spot.detail ? ` · ${spot.detail}` : ""}
      </p>
      <ul className="mt-3 divide-y divide-paper-300">
        {rows.map((item) => (
          <li key={item.id}>
            <Link
              href={resolveEventSlug(item)}
              className="group block py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
            >
              <span className="block font-serif text-[15px] font-bold leading-snug text-ink-900 decoration-1 underline-offset-4 group-hover:underline">
                {item.title}
              </span>
              <span className="mt-1 block text-xs text-ink-500">
                {[whenLabel(item.firstSeenAt), item.outlets.join(", ")].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!expanded && spot.items.length > FIRST ? (
        <button
          type="button"
          onClick={onExpand}
          className="mt-2 inline-flex min-h-[40px] items-center rounded-full border border-paper-300 bg-paper-50 px-3.5 text-sm font-semibold text-ink-800 hover:bg-paper-200"
        >
          Nog {spot.items.length - FIRST}
        </button>
      ) : null}
    </section>
  );
}
