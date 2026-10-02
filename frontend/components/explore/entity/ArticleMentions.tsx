"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { getEntityArticles, searchArticles } from "@/lib/api";
import { coverageByOutlet } from "@/lib/explore/coverage";
import { parseIsoDate } from "@/lib/format";
import type { ArticleRef, EntityArticleGroup, EventEntity } from "@/lib/types";
import { exploreAuxSwrOptions } from "@/lib/swr-config";

import { useExplore } from "../ExploreContext";
import { Eyebrow, Favicon } from "../ui/primitives";

const dateFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

/** "29 sep 2026", or null without a valid date. */
export function articleDate(value: string | null | undefined): string | null {
  const published = parseIsoDate(value);
  return published ? dateFormatter.format(published) : null;
}

function eventHref(article: Pick<ArticleRef, "event_slug" | "event_id">): string | null {
  if (article.event_slug) return `/event/${encodeURIComponent(article.event_slug)}`;
  return article.event_id != null ? `/event/${article.event_id}` : null;
}

/** One article: favicon, source, date and the title as a link to the article (never its content). */
export function ArticleRow({
  article,
  showEvent = false,
  showSource = true,
  note,
}: {
  article: ArticleRef;
  showEvent?: boolean;
  showSource?: boolean;
  /** Extra text after the date ("alleen de kop") */
  note?: string;
}) {
  const { exploration } = useExplore();
  const demo = exploration.input.event.isDemo;
  const href = showEvent ? eventHref(article) : null;
  return (
    <li className="flex gap-2 py-1.5 text-sm">
      {showSource ? <Favicon name={article.source_name ?? "?"} size={16} className="mt-0.5 shrink-0" /> : null}
      <div className="min-w-0 flex-1">
        {demo ? (
          <p className="font-medium text-ink-900">{article.title}</p>
        ) : (
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 underline-offset-2 hover:underline">
            {article.title}
          </a>
        )}
        <p className="text-xs text-ink-500">
          {[showSource ? article.source_name : null, articleDate(article.published_at), note].filter(Boolean).join(" · ")}
          {href && article.event_id !== exploration.input.event.id ? (
            <>
              {" · "}
              <Link href={href} className="font-semibold text-accent-blue">
                {article.event_title ? `in: ${article.event_title}` : "naar dit nieuws"}
              </Link>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function ShowMore({ total, shown, onClick, label }: { total: number; shown: number; onClick: () => void; label: string }) {
  if (total <= shown) return null;
  return (
    <button type="button" onClick={onClick} className="min-h-[40px] text-sm font-semibold text-accent-blue">
      {label} ({total - shown})
    </button>
  );
}

const articlesLabel = (count: number) => (count === 1 ? "1 artikel" : `${count} artikelen`);
const outletsLabel = (count: number) => (count === 1 ? "1 medium" : `${count} media`);

interface OutletRow {
  name: string;
  domain?: string | null;
  /** Bar length: mentions or articles */
  value: number;
  valueLabel: string;
  articles: ArticleRef[];
}

/** Outlets with a bar; tap one to see what it wrote (the titles of its articles). */
function OutletRows({ rows, showEvent = false, initial = 6 }: { rows: OutletRow[]; showEvent?: boolean; initial?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...rows.map((row) => row.value));
  const shown = all ? rows : rows.slice(0, initial);
  return (
    <div>
      <ul className="space-y-0.5">
        {shown.map((row) => {
          const expanded = open === row.name;
          return (
            <li key={row.name}>
              <button
                type="button"
                aria-expanded={row.articles.length ? expanded : undefined}
                disabled={!row.articles.length}
                onClick={() => setOpen(expanded ? null : row.name)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-left text-sm hover:bg-paper-100 disabled:hover:bg-transparent"
              >
                <Favicon name={row.name} domain={row.domain} size={16} className="shrink-0" />
                <span className="w-28 shrink-0 truncate font-medium text-ink-900">{row.name}</span>
                <span className="h-2 min-w-[24px] flex-1 rounded-full bg-paper-200" aria-hidden="true">
                  <span className="block h-2 rounded-full bg-accent-blue" style={{ width: `${(row.value / max) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right text-xs text-ink-500">{row.valueLabel}</span>
                {row.articles.length ? (
                  <ChevronDown size={14} className={`shrink-0 text-ink-400 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                ) : (
                  <span className="w-3.5 shrink-0" aria-hidden="true" />
                )}
              </button>
              {expanded ? (
                <ul className="mb-2 ml-3 divide-y divide-paper-200 border-l-2 border-paper-200 pl-3" aria-label={`Wat ${row.name} schreef`}>
                  {row.articles.map((article) => (
                    <ArticleRow key={article.id} article={article} showEvent={showEvent} />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ShowMore total={rows.length} shown={shown.length} onClick={() => setAll(true)} label="Alle media" />
    </div>
  );
}

/** "Wie noemt X?" in this news: mentions per outlet, and per outlet the articles (what it wrote about X). */
export function MentionsByOutlet({ entity, name }: { entity: EventEntity | undefined; name: string }) {
  const { exploration } = useExplore();
  const { input, index } = exploration;
  const articles = (entity?.article_ids ?? [])
    .map((id) => index.article(id))
    .filter((article): article is NonNullable<typeof article> => Boolean(article))
    .sort((a, b) => String(a.publishedAt ?? "").localeCompare(String(b.publishedAt ?? "")));
  const mentions = entity?.outlet_counts ?? {};
  const names = Array.from(new Set([...Object.keys(mentions), ...articles.map((article) => article.outletName)]));
  const rows: OutletRow[] = names
    .map((outletName) => {
      const own = articles.filter((article) => article.outletName === outletName);
      const value = mentions[outletName] ?? own.length;
      return {
        name: outletName,
        domain: input.outlets.find((outlet) => outlet.name === outletName)?.domain,
        value,
        valueLabel: `${value}×`,
        articles: own.map((article) => ({ id: article.id, title: article.title, url: article.url, source_name: article.outletName, published_at: article.publishedAt })),
      };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "nl"));
  if (rows.length === 0) return null;
  const writers = new Set(articles.map((article) => article.outletName)).size;
  return (
    <section className="space-y-2" aria-label={`Wie noemt ${name}?`}>
      <Eyebrow>Wie noemt {name}?</Eyebrow>
      {articles.length ? (
        <p className="text-xs text-ink-500">
          <span className="font-semibold">
            Genoemd in {articlesLabel(articles.length)} van {outletsLabel(writers)}.
          </span>{" "}
          Tik op een medium voor wat het schreef.
        </p>
      ) : null}
      <OutletRows rows={rows} />
    </section>
  );
}

function useEntityArticles(aliases: string[], excludeEventId: number | null, kind: EventEntity["kind"] | null) {
  const { exploration } = useExplore();
  const demo = exploration.input.event.isDemo;
  return useSWR(
    aliases.length ? ["entity-articles", aliases.join("|"), excludeEventId ?? "alle", kind ?? "", demo] : null,
    () => getEntityArticles(aliases, { excludeEventId, kind, demo }),
    exploreAuxSwrOptions,
  );
}

/** The news items with the articles in each (the view "per nieuwsitem"). */
function EventGroups({ groups }: { groups: EntityArticleGroup[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <ul className="space-y-2">
      {groups.map((group) => {
        const shown = open[group.event_id] ? group.articles : group.articles.slice(0, 3);
        return (
          <li key={group.event_id} className="rounded-xl border border-paper-300 px-3 py-2">
            <Link
              href={`/event/${encodeURIComponent(group.event_slug ?? String(group.event_id))}`}
              className="flex min-h-[40px] items-center justify-between gap-2 text-sm hover:underline"
            >
              <span className="font-semibold text-ink-900">{group.event_title}</span>
              <span className="shrink-0 text-xs text-ink-500">{group.mention_count}× genoemd</span>
            </Link>
            {shown.length ? (
              <ul className="divide-y divide-paper-200 border-t border-paper-200">
                {shown.map((article) => (
                  <ArticleRow key={article.id} article={article} />
                ))}
              </ul>
            ) : null}
            <ShowMore
              total={group.articles.length}
              shown={shown.length}
              onClick={() => setOpen((state) => ({ ...state, [group.event_id]: true }))}
              label="Meer artikelen"
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Who wrote about an entity in the news (all news, or all but this item): per outlet with the titles
 * of what it wrote, or per news item.
 */
export function EntityCoverage({
  aliases,
  kind,
  excludeEventId,
  title,
}: {
  aliases: string[];
  kind: EventEntity["kind"] | null;
  excludeEventId: number | null;
  title: string;
}) {
  const [view, setView] = useState<"medium" | "nieuws">("medium");
  const { data, isLoading } = useEntityArticles(aliases, excludeEventId, kind);
  if (isLoading) return <div className="h-16 animate-pulse rounded-xl bg-paper-200" aria-label="Nieuws laden" />;
  if (!data?.length) return null;
  const outlets = coverageByOutlet(data);
  const total = outlets.reduce((sum, outlet) => sum + outlet.count, 0);
  const views = [
    { id: "medium" as const, label: "Per medium" },
    { id: "nieuws" as const, label: "Per nieuwsitem" },
  ];
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>{title}</Eyebrow>
        <div role="radiogroup" aria-label="Weergave" className="flex rounded-full border border-paper-300 p-0.5">
          {views.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={view === item.id}
              onClick={() => setView(item.id)}
              className={`min-h-[36px] rounded-full px-3 text-xs font-semibold ${view === item.id ? "bg-ink-900 text-white" : "text-ink-600"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {view === "medium" ? (
        <>
          <p className="text-xs text-ink-500">
            {articlesLabel(total)} van {outletsLabel(outlets.length)} in {data.length === 1 ? "1 nieuwsitem" : `${data.length} nieuwsitems`}
            {data.length >= 20 ? " (de 20 nieuwste)" : ""}.
          </p>
          <OutletRows
            rows={outlets.map((outlet) => ({ name: outlet.name, value: outlet.count, valueLabel: String(outlet.count), articles: outlet.articles }))}
            showEvent
          />
        </>
      ) : (
        <EventGroups groups={data} />
      )}
    </section>
  );
}

/** One line for a tooltip: which outlets wrote about the entity (favicons with counts). */
export function CoverageTeaser({ aliases, onOpen }: { aliases: string[]; onOpen: () => void }) {
  const { data } = useEntityArticles(aliases, null, null);
  const outlets = data ? coverageByOutlet(data) : [];
  if (outlets.length === 0) return null;
  const total = outlets.reduce((sum, outlet) => sum + outlet.count, 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Wie schreef erover: ${articlesLabel(total)} van ${outletsLabel(outlets.length)}`}
      className="flex min-h-[40px] w-full items-center gap-2 rounded-xl border border-paper-300 px-2 text-left text-xs hover:bg-paper-100"
    >
      <span className="shrink-0 font-semibold text-ink-700">In het nieuws</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {outlets.slice(0, 4).map((outlet) => (
          <span key={outlet.name} className="inline-flex shrink-0 items-center gap-0.5 text-ink-600" title={outlet.name}>
            <Favicon name={outlet.name} size={14} />
            {outlet.count}
          </span>
        ))}
        {outlets.length > 4 ? <span className="shrink-0 text-ink-500">+{outlets.length - 4}</span> : null}
      </span>
      <ChevronRight size={14} className="shrink-0 text-ink-400" aria-hidden="true" />
    </button>
  );
}

/** Search all articles (title, intro and text; only titles are shown), prefilled with the entity's name. */
export function ArticleSearch({ initialQuery }: { initialQuery: string }) {
  const { exploration } = useExplore();
  const demo = exploration.input.event.isDemo;
  const [text, setText] = useState(initialQuery);
  const [query, setQuery] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);
  const { data, error, isLoading } = useSWR(
    query ? ["article-search", query, limit, demo] : null,
    () => searchArticles(query as string, { demo, limit }),
    exploreAuxSwrOptions,
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = text.trim();
    if (q.length < 2) return;
    setLimit(10);
    setQuery(q);
  };

  return (
    <section className="space-y-2">
      <Eyebrow>Zoek in alle artikelen</Eyebrow>
      <form role="search" onSubmit={submit} className="flex gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-paper-300 bg-paper-50 px-3">
          <Search size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-[44px] w-full bg-transparent text-base outline-none sm:text-sm"
            aria-label="Zoekterm voor alle artikelen"
          />
        </label>
        <button type="submit" className="min-h-[44px] shrink-0 rounded-full bg-ink-900 px-4 text-sm font-semibold text-white">
          Zoek
        </button>
      </form>
      {isLoading ? <p className="text-sm text-ink-500">Zoeken…</p> : null}
      {error ? <p className="text-sm text-red-700">Zoeken lukt nu niet.</p> : null}
      {query && data === null ? <p className="text-sm text-ink-500">Zoeken in alle artikelen kan zodra de database is bijgewerkt.</p> : null}
      {query && data ? (
        data.total === 0 ? (
          <p className="text-sm text-ink-500">Niets gevonden voor “{query}”.</p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink-500">
              {data.total === 1 ? "1 artikel" : `${data.total} artikelen`} met “{query}”
            </p>
            <ul className="divide-y divide-paper-200">
              {data.items.map((article) => (
                <ArticleRow key={article.id} article={article} showEvent />
              ))}
            </ul>
            {data.total > data.items.length && limit < 50 ? (
              <button type="button" onClick={() => setLimit((value) => Math.min(50, value + 20))} className="min-h-[40px] text-sm font-semibold text-accent-blue">
                Meer resultaten
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}
