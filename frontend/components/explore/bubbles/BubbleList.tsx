"use client";

import { bubbleGroupKey, type Bubble, type BubbleScene, type HeroLens } from "@/lib/explore/layout/bubbles";

import { useExplore } from "../ExploreContext";
import { OutletCard } from "../outlet/OutletCard";
import { Balloon } from "../ui/Balloon";
import { Favicon } from "../ui/primitives";

/** Accessible list version of the bubble map: same data, grouped per lens. */
export function BubbleList({ scene, lens, onTap }: { scene: BubbleScene; lens: Exclude<HeroLens, "tegenspraak">; onTap: (bubble: Bubble) => boolean }) {
  const { exploration, isRevealed } = useExplore();
  const groups = scene.groupsByLens[lens];

  return (
    <div className="space-y-4 rounded-3xl border border-paper-300 bg-paper-50 p-4">
      {groups.map((group) => {
        const members = scene.bubbles.filter((bubble) => bubbleGroupKey(bubble, lens) === group.key);
        if (members.length === 0) return null;
        const discovered = group.clueId ? isRevealed(group.clueId) : true;
        return (
          <section key={group.key} aria-label={discovered ? group.label : group.maskedLabel}>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">{discovered ? group.label : group.maskedLabel}</h3>
            <ul className="space-y-1.5">
              {members.map((bubble) => {
                const outlet = exploration.index.outlet(bubble.outletKey);
                if (!outlet) return null;
                const open = bubble.perspectiveClueId ? isRevealed(bubble.perspectiveClueId) : true;
                return (
                  <li key={bubble.id}>
                    <Balloon
                      label={`Over ${outlet.name}`}
                      content={(close) => <OutletCard outletKey={bubble.outletKey} onNavigate={close} />}
                    >
                      {({ ref, props }) => (
                        <button
                          ref={ref}
                          {...props}
                          type="button"
                          onClickCapture={(event) => {
                            if (!onTap(bubble)) {
                              event.stopPropagation();
                              event.preventDefault();
                            }
                          }}
                          className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-paper-100"
                        >
                          <Favicon name={outlet.name} domain={outlet.domain} size={18} />
                          <span className="font-semibold">{outlet.name}</span>
                          <span className="flex-1 truncate text-ink-600">{open ? bubble.stance : "— tik om te onthullen"}</span>
                        </button>
                      )}
                    </Balloon>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
