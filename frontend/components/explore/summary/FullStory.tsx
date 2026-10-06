"use client";

import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";

import { remarkEntityLinks } from "@/lib/explore/entity-links";

import { EntityInline, OutletInline } from "../entity/EntityText";
import { useEntityLinks } from "../entity/EntityLinks";

function plainText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("");
}

function Strong({ children }: { children?: ReactNode }) {
  return <strong className="font-bold text-ink-900">{children}</strong>;
}

/** A paragraph that is only bold text ("**Economie tegenover natuur**") is a heading in the summary. */
function isBoldLine(children: ReactNode): boolean {
  const parts = Children.toArray(children).filter((child) => !(typeof child === "string" && !child.trim()));
  return parts.length === 1 && isValidElement(parts[0]) && parts[0].type === Strong;
}

/**
 * The whole summary in the page, in the letter of its first paragraph. Outlets and names are
 * tappable like in every other text: the same targets as `EntityText`, each linked once.
 */
export function FullStory({ markdown }: { markdown: string }) {
  const context = useEntityLinks();
  const links = useMemo(() => context?.links ?? [], [context]);
  const remarkPlugins = useMemo(() => [remarkEntityLinks(links)], [links]);
  const byHref = useMemo(() => new Map(links.map((link) => [link.href, link])), [links]);

  return (
    <div className="space-y-4 font-serif text-[17px] leading-relaxed text-ink-800">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        urlTransform={(url) => (url.startsWith("pluri:") ? url : defaultUrlTransform(url))}
        components={{
          p: ({ children }) =>
            isBoldLine(children) ? <h3 className="pt-2 text-lg font-bold leading-snug text-ink-900">{children}</h3> : <p>{children}</p>,
          h1: ({ children }) => <h3 className="pt-2 text-lg font-bold leading-snug text-ink-900">{children}</h3>,
          h2: ({ children }) => <h3 className="pt-2 text-lg font-bold leading-snug text-ink-900">{children}</h3>,
          h3: ({ children }) => <h3 className="pt-2 text-lg font-bold leading-snug text-ink-900">{children}</h3>,
          h4: ({ children }) => <h4 className="pt-1 font-bold text-ink-900">{children}</h4>,
          strong: Strong,
          ul: ({ children }) => <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-400">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1.5 pl-5 marker:text-ink-400">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-paper-300 pl-4 italic text-ink-700">{children}</blockquote>,
          a: ({ href, children }) => {
            const link = href ? byHref.get(href) : undefined;
            if (link?.kind === "outlet") return <OutletInline outletKey={link.key} text={plainText(children)} />;
            if (link) return <EntityInline link={link} text={plainText(children)} />;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-blue underline underline-offset-2">
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
