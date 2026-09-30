"use client";

import Link from "next/link";
import { ArrowRight, Footprints, UserSearch } from "lucide-react";

import { getCategoryForEventType } from "@/lib/categories";
import { getCountryFlag, getCountryName, formatEventTimeframe } from "@/lib/format";
import type { RelationReason } from "@/lib/types";

import { useExplore } from "../ExploreContext";
import { Chip, Tag } from "../ui/primitives";

function reasonLabel(reason: RelationReason): string {
  switch (reason.type) {
    case "entity":
      return reason.kind === "person" ? `Zelfde persoon: ${reason.name}` : `Ook over ${reason.name}`;
    case "country":
      return `${getCountryFlag(reason.iso)} ${getCountryName(reason.iso)}`.trim();
    case "category":
      return "Zelfde categorie";
    case "topic":
      return "Zelfde thema";
    default:
      return "";
  }
}

export function RelatedTrail() {
  const { exploration, panel } = useExplore();
  const { relations, availability } = exploration.input;

  if (!availability.relations || relations.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="related-title" className="space-y-3">
      <div className="flex items-center gap-2">
        <Footprints size={18} className="text-accent-blue" aria-hidden="true" />
        <h2 id="related-title" className="font-serif text-xl font-bold text-ink-900">
          Volg het spoor
        </h2>
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {relations.map((relation) => {
          const category = getCategoryForEventType(relation.related_event_type);
          const href = `/event/${encodeURIComponent(relation.related_slug ?? String(relation.related_event_id))}`;
          return (
            <li key={relation.related_event_id} className="w-[78%] shrink-0 snap-start sm:w-[46%]">
              {/* The link stretches over the whole card; the name chips sit on top of it (no buttons inside a link) */}
              <div className="relative flex h-full min-h-[132px] flex-col justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4 shadow-card-light hover:shadow-card">
                <Link href={href} className="block space-y-1 after:absolute after:inset-0 after:rounded-2xl after:content-['']">
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${category.color}`}>{category.label}</span>
                  <p className="font-serif font-bold leading-snug text-ink-900">{relation.related_title}</p>
                  <p className="text-xs text-ink-500">
                    {formatEventTimeframe(relation.related_first_seen_at, relation.related_last_updated_at)}
                    {relation.related_article_count ? ` · ${relation.related_article_count} artikelen` : ""}
                  </p>
                </Link>
                <div className="flex flex-wrap items-center gap-1.5">
                  {relation.reasons.slice(0, 3).map((reason, i) => {
                    const label = reasonLabel(reason);
                    if (!label) return null;
                    if (reason.type === "entity") {
                      return (
                        <Chip
                          key={i}
                          tone="blue"
                          icon={<UserSearch size={12} aria-hidden="true" />}
                          onClick={() =>
                            panel.open(`entiteit:${reason.key}`, { n: reason.name, k: reason.kind === "person" || reason.kind === "org" ? reason.kind : null })
                          }
                          className="relative z-10 max-w-full"
                        >
                          {label}
                        </Chip>
                      );
                    }
                    return (
                      <Tag key={i} tone="blue">
                        {label}
                      </Tag>
                    );
                  })}
                  <ArrowRight size={14} className="ml-auto text-ink-400" aria-hidden="true" />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
