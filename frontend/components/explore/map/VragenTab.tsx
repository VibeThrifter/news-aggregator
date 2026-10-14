"use client";

import { omissionText } from "@/lib/explore/missing";
import { anchorOutletKey, ownEntryOf, resolveOwnAnchor } from "@/lib/explore/own";
import type { Finding } from "@/lib/explore/types";

import { useExplore } from "../ExploreContext";
import { OutletInline } from "../entity/EntityText";
import { FindingRow } from "./FindingRow";
import { OwnTag } from "./OwnForm";

/** A white card, like the cards under "Wie praat?" */
const CARD = "rounded-2xl border border-paper-300 bg-paper-50 px-4";

/**
 * "Niet gevraagd": a card per outlet with the questions its articles did not ask, under what
 * leaving things out does to its story. Your own questions go with the outlet of whom you asked
 * them (or of the speaker), else under the cards. `rows` in display order.
 */
export function VragenTab({ rows }: { rows: Finding[] }) {
  const { exploration } = useExplore();
  const { input, index, speakers } = exploration;
  const byOutlet = new Map<string, Finding[]>();
  const loose: Finding[] = [];
  for (const finding of rows) {
    const entry = ownEntryOf(finding);
    const key =
      finding.body.type === "question" ? finding.body.outletKey : entry ? anchorOutletKey(resolveOwnAnchor(entry, exploration), speakers) : null;
    if (key) byOutlet.set(key, [...(byOutlet.get(key) ?? []), finding]);
    else loose.push(finding);
  }
  // The outlet with the most questions first
  const outlets = [...input.outlets, ...(exploration.ownOutlets ?? [])]
    .filter((outlet) => byOutlet.has(outlet.key))
    .sort((a, b) => (byOutlet.get(b.key)?.length ?? 0) - (byOutlet.get(a.key)?.length ?? 0));
  // An outlet that is not in the picture keeps its questions in the list
  for (const [key, list] of Array.from(byOutlet.entries())) {
    if (!outlets.some((outlet) => outlet.key === key)) loose.push(...list);
  }
  if (outlets.length === 0 && loose.length === 0) return null;
  const analyses = input.insight?.media_analysis ?? [];
  return (
    <div className="space-y-3">
      {outlets.map((outlet) => {
        const omission = omissionText(analyses.filter((analysis) => index.outletForName(analysis.source, analysis.article_url) === outlet.key));
        return (
          <section key={outlet.key} className={CARD} aria-label={`Niet gevraagd door ${outlet.name}`}>
            <div className="space-y-1 py-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 font-serif text-[15px] leading-snug">
                  <OutletInline outletKey={outlet.key} className="font-bold" iconSize={16} />
                </p>
                {outlet.own ? <OwnTag /> : null}
              </div>
              {omission ? <p className="text-sm leading-relaxed text-ink-600">{omission}</p> : null}
            </div>
            <ul className="divide-y divide-paper-200 border-t border-paper-200">
              {(byOutlet.get(outlet.key) ?? []).map((finding) => (
                <FindingRow key={finding.id} finding={finding} outletKey={outlet.key} />
              ))}
            </ul>
          </section>
        );
      })}
      {loose.length ? (
        <ul className="divide-y divide-paper-200">
          {loose.map((finding) => (
            <FindingRow key={finding.id} finding={finding} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
