"use client";

import { useState } from "react";
import useSWR from "swr";

import { getWikipediaSummary, searchWikipedia } from "@/lib/api";
import { isSameTitle, wikiSearchPageUrl, wikiTitleCandidates, type WikiCandidate, type WikiSummary } from "@/lib/explore/wikipedia";
import { wikipediaSwrOptions } from "@/lib/swr-config";

import { Chip } from "../ui/primitives";

interface WikiResult {
  summary: WikiSummary | null;
  /** Only for disambiguation pages: "Bedoel je…?" */
  candidates: WikiCandidate[];
}

/**
 * Find the Wikipedia page for a name: exact title (and the parts of "X (Y)") on nl, then an nl search
 * hit with the same title, then en. Nothing found = nothing shown, rather than a wrong page.
 */
export async function loadWikipedia(name: string): Promise<WikiResult> {
  const titles = wikiTitleCandidates(name);
  for (const title of titles) {
    const nl = await getWikipediaSummary(title, "nl").catch(() => null);
    if (nl?.disambiguation) return { summary: null, candidates: await searchWikipedia(title, "nl").catch(() => []) };
    if (nl) return { summary: nl, candidates: [] };
  }
  const hits = await searchWikipedia(name, "nl").catch(() => []);
  const same = hits.find((hit) => isSameTitle(hit.title, name));
  if (same) {
    const nl = await getWikipediaSummary(same.title, "nl").catch(() => null);
    if (nl && !nl.disambiguation) return { summary: nl, candidates: [] };
  }
  const en = await getWikipediaSummary(titles[0] ?? name, "en").catch(() => null);
  if (en && !en.disambiguation) return { summary: en, candidates: [] };
  return { summary: null, candidates: [] };
}

export function useWikipedia(name: string | null | undefined) {
  return useSWR(name ? ["wikipedia", name] : null, () => loadWikipedia(name as string), wikipediaSwrOptions);
}

/** One line from Wikipedia ("Nederlands journaliste") for compact places like network tooltips. */
export function WikiDescription({ name }: { name: string }) {
  const { data } = useWikipedia(name);
  const summary = data?.summary;
  if (!summary?.description) return null;
  return (
    <p className="text-xs text-ink-500">
      {summary.description}{" "}
      <a href={summary.url} target="_blank" rel="noopener noreferrer" className="underline" aria-label={`${summary.title} op Wikipedia`}>
        (Wikipedia)
      </a>
    </p>
  );
}

/** Wikipedia background (extract, thumbnail, attribution) that loads by itself. */
export function WikipediaBlock({ name }: { name: string }) {
  const [chosen, setChosen] = useState(name);
  const { data, error, isLoading } = useWikipedia(chosen);

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-xl bg-paper-200" aria-label="Wikipedia laden" />;
  }
  if (error) {
    return <p className="text-sm text-ink-500">Wikipedia is nu niet bereikbaar.</p>;
  }
  if (data?.summary) {
    const summary = data.summary;
    return (
      <div className="space-y-2 rounded-xl border border-paper-300 bg-paper-100 p-3">
        <div className="flex gap-3">
          {summary.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={summary.thumbnail} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" />
          ) : null}
          <div>
            <p className="font-semibold text-ink-900">{summary.title}</p>
            {summary.description ? <p className="text-xs text-ink-500">{summary.description}</p> : null}
          </div>
        </div>
        <p className="text-sm leading-relaxed text-ink-800">{summary.extract}</p>
        <p className="text-[11px] text-ink-500">
          Bron:{" "}
          <a href={summary.url} target="_blank" rel="noopener noreferrer" className="underline">
            Wikipedia{summary.lang !== "nl" ? ` (${summary.lang})` : ""}
          </a>{" "}
          · CC BY-SA 4.0 · automatisch gevonden op naam
        </p>
      </div>
    );
  }
  if (data?.candidates.length) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-600">Bedoel je…?</p>
        <div className="flex flex-wrap gap-1.5">
          {data.candidates.map((candidate) => (
            <Chip key={candidate.title} onClick={() => setChosen(candidate.title)}>
              {candidate.title}
            </Chip>
          ))}
        </div>
      </div>
    );
  }
  return (
    <p className="text-sm text-ink-500">
      Geen Wikipedia-pagina gevonden.{" "}
      <a href={wikiSearchPageUrl(name)} target="_blank" rel="noopener noreferrer" className="underline">
        Zelf zoeken
      </a>
    </p>
  );
}
