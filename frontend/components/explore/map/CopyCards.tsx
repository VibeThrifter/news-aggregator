"use client";

import { chanceLabel, copyGroupLabel, shareLabel } from "@/lib/explore/copies";
import type { CopyGroup, Finding } from "@/lib/explore/types";
import { parseIsoDate } from "@/lib/format";

import { useExplore } from "../ExploreContext";
import { Favicon } from "../ui/primitives";
import { NumberBadge, useFocusRing } from "./Markers";

const timeFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The articles of one text (Story 14.27): when, where, how much of it is that text and how sure that is. */
export function CopyArticles({ group }: { group: CopyGroup }) {
  const { exploration } = useExplore();
  const demo = Boolean(exploration.input.event.isDemo);
  return (
    <ul className="divide-y divide-paper-200">
      {group.articles.map(({ article, share, probability }) => {
        const published = parseIsoDate(article.publishedAt);
        return (
          <li key={article.id} className="flex gap-2 py-2.5 text-sm">
            <span className="w-24 shrink-0 pt-0.5 text-xs text-ink-400">{published ? timeFormatter.format(published) : ""}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                <Favicon name={article.outletName} size={14} />
                {article.outletName}
              </span>
              {demo ? (
                <span className="text-ink-800">{article.title}</span>
              ) : (
                <a href={article.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 underline-offset-2 hover:underline">
                  {article.title}
                </a>
              )}
              <span className="block text-xs text-ink-500">
                {shareLabel(share)} · {chanceLabel(probability)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "Wie praat?": a card per text that more outlets bring, with the number of its = in the picture. */
export function CopyCard({ finding }: { finding: Finding }) {
  // A tap on its = in the picture opens the tab and rings this card
  const { ref, ringing } = useFocusRing<HTMLElement>("finding", finding.id);
  if (finding.body.type !== "copy") return null;
  const label = copyGroupLabel(finding.body.group);
  return (
    <section
      ref={ref}
      aria-label={label}
      className={`scroll-mt-28 rounded-2xl border border-paper-300 bg-paper-50 px-4 ${ringing ? "ring-4 ring-amber-300 ring-offset-2" : ""}`}
    >
      <div className="flex items-center gap-2 py-3">
        <NumberBadge findingId={finding.id} type="copy" />
        <p
          className="min-w-0 font-serif text-[15px] font-bold leading-snug text-ink-900"
          title="Woord voor woord dezelfde zinnen van 12 woorden of meer, citaten niet meegeteld. De kans is geijkt op paren artikelen die blind zijn beoordeeld."
        >
          {label}
        </p>
      </div>
      <div className="border-t border-paper-200">
        <CopyArticles group={finding.body.group} />
      </div>
    </section>
  );
}
