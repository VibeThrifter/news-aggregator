/**
 * @jest-environment jsdom
 */
import { buildExploration } from "@/lib/explore/exploration";
import { buildFigure, foundVoicesFor } from "@/lib/explore/figure";
import { DEMO_EVENT, DEMO_EVENTS } from "@/lib/explore/fixtures/demo-event";
import { applyDemoVoices, demoRequestVoiceSearch, demoReviewVoiceCandidate, demoVoiceSearches } from "@/lib/explore/fixtures/demo-voices";
import { isOutletShown } from "@/lib/explore/layout/bubbles";
import type { RawExploration, RawExploreArticle } from "@/lib/explore/input";
import { withOwn } from "@/lib/explore/own";

const clone = (raw: RawExploration): RawExploration => JSON.parse(JSON.stringify(raw));

const found = (id: number, extra: Partial<RawExploreArticle> = {}): RawExploreArticle => ({
  id,
  title: "Boeren in de polder: 'niemand vraagt ons iets'",
  url: `https://www.trouw.nl/${id}`,
  source_name: "Trouw",
  published_at: "2026-09-29T05:30:00Z",
  is_international: false,
  source_country: "NL",
  spectrum: null,
  digest: null,
  found: { perspective: "Boeren op de polder", who: "Gerrit Hofstede, boer en verpachter", gist: "Hij wil meepraten over de turbines.", gap_key: null },
  ...extra,
});

describe("found voices", () => {
  it("speak in the outlet where they were found, with their role after the comma", () => {
    const raw = clone(DEMO_EVENT);
    raw.articles.push(found(-9001));
    const exploration = buildExploration(raw);
    const trouw = exploration.speakers.byOutlet.get("trouw") ?? [];
    expect(trouw).toHaveLength(1);
    expect(trouw[0]).toMatchObject({
      id: "trouw:gevonden--9001",
      name: "Gerrit Hofstede",
      role: "boer en verpachter",
      kind: "person",
      quote: "Hij wil meepraten over de turbines.",
      found: { perspective: "Boeren op de polder", articleId: -9001, gapKey: null },
    });
    expect(exploration.input.outlets.find((outlet) => outlet.key === "trouw")?.foundVoice).toBe(true);
  });

  it("answer the missing voice by its id, or by the same words", () => {
    const raw = clone(DEMO_EVENT);
    raw.articles.push(found(-9001));
    const exploration = buildExploration(raw);
    const missing = buildFigure(exploration, (outlet) => isOutletShown(outlet)).groups.find((group) => group.kind === "missing");
    const farmers = missing?.ghosts.find((ghost) => ghost.label === "Boeren op de polder");
    expect(farmers?.found).toEqual([{ speakerId: "trouw:gevonden--9001", outletKey: "trouw" }]);
    expect(missing?.ghosts.filter((ghost) => ghost.found).length).toBe(1);

    // A missing voice a reader added, found for that reader's entry
    const raw2 = clone(DEMO_EVENT);
    raw2.articles.push(found(-9002, { found: { perspective: "Jongeren uit het dorp", who: "Jongerenraad", gist: "Wij willen meepraten.", gap_key: "own:jong1" } }));
    const view = withOwn(buildExploration(raw2), [{ id: "own:jong1", kind: "gap", text: "Jongeren in Dijkerhoven", createdAt: "2026-10-03T10:00:00Z" }]);
    expect(foundVoicesFor(view.speakers, "own:jong1", "Jongeren in Dijkerhoven")).toHaveLength(1);
  });

  it("are in the picture also when found abroad", () => {
    expect(isOutletShown({ key: "vrt", isInternational: true })).toBe(false);
    expect(isOutletShown({ key: "vrt", isInternational: true, foundVoice: true })).toBe(true);
    expect(isOutletShown({ key: "vrt", isInternational: true, foundVoice: true }, { added: [], removed: ["vrt"] })).toBe(false);
  });
});

describe("the simulated search in the demo", () => {
  beforeEach(() => window.localStorage.clear());

  it("queues, searches, finds and adds an approved source to the demo news", async () => {
    const event = DEMO_EVENTS["demo-vervolg"] ?? Object.values(DEMO_EVENTS)[0];
    const request = await demoRequestVoiceSearch(event.event.id, { perspective: "Boeren met turbines op hun land", origin: "analyse", gapKey: "gap:x" });
    expect(request.ok && request.search.status).toBe("wachtrij");

    // Later: done, with what it found
    jest.useFakeTimers({ now: Date.now() + 5000 });
    const [search] = await demoVoiceSearches(event.event.id);
    expect(search.status).toBe("klaar");
    expect(search.candidates.map((candidate) => candidate.outlet)).toEqual(["Trouw", "RTL Nieuws"]);

    await demoReviewVoiceCandidate(search.id, "c1", "goedgekeurd");
    const raw = applyDemoVoices(clone(event));
    const added = raw.articles.find((article) => article.found);
    expect(added).toMatchObject({ source_name: "Trouw", found: { perspective: "Boeren met turbines op hun land", gap_key: "gap:x" } });

    await demoReviewVoiceCandidate(search.id, "c1", "open");
    expect(applyDemoVoices(clone(event)).articles.some((article) => article.found)).toBe(false);
    jest.useRealTimers();
  });

  it("finds nobody for a voice it has nothing for", async () => {
    const request = await demoRequestVoiceSearch(-1, { perspective: "Iets heel anders", origin: "eigen" });
    jest.useFakeTimers({ now: Date.now() + 5000 });
    const [search] = await demoVoiceSearches(-1);
    expect(request.ok).toBe(true);
    expect(search.status).toBe("niets_gevonden");
    jest.useRealTimers();
  });
});
