/**
 * @jest-environment jsdom
 */
import {
  earlierFromAdmin,
  earlierFromPublic,
  inPicture,
  missingVoicesInPicture,
  publicSearches,
  rankEarlier,
  voiceKey,
} from "@/lib/explore/earlier-searches";
import { buildExploration } from "@/lib/explore/exploration";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import { demoPublicVoiceSearches, demoRequestVoiceSearch, demoReviewVoiceCandidate } from "@/lib/explore/fixtures/demo-voices";
import { withOwn } from "@/lib/explore/own";
import type { VoiceCandidate, VoiceSearch } from "@/lib/voice-search";

const candidate = (id: string, url: string, verdict: VoiceCandidate["verdict"], extra: Partial<VoiceCandidate> = {}): VoiceCandidate => ({
  id,
  url,
  title: "Boeren in de polder",
  outlet: "Trouw",
  domain: "trouw.nl",
  is_international: false,
  country: "NL",
  published_at: null,
  who: "Gerrit Hofstede",
  gist: "Hij wil meepraten.",
  confidence: 0.8,
  verdict,
  article_id: verdict === "goedgekeurd" ? 12 : null,
  ...extra,
});

const search = (id: number, perspective: string, extra: Partial<VoiceSearch> = {}): VoiceSearch => ({
  id,
  event_id: 7,
  perspective,
  origin: "analyse",
  gap_key: null,
  status: "klaar",
  status_reason: null,
  candidates: [],
  created_at: `2026-10-07T1${id}:00:00Z`,
  finished_at: null,
  ...extra,
});

describe("Al gezocht met AI", () => {
  it("gives the admin one row per voice with what was approved and what is still open", () => {
    const rows = earlierFromAdmin([
      search(1, "Boeren op de polder", {
        gap_key: "gap:abc",
        candidates: [candidate("c1", "https://trouw.nl/a", "goedgekeurd"), candidate("c2", "https://ad.nl/b", "open")],
      }),
      // The same voice searched again, other case and spacing: still running
      search(3, "boeren  op de Polder ", { status: "bezig" }),
      search(2, "Juristen", { status: "fout" }),
      search(4, "Omwonenden", { candidates: [candidate("c1", "https://nos.nl/c", "afgewezen")] }),
    ]);
    expect(rows.map((row) => [row.perspective, row.state, row.found.length, row.open, row.gapKey])).toEqual([
      ["Omwonenden", "gezocht", 0, 0, null],
      ["boeren  op de Polder", "bezig", 1, 1, "gap:abc"],
    ]);
    expect(rows[1].found[0]).toEqual({
      url: "https://trouw.nl/a",
      title: "Boeren in de polder",
      outlet: "Trouw",
      domain: "trouw.nl",
      who: "Gerrit Hofstede",
      gist: "Hij wil meepraten.",
      article_id: 12,
    });
  });

  it("shows readers only what the admin approved", () => {
    const shown = publicSearches([
      search(1, "Boeren op de polder", {
        candidates: [candidate("c1", "https://trouw.nl/a", "goedgekeurd"), candidate("c2", "https://ad.nl/b", "open")],
      }),
    ]);
    expect(shown).toHaveLength(1);
    expect(shown[0].found.map((find) => find.url)).toEqual(["https://trouw.nl/a"]);
    const rows = earlierFromPublic(shown);
    expect(rows[0]).toMatchObject({ key: "boeren op de polder", open: 0, state: "gezocht" });
  });

  it("puts the voices like what you type first", () => {
    const rows = earlierFromAdmin([search(1, "Jongeren"), search(2, "Boeren op de polder"), search(3, "Juristen")]);
    expect(rankEarlier(rows, "").map((row) => row.perspective)).toEqual(["Juristen", "Boeren op de polder", "Jongeren"]);
    expect(rankEarlier(rows, "de boer").map((row) => row.perspective)).toEqual(["Boeren op de polder", "Juristen", "Jongeren"]);
    expect(voiceKey("  Boeren   op de Polder ")).toBe("boeren op de polder");
  });

  it("knows a voice that is in the picture already", () => {
    const exploration = buildExploration(DEMO_EVENT);
    const gap = exploration.findings.find((finding) => finding.body.type === "gap");
    expect(gap?.body.type).toBe("gap");
    if (!gap || gap.body.type !== "gap") return;
    const voices = missingVoicesInPicture(exploration.findings);
    const [row] = earlierFromAdmin([search(1, gap.body.gap.perspective.toUpperCase())]);
    expect(inPicture(row, exploration.findingById, voices)).toBe(gap.id);
    const [byKey] = earlierFromAdmin([search(1, "Iets anders", { gap_key: gap.id })]);
    expect(inPicture(byKey, exploration.findingById, voices)).toBe(gap.id);
    const [elsewhere] = earlierFromAdmin([search(1, "Iets anders", { gap_key: "own:van-de-admin" })]);
    expect(inPicture(elsewhere, exploration.findingById, voices)).toBeNull();

    // A voice you added yourself counts too
    const own = withOwn(exploration, [
      { id: "own:x", kind: "gap", text: "Iets anders", createdAt: "2026-10-07T21:00:00Z" },
    ]);
    expect(inPicture(elsewhere, own.findingById, missingVoicesInPicture(own.findings))).toBe("own:x");
  });

  it("works in the demo: readers see what was approved on this device", async () => {
    window.localStorage.clear();
    const eventId = DEMO_EVENT.event.id;
    const started = await demoRequestVoiceSearch(eventId, { perspective: "Boeren op de polder", origin: "analyse", gapKey: null });
    if (!started.ok) throw new Error("demo search did not start");
    // Not approved yet: the voice was searched, nothing to show
    jest.useFakeTimers({ now: Date.now() + 10_000 });
    let shown = await demoPublicVoiceSearches(eventId);
    expect(shown.map((row) => [row.perspective, row.found.length])).toEqual([["Boeren op de polder", 0]]);
    await demoReviewVoiceCandidate(started.search.id, "c1", "goedgekeurd");
    shown = await demoPublicVoiceSearches(eventId);
    expect(shown[0].found).toHaveLength(1);
    jest.useRealTimers();
  });
});
