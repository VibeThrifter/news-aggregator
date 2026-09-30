"use client";

import { Fragment, useMemo, type ReactNode } from "react";

import { segmentText, type EntityLink } from "@/lib/explore/entity-linker";

import { useExplore } from "../ExploreContext";
import { OutletCard } from "../outlet/OutletCard";
import { Balloon } from "../ui/Balloon";
import { Favicon } from "../ui/primitives";
import { useEntityLinks } from "./EntityLinks";

/**
 * Inline tap target inside running text: the padding makes the hit area ≥ 32px high while the
 * negative margin keeps the line height (buttons render inline-block).
 */
const INLINE_TARGET = "-my-2 inline-block rounded-sm px-0.5 py-2 text-left align-baseline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue";

/** A name in running text that opens its entity panel ("Wie is dit?"). */
export function EntityInline({ link, text }: { link: EntityLink; text: string }) {
  const context = useEntityLinks();
  if (!context) return <>{text}</>;
  return (
    <button
      type="button"
      onClick={(event) => {
        // Names can sit inside tappable cards (bias deck): only open the panel
        event.stopPropagation();
        context.openEntity(link.key, link.name);
      }}
      className={`${INLINE_TARGET} font-semibold text-accent-blue underline decoration-dotted underline-offset-4`}
    >
      {text}
    </button>
  );
}

/** An outlet name in running text: same balloon as the outlet chips, as an inline link. */
export function OutletInline({ outletKey, text }: { outletKey: string; text?: string }) {
  const { exploration } = useExplore();
  const outlet = exploration.index.outlet(outletKey);
  if (!outlet) return <>{text ?? outletKey}</>;
  return (
    // The wrapper stops the tap from reaching a tappable parent; the balloon still opens
    <span className="inline" onClick={(event) => event.stopPropagation()}>
      <Balloon label={`Over ${outlet.name}`} placement="top" content={(close) => <OutletCard outletKey={outletKey} onNavigate={close} />}>
        {({ ref, props }) => (
          <button
            ref={ref}
            {...props}
            type="button"
            className={`${INLINE_TARGET} font-semibold text-ink-900 underline decoration-paper-300 decoration-2 underline-offset-4`}
          >
            <Favicon name={outlet.name} domain={outlet.domain} size={14} className="mr-1 inline-block align-[-2px]" />
            {text ?? outlet.name}
          </button>
        )}
      </Balloon>
    </span>
  );
}

/**
 * Plain text in which every known name (people, organisations, authorities, outlets) is tappable.
 * Only the first occurrence of each name per text is linked; outside the explore shell the text
 * stays plain.
 */
export function EntityText({ text, used }: { text: string | null | undefined; used?: Set<string> }): ReactNode {
  const context = useEntityLinks();
  const segments = useMemo(
    () => (context && text ? segmentText(text, context.links, used ?? new Set()) : null),
    // `used` is deliberately not a dependency: it is shared state of the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, text],
  );
  if (!text) return null;
  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.type === "text") return <Fragment key={i}>{segment.text}</Fragment>;
        if (segment.link.kind === "outlet") return <OutletInline key={i} outletKey={segment.link.key} text={segment.text} />;
        return <EntityInline key={i} link={segment.link} text={segment.text} />;
      })}
    </>
  );
}
