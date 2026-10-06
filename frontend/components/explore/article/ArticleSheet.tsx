"use client";

import { ExternalLink } from "lucide-react";

import { OWNERSHIP_TYPE_LABELS } from "@/lib/explore/media-landscape";
import { getCountryFlag, parseIsoDate } from "@/lib/format";

import { useExplore } from "../ExploreContext";
import { SubHeading, Favicon } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";

const dateFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * One article of this news, bigger than in the outlet balloon: what it reports (the Dutch gist of
 * the analysis), the perspective it was put in and the headline as a link to the article itself.
 */
export function ArticleSheet({ articleId }: { articleId: number }) {
  const { exploration, panel } = useExplore();
  const { index, findings, input } = exploration;
  const article = index.article(articleId);
  const outlet = article ? index.outlet(article.outletKey) : null;
  const onOpenChange = (open: boolean) => (!open ? panel.close() : undefined);

  if (!article || !outlet) {
    return (
      <Sheet open onOpenChange={onOpenChange} title="Artikel niet gevonden">
        <p className="text-sm text-ink-500">Dit artikel hoort niet (meer) bij dit nieuws.</p>
      </Sheet>
    );
  }

  const published = parseIsoDate(article.publishedAt);
  const ownership = outlet.profile?.ownershipType;
  // The perspectives the analysis put this article in, with its core message
  const perspectives = findings.flatMap((finding) => {
    const body = finding.body;
    if (body.type !== "perspective") return [];
    return body.stances
      .filter((stance) => stance.articleId === article.id)
      .map((stance) => ({ id: finding.id, label: body.cluster.label, stance: stance.stance }));
  });

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={`${outlet.name}${outlet.isInternational && outlet.country ? ` ${getCountryFlag(outlet.country)}` : ""}`}
      subtitle={
        [published ? dateFormatter.format(published) : null, ownership && ownership !== "unknown" ? OWNERSHIP_TYPE_LABELS[ownership] : null]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      icon={<Favicon name={outlet.name} domain={outlet.domain} size={24} />}
    >
      <div className="space-y-5">
        {article.digest ? (
          <section className="space-y-1.5">
            <SubHeading>Wat staat erin?</SubHeading>
            <p className="text-base leading-relaxed text-ink-900">{article.digest.text}</p>
            <p className="text-xs text-ink-500">
              {article.digest.basis === "title"
                ? "De tekst was niet op te halen: dit is de kop in het Nederlands."
                : "In eigen woorden samengevat door de analyse."}
            </p>
          </section>
        ) : article.isInternational ? (
          <p className="text-sm text-ink-500">Van dit buitenlandse artikel hebben we nog alleen de kop.</p>
        ) : null}

        {perspectives.map((perspective) => (
          <section key={perspective.id} className="rounded-xl bg-paper-100 p-3">
            <SubHeading>{perspective.label}</SubHeading>
            {perspective.stance ? <p className="mt-1 text-sm italic text-ink-800">“{perspective.stance}”</p> : null}
          </section>
        ))}

        <section className="space-y-1">
          <SubHeading>Origineel</SubHeading>
          {input.event.isDemo ? (
            <p className="font-medium text-ink-900">{article.title}</p>
          ) : (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-start gap-1.5 font-medium text-accent-blue underline-offset-2 hover:underline"
            >
              <span>{article.title}</span>
              <ExternalLink size={14} className="mt-1 shrink-0" aria-hidden="true" />
            </a>
          )}
        </section>
      </div>
    </Sheet>
  );
}
