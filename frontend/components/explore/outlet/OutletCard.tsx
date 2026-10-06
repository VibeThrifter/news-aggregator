"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Network, Pin, Scale } from "lucide-react";

import { TAB_BY_ID } from "@/lib/explore/labels";
import { outletIndex, type IndexLine } from "@/lib/explore/lens-index";
import { OWNERSHIP_TYPE_LABELS } from "@/lib/explore/media-landscape";
import { perspectiveEstimates } from "@/lib/explore/nearest";
import { outletSentences } from "@/lib/explore/outlet-sentences";
import { useExploreStore } from "@/lib/explore/store";
import { getCountryFlag } from "@/lib/format";
import type { ExploreOutlet } from "@/lib/explore/types";

import { dossierIds, useExplore } from "../ExploreContext";
import { ArticleRow, articleDate } from "../entity/ArticleMentions";
import { Balloon } from "../ui/Balloon";
import { Chip, SubHeading, Favicon, Tag } from "../ui/primitives";
import { OwnTag } from "../map/OwnForm";
import { OthersAbout } from "../map/Others";
import { OwnAbout } from "../map/PeopleCards";

function AxisBar({ value, left, right, gradient, label }: { value: number; left: string; right: string; gradient: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-ink-500" aria-label={label}>
      <span className="w-16 text-right">{left}</span>
      <span className={`relative h-1.5 w-28 rounded-full bg-gradient-to-r ${gradient}`}>
        <span
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink-900 shadow"
          style={{ left: `${Math.min(100, Math.max(0, value * 100))}%` }}
        />
      </span>
      <span className="w-16">{right}</span>
    </div>
  );
}

/** Position of an outlet on both axes of the spectrum map (editorial estimates). */
export function OutletPosition({ outlet }: { outlet: ExploreOutlet }) {
  if (outlet.x === null && outlet.establishment === null) return null;
  return (
    <div className="space-y-1" title="Redactionele inschatting">
      {outlet.x !== null ? (
        <AxisBar
          value={outlet.x / 10}
          left="Links"
          right="Rechts"
          gradient="from-blue-400/70 via-paper-300 to-red-400/70"
          label={`Links-rechts: ${outlet.x} van 10`}
        />
      ) : null}
      {outlet.establishment !== null ? (
        <AxisBar
          value={(outlet.establishment + 1) / 2}
          left="Alternatief"
          right="Gevestigd"
          gradient="from-purple-400/70 via-paper-300 to-ink-400/70"
          label={`Gevestigd-alternatief: ${outlet.establishment}`}
        />
      ) : null}
    </div>
  );
}

