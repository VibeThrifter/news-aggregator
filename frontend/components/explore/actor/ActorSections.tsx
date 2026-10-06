"use client";

import Link from "next/link";
import useSWR from "swr";
import { ChevronRight, Newspaper, Users } from "lucide-react";

import { getEntityAppearances, getEntityCooccurrence, pmMeta } from "@/lib/api";
import { parseIsoDate } from "@/lib/format";
import { actorHref, keySlug } from "@/lib/explore/research";
import type { EntityKind } from "@/lib/types";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { ResearchStatusCard } from "../entity/ResearchStatus";
import { useEntityResearch } from "../entity/useEntityResearch";
import { PmAttribution } from "../network/PmSection";
import { SubHeading } from "../ui/primitives";

const dateFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

function formatDate(value: string | null | undefined): string | null {
  const date = parseIsoDate(value ?? null);
  return date ? dateFormatter.format(date) : null;
}

export function SectionTitle({ icon, children, id }: { icon?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h2 id={id} className="font-serif text-lg font-bold text-ink-900">
        {children}
      </h2>
    </div>
  );
}

function ListSkeleton({ label }: { label: string }) {
  return <div className="h-24 animate-pulse rounded-xl bg-paper-200" aria-label={label} />;
}

/** "Samen in het nieuws": people and organisations that appear in the same events. */
export function CooccurrenceSection({ aliases, demo }: { aliases: string[]; demo: boolean }) {
  const { data, error, isLoading } = useSWR(
    aliases.length ? ["cooccurrence", aliases.join("|"), demo] : null,
    () => getEntityCooccurrence(aliases, { demo, limit: 12 }),
    exploreAuxSwrOptions,
  );
  return (
    <section className="space-y-2" aria-labelledby="actor-cooccurrence">
      <SectionTitle id="actor-cooccurrence" icon={<Users size={18} className="text-accent-blue" aria-hidden="true" />}>
        Samen in het nieuws
      </SectionTitle>
      {isLoading ? <ListSkeleton label="Samen in het nieuws laden" /> : null}
      {error ? <p className="text-sm text-ink-500">Kon niet laden wie er samen in het nieuws kwam.</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-ink-500">Nog niemand anders gevonden in hetzelfde nieuws.</p> : null}
      {data && data.length ? (
        <ul className="divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-paper-50">
          {data.map((row) => {
            const kind = row.kind === "person" || row.kind === "org" ? row.kind : null;
            return (
              <li key={row.entity_key}>
                <Link
                  href={actorHref(keySlug(row.entity_key), { kind, name: row.name, demo })}
                  className="flex min-h-[52px] items-center gap-3 px-3 py-2 text-left hover:bg-paper-100"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink-900">{row.name}</span>
                    <span className="block truncate text-xs text-ink-500">
                      {row.shared_events === 1 ? "1 keer samen" : `${row.shared_events} keer samen`}
                      {row.last_event_title ? ` · laatst: ${row.last_event_title}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-ink-400">
                    {kind === "person" ? "Persoon" : "Organisatie"}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/** "Ook in het nieuws": events in which the name appears. */
export function AppearancesSection({ aliases, kind, demo }: { aliases: string[]; kind: EntityKind | null; demo: boolean }) {
  const { data, error, isLoading } = useSWR(
    aliases.length ? ["actor-appearances", aliases.join("|"), kind ?? "", demo] : null,
    // Not tied to an event: exclude nothing (event ids are positive)
    () => getEntityAppearances(aliases, 0, kind, { demo }),
    exploreAuxSwrOptions,
  );
  return (
    <section className="space-y-2" aria-labelledby="actor-appearances">
      <SectionTitle id="actor-appearances" icon={<Newspaper size={18} className="text-accent-blue" aria-hidden="true" />}>
        Ook in het nieuws
      </SectionTitle>
      {isLoading ? <ListSkeleton label="Nieuws laden" /> : null}
      {error ? <p className="text-sm text-ink-500">Kon het nieuws niet laden.</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-ink-500">Niet gevonden in ander nieuws.</p> : null}
      {data && data.length ? (
        <ul className="space-y-2">
          {data.map((row) => (
            <li key={row.event_id}>
              <Link
                href={`/event/${encodeURIComponent(row.event_slug ?? String(row.event_id))}`}
                className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 px-3 py-2 hover:bg-paper-100"
              >
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug text-ink-900">{row.event_title}</span>
                  <span className="block text-xs text-ink-500">
                    {[formatDate(row.event_last_updated_at), `${row.mention_count}× genoemd`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Research status on the actor page: read-only (names are only requested from the news itself). */
export function ActorResearchSection({ keys, name, demo, inModel = false }: { keys: string[]; name: string; demo: boolean; inModel?: boolean }) {
  const research = useEntityResearch({ keys, name, demo });
  if (keys.length === 0 || !research.available) return null;
  // Well-known entities of the model were never researched: nothing to report
  if (inModel && !research.loading && !research.row) return null;
  return (
    <section className="space-y-2" aria-labelledby="actor-research">
      <SubHeading>
        <span id="actor-research">Onderzoeksstatus</span>
      </SubHeading>
      {research.loading ? (
        <div className="h-16 animate-pulse rounded-xl bg-paper-200" aria-label="Onderzoeksstatus laden" />
      ) : (
        <ResearchStatusCard row={research.row} name={name} />
      )}
    </section>
  );
}

/** "Propagandamodel — dataset vX" plus the general attribution. */
export function DatasetAttribution({ demo }: { demo: boolean }) {
  const { data } = useSWR(["pm-meta", demo], () => pmMeta({ demo }), exploreAuxSwrOptions);
  return (
    <footer className="space-y-1 border-t border-paper-300 pt-3">
      <p className="text-xs font-semibold text-ink-600">
        Propagandamodel{data?.version ? ` — dataset v${data.version}` : ""}
        {data?.synced_at ? ` · bijgewerkt ${formatDate(data.synced_at)}` : ""}
      </p>
      <PmAttribution />
    </footer>
  );
}
