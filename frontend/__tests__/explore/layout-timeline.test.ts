import { deriveClues } from "@/lib/explore/clues";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import { buildExploreInput } from "@/lib/explore/input";
import {
  BUBBLE_CLOSED,
  BUBBLE_OPEN,
  bubbleBoxes,
  buildBubbleScene,
  layoutBubbles,
  type BubbleBox,
} from "@/lib/explore/layout/bubbles";
import { buildScrubberModel, firstReporters, formatLag, formatTimelineTime, parseTimelineTime } from "@/lib/explore/timeline";
import { parseWikiSearch, parseWikiSummary, wikiSearchUrl, wikiSummaryUrl } from "@/lib/explore/wikipedia";

function maxOverlap(layout: ReturnType<typeof layoutBubbles>): number {
  const placed = Array.from(layout.bubbles.values());
  let worst = 0;
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      const ox = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
      const oy = (a.height + b.height) / 2 - Math.abs(a.y - b.y);
      if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy));
    }
  }
  return worst;
}

function boxes(count: number, groups: number, open = 0): BubbleBox[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    group: `g${i % groups}`,
    ...(i < open ? BUBBLE_OPEN : BUBBLE_CLOSED),
  }));
}

describe("bubble layout", () => {
  it.each([
    [1, 1, 0],
    [12, 3, 3],
    [40, 5, 4],
  ])("places %i bubbles in %i groups without overlap on a 328px screen", (count, groups, open) => {
    const input = boxes(count, groups, open);
    const layout = layoutBubbles(input, Array.from({ length: groups }, (_, i) => `g${i}`), { width: 328, seed: 7 });
    expect(layout.bubbles.size).toBe(count);
    expect(maxOverlap(layout)).toBeLessThanOrEqual(2);
    for (const bubble of Array.from(layout.bubbles.values())) {
      expect(bubble.x - bubble.width / 2).toBeGreaterThanOrEqual(0);
      expect(bubble.x + bubble.width / 2).toBeLessThanOrEqual(layout.width);
      expect(bubble.y - bubble.height / 2).toBeGreaterThanOrEqual(0);
      expect(bubble.y + bubble.height / 2).toBeLessThanOrEqual(layout.height);
    }
    expect(layout.groups).toHaveLength(groups);
  });

  it("fits the dots of a closed bubble and makes room for readable group labels", () => {
    // favicon 20 + gap 8 + three dots 26 + padding 20 + border 4
    expect(BUBBLE_CLOSED.width).toBeGreaterThanOrEqual(78);

    // "Zonder invalshoek": the halo is wide enough for the whole label ("Zonde…" before)
    const single = layoutBubbles(boxes(2, 1), ["g0"], { width: 328, seed: 5, labelWidths: { g0: 127 } });
    const [halo] = single.groups;
    expect(halo.lines).toBe(1);
    expect(halo.width).toBeGreaterThanOrEqual(127 + 24);
    expect(halo.x).toBeGreaterThanOrEqual(4);
    expect(halo.x + halo.width).toBeLessThanOrEqual(328 - 4);
    // The pill sticks out 12px above the halo (inside the map) and ends 8px into it; bubbles start below it
    // with room for their float animation (4px)
    const top = Math.min(...Array.from(single.bubbles.values()).map((bubble) => bubble.y - bubble.height / 2));
    expect(halo.y - 12).toBeGreaterThanOrEqual(0);
    expect(top - (halo.y + 8)).toBeGreaterThanOrEqual(8);

    // A long label wraps to two lines instead of widening its halo past its column
    const labelWidths = { g0: 210, g1: 60, g2: 127 };
    const closed = layoutBubbles(boxes(12, 3), ["g0", "g1", "g2"], { width: 328, seed: 7, labelWidths });
    const [wrapped, short] = closed.groups;
    expect(wrapped.lines).toBe(2);
    expect(short.lines).toBe(1);
    expect(wrapped.width).toBeLessThanOrEqual(328 / 2);
    const wrappedTop = Math.min(
      ...Array.from(closed.bubbles.entries())
        .filter(([id]) => Number(id.slice(1)) % 3 === 0)
        .map(([, bubble]) => bubble.y - bubble.height / 2),
    );
    expect(wrappedTop - (wrapped.y - 12 + 34)).toBeGreaterThanOrEqual(8); // two lines: 34px high

    // Halos (with their labels sticking out above) never overlap each other, also with open bubbles
    const withOpen = layoutBubbles(boxes(12, 3, 3), ["g0", "g1", "g2"], { width: 328, seed: 7, labelWidths });
    for (const result of [closed, withOpen]) {
      const areas = result.groups.map((group) => ({ ...group, y: group.y - 12, height: group.height + 12 }));
      for (let i = 0; i < areas.length; i += 1) {
        for (let j = i + 1; j < areas.length; j += 1) {
          const a = areas[i];
          const b = areas[j];
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("is deterministic for the same seed", () => {
    const input = boxes(12, 3);
    const a = layoutBubbles(input, ["g0", "g1", "g2"], { width: 328, seed: 3 });
    const b = layoutBubbles(input, ["g0", "g1", "g2"], { width: 328, seed: 3 });
    expect(Array.from(a.bubbles.entries())).toEqual(Array.from(b.bubbles.entries()));
  });

  it("builds a scene from the demo event with lenses and contradiction lines", () => {
    const input = buildExploreInput(DEMO_EVENT);
    const clues = deriveClues(input);
    const scene = buildBubbleScene(input, clues);
    expect(scene.bubbles.length).toBeGreaterThanOrEqual(8);
    expect(scene.bubbles.every((bubble) => !bubble.outletKey.startsWith("dw"))).toBe(true);
    expect(scene.internationalCount).toBe(2);
    expect(scene.groupsByLens.invalshoek.map((group) => group.label)).toContain("Economische kans voor het dorp");
    expect(scene.contradictions).toHaveLength(2);
    expect(scene.groupsByLens.frame.some((group) => group.label === "Economisch")).toBe(true);

    // 2D spectrum map: links -> rechts (x) and gevestigd (top) -> alternatief (bottom) (y)
    const spectrumBoxes = bubbleBoxes(scene, "spectrum", new Set());
    const telegraaf = spectrumBoxes.find((box) => box.id.endsWith(":telegraaf"));
    expect(telegraaf?.xTarget).toBeCloseTo(0.7);
    expect(telegraaf?.yTarget).toBeCloseTo(0.15);
    const alternative = spectrumBoxes.find((box) => box.id.endsWith(":andere-krant"));
    expect(alternative?.group).toBe("s:main");
    expect(alternative?.xTarget).toBeCloseTo(0.6);
    expect(alternative?.yTarget).toBeCloseTo(0.9);

    const layout = layoutBubbles(spectrumBoxes, ["s:main"], { width: 328, seed: 9, minHeight: 400 });
    const nos = layout.bubbles.get(spectrumBoxes.find((box) => box.id.endsWith(":nos"))!.id)!;
    const andere = layout.bubbles.get(alternative!.id)!;
    expect(nos.y).toBeLessThan(andere.y); // gevestigd above alternatief
    const volkskrant = layout.bubbles.get(spectrumBoxes.find((box) => box.id.endsWith(":volkskrant"))!.id)!;
    const geenstijl = layout.bubbles.get(spectrumBoxes.find((box) => box.id.endsWith(":geenstijl"))!.id)!;
    expect(volkskrant.x).toBeLessThan(geenstijl.x); // links left of rechts

    const openBoxes = bubbleBoxes(scene, "invalshoek", new Set([scene.bubbles[0].id]));
    expect(openBoxes[0].width).toBe(BUBBLE_OPEN.width);
  });
});

describe("timeline", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  it("formats year-only, dates, datetimes and the 1970 bug", () => {
    expect(formatTimelineTime("1934")).toBe("1934");
    expect(parseTimelineTime("1934").yearOnly).toBe(true);
    expect(formatTimelineTime("1970-01-01T00:32:14Z", "Geboren in 1934")).toBe("1934");
    expect(formatTimelineTime("1970-01-01T00:32:14Z", "Zonder jaar")).toBe("–");
    expect(formatTimelineTime("2020-05-04", undefined, now)).toMatch(/2020$/);
    expect(formatTimelineTime("niet-een-datum")).toBe("niet-een-datum");
  });

  it("orders first reporters and formats lags", () => {
    const input = buildExploreInput(DEMO_EVENT);
    const order = firstReporters(input);
    expect(order[0].outletKey).toBe("nu-nl");
    expect(order[0].lagMinutes).toBe(0);
    expect(order.some((entry) => entry.outletKey === "dw")).toBe(false);
    expect(firstReporters(input, { includeInternational: true }).some((entry) => entry.outletKey === "dw")).toBe(true);
    expect(formatLag(0)).toBe("als eerste");
    expect(formatLag(39)).toBe("39 min later");
    expect(formatLag(180)).toBe("3 uur later");
    expect(formatLag(60 * 72)).toBe("3 dagen later");
  });

  it("splits history from markers in the scrubber model", () => {
    const input = buildExploreInput(DEMO_EVENT);
    const model = buildScrubberModel(input);
    expect(model.end).toBeGreaterThan(model.start);
    expect(model.history.map((item) => item.label)).toEqual(expect.arrayContaining(["2019"]));
    expect(model.markers.length).toBeGreaterThanOrEqual(3);
    for (const marker of model.markers) {
      expect(marker.t).toBeGreaterThanOrEqual(model.start);
      expect(marker.t).toBeLessThanOrEqual(model.end);
    }
    expect(model.lanes[0].isInternational).toBe(false);
    expect(model.lanes[model.lanes.length - 1].isInternational).toBe(true);
    expect(model.lanes.find((lane) => lane.outletKey === "nos")?.dots).toHaveLength(2);
  });
});

describe("wikipedia parsing", () => {
  it("builds urls", () => {
    expect(wikiSummaryUrl("Mark Rutte")).toBe("https://nl.wikipedia.org/api/rest_v1/page/summary/Mark_Rutte");
    expect(wikiSearchUrl("rutte", "en")).toContain("en.wikipedia.org/w/api.php?action=opensearch&search=rutte");
  });

  it("parses summaries incl. disambiguation", () => {
    const summary = parseWikiSummary({
      type: "standard",
      title: "Mediahuis",
      description: "bedrijf uit België",
      extract: "Mediahuis is een Belgisch mediabedrijf.",
      thumbnail: { source: "https://upload.wikimedia.org/x.png" },
      content_urls: { mobile: { page: "https://nl.m.wikipedia.org/wiki/Mediahuis" } },
    });
    expect(summary).toEqual({
      lang: "nl",
      title: "Mediahuis",
      description: "bedrijf uit België",
      extract: "Mediahuis is een Belgisch mediabedrijf.",
      thumbnail: "https://upload.wikimedia.org/x.png",
      url: "https://nl.m.wikipedia.org/wiki/Mediahuis",
      disambiguation: false,
    });
    expect(parseWikiSummary({ type: "disambiguation", title: "X", extract: "" })?.disambiguation).toBe(true);
    expect(parseWikiSummary({ title: 1 })).toBeNull();
    expect(parseWikiSummary(null)).toBeNull();
  });

  it("parses opensearch results", () => {
    expect(parseWikiSearch(["q", ["A", "B"], ["", "desc"], ["https://a", "https://b"]])).toEqual([
      { title: "A", description: null, url: "https://a" },
      { title: "B", description: "desc", url: "https://b" },
    ]);
    expect(parseWikiSearch({})).toEqual([]);
  });
});