/** A web link and its site ("nos.nl"); null for anything else. */
function articleLink(url: string | undefined): { href: string; host: string } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return { href: parsed.toString(), host: parsed.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

/** Everything about an outlet in this news: what it wrote, one line per tab, and actions. */
export function OutletCard({ outletKey, onNavigate }: { outletKey: string; onNavigate?: () => void }) {
  const { exploration, panel, pin, eventId, isPinned } = useExplore();
  const setCompareSlot = useExploreStore((state) => state.setCompareSlot);
  const [allArticles, setAllArticles] = useState(false);
  const [allSentences, setAllSentences] = useState(false);
  const outlet = exploration.index.outlet(outletKey);
  if (!outlet) return null;

  const perspective = exploration.findings.find(
    (finding) => finding.body.type === "perspective" && finding.body.stances.some((stance) => stance.outletKey === outletKey),
  );
  const estimate =
    perspective ? undefined : perspectiveEstimates(exploration.input, exploration.findings, exploration.index).get(outletKey);
  // What this outlet wrote: the summary sentences that name it (words of the analysis), then the
  // titles as links (never their content). Of a foreign article only the headline is known, so it
  // shows its Dutch gist (backend job "Article Digest") or "alleen de kop".
  const sentences = outlet.isInternational ? [] : (outletSentences(exploration.input).get(outletKey) ?? []);
  const articles = outlet.articleIds
    .map((id) => exploration.index.article(id))
    .filter((article): article is NonNullable<typeof article> => Boolean(article))
    .sort((a, b) => String(a.publishedAt ?? "").localeCompare(String(b.publishedAt ?? "")));
  const ownership = outlet.profile?.ownershipType;
  const networkHref = `/event/${encodeURIComponent(exploration.input.event.slug ?? String(eventId))}/netwerk${
    outlet.profile?.pmEntityId ? `?focus=${encodeURIComponent(`pm:${outlet.profile.pmEntityId}`)}` : ""
  }`;
  const canCompare = exploration.input.outlets.length >= 2;
  const pinId = dossierIds.outlet(outletKey);
  // Straight to the original article (the first, when there are more); demo articles do not exist
  const original = exploration.input.event.isDemo ? null : articleLink(articles[0]?.url);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Favicon name={outlet.name} domain={outlet.domain} size={28} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold text-ink-900">
            {outlet.name} {outlet.isInternational ? getCountryFlag(outlet.country) : ""}
            {outlet.own ? <OwnTag /> : null}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {ownership && ownership !== "unknown" ? (
              <Tag tone={ownership === "state" ? "red" : ownership === "public" ? "blue" : "neutral"}>{OWNERSHIP_TYPE_LABELS[ownership]}</Tag>
            ) : null}
            <Tag>
              {outlet.articleIds.length} {outlet.articleIds.length === 1 ? "artikel" : "artikelen"}
            </Tag>
          </div>
        </div>
      </div>

      {original ? (
        <a
          href={original.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[44px] items-center gap-2 rounded-xl bg-ink-900 px-3.5 text-sm font-semibold text-white hover:bg-ink-800"
        >
          <ExternalLink size={16} aria-hidden="true" />
          {articles.length > 1 ? "Naar het eerste artikel" : "Naar het artikel"}
          <span className="ml-auto truncate font-normal text-white/70">{original.host}</span>
        </a>
      ) : null}

      {!outlet.isInternational ? <OutletPosition outlet={outlet} /> : null}

      {perspective && perspective.body.type === "perspective" ? (
        <p className="text-sm text-ink-600">
          Invalshoek: <strong className="font-semibold text-ink-800">{perspective.body.cluster.label}</strong>
        </p>
      ) : estimate ? (
        <p className="text-sm text-ink-600">
          Geschatte invalshoek: <strong className="font-semibold text-ink-800">{estimate.label}</strong>
        </p>
      ) : null}

      {sentences.length || articles.length ? (
        <div className="space-y-1">
          <SubHeading>Wat schreef {outlet.name}?</SubHeading>
          {sentences.length ? (
            <ul className="space-y-1.5 pb-1 text-sm text-ink-800">
              {(allSentences ? sentences : sentences.slice(0, 1)).map((parts, i) => (
                <li key={i}>
                  {parts.map((part, j) =>
                    part.own ? (
                      <strong key={j} className="font-semibold text-ink-900">
                        {part.text}
                      </strong>
                    ) : (
                      <Fragment key={j}>{part.text}</Fragment>
                    ),
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {sentences.length > 1 && !allSentences ? (
            <button type="button" onClick={() => setAllSentences(true)} className="min-h-[40px] text-sm font-semibold text-accent-blue">
              {sentences.length === 2 ? "Nog 1 zin" : `Nog ${sentences.length - 1} zinnen`}
            </button>
          ) : null}
          <ul className="divide-y divide-paper-200">
            {(allArticles ? articles : articles.slice(0, 3)).map((article) =>
              article.digest ? (
                // A foreign article: what it reports in Dutch; tap for the article panel (headline, link)
                <li key={article.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate?.();
                      panel.open(`artikel:${article.id}`);
                    }}
                    className="flex min-h-[44px] w-full items-start gap-2 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink-900">{article.digest.text}</span>
                      <span className="mt-0.5 block text-xs text-ink-500">{articleDate(article.publishedAt)}</span>
                    </span>
                    <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden="true" />
                  </button>
                </li>
              ) : (
                <ArticleRow
                  key={article.id}
                  article={{ id: article.id, title: article.title, url: article.url, source_name: article.outletName, published_at: article.publishedAt }}
                  showSource={false}
                  note={article.isInternational ? "alleen de kop" : undefined}
                />
              ),
            )}
          </ul>
          {articles.length > 3 && !allArticles ? (
            <button type="button" onClick={() => setAllArticles(true)} className="min-h-[40px] text-sm font-semibold text-accent-blue">
              Alle {articles.length} artikelen
            </button>
          ) : null}
        </div>
      ) : null}

      <IndexLines lines={outletIndex(exploration, outletKey)} onNavigate={onNavigate} />

      <OwnAbout anchor={`outlet:${outletKey}`} onNavigate={onNavigate} />
      <OthersAbout anchor={`outlet:${outletKey}`} onNavigate={onNavigate} />

      <div className="flex flex-wrap gap-2">
        {canCompare ? (
          <Chip
            tone="blue"
            icon={<Scale size={14} />}
            onClick={() => {
              setCompareSlot(eventId, outletKey);
              onNavigate?.();
              // The sheet asks for the second outlet when there is none yet
              panel.open("vergelijk");
            }}
          >
            Vergelijk
          </Chip>
        ) : null}
        <Chip
          icon={<Pin size={14} />}
          aria-pressed={isPinned(pinId)}
          onClick={() =>
            pin({
              id: pinId,
              kind: "outlet",
              eventId: null,
              refId: outletKey,
              title: outlet.name,
              subtitle: outlet.profile?.ownershipType ? OWNERSHIP_TYPE_LABELS[outlet.profile.ownershipType] : undefined,
              outletKey,
              keys: [`outlet:${outletKey}`, ...(outlet.profile?.pmEntityId ? [`pm:${outlet.profile.pmEntityId}`] : [])],
            })
          }
        >
          {isPinned(pinId) ? "Bewaard" : "Bewaar"}
        </Chip>
        {outlet.profile?.pmEntityId ? (
          <Link
            href={networkHref}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 bg-paper-100 px-3 py-1 text-xs font-medium text-ink-700 hover:bg-paper-200"
          >
            <Network size={14} /> Wie zit erachter?
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** "In dit nieuws": one line per tab; a tap opens that tab at the first finding. */
export function IndexLines({ lines, onNavigate }: { lines: IndexLine[]; onNavigate?: () => void }) {
  const { toFinding, numbers } = useExplore();
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1">
      <SubHeading>In dit nieuws</SubHeading>
      <ul className="divide-y divide-paper-200 rounded-xl border border-paper-200">
        {lines.map((line) => {
          const nums = line.findingIds.map((id) => numbers.get(id)).filter((n): n is number => Boolean(n));
          return (
            <li key={line.tab}>
              <button
                type="button"
                disabled={line.findingIds.length === 0}
                onClick={() => {
                  onNavigate?.();
                  toFinding(line.findingIds[0]);
                }}
                className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper-100 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TAB_BY_ID[line.tab].color }} />
                <span className="w-[7.5rem] shrink-0 text-xs font-semibold text-ink-500">{TAB_BY_ID[line.tab].label}</span>
                <span className="min-w-0 flex-1 text-ink-800">{line.text}</span>
                {nums.length ? <span className="shrink-0 text-xs font-semibold text-ink-400">{nums.slice(0, 4).join(" ")}</span> : null}
                {line.findingIds.length ? <ChevronRight size={14} className="shrink-0 text-ink-400" aria-hidden="true" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Chip that opens the outlet balloon. */
export function OutletChip({ outletKey }: { outletKey: string }) {
  const { exploration } = useExplore();
  const outlet = exploration.index.outlet(outletKey);
  if (!outlet) return null;
  return (
    <Balloon label={`Over ${outlet.name}`} placement="top" content={(close) => <OutletCard outletKey={outletKey} onNavigate={close} />}>
      {({ ref, props }) => (
        <button
          ref={ref}
          {...props}
          type="button"
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-2.5 py-1 text-xs font-medium text-ink-800 hover:bg-paper-100"
        >
          <Favicon name={outlet.name} domain={outlet.domain} size={16} />
          {outlet.name}
        </button>
      )}
    </Balloon>
  );
}
