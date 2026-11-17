"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Newspaper } from "lucide-react";

import { biasByOutlet } from "@/lib/explore/bias";
import { linkHost, sharedLinks, type SharedLink } from "@/lib/explore/links";
import { kamervragenByArticle, pressQuotesByArticle, sponsoredLabel, type PressQuote } from "@/lib/explore/official";
import { OWNERSHIP_TYPE_LABELS } from "@/lib/explore/media-landscape";
import type { ExploreArticle } from "@/lib/explore/types";
import type { EventDocument } from "@/lib/types";
import { getCountryFlag, parseIsoDate } from "@/lib/format";
import { BiasScoreBadge } from "@/components/BiasScoreBadge";

import { useExplore } from "../ExploreContext";
import { MARKER_STYLE } from "../map/Markers";
import { OutletChip } from "../outlet/OutletCard";
import { Favicon, Tag } from "../ui/primitives";

const timeFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function PublishedAt({ article }: { article: ExploreArticle }) {
  const published = parseIsoDate(article.publishedAt);
  return <span className="w-24 shrink-0 pt-0.5 text-xs text-ink-400">{published ? timeFormatter.format(published) : ""}</span>;
}

function ArticleLink({ article, demo }: { article: ExploreArticle; demo: boolean }) {
  if (demo) return <span className="text-ink-800">{article.title}</span>;
  return (
    <a href={article.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 underline-offset-2 hover:underline">
      {article.title}
    </a>
  );
}

/** "=7 zelfde tekst": the article is one text with articles of other outlets; a tap opens that text. */
function SameText({ findingId }: { findingId: string }) {
  const { numbers, toFinding } = useExplore();
  const number = numbers.get(findingId);
  return (
    <button type="button" onClick={() => toFinding(findingId)} className="ml-1.5 align-middle" aria-label={`Zelfde tekst ${number ?? ""}: toon de artikelen`}>
      <Tag>
        {number ? (
          <span className="mr-1 font-bold" style={{ color: MARKER_STYLE.copy.color }}>
            {MARKER_STYLE.copy.sign}
            {number}
          </span>
        ) : null}
        zelfde tekst
      </Tag>
    </button>
  );
}

/** The sites an article links to in its text; each host opens the page. */
function ArticleLinks({ links }: { links: string[] }) {
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-500">
      {links.map((url) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-ink-800 hover:underline">
          ↗ {linkHost(url)}
        </a>
      ))}
    </span>
  );
}

/**
 * What else is known about one article: its earlier headline (Story 14.32), who ordered a study it
 * reports (14.36), the press release it quotes word for word (14.34) and the Kamervragen that cite
 * it (14.33). Each line says what is there and links to it.
 */
function ArticleTraces({ article, press, questions }: { article: ExploreArticle; press: PressQuote[]; questions: EventDocument[] }) {
  const history = article.titleHistory ?? [];
  const studies = article.sponsored ?? [];
  if (!history.length && !studies.length && !press.length && !questions.length) return null;
  return (
    <span className="mt-1 block space-y-0.5 text-xs leading-4 text-ink-600">
      {history.length ? (
        <span className="block">
          {history.length === 1 ? "Eerdere kop" : `${history.length} eerdere koppen, de eerste`}:{" "}
          <span className="text-ink-500 line-through decoration-ink-300">{history[0].title}</span>
        </span>
      ) : null}
      {studies.map((study) => (
        <span key={study.sponsor} className="block" title={study.sentence}>
          {sponsoredLabel(study, article.outletName)}
        </span>
      ))}
      {press.map((quoted) => (
        <a key={quoted.document.url} href={quoted.document.url} target="_blank" rel="noopener noreferrer" className="block underline-offset-2 hover:text-ink-900 hover:underline">
          {quoted.quotes.length
            ? `${quoted.quotes.length === 1 ? "Een citaat staat" : `${quoted.quotes.length} citaten staan`} letterlijk in het persbericht`
            : `${Math.round(quoted.share * 100)} % van de tekst staat letterlijk in het persbericht`}
          {quoted.document.location ? ` van ${quoted.document.location}` : ""} ↗
        </a>
      ))}
      {questions.map((document) => (
        <a key={document.url} href={document.url} target="_blank" rel="noopener noreferrer" className="block underline-offset-2 hover:text-ink-900 hover:underline">
          {document.doc_type === "Antwoord op Kamervragen" ? "Antwoord op Kamervragen" : "Kamervragen"}
          {document.details?.askers ? ` van ${document.details.askers}` : ""} over dit artikel ↗
        </a>
      ))}
    </span>
  );
}

/** A page that articles of several outlets link to: the source they share. */
function SharedLinkRow({ link }: { link: SharedLink }) {
  const path = link.url.replace(/^https?:\/\/[^/]+/, "");
  return (
    <li className="space-y-1.5 py-2">
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="block text-sm text-ink-900 underline-offset-2 hover:underline">
        <span className="font-medium">{link.host}</span>
        <span className="break-all text-ink-500">{path.length > 1 ? path : ""}</span>
      </a>
      <span className="flex flex-wrap gap-1.5">
        {link.outletKeys.map((key) => (
          <OutletChip key={key} outletKey={key} />
        ))}
      </span>
    </li>
  );
}

/** All outlets and their articles of this news; opens downwards in the page. */
export function SourcesRow() {
  const { exploration, panel } = useExplore();
  const { input, index, findings } = exploration;
  const [open, setOpen] = useState(false);
  const bias = biasByOutlet(input);
  // Dutch outlets first, then foreign ones; each in order of their first article
  const outlets = [...input.outlets].sort((a, b) => Number(a.isInternational) - Number(b.isInternational));
  // Article → the text it shares with articles of other outlets (Story 14.27, under "Wie praat?")
  const copied = useMemo(() => {
    const map = new Map<number, string>();
    for (const finding of findings) {
      if (finding.body.type !== "copy") continue;
      for (const { article } of finding.body.group.articles) map.set(article.id, finding.id);
    }
    return map;
  }, [findings]);
  const demo = Boolean(input.event.isDemo);
  const shared = useMemo(() => sharedLinks(input.articles), [input.articles]);
  const press = useMemo(() => pressQuotesByArticle(input.documents), [input.documents]);
  const questions = useMemo(() => kamervragenByArticle(input.documents), [input.documents]);

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
            {copied.size > 0 ? ` · ${copied.size} met dezelfde tekst` : ""}
            {shared.length > 0 ? ` · ${shared.length} ${shared.length === 1 ? "pagina" : "pagina's"} die meer bronnen linken` : ""}
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
                    return (
                      <li key={id} className="flex gap-2 text-sm">
                        <PublishedAt article={article} />
                        <span className="min-w-0 flex-1">
                          <ArticleLink article={article} demo={demo} />
                          {copied.has(article.id) ? <SameText findingId={copied.get(article.id) as string} /> : null}
                          {article.digest ? <span className="mt-0.5 block text-xs text-ink-600">{article.digest.text}</span> : null}
                          {article.links?.length && !demo ? <ArticleLinks links={article.links} /> : null}
                          <ArticleTraces article={article} press={press.get(article.id) ?? []} questions={questions.get(article.id) ?? []} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          {shared.length > 0 && !demo ? (
            <li className="py-3">
              <h3 className="font-serif text-sm font-semibold text-ink-900">Dezelfde pagina gelinkt</h3>
              <ul className="divide-y divide-paper-200">
                {shared.map((link) => (
                  <SharedLinkRow key={link.url} link={link} />
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
