"use client";

import { useState } from "react";
import { Newspaper } from "lucide-react";

import { biasByOutlet } from "@/lib/explore/bias";
import { OWNERSHIP_TYPE_LABELS } from "@/lib/explore/media-landscape";
import { getCountryFlag, parseIsoDate } from "@/lib/format";
import { BiasScoreBadge } from "@/components/BiasScoreBadge";

import { useExplore } from "../ExploreContext";
import { OutletChip, OutletPosition } from "../outlet/OutletCard";
import { Tag } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";

const timeFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function SourcesSheet() {
  const { exploration, panel } = useExplore();
  const { input, index } = exploration;
  const [tab, setTab] = useState<"nl" | "intl">(panel.param("tab") === "buitenland" ? "intl" : "nl");
  const bias = biasByOutlet(input);
  const outlets = input.outlets.filter((outlet) => (tab === "nl" ? !outlet.isInternational : outlet.isInternational));
  const intlCount = input.outlets.filter((outlet) => outlet.isInternational).length;

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title="Bronnen en artikelen"
      subtitle={`${input.outlets.length} bronnen · ${input.articles.length} artikelen`}
      icon={<Newspaper size={22} />}
    >
      {intlCount > 0 ? (
        <div role="tablist" aria-label="Soort bronnen" className="mb-4 inline-flex rounded-full border border-paper-300 p-1">
          {[
            { id: "nl" as const, label: "Nederland" },
            { id: "intl" as const, label: `Buitenland (${intlCount})` },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`min-h-[40px] rounded-full px-4 text-sm font-semibold ${tab === item.id ? "bg-ink-900 text-white" : "text-ink-600"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <ul className="space-y-4">
        {outlets.map((outlet) => {
          const outletBias = bias.get(outlet.key);
          const type = outlet.profile?.ownershipType;
          return (
            <li key={outlet.key} className="space-y-2 rounded-2xl border border-paper-300 bg-paper-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <OutletChip outletKey={outlet.key} />
                {outlet.isInternational ? <span>{getCountryFlag(outlet.country)}</span> : null}
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
              {!outlet.isInternational ? <OutletPosition outlet={outlet} /> : null}
              <ul className="space-y-1.5">
                {outlet.articleIds.map((id) => {
                  const article = index.article(id);
                  if (!article) return null;
                  const published = parseIsoDate(article.publishedAt);
                  return (
                    <li key={id} className="flex gap-2 text-sm">
                      <span className="w-24 shrink-0 text-xs text-ink-400">{published ? timeFormatter.format(published) : ""}</span>
                      {input.event.isDemo ? (
                        <span className="text-ink-800">{article.title}</span>
                      ) : (
                        <a href={article.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 underline-offset-2 hover:underline">
                          {article.title}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
