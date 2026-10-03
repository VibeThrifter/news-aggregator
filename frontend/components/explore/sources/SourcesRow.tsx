"use client";

import { useState } from "react";
import { ChevronDown, Newspaper } from "lucide-react";

import { biasByOutlet } from "@/lib/explore/bias";
import { OWNERSHIP_TYPE_LABELS } from "@/lib/explore/media-landscape";
import { getCountryFlag, parseIsoDate } from "@/lib/format";
import { BiasScoreBadge } from "@/components/BiasScoreBadge";

import { useExplore } from "../ExploreContext";
import { OutletChip } from "../outlet/OutletCard";
import { Favicon, Tag } from "../ui/primitives";

const timeFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** All outlets and their articles of this news; opens downwards in the page. */
export function SourcesRow() {
  const { exploration, panel } = useExplore();
  const { input, index } = exploration;
  const [open, setOpen] = useState(false);
  const bias = biasByOutlet(input);
  // Dutch outlets first, then foreign ones; each in order of their first article
  const outlets = [...input.outlets].sort((a, b) => Number(a.isInternational) - Number(b.isInternational));

  return (
    <section aria-label="Bronnen en artikelen" className="rounded-2xl border border-paper-300 bg-paper-50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper-100"
      >
        <Newspaper size={18} className="shrink-0 text-ink-500" aria-hidden="true" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-ink-900">Alle bronnen en artikelen</span>
          <span className="text-xs text-ink-500">
            {input.outlets.length} {input.outlets.length === 1 ? "bron" : "bronnen"} · {input.articles.length}{" "}
            {input.articles.length === 1 ? "artikel" : "artikelen"}
          </span>
        </span>
        {!open ? (
          <span className="flex -space-x-1.5" aria-hidden="true">
            {outlets.slice(0, 5).map((outlet) => (
              <span key={outlet.key} className="rounded-full border-2 border-paper-50 bg-paper-50">
                <Favicon name={outlet.name} domain={outlet.domain} size={18} className="rounded-full" />
              </span>
            ))}
          </span>
        ) : null}
        <ChevronDown size={18} className={`shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open ? (
        <ul className="divide-y divide-paper-200 border-t border-paper-200 px-4">
          {outlets.map((outlet) => {
            const outletBias = bias.get(outlet.key);
            const type = outlet.profile?.ownershipType;
            return (
              <li key={outlet.key} className="space-y-1.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <OutletChip outletKey={outlet.key} />
                  {outlet.isInternational ? <span aria-hidden="true">{getCountryFlag(outlet.country)}</span> : null}
                  {type && type !== "unknown" ? (
                    <Tag tone={type === "state" ? "red" : type === "public" ? "blue" : "neutral"}>{OWNERSHIP_TYPE_LABELS[type]}</Tag>
                  ) : null}
                  {outletBias ? (
                    <BiasScoreBadge
                      rating={outletBias.averageRating}
                      biasCount={outletBias.sentenceCount}
                      showCount
                      onClick={() => panel.open(`bias:${outlet.key}`)}
                    />
                  ) : null}
                </div>
                <ul className="space-y-1.5">
                  {outlet.articleIds.map((id) => {
                    const article = index.article(id);
                    if (!article) return null;
                    const published = parseIsoDate(article.publishedAt);
                    return (
                      <li key={id} className="flex gap-2 text-sm">
                        <span className="w-24 shrink-0 pt-0.5 text-xs text-ink-400">{published ? timeFormatter.format(published) : ""}</span>
                        <span className="min-w-0 flex-1">
                          {input.event.isDemo ? (
                            <span className="text-ink-800">{article.title}</span>
                          ) : (
                            <a
                              href={article.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-ink-900 underline-offset-2 hover:underline"
                            >
                              {article.title}
                            </a>
                          )}
                          {article.digest ? <span className="mt-0.5 block text-xs text-ink-600">{article.digest.text}</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
