"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { storyThread } from "@/lib/explore/chronology";
import { useFocusStore } from "@/lib/explore/focus";
import { TABS } from "@/lib/explore/labels";
import { OWN_KINDS, OWN_KINDS_BY_TAB } from "@/lib/explore/own";
import { useExploreStore } from "@/lib/explore/store";
import type { Finding, TabId } from "@/lib/explore/types";

import { useExplore } from "../ExploreContext";
import { FindingRow } from "./FindingRow";
import { OthersSection, useSharedGroups } from "./Others";
import { OwnAdd } from "./OwnForm";
import { StemmenTab } from "./StemmenTab";
import { TijdlijnTab } from "./TijdlijnTab";
import { ScrollRow } from "../ui/ScrollRow";

const NONE: never[] = [];

const ROW_ORDER: Partial<Record<TabId, Finding["type"][]>> = {
  klopt: ["claim", "statistic", "fallacy", "contradiction"],
  ontbreekt: ["gap", "questions", "science"],
  gebracht: ["frame", "tone", "bias"],
  invalshoeken: ["perspective"],
};

/**
 * The questions under the picture: one tab per question, the findings as rows, and under them
 * what you add yourself.
 */
export function FindingsTabs() {
  const { exploration, numbers } = useExplore();
  const { input, byTab, speakers } = exploration;
  // What others shared can be the only thing in a tab
  const { groups: others } = useSharedGroups();
  const chosen = useExploreStore((state) => state.prefs.findingsTab);
  const setPref = useExploreStore((state) => state.setPref);
  // A popover asks for the form of a tab that may still be empty: that tab stays while it is chosen
  const composing = useFocusStore((state) => (state.compose ? OWN_KINDS[state.compose.kind].tab : null));
  const [forced, setForced] = useState<TabId | null>(null);
  useEffect(() => {
    if (composing) setForced(composing);
  }, [composing]);
  const bar = useRef<HTMLDivElement | null>(null);

  const counts = useMemo(() => {
    const thread = storyThread(input);
    const dutch = input.outlets.filter((outlet) => !outlet.isInternational).length;
    const of = (tab: TabId) => byTab.get(tab)?.length ?? 0;
    const map = new Map<TabId, number>([
      ["invalshoeken", dutch >= 2 ? of("invalshoeken") : 0],
      ["klopt", of("klopt")],
      // Who speaks, and the sources you added
      ["stemmen", new Set(speakers.speakers.map((speaker) => speaker.slug)).size + (byTab.get("stemmen") ?? []).filter((f) => f.body.type === "own" && f.body.entry.kind === "source").length],
      ["ontbreekt", of("ontbreekt")],
      ["gebracht", (byTab.get("gebracht") ?? []).filter((finding) => finding.type !== "tone" || finding.outletKeys.length > 0).length],
      [
        "tijdlijn",
        thread.earlier.length + thread.alongside.length + thread.later.length + (byTab.get("tijdlijn") ?? []).filter((f) => f.type !== "first").length,
      ],
    ]);
    if ((map.get("stemmen") ?? 0) === 0 && (byTab.get("stemmen") ?? []).some((finding) => finding.type === "voices")) map.set("stemmen", 1);
    return map;
  }, [byTab, input, speakers]);

  const visible = TABS.filter(
    (tab) =>
      (counts.get(tab.id) ?? 0) > 0 ||
      tab.id === composing ||
      (tab.id === forced && chosen === forced) ||
      others.some((group) => OWN_KINDS[group.lead.kind].tab === tab.id),
  );
  const current = visible.find((tab) => tab.id === chosen)?.id ?? visible[0]?.id ?? null;

  // Keep the chosen tab in view in the scrollable bar (without moving the page)
  useEffect(() => {
    const strip = bar.current;
    const button = strip?.querySelector<HTMLElement>(`[data-tab="${current}"]`);
    if (strip && button) strip.scrollTo({ left: Math.max(0, button.offsetLeft - 16), behavior: "smooth" });
  }, [current]);

  if (!current) return null;

  const rows = (tab: TabId) => {
    const list = byTab.get(tab) ?? [];
    const order = ROW_ORDER[tab] ?? [];
    const analysis = list
      .filter((finding) => finding.type !== "own")
      .sort(
        (a, b) =>
          order.indexOf(a.type) - order.indexOf(b.type) ||
          (numbers.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (numbers.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
          a.order - b.order,
      );
    // What you added comes last, in the order you added it
    return [...analysis, ...list.filter((finding) => finding.type === "own").sort((a, b) => a.order - b.order)];
  };

  return (
    <section aria-label="Bevindingen" className="space-y-2">
      <div className="sticky top-0 z-20 -mx-4 bg-paper-100/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
        <ScrollRow ref={bar} role="tablist" aria-label="Vragen" className="-mx-1 gap-1.5 px-1">
          {visible.map((tab) => (
            <button
              key={tab.id}
              data-tab={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === current}
              onClick={() => setPref("findingsTab", tab.id)}
              className={`flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                tab.id === current ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 bg-paper-50 text-ink-700 hover:bg-paper-100"
              }`}
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: tab.color }} />
              {tab.label}
              <span className={`text-xs ${tab.id === current ? "text-white/70" : "text-ink-400"}`}>{counts.get(tab.id)}</span>
            </button>
          ))}
        </ScrollRow>
      </div>

      <div role="tabpanel" aria-label={TABS.find((tab) => tab.id === current)?.label}>
        {current === "stemmen" ? (
          <StemmenTab />
        ) : current === "tijdlijn" ? (
          <TijdlijnTab />
        ) : (
          <ul className="divide-y divide-paper-200">
            {rows(current)
              .filter((finding) => !(finding.type === "tone" && finding.outletKeys.length === 0))
              .map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
          </ul>
        )}
        <OwnAdd key={current} kinds={OWN_KINDS_BY_TAB[current] ?? NONE} />
        <OthersSection key={`others-${current}`} tab={current} />
      </div>
    </section>
  );
}
