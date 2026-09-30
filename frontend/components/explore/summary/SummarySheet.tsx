"use client";

import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { BookOpen } from "lucide-react";

import { buildEntityLinks, ENTITY_HREF, OUTLET_HREF } from "@/lib/explore/entity-linker";
import { remarkEntityLinks } from "@/lib/explore/entity-links";

import { useExplore } from "../ExploreContext";
import { OutletChip } from "../outlet/OutletCard";
import { Sheet } from "../ui/Sheet";

export function SummarySheet() {
  const { exploration, panel } = useExplore();
  const { input } = exploration;

  // Same targets as every other text (Epic 12), plus places and countries as the summary always had
  const targets = useMemo(
    () =>
      buildEntityLinks(
        {
          outlets: input.outlets,
          entities: input.entities,
          authorities: (input.insight?.authority_analysis ?? []).map((authority) => authority.authority),
        },
        { kinds: "all" },
      ),
    [input],
  );
  const names = useMemo(() => new Map(targets.map((target) => [target.href, target.name])), [targets]);

  const remarkPlugins = useMemo(() => [remarkEntityLinks(targets)], [targets]);

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title={input.event.title}
      subtitle="Het hele verhaal — tik op een bron of naam"
      icon={<BookOpen size={22} />}
    >
      <div className="prose prose-sm prose-neutral max-w-none prose-p:leading-relaxed prose-strong:text-ink-900 prose-headings:font-serif">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          urlTransform={(url) => (url.startsWith("pluri:") ? url : defaultUrlTransform(url))}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith(OUTLET_HREF)) {
                return (
                  <span className="not-prose inline-block align-middle">
                    <OutletChip outletKey={href.slice(OUTLET_HREF.length)} />
                  </span>
                );
              }
              if (href?.startsWith(ENTITY_HREF)) {
                const key = href.slice(ENTITY_HREF.length);
                return (
                  <button
                    type="button"
                    onClick={() => panel.open(`entiteit:${key}`, { n: names.get(href) ?? String(children) })}
                    className="font-semibold text-accent-blue underline decoration-dotted underline-offset-4"
                  >
                    {children}
                  </button>
                );
              }
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            },
          }}
        >
          {input.summary.body}
        </ReactMarkdown>
      </div>
      <p className="mt-6 text-xs text-ink-500">
        Samenvatting gemaakt door AI op basis van de gekoppelde artikelen; citaten worden toegeschreven aan de publicatie.
      </p>
    </Sheet>
  );
}
