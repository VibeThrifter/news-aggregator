"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight, Network, Pin, Scale, ScanText } from "lucide-react";

import { biasByOutlet, objectivity } from "@/lib/explore/bias";
import { perspectiveEstimates } from "@/lib/explore/nearest";
import { outletSentences } from "@/lib/explore/outlet-sentences";
import { revealedTitle } from "@/lib/explore/clues";
import { OWNERSHIP_TYPE_LABELS } from "@/lib/explore/media-landscape";
import { SPOOR_BY_ID, toneLabel } from "@/lib/explore/labels";
import { useExploreStore } from "@/lib/explore/store";
import { getCountryFlag } from "@/lib/format";
import type { ExploreOutlet } from "@/lib/explore/types";

import { SPOOR_COLORS, dossierIds, useExplore } from "../ExploreContext";
import { ArticleRow, articleDate } from "../entity/ArticleMentions";
import { useToast } from "../ui/Toast";
import { Balloon } from "../ui/Balloon";
import { Chip, Eyebrow, Favicon, Tag } from "../ui/primitives";
import { WhyRoutes } from "./WhyRoutes";

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

/** Everything about an outlet in this event, with click-through to its clues. */
export function OutletCard({ outletKey, onNavigate }: { outletKey: string; onNavigate?: () => void }) {
  const { exploration, isRevealed, panel, pin, eventId } = useExplore();
  const setCompareSlot = useExploreStore((state) => state.setCompareSlot);
  const toast = useToast();
  const [allArticles, setAllArticles] = useState(false);
  const [allSentences, setAllSentences] = useState(false);
  const outlet = exploration.index.outlet(outletKey);
  if (!outlet) return null;

  const clues = exploration.clues.filter((clue) => clue.outletKeys.includes(outletKey));
  // The perspectives are visible in the bubbles right away, so here too
  const perspectives = clues.filter((clue) => clue.body.type === "perspective");
  const estimate = perspectives.length === 0 ? perspectiveEstimates(exploration.input, exploration.clues, exploration.index).get(outletKey) : undefined;
  // What this outlet wrote in this news: the summary sentences that name it (words of the analysis),
  // then the titles as links to the articles (never their content). Google News only gives a foreign
  // article's headline, so what the summary says about it is a guess; instead a foreign article shows
  // its Dutch gist (backend job "Article Digest"), or "alleen de kop" until it has one.
  const sentences = outlet.isInternational ? [] : (outletSentences(exploration.input).get(outletKey) ?? []);
  const articles = outlet.articleIds
    .map((id) => exploration.index.article(id))
    .filter((article): article is NonNullable<typeof article> => Boolean(article))
    .sort((a, b) => String(a.publishedAt ?? "").localeCompare(String(b.publishedAt ?? "")));
  const tone = clues.find((clue) => clue.body.type === "tone" && isRevealed(clue.id));
  const bias = biasByOutlet(exploration.input).get(outletKey);
  const ownership = outlet.profile?.ownershipType;
  const networkHref = `/event/${encodeURIComponent(exploration.input.event.slug ?? String(eventId))}/netwerk?focus=${encodeURIComponent(`outlet:${outletKey}`)}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Favicon name={outlet.name} domain={outlet.domain} size={28} />
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">
            {outlet.name} {outlet.isInternational ? getCountryFlag(outlet.country) : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {ownership && ownership !== "unknown" ? (
              <Tag tone={ownership === "state" ? "red" : ownership === "public" ? "blue" : "neutral"}>
                {OWNERSHIP_TYPE_LABELS[ownership]}
              </Tag>
            ) : null}
            <Tag>
              {outlet.articleIds.length} {outlet.articleIds.length === 1 ? "artikel" : "artikelen"}
            </Tag>
          </div>
        </div>
      </div>

      {!outlet.isInternational ? <OutletPosition outlet={outlet} /> : null}

      <div className="flex flex-wrap gap-2">
        {!outlet.isInternational ? (
          <Chip
            tone="blue"
            icon={<Scale size={14} />}
            onClick={() => {
              setCompareSlot(eventId, outletKey);
              onNavigate?.();
              const { compare } = useExploreStore.getState();
              if (compare.eventId === eventId && compare.a && compare.b) {
                panel.open("vergelijk");
              } else {
                toast(`${outlet.name} staat klaar. Kies nog een bron om mee te vergelijken.`);
              }
            }}
          >
            Vergelijk
          </Chip>
        ) : null}
        <Chip
          icon={<Pin size={14} />}
          onClick={() =>
            pin({
              id: dossierIds.outlet(outletKey),
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
          Bewaar
        </Chip>
        {bias && bias.sentenceCount > 0 ? (
          <Chip
            tone="purple"
            icon={<ScanText size={14} />}
            onClick={() => {
              onNavigate?.();
              panel.open(`bias:${outletKey}`);
            }}
          >
            Bias-zinnen
          </Chip>
        ) : null}
        <Link
          href={networkHref}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-paper-300 bg-paper-100 px-3 py-1 text-xs font-medium text-ink-700 hover:bg-paper-200"
        >
          <Network size={14} /> Netwerk
        </Link>
      </div>

      {perspectives.map((clue) =>
        clue.body.type === "perspective" ? (
          <div key={clue.id} className="rounded-xl bg-paper-100 p-3">
            <Eyebrow>{clue.body.cluster.label}</Eyebrow>
            <p className="mt-1 text-sm italic text-ink-800">
              “{clue.body.stances.find((stance) => stance.outletKey === outletKey)?.stance ?? clue.body.cluster.summary}”
            </p>
          </div>
        ) : null,
      )}

      {estimate ? (
        <p className="text-sm text-ink-600">
          Geschatte invalshoek: <strong className="font-semibold text-ink-800">{estimate.label}</strong>
        </p>
      ) : null}

      {sentences.length || articles.length ? (
        <div className="space-y-1">
          <Eyebrow>Wat schreef {outlet.name}?</Eyebrow>
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

      <WhyRoutes outletKey={outletKey} />

      {tone && tone.body.type === "tone" ? (
        <p className="text-sm">
          <span className="text-ink-500">Toon: </span>
          <strong>{toneLabel(tone.body.analysis.tone)}</strong>
        </p>
      ) : null}

      {bias ? (
        <p className="text-sm">
          <span className="text-ink-500">Objectiviteit eigen tekst: </span>
          <strong>{objectivity(bias.averageRating)}%</strong>
          <span className="text-ink-500"> · {bias.sentenceCount} gekleurde zinnen</span>
        </p>
      ) : null}

      {clues.length > 0 ? (
        <div className="space-y-1.5">
          <Eyebrow>Aanwijzingen bij {outlet.name}</Eyebrow>
          <ul className="space-y-1">
            {clues.slice(0, 8).map((clue) => (
              <li key={clue.id}>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate?.();
                    panel.open(`spoor:${clue.spoor}`, { c: clue.id });
                  }}
                  className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-paper-100"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: SPOOR_COLORS[clue.spoor] }}
                  />
                  <span className="flex-1 truncate">
                    {isRevealed(clue.id) ? revealedTitle(clue, exploration.index) : clue.teaser.title}
                  </span>
                  <span className="text-[11px] text-ink-400">
                    {isRevealed(clue.id) ? "✓" : SPOOR_BY_ID[clue.spoor].question.replace("?", "")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
