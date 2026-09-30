"use client";

import { useEffect, useMemo, useState } from "react";

import { buildScrubberModel, firstReporters, formatLag } from "@/lib/explore/timeline";

import { useExplore } from "../ExploreContext";
import { EntityText } from "../entity/EntityText";
import { OutletCard } from "../outlet/OutletCard";
import { Balloon } from "../ui/Balloon";
import { Eyebrow, Favicon } from "../ui/primitives";

const STEPS = 1000;
const dateTime = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function TimelineScrubber({ timelineClueIds }: { timelineClueIds: string[] }) {
  const { exploration, reveal, isRevealed } = useExplore();
  const { input, index, clueById } = exploration;
  const model = useMemo(() => buildScrubberModel(input), [input]);
  const [step, setStep] = useState(0);
  const t = model.start + ((model.end - model.start) * step) / STEPS;
  const span = model.end - model.start;
  const pos = (time: number) => `${((time - model.start) / span) * 100}%`;

  // Map timeline clues to LLM timeline indexes
  const clueForIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const id of timelineClueIds) {
      const clue = clueById.get(id);
      if (clue?.body.type !== "timeline") continue;
      const i = (input.insight?.timeline ?? []).indexOf(clue.body.item);
      if (i >= 0) map.set(i, id);
    }
    return map;
  }, [clueById, input.insight?.timeline, timelineClueIds]);

  const passedMarkers = model.markers.filter((marker) => marker.t <= t);
  const passedArticles = model.lanes.flatMap((lane) => lane.dots).filter((dot) => dot.t <= t);
  const order = useMemo(() => firstReporters(input), [input]);

  // Scrubbing reveals the moments you pass (and "who was first" once two outlets reported)
  useEffect(() => {
    const ids = passedMarkers.map((marker) => clueForIndex.get(marker.index)).filter((id): id is string => Boolean(id));
    if (step === STEPS) {
      model.history.forEach((marker) => {
        const id = clueForIndex.get(marker.index);
        if (id) ids.push(id);
      });
    }
    const outletsPassed = new Set(
      passedArticles.map((dot) => index.article(dot.articleId)?.outletKey).filter(Boolean),
    );
    if (outletsPassed.size >= 2) {
      const first = exploration.clues.find((clue) => clue.type === "first");
      if (first) ids.push(first.id);
    }
    if (ids.length) reveal(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const latest = passedMarkers[passedMarkers.length - 1];

  return (
    <div className="space-y-3 rounded-2xl border border-paper-300 bg-paper-50 p-3">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Tijdlijn-scrubber</Eyebrow>
        <span className="text-xs font-semibold text-ink-700">{dateTime.format(new Date(t))}</span>
      </div>

      {model.history.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-500">Voorgeschiedenis:</span>
          {model.history.map((marker) => {
            const id = clueForIndex.get(marker.index);
            const shown = id ? isRevealed(id) : false;
            return (
              <button
                key={marker.index}
                type="button"
                onClick={() => id && reveal([id])}
                className="min-h-[32px] rounded-full border border-paper-300 bg-paper-100 px-2.5"
                title={shown ? marker.headline : "Tik om te onthullen"}
              >
                {marker.label}
                {shown ? ` · ${marker.headline}` : ""}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-1.5">
        {/* markers */}
        <div className="relative ml-[84px] h-3">
          {model.markers.map((marker) => (
            <span
              key={marker.index}
              className={`absolute top-0 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] ${marker.t <= t ? "bg-accent-red" : "bg-paper-300"}`}
              style={{ left: pos(marker.t) }}
              aria-hidden="true"
            />
          ))}
        </div>
        {model.lanes.map((lane) => {
          const outlet = index.outlet(lane.outletKey);
          return (
            <div key={lane.outletKey} className="flex items-center gap-2">
              {outlet ? (
                <Balloon label={`Over ${outlet.name}`} placement="top" content={(close) => <OutletCard outletKey={outlet.key} onNavigate={close} />}>
                  {({ ref, props }) => (
                    <button
                      ref={ref}
                      {...props}
                      type="button"
                      className="flex min-h-[32px] w-[76px] shrink-0 items-center gap-1 rounded-md text-left text-[11px] text-ink-600 hover:bg-paper-100"
                    >
                      <Favicon name={lane.name} domain={outlet.domain} size={14} />
                      <span className="truncate underline decoration-paper-300 underline-offset-2">{lane.name}</span>
                    </button>
                  )}
                </Balloon>
              ) : (
                <span className="flex w-[76px] shrink-0 items-center gap-1 truncate text-[11px] text-ink-600">
                  <Favicon name={lane.name} size={14} />
                  <span className="truncate">{lane.name}</span>
                </span>
              )}
              <span className="relative h-6 flex-1 rounded-full bg-paper-100">
                {lane.dots.map((dot) => {
                  const article = index.article(dot.articleId);
                  const passed = dot.t <= t;
                  return (
                    <Balloon
                      key={dot.articleId}
                      label="Artikel"
                      width={260}
                      content={
                        <div className="space-y-1">
                          <p className="text-xs text-ink-500">
                            {lane.name} · {dateTime.format(new Date(dot.t))}
                          </p>
                          {article ? (
                            input.event.isDemo ? (
                              <p className="text-sm font-semibold text-ink-900">{article.title}</p>
                            ) : (
                              <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent-blue">
                                Lees bij {lane.name}: {article.title}
                              </a>
                            )
                          ) : null}
                        </div>
                      }
                    >
                      {({ ref, props }) => (
                        <button
                          ref={ref}
                          {...props}
                          type="button"
                          aria-label={`${lane.name}, ${dateTime.format(new Date(dot.t))}`}
                          className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                          style={{ left: pos(dot.t) }}
                        >
                          <span
                            className={`block h-3 w-3 rounded-full border-2 transition-colors ${passed ? "border-accent-blue bg-accent-blue" : "border-paper-300 bg-white"}`}
                          />
                        </button>
                      )}
                    </Balloon>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>

      <input
        type="range"
        min={0}
        max={STEPS}
        value={step}
        onChange={(event) => setStep(Number(event.target.value))}
        className="ml-[84px] w-[calc(100%-84px)] accent-accent-blue"
        aria-label="Tijd"
        aria-valuetext={`${dateTime.format(new Date(t))} — ${passedArticles.length} artikelen`}
      />

      <div className="rounded-xl bg-paper-100 p-3 text-sm text-ink-800">
        <p>
          <strong>{passedArticles.length}</strong> van {input.articles.length} artikelen verschenen
          {order.length ? (
            <>
              {" · eerst gemeld door "}
              <strong>{index.outlet(order[0].outletKey)?.name}</strong>
              {order[1] && passedArticles.length > 1
                ? `, ${index.outlet(order[1].outletKey)?.name} ${formatLag(order[1].lagMinutes)}`
                : ""}
            </>
          ) : null}
        </p>
        {latest ? (
          <p className="mt-1 font-semibold text-ink-900">
            ↳ <EntityText text={latest.headline} />
          </p>
        ) : null}
      </div>
    </div>
  );
}
